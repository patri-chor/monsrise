// ============================================================
// 引擎桥接服务：Node 持久化进程 + stdio JSONL 协议
// Python 训练端（RL 栈）通过子进程与本服务通信，复用 TS 战斗引擎
// 请求（每行一个 JSON）：{"id":n,"type":"...","...":"..."}
//   响应：{"id":n,"ok":true,...} 或 {"id":n,"ok":false,"error":"..."}
// 运行：npx vite-node --script src/engine/bridge.ts
// ============================================================

import './env';
import readline from 'node:readline';
import { createRequire } from 'node:module';
import { registerAllBadges } from '../game/BadgeSystem';
import { gameEngine } from '../game/GameEngine';
import type { PlacedMonster } from '../game/GameEngine';
import { battleSystem } from '../game/BattleSystem';
import { DB_MONSTERS, DB_BADGES } from '../game/Database';
import { FORMATION_LIBRARY } from '../ai/formation_library';
import { simulateRoundBattle, newSimMonster } from './placement/search';

registerAllBadges();
gameEngine.restartGame();

// ---------- ai-bundle（原网页手工启发式 AI）加载 ----------
// 该 bundle 是浏览器 IIFE（模块末尾引用 window），Node 加载前先补 window shim；
// 加载后其内部 console.log 会污染 stdio JSONL 协议，调用时需临时静默。
(globalThis as any).window = globalThis;
const __require = createRequire(import.meta.url);
let BundleAI: any = null;
try {
  let mod: any = null;
  try {
    mod = __require('../../public/ai-bundle.iife.js');
  } catch (e) {
    mod = __require('../ai-bundle.iife.js');
  }
  BundleAI = (globalThis as any).BattleAI ?? mod.BattleAI ?? mod?.default?.BattleAI ?? mod?.default ?? mod;
  if (typeof BundleAI !== 'function' && BundleAI?.BattleAI) {
    BundleAI = BundleAI.BattleAI;
  }
} catch (e) {
  process.stderr.write(`[bridge] ai-bundle 加载失败: ${(e as Error).message}\n`);
}

/** 静默执行 bundle 调用（其内部 console.log/warn 会破坏 JSONL 协议） */
function quiet<T>(fn: () => T): T {
  const log = console.log;
  const warn = console.warn;
  const err = console.error;
  console.log = () => {};
  console.warn = () => {};
  console.error = () => {};
  try {
    return fn();
  } finally {
    console.log = log;
    console.warn = warn;
    console.error = err;
  }
}

/** 组装 bundle 所需局面：board[5][11] + players.deployed（怪物在己方半区的放置结果） */
function buildBundleState(
  side: 'p1' | 'p2',
  round: number,
  my: { dbId: number; x: number; y: number }[],
  enemy: { dbId: number; x: number; y: number }[],
  budget: number,
): any {
  const board: any[][] = [];
  for (let y = 0; y < 5; y++) board.push(new Array(11).fill(null));
  // 统一转到 p2 视角：bundle 原生假设 AI 在 p2（右侧 x6-10）、对手在 p1（左侧 x0-4）。
  // side='p1' 时若直接喂真实坐标（己方 x0-4 / 敌方 x6-10），与 bundle 空间假设相反，
  // 会导致 selectBranch/applyVariant/computeSpecialPosition 等依赖坐标的逻辑错位
  // （表现为先手/后手行为不对称）。故喂入前先把所有坐标镜像到 p2 视角。
  const toP2 = (m: { dbId: number; x: number; y: number }): { dbId: number; x: number; y: number } =>
    side === 'p1' ? { dbId: m.dbId, x: 10 - m.x, y: m.y } : m;
  const myV = my.map(toP2);
  const enemyV = enemy.map(toP2);
  const fill = (list: { dbId: number; x: number; y: number }[], owner: 'p1' | 'p2'): any[] => {
    const deployed: any[] = [];
    list.forEach((m, i) => {
      const inst = { instanceId: i + 1, monsterId: m.dbId, badgeIds: [], position: { x: m.x, y: m.y }, owner };
      board[m.y][m.x] = inst;
      deployed.push(inst);
    });
    return deployed;
  };
  // bundle 原生假设 AI 在 p2（selectBranch 固定把 players.p1 当对手），
  // 我方恒填 players.p2，对手填 players.p1，保持分支匹配语义一致
  const players: any = {
    p1: { side: 'p1', deployed: [], remainingBudget: 4 },
    p2: { side: 'p2', deployed: [], remainingBudget: 4 },
  };
  players.p1.deployed = fill(enemyV, 'p1');
  players.p2.deployed = fill(myV, 'p2');
  players.p2.remainingBudget = budget; // 我方恒为 p2 角色，预算给 players.p2
  return {
    board,
    players,
    round,
    phase: 'placing',
    currentPlayer: side,
    nextInstanceId: 99,
  };
}

/** 持久化 BattleAI 实例（按 session 复用：同局跨回合共享同一阵型与 deployedIds） */
const bundleSessions = new Map<string, any>();

