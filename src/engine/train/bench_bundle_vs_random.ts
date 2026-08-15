// ============================================================
// 原生基准：新 bundle AI（public/ai-bundle.iife.js，网页同款）vs 任意随机卡组规则随机
// 语义对齐 reports/bundle_vs_any_random_report.md（旧 bundle 81.4%）：
// 7 套卡组各 20 局交替先后手，bundle 用该卡组；随机侧每局从 7 套卡组中任意随机选一套乱放。
// bundle 侧 = BattleAI.buildTeam + loadCustomFormation(卡组阵型) + decideWithFormation
//   （与网页 BattleUI.runAIPlacements 回退规则引擎同一套决策链，坐标 p2 视角、p1 镜像）
// 随机侧 = randPlacementPlan（随机卡组随机乱放，每回合花光预算）
// 运行：npx vite-node --script src/engine/train/bench_bundle_vs_random.ts [--games 20] [--runs 3]
//   --bundle <路径> 默认 public/ai-bundle.iife.js（新 bundle）；可指定 src/ai-bundle.iife.js 对比旧版
// ============================================================

import '../env';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gameEngine } from '../../game/GameEngine';
import type { PlacedMonster, TeamSlot } from '../../game/GameEngine';
import { battleSystem } from '../../game/BattleSystem';
import { vfx } from '../../game/VfxManager';
import { registerAllBadges } from '../../game/BadgeSystem';
import { DB_MONSTERS } from '../../game/Database';
import { FORMATION_LIBRARY } from '../../ai/formation_library';
import type { FormationTeamSlot } from '../../ai/types';
import type { Placement } from '../types';

registerAllBadges();
vfx.particlesEnabled = false;

// ---------- CLI 参数 ----------
const ARGV: Record<string, string> = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith('--')) {
    const k = a.slice(2);
    const v = process.argv[i + 1];
    if (v !== undefined && !v.startsWith('--')) { ARGV[k] = v; i++; }
    else { ARGV[k] = 'true'; }
  }
}
const N_GAMES = Number(ARGV.games ?? 20);
const RUNS = Number(ARGV.runs ?? 3);
const BATTLE_DT = Number(ARGV.dt ?? 0.04); // 默认 25 帧/秒，与网页固定逻辑步长一致
const BUNDLE_PATH = ARGV.bundle ?? 'public/ai-bundle.iife.js';
// 随机对手规则：rule=复刻 Python rule_random_place（决策随机，坦克/战士/特殊靠前、法师/射手靠后）；
// pure=旧纯随机乱放（对照）
const OPP = ARGV.opp ?? 'rule';
const timeoutSec = 45; // 40s 战斗 + 缓冲兜底

// ---------- 加载 bundle（浏览器 IIFE：顶层 var 在 CommonJS 是模块作用域，用 new Function 捕获） ----------
const w = globalThis as any;
let BundleAI: any = null;
try {
  const code = readFileSync(resolve(BUNDLE_PATH), 'utf8');
  const factory = new Function('window', 'globalThis', '"use strict";\n' + code + '\n;return BattleAI;');
  const bundleExports = factory(w, w);
  BundleAI = bundleExports?.BattleAI ?? w.BattleAI ?? null;
} catch (e) {
  console.log(`[bundle] 加载失败: ${(e as Error).message}`);
}
if (!BundleAI) {
  console.log(`[bundle] 未在 ${BUNDLE_PATH} 找到 BattleAI，退出`);
  process.exit(1);
}
console.log(`[bundle] 加载成功: ${resolve(BUNDLE_PATH)}`);

/** 静默执行 bundle 调用（其内部 console.log/warn 会刷屏） */
function quiet<T>(fn: () => T): T {
  const log = console.log, warn = console.warn, err = console.error;
  console.log = () => {}; console.warn = () => {}; console.error = () => {};
  try { return fn(); } finally { console.log = log; console.warn = warn; console.error = err; }
}

/** mulberry32 确定性伪随机（随机侧 + bundle 内部随机都可复现） */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ZONE: Record<1 | 2, { min: number; max: number }> = {
  1: { min: 0, max: 4 },
  2: { min: 6, max: 10 },
};