/** ai-bundle 整回合计划：一次生成阵型计划（decide() 逐次消费会因 selectBranch/分支
 *  重随机导致计划漂移，且只消费 placements[0]，故直接用 decideWithFormation 取全量）。
 *  formation 传卡组名时强制加载对应阵型（引擎侧已知 deck→阵型 的精确映射，
 *  绕开 bundle 内置 matcher 的误识别/随机换阵型问题）。 */
/** 变体随机化（镜像/平移）会让放置落点与其他已放置怪冲突；
 *  原版 bundle 只做区间 clamp、不查占用，冲突落点会被直接丢弃 → 预算浪费。
 *  此处兜底：丢弃前先就近寻找己方半区最近空闲格重定位。 */
function relocateNear(
  x: number, y: number,
  side: 'p1' | 'p2',
  occupied: Set<number>,
  debug: boolean, monsterId: number,
): [number, number] | null {
  const lo = side === 'p1' ? 0 : 6;
  const hi = side === 'p1' ? 4 : 10;
  for (let d = 1; d <= 8; d++) {
    for (let dy = -d; dy <= d; dy++) {
      for (let dx = -d; dx <= d; dx++) {
        if (Math.abs(dx) + Math.abs(dy) !== d) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < lo || nx > hi || ny < 0 || ny > 4) continue;
        if (occupied.has(nx * 10 + ny)) continue;
        if (debug) process.stderr.write(`  [重定位] ${monsterId}@(${x},${y}) → (${nx},${ny})\n`);
        return [nx, ny];
      }
    }
  }
  return null;
}

function bundleRoundPlan(
  session: string | undefined,
  side: 'p1' | 'p2',
  round: number,
  budget: number,
  hand: { monsterId: number; badgeIds: number[] }[],
  my: { dbId: number; x: number; y: number }[],
  enemy: { dbId: number; x: number; y: number }[],
  formationName?: string,
  debug = false,
): { monsterId: number; x: number; y: number }[] {
  if (!BundleAI || hand.length === 0) return [];
  const key = session ?? `anon_${Math.random().toString(36).slice(2)}`;
  let ai = bundleSessions.get(key);
  if (!ai) {
    ai = new BundleAI();
    bundleSessions.set(key, ai);
  }
  const fe = ai.pipeline.getFormationEngine();
  const cur = fe.getSelectedFormation();
  try {
    ai.hand = hand;
    if (formationName && cur?.name !== formationName) {
      const f = FORMATION_LIBRARY.find(fm => fm.name === formationName);
      if (f) {
        ai.buildTeam(hand);
        fe.loadCustomFormation(f as any);
      } else {
        if (!cur) ai.buildTeam(hand);
      }
    } else if (!cur) {
      ai.buildTeam(hand);
    }
  } catch (e) {
    process.stderr.write(`[bridge] bundle 阵型加载失败: ${(e as Error).stack || (e as Error).message}\n`);
    return [];
  }
  const plan: { monsterId: number; x: number; y: number }[] = [];
  const occupied = new Set(my.map(m => m.x * 10 + m.y));
  let curBudget = budget;
  const inHand = new Set(hand.map(h => h.monsterId));
  let placements: any[] = [];
  try {
    const st = buildBundleState(side, round, my, enemy, curBudget);
    const raw = quiet(() => ai.pipeline.decideWithFormation(hand, round, st));
    placements = raw?.placements ?? [];
  } catch (e) {
    process.stderr.write(`[bridge] bundle_plan 失败: ${(e as Error).stack || (e as Error).message}\n`);
    return [];
  }
  for (const a of placements) {
    if (debug) process.stderr.write(`[bundle-debug R${round}] 原始放置 ${a.monsterId}@(${a.x},${a.y})`);
    if (!inHand.has(a.monsterId)) {
      if (debug) process.stderr.write(`  [丢弃] 手牌无 ${a.monsterId}\n`);
      continue; // 阵型模板可能引用手牌外卡
    }
    const cost = ai.getMonster(a.monsterId)?.cost ?? 0;
    if (cost > curBudget) {
      if (debug) process.stderr.write(`  [丢弃] 费用 ${cost} > 预算 ${curBudget}\n`);
      continue;
    }
    // 树坐标以 p2 视角标注，p1 侧镜像；再过滤己方半区 + 空格
    let ax = a.x;
    if (side === 'p1') ax = 10 - ax;
    const lo = side === 'p1' ? 0 : 6;
    const hi = side === 'p1' ? 4 : 10;
    if (ax < lo || ax > hi || occupied.has(ax * 10 + a.y)) {
      // 变体冲突落点：就近重定位到空闲格（原版 bundle 直接丢弃导致预算浪费）。
      // BUNDLE_RELOCATE=0 可关闭（A/B 对照验证重定位效果）
      if (process.env.BUNDLE_RELOCATE === '0') {
        if (debug) process.stderr.write(`  [丢弃] 镜像后(${ax},${a.y}) 越界或占用\n`);
        continue;
      }
      const r = relocateNear(ax, a.y, side, occupied, debug, a.monsterId);
      if (!r) {
        if (debug) process.stderr.write(`  [丢弃] 镜像后(${ax},${a.y}) 越界或占用且无空闲格\n`);
        continue;
      }
      ax = r[0];
      a.y = r[1];
      if (debug) process.stderr.write(`  [采用] ${a.monsterId}@(${ax},${a.y}) 费${cost}\n`);
      occupied.add(ax * 10 + a.y);
      plan.push({ monsterId: a.monsterId, x: ax, y: a.y });
      curBudget -= cost;
      continue;
    }
    if (debug) process.stderr.write(`  [采用] ${a.monsterId}@(${ax},${a.y}) 费${cost}\n`);
    occupied.add(ax * 10 + a.y);
    plan.push({ monsterId: a.monsterId, x: ax, y: a.y });
    curBudget -= cost;
  }
  return plan;
}

interface WireMonster {
  dbId: number;
  x: number;
  y: number;
  team: 1 | 2;
  badgeIds: number[];
}

/** 桥接输入的轻量怪 → 完整 PlacedMonster（startBattle 会重置战斗属性，无需 hp 等字段） */
function toPlaced(m: WireMonster, round: number): PlacedMonster {
  return newSimMonster({ monsterId: m.dbId, badgeIds: m.badgeIds, x: m.x, y: m.y }, m.team, round);
}

function handle(req: Record<string, any>): Record<string, any> {
  switch (req.type) {
    case 'ping':
      return { pong: true, engine: 'monsrise' };

    // 回合战斗模拟（MCTS rollout + self-play 推进）：给定任意棋盘 → 回合结果 + 幸存者
    case 'simulate': {
      const round = Number(req.round ?? 1);
      const board = (req.board as WireMonster[]).map(m => toPlaced(m, round));
      // 覆盖战斗随机种子（self-play 多样性）；请求缺省时保持确定性
      if (typeof req.seed === 'number') (battleSystem as any)._overrideSeed = req.seed;
      try {
        const o = simulateRoundBattle(board, round, Number(req.timeout ?? 40));
        return {
          d1: o.d1, d2: o.d2,
          hpP1: o.hpP1, hpP2: o.hpP2,
          killsP1: o.killsP1, killsP2: o.killsP2,
          survivors: o.survivors,
        };
      } finally {
        delete (battleSystem as any)._overrideSeed;
      }
    }

    // 怪兽/徽章数据库（Python 端状态编码与动作合法性用，静态数据一次拉取）
    case 'db':
      return {
        monsters: DB_MONSTERS.map(m => ({
          id: m.id, name: m.name, cost: m.cost, type: m.type,
          hp: m.hp, atk: m.atk, ats: m.ats, range: m.range, speed: m.speed,
          skill: m.skill, skillCd: m.skillCd, role: m.role, race: m.race,
        })),
        badges: DB_BADGES.map(b => ({ id: b.id, name: b.name })),
      };

    // 阵型库卡组（self-play 配对用：monsterId + badgeIds + 完整阵型树）
    // tree 为完整 FormationTree（开局/各回合计划/分支应变），Python 端做
    // 卡组树先验（"先学自身布阵策略"）与 R1-R2 强制树计划（forceTreeRounds）用。
    case 'formations':
      return {
        formations: FORMATION_LIBRARY.map(f => ({
          name: f.name,
          team: f.team.filter(s => s.monsterId > 0).map(s => ({ monsterId: s.monsterId, badgeIds: s.badgeIds })),
          tree: f.tree ?? null,
        })),
      };

    // ai-bundle（原网页手工启发式 AI）整回合放置计划：树计划 + 变体随机化
    case 'bundle_plan': {
      const side: 'p1' | 'p2' = req.side === 'p1' ? 'p1' : 'p2';
      const round = Number(req.round ?? 1);
      const budget = Number(req.budget ?? 4);
      const session = req.session ? String(req.session) : undefined;
      const formation = req.formation ? String(req.formation) : undefined;
      const rawHand = req.hand ?? [];
      const hand = (rawHand as any[]).map(h => {
        const mid = typeof h === 'number' ? h : (h.monsterId ?? h.id);
        const bids = typeof h === 'object' && h ? (h.badgeIds ?? []) : [];
        return { monsterId: mid, id: mid, badgeIds: bids };
      });
      const my = (req.my ?? []) as { dbId: number; x: number; y: number }[];
      const enemy = (req.enemy ?? []) as { dbId: number; x: number; y: number }[];
      return { plan: bundleRoundPlan(session, side, round, budget, hand, my, enemy, formation, req.debug === true) };
    }

    default:
      throw new Error(`unknown request type: ${req.type}`);
  }
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let req: Record<string, any>;
  try {
    req = JSON.parse(trimmed);
  } catch {
    return; // 非法行忽略，保持协议健壮
  }
  try {
    const res = handle(req);
    process.stdout.write(JSON.stringify({ id: req.id, ok: true, ...res }) + '\n');
  } catch (e) {
    process.stdout.write(JSON.stringify({ id: req.id, ok: false, error: (e as Error).message }) + '\n');
  }
});
rl.on('close', () => process.exit(0));