/** 同卡组随机合法放置（每回合独立随机，花光剩余预算） */
function randPlacementPlan(
  team: FormationTeamSlot[],
  side: 1 | 2,
  budgetLimit: number,
  my: PlacedMonster[],
  rng: () => number = Math.random,
): Placement[] {
  const zone = ZONE[side];
  const hand = [...team];
  const occupied = new Set(my.map(m => m.gridX * 10 + m.gridY));
  let budget = budgetLimit;
  const placed: Placement[] = [];
  while (true) {
    const affordable = hand.filter(c => DB_MONSTERS.find(d => d.id === c.monsterId)!.cost <= budget);
    const free: { x: number; y: number }[] = [];
    for (let y = 0; y < 5; y++) for (let x = zone.min; x <= zone.max; x++) if (!occupied.has(x * 10 + y)) free.push({ x, y });
    if (affordable.length === 0 || free.length === 0) break;
    const c = affordable[Math.floor(rng() * affordable.length)];
    const cell = free[Math.floor(rng() * free.length)];
    const m = DB_MONSTERS.find(d => d.id === c.monsterId)!;
    occupied.add(cell.x * 10 + cell.y);
    placed.push({ monsterId: c.monsterId, badgeIds: c.badgeIds, x: cell.x, y: cell.y });
    hand.splice(hand.indexOf(c), 1);
    budget -= m.cost;
  }
  return placed;
}

/** 规则随机放置（复刻 Python rule_random_place，L1 基准）：
 * 决策随机选怪；位置按角色分前后：坦克/战士/特殊放前三列（近中线），法师/射手放后三列（远中线），
 * y 行 0-4 均匀随机。预算=引擎剩余预算（累计上限-已花，语义与 BUDGET_LIMITS 对齐）。 */
function ruleRandomPlace(
  team: FormationTeamSlot[],
  side: 1 | 2,
  budget: number,
  my: PlacedMonster[],
  rng: () => number,
): Placement[] {
  const lo = side === 1 ? 0 : 6;
  const hi = side === 1 ? 4 : 10;
  const frontCols = side === 1 ? [2, 3, 4] : [6, 7, 8];
  const backCols = side === 1 ? [0, 1, 2] : [8, 9, 10];
  const hand = [...team];
  const occupied = new Set(my.map(m => m.gridX * 10 + m.gridY));
  let cur = budget;
  const placed: Placement[] = [];
  while (true) {
    const affordable = hand.filter(c => DB_MONSTERS.find(d => d.id === c.monsterId)!.cost <= cur);
    const free: { x: number; y: number }[] = [];
    for (let y = 0; y < 5; y++) for (let x = lo; x <= hi; x++) if (!occupied.has(x * 10 + y)) free.push({ x, y });
    if (affordable.length === 0 || free.length === 0) break;
    const c = affordable[Math.floor(rng() * affordable.length)];
    const role = DB_MONSTERS.find(d => d.id === c.monsterId)?.role ?? '战士';
    const cols = role === '法师' || role === '射手' ? backCols : frontCols;
    const candidates = free.filter(f => cols.includes(f.x));
    const pool = candidates.length > 0 ? candidates : free;
    const cell = pool[Math.floor(rng() * pool.length)];
    const m = DB_MONSTERS.find(d => d.id === c.monsterId)!;
    occupied.add(cell.x * 10 + cell.y);
    placed.push({ monsterId: c.monsterId, badgeIds: c.badgeIds, x: cell.x, y: cell.y });
    hand.splice(hand.indexOf(c), 1);
    cur -= m.cost;
  }
  return placed;
}

// ---------- bundle 整回合计划（逻辑同 bridge.bundleRoundPlan，搬入本地以避免依赖 bridge 进程） ----------
/** 组装 bundle 所需局面：统一转到 p2 视角（bundle 原生假设 AI 在 p2），p1 侧喂入前镜像坐标 */
function buildBundleState(
  side: 'p1' | 'p2',
  round: number,
  my: { dbId: number; x: number; y: number }[],
  enemy: { dbId: number; x: number; y: number }[],
  budget: number,
): any {
  const board: any[][] = [];
  for (let y = 0; y < 5; y++) board.push(new Array(11).fill(null));
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
  const players: any = {
    p1: { side: 'p1', deployed: [], remainingBudget: 4 },
    p2: { side: 'p2', deployed: [], remainingBudget: 4 },
  };
  players.p1.deployed = fill(enemyV, 'p1');
  players.p2.deployed = fill(myV, 'p2');
  players.p2.remainingBudget = budget;
  return { board, players, round, phase: 'placing', currentPlayer: side, nextInstanceId: 99 };
}

/** 冲突落点就近重定位到己方半区最近空闲格（原版 bundle 直接丢弃导致预算浪费） */
function relocateNear(
  x: number, y: number,
  side: 'p1' | 'p2',
  occupied: Set<number>,
): [number, number] | null {
  const lo = side === 'p1' ? 0 : 6;
  const hi = side === 'p1' ? 4 : 10;
  for (let d = 1; d <= 8; d++) {
    for (let dy = -d; dy <= d; dy++) {
      for (let dx = -d; dx <= d; dx++) {
        if (Math.abs(dx) + Math.abs(dy) !== d) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < lo || nx > hi || ny < 0 || ny > 4) continue;
        if (occupied.has(nx * 10 + ny)) continue;
        return [nx, ny];
      }
    }
  }
  return null;
}

/** bundle 整回合放置计划（formationName 强制卡组对应阵型，坐标以 p2 视角输出，p1 侧由调用方镜像） */
function bundleRoundPlan(
  ai: any,
  side: 'p1' | 'p2',
  round: number,
  budget: number,
  hand: { monsterId: number; badgeIds: number[] }[],
  my: { dbId: number; x: number; y: number }[],
  enemy: { dbId: number; x: number; y: number }[],
  formationName: string,
): { monsterId: number; x: number; y: number }[] {
  if (hand.length === 0) return [];
  const fe = ai.pipeline.getFormationEngine();
  const cur = fe.getSelectedFormation();
  try {
    if (formationName && cur?.name !== formationName) {
      const f = FORMATION_LIBRARY.find(fm => fm.name === formationName);
      if (f) { ai.buildTeam(hand); quiet(() => fe.loadCustomFormation(f as any)); }
      else if (!cur) ai.buildTeam(hand);
    } else if (!cur) {
      ai.buildTeam(hand);
    }
  } catch (e) {
    console.log(`[bundle] 阵型加载失败: ${(e as Error).message}`);
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
    console.log(`[bundle] decideWithFormation 失败: ${(e as Error).message}`);
    return [];
  }
  for (const a of placements) {
    if (!inHand.has(a.monsterId)) continue; // 阵型模板可能引用手牌外卡
    const cost = ai.getMonster(a.monsterId)?.cost ?? 0;
    if (cost > curBudget) continue;
    let ax = a.x;
    if (side === 'p1') ax = 10 - ax;
    const lo = side === 'p1' ? 0 : 6;
    const hi = side === 'p1' ? 4 : 10;
    if (ax < lo || ax > hi || occupied.has(ax * 10 + a.y)) {
      const r = relocateNear(ax, a.y, side, occupied);
      if (!r) continue;
      ax = r[0]; a.y = r[1];
    }
    occupied.add(ax * 10 + a.y);
    plan.push({ monsterId: a.monsterId, x: ax, y: a.y });
    curBudget -= cost;
  }
  return plan;
}

/** 一侧放置：kind='bundle' → bundle 决策（Math.random 临时替换为固定 rng，保证逐局可复现）；kind='random' → randPlacementPlan */
function placeSide(
  side: 'p1' | 'p2',
  kind: 'bundle' | 'random',
  ai: any,
  team: FormationTeamSlot[],
  formationName: string,
  rng: () => number,
): void {
  const teamId = side === 'p1' ? 1 : 2;
  const my = gameEngine.boardMonsters.filter(m => m.team === teamId).map(m => ({ dbId: m.dbId, x: m.gridX, y: m.gridY }));
  const enemy = gameEngine.boardMonsters.filter(m => m.team !== teamId).map(m => ({ dbId: m.dbId, x: m.gridX, y: m.gridY }));
  const budget = gameEngine[teamId === 1 ? 'p1RemainingBudget' : 'p2RemainingBudget'];
  const realRandom = Math.random;
  Math.random = rng;
  try {
    if (kind === 'bundle') {
      const plan = bundleRoundPlan(ai, side, gameEngine.currentRound, budget, team, my, enemy, formationName);
      for (const p of plan) {
        const slot = team.find(s => s.monsterId === p.monsterId);
        if (!slot) continue;
        gameEngine.placeMonster(slot, p.x, p.y, teamId === 1);
      }
    } else {
      const rand = OPP === 'rule'
        ? ruleRandomPlace(team, teamId, budget, gameEngine.boardMonsters.filter(m => m.team === teamId), rng)
        : randPlacementPlan(team, teamId, budget, gameEngine.boardMonsters.filter(m => m.team === teamId), rng);
      for (const p of rand) {
        gameEngine.placeMonster(p as unknown as TeamSlot, p.x, p.y, teamId === 1);
      }
    }
  } finally {
    Math.random = realRandom;
  }
}

/** 一局：bundleSide 用 bundle 决策，对侧随机。返回 (胜, 平, 负) + 结果摘要 */
function playOne(
  team: FormationTeamSlot[],
  formationName: string,
  bundleSide: 1 | 2,
  bundleFirst: boolean,
  seed: number,
): { w: number; d: number; l: number; summary: string } {
  gameEngine.restartGame();
  gameEngine.mode = 'ai';
  gameEngine.teams = [team as TeamSlot[], team as TeamSlot[]];
  gameEngine.setReplaySeed(seed);
  const ai = new BundleAI();
  ai.setDifficulty('normal');
  // 随机侧卡组：每局从 7 套中任意随机选一套（独立 rng 派生，不受 bundle 决策随机消耗影响，可复现）
  const randFormation = FORMATION_LIBRARY[Math.floor(mulberry32(seed * 15485863)() * FORMATION_LIBRARY.length)];
  const randTeam = randFormation.team.filter(s => s.monsterId > 0);
  const scores = [0, 0];
  const roundResults: (0 | 1 | 2)[] = [];
  for (let round = 1; round <= gameEngine.maxRounds; round++) {
    if (gameEngine.isGameOver()) break;
    gameEngine.currentRound = round;
    const bundleS = bundleSide === 1 ? 'p1' : 'p2';
    const randS = bundleSide === 1 ? 'p2' : 'p1';
    // bundle 侧先/随机侧先各半（抵消数组顺序 bias）；bundle 内部随机 + 随机侧共用 seed 派生 rng → 整局可复现
    const rng = mulberry32(seed * 2654435761 + round);
    if (bundleFirst) {
      placeSide(bundleS, 'bundle', ai, team, formationName, rng);
      placeSide(randS, 'random', ai, randTeam, formationName, rng);
    } else {
      placeSide(randS, 'random', ai, randTeam, formationName, rng);
      placeSide(bundleS, 'bundle', ai, team, formationName, rng);
    }
    const s1 = gameEngine.p1Score;
    const s2 = gameEngine.p2Score;
    battleSystem.startBattle();
    let elapsed = 0;
    while (battleSystem.active && elapsed < timeoutSec) {
      battleSystem.update(BATTLE_DT);
      vfx.update(BATTLE_DT);
      elapsed += BATTLE_DT;
    }
    if (battleSystem.active) (battleSystem as any).endBattle(null);
    const d1 = gameEngine.p1Score - s1;
    const d2 = gameEngine.p2Score - s2;
    scores[0] += d1;
    scores[1] += d2;
    roundResults.push(d1 === d2 ? 0 : d1 > d2 ? 1 : 2);
    vfx.particles.length = 0;
    vfx.backgroundParticles.length = 0;
    vfx.projectiles.length = 0;
    vfx.floatingTexts.length = 0;
    vfx.auraCircles = [];
    gameEngine.resetBoardForNextRound();
  }
  const bw = bundleSide === 1 ? scores[0] : scores[1];
  const bl = bundleSide === 1 ? scores[1] : scores[0];
  const summary = `side${bundleSide}${bundleFirst ? 'T' : 'F'} ${roundResults.join('')} ${scores[0]}:${scores[1]}`;
  if (bw === bl) return { w: 0, d: 1, l: 0, summary };
  return bw > bl ? { w: 1, d: 0, l: 0, summary } : { w: 0, d: 0, l: 1, summary };
}

function main(): void {
  const decks = FORMATION_LIBRARY;
  const t0 = Date.now();
  let totalGames = 0;
  const rows: { name: string; w: number; d: number; l: number; ms: number }[] = [];
  let totalW = 0, totalD = 0, totalL = 0;
  for (const f of decks) {
    const team = f.team.filter(s => s.monsterId > 0);
    let w = 0, d = 0, l = 0;
    const perRunMs: number[] = [];
    let baseSummaries: string[] | null = null;
    for (let run = 0; run < RUNS; run++) {
      const rt0 = Date.now();
      let rw = 0, rd = 0, rl = 0;
      const runSummaries: string[] = [];
      for (let g = 0; g < N_GAMES; g++) {
        // 位置与入数组顺序 4 种组合正交：g%2 定 bundle 左右，g%4<2 定 bundle 先手
        const bundleSide: 1 | 2 = g % 2 === 0 ? 1 : 2;
        const bundleFirst = (g % 4) < 2;
        const r = playOne(team, f.name, bundleSide, bundleFirst, 1000 + g);
        rw += r.w; rd += r.d; rl += r.l;
        const s = `${g}:${r.summary}`;
        runSummaries.push(s);
        if (run === 0) console.log(`  ${f.name} g${s}`);
      }
      perRunMs.push(Date.now() - rt0);
      totalGames += N_GAMES;
      if (run === 0) { w = rw; d = rd; l = rl; baseSummaries = runSummaries; }
      else if (baseSummaries && JSON.stringify(baseSummaries) !== JSON.stringify(runSummaries)) {
        console.log(`[警告] ${f.name} run${run} 结果摘要与 run0 不一致！`);
      }
    }
    const sortedMs = [...perRunMs].sort((a, b) => a - b);
    const medMs = sortedMs[Math.floor(sortedMs.length / 2)];
    rows.push({ name: f.name, w, d, l, ms: medMs });
    const ev = w + d + l;
    totalW += w; totalD += d; totalL += l;
    console.log(
      `[${f.name}] ${N_GAMES}局×${RUNS} 胜${w} 平${d} 负${l} bundle胜率=${ev ? (w / ev * 100).toFixed(1) : 0}% ` +
        `胜平率=${ev ? ((w + 0.5 * d) / ev * 100).toFixed(1) : 0}% 各遍耗时=${perRunMs.join('/')}ms 中位数=${medMs}ms`,
    );
  }
  const totalMs = Date.now() - t0;
  const ev = totalW + totalD + totalL;
  console.log('');
  console.log(`bundle(${BUNDLE_PATH}) vs ${OPP === 'rule' ? '规则随机(rule_random_place)' : '纯随机(randPlacementPlan)'} 汇总（${RUNS} 遍一致，纯胜率/胜平率）：`);
  for (const r of rows) {
    const e = r.w + r.d + r.l;
    console.log(`  ${r.name.padEnd(6)}: 纯胜率 ${(e ? (r.w / e * 100) : 0).toFixed(1)}%  胜平率 ${(e ? ((r.w + 0.5 * r.d) / e * 100) : 0).toFixed(1)}%  (胜${r.w}/平${r.d}/负${r.l})  ${r.ms}ms`);
  }
  console.log(`  平均: 纯胜率 ${(ev ? (totalW / ev * 100) : 0).toFixed(1)}%  胜平率 ${(ev ? ((totalW + 0.5 * totalD) / ev * 100) : 0).toFixed(1)}%`);
  console.log(`共 ${totalGames} 局 总耗时${(totalMs / 1000).toFixed(1)}s dt=${BATTLE_DT}`);
}

main();
