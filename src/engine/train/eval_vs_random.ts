// ============================================================
// 最终验收：进化产物（EvolFormation）vs 规则随机对手 的不败率
//
// 规则随机对手口径（用户定案）：
//   - 随机卡组：从 7 套已知阵型随机选一套（含真实徽章，free_deck 语义）
//   - 完全随机站位：random_place，不做坦克前/远程后约束
//   - 主指标 = 不败率（胜+平），纯胜率作参考
//
// 进化侧用 bundle 引擎 + patch selectBranch（FeatureMask 识别完整保留），
// 对手侧用 TS 实现的规则随机放置，战斗用真实 BattleSystem(dt=0.04)。
//
// 运行：npx vite-node --script src/engine/train/eval_vs_random.ts [结果json] [局数] [--bundle 路径]
// ============================================================

import '../env';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gameEngine } from '../../game/GameEngine';
import type { TeamSlot } from '../../game/GameEngine';
import { battleSystem } from '../../game/BattleSystem';
import { vfx } from '../../game/VfxManager';
import { registerAllBadges } from '../../game/BadgeSystem';
import { DB_MONSTERS } from '../../game/Database';
import { FORMATION_LIBRARY } from '../../ai/formation_library';
import type { EvolFormation, EvolNode, FeatureMask } from './evol_gene';
import { summarizeEvolFormation } from './evol_gene';
import { buildConditionMap, matchMask, isEmptyMask, emptyMask, evolToBundleFormation } from './evol_gene';

registerAllBadges();
vfx.particlesEnabled = false;

const BATTLE_DT = 0.04;
const TIMEOUT_SEC = 45;

function loadBundle(bundlePath: string): any {
  const w = globalThis as any;
  try {
    const code = readFileSync(resolve(bundlePath), 'utf8');
    const factory = new Function('window', 'globalThis', '"use strict";\n' + code + '\n;return BattleAI;');
    const bundleExports = factory(w, w);
    return bundleExports?.BattleAI ?? w.BattleAI ?? null;
  } catch (e) {
    console.error(`[eval] bundle 加载失败: ${(e as Error).message}`);
    return null;
  }
}

function quiet<T>(fn: () => T): T {
  const log = console.log, warn = console.warn, err = console.error;
  console.log = () => {}; console.warn = () => {}; console.error = () => {};
  try { return fn(); } finally { console.log = log; console.warn = warn; console.error = err; }
}

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

function reviveNode(raw: any): EvolNode {
  const cond: FeatureMask = {
    handHas: raw.condition?.handHas ?? [],
    handBadgeHas: raw.condition?.handBadgeHas ?? [],
    handNotHas: raw.condition?.handNotHas ?? [],
    boardHas: raw.condition?.boardHas ?? [],
    boardNotHas: raw.condition?.boardNotHas ?? [],
  };
  return {
    id: raw.id,
    round: raw.round,
    condition: cond,
    placements: (raw.placements ?? []).map((p: any) => ({ monsterId: p.monsterId, x: p.x, y: p.y })),
    children: (raw.children ?? []).map((c: any) => reviveNode(c)),
  };
}

function reviveFormation(raw: any): EvolFormation {
  return {
    name: raw.name ?? 'evolved',
    archetype: raw.archetype ?? 'half_rush',
    team: (raw.team ?? []).map((s: any) => ({ monsterId: s.monsterId, badgeIds: [...(s.badgeIds ?? [])] })),
    root: reviveNode(raw.tree ?? raw.root),
  };
}

function buildBundleState(
  side: 'p1' | 'p2',
  round: number,
  my: { dbId: number; x: number; y: number }[],
  enemy: { dbId: number; x: number; y: number }[],
  budget: number,
): any {
  const board: any[][] = [];
  for (let y = 0; y < 5; y++) board.push(new Array(11).fill(null));
  const toP2 = (m: { dbId: number; x: number; y: number }) =>
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

function relocateNear(x: number, y: number, side: 'p1' | 'p2', occupied: Set<number>): [number, number] | null {
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

const PRIORITY: Record<number, number> = {
  113: 0, 107: 1, 118: 2, 114: 3, 117: 4, 106: 5, 116: 6,
};

/** 进化侧整回合放置（bundle + patch selectBranch 用 FeatureMask） */
function evolvedRoundPlan(
  ai: any,
  side: 'p1' | 'p2',
  round: number,
  budget: number,
  hand: { monsterId: number; badgeIds: number[] }[],
  my: { dbId: number; x: number; y: number }[],
  enemy: { dbId: number; x: number; y: number }[],
  f: EvolFormation,
): { monsterId: number; x: number; y: number }[] {
  if (hand.length === 0) return [];
  const fe = ai.pipeline.getFormationEngine();
  const cur = fe.getSelectedFormation();
  try {
    if (cur?.name !== f.name) {
      ai.buildTeam(hand);
      quiet(() => fe.loadCustomFormation(evolToBundleFormation(f)));
      const condMap = buildConditionMap(f.root);
      fe.selectBranch = (gameState: any, branches: any[]): any => {
        const handIds: Set<number> = fe.opponentHandIds ?? new Set();
        const handBadges: Set<number> = fe.opponentHandBadgeIds ?? new Set();
        const boardIds: Set<number> = new Set((gameState.players.p1.deployed ?? []).map((m: any) => m.monsterId));
        let chosen: any = null;
        let mainBranch: any = null;
        for (const b of branches) {
          const cond = condMap.get(b.id) ?? emptyMask();
          if (isEmptyMask(cond)) { if (!mainBranch) mainBranch = b; continue; }
          if (matchMask(cond, handIds, handBadges, boardIds)) { chosen = b; break; }
        }
        return chosen ?? mainBranch ?? branches[0];
      };
    }
    // 规则随机对手手牌不可见，不 setOpponentHand（识别走场上特征）
  } catch (e) {
    console.error(`[eval] 阵型加载失败: ${(e as Error).message}`);
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
    console.error(`[eval] decideWithFormation 失败: ${(e as Error).message}`);
    return [];
  }
  for (const a of placements) {
    if (!inHand.has(a.monsterId)) continue;
    const cost = ai.getMonster(a.monsterId)?.cost ?? 0;
    if (cost > curBudget) continue;
    if (a.x < 6 || a.x > 10 || a.y < 0 || a.y > 4) {
      const r = relocateNear(a.x, a.y, 'p2', occupied);
      if (!r) continue;
      a.x = r[0]; a.y = r[1];
    }
    if (occupied.has(a.x * 10 + a.y)) {
      const r = relocateNear(a.x, a.y, 'p2', occupied);
      if (!r) continue;
      a.x = r[0]; a.y = r[1];
    }
    occupied.add(a.x * 10 + a.y);
    plan.push({ monsterId: a.monsterId, x: a.x, y: a.y });
    curBudget -= cost;
  }
  return plan;
}

/** 规则随机对手放置：完全随机站位（random_place 语义，无坦克前/远程后约束） */
function ruleRandomPlace(
  deck: { monsterId: number; badgeIds: number[] }[],
  handIds: number[],
  budget: number,
  side: 1 | 2,
  my: { dbId: number; x: number; y: number }[],
  rng: () => number,
): { monsterId: number; badgeIds: number[] }[] {
  const lo = side === 1 ? 0 : 6;
  const hi = side === 1 ? 4 : 10;
  const occupied = new Set(my.map(m => m.x * 10 + m.y));
  const placed: { monsterId: number; badgeIds: number[] }[] = [];
  const affordable = deck.filter(s => handIds.includes(s.monsterId) && (DB_COST[s.monsterId] ?? 2) <= budget);
  let curBudget = budget;
  while (affordable.length > 0) {
    const free: { x: number; y: number }[] = [];
    for (let y = 0; y < 5; y++) for (let x = lo; x <= hi; x++) if (!occupied.has(x * 10 + y)) free.push({ x, y });
    if (free.length === 0) break;
    const pick = affordable.splice(Math.floor(rng() * affordable.length), 1)[0];
    const cell = free[Math.floor(rng() * free.length)];
    occupied.add(cell.x * 10 + cell.y);
    placed.push({ monsterId: pick.monsterId, badgeIds: pick.badgeIds });
    curBudget -= DB_COST[pick.monsterId] ?? 2;
    // 过滤预算不足的
    for (let i = affordable.length - 1; i >= 0; i--) {
      if ((DB_COST[affordable[i].monsterId] ?? 2) > curBudget) affordable.splice(i, 1);
    }
  }
  return placed;
}

// 费用表（延迟初始化）
let DB_COST: Record<number, number> = {};
function initCost(): void {
  DB_COST = {};
  for (const m of DB_MONSTERS) DB_COST[m.id] = m.cost;
}

/** 单局：进化产物 vs 规则随机，返回进化侧 {w,d,l} */
function playOne(
  BundleAI: any,
  f: EvolFormation,
  oppDeck: { monsterId: number; badgeIds: number[] }[],
  evoSide: 1 | 2,
  seed: number,
): { w: number; d: number; l: number } {
  const evoTeam = f.team.filter(s => s.monsterId > 0) as TeamSlot[];
  gameEngine.restartGame();
  gameEngine.mode = 'ai';
  gameEngine.teams = [evoTeam as TeamSlot[], oppDeck as TeamSlot[]];
  gameEngine.setReplaySeed(seed);
  const ai = new BundleAI();
  ai.setDifficulty('normal');
  const scores = [0, 0];
  // 严格按侧维护手牌（与 selfplay.play_vs_random 语义一致）：放置后移除
  const evoHand: number[] = f.team.filter(s => s.monsterId > 0).map(s => s.monsterId);
  const oppHand: number[] = oppDeck.map(s => s.monsterId);
  const oppSide: 1 | 2 = evoSide === 1 ? 2 : 1;

  for (let round = 1; round <= gameEngine.maxRounds; round++) {
    if (gameEngine.isGameOver()) break;
    gameEngine.currentRound = round;
    const rng = mulberry32(seed * 2654435761 + round);

    const evoBudget = gameEngine[evoSide === 1 ? 'p1RemainingBudget' : 'p2RemainingBudget'];
    const oppBudget = gameEngine[oppSide === 1 ? 'p1RemainingBudget' : 'p2RemainingBudget'];
    const evoMy = gameEngine.boardMonsters.filter(m => m.team === evoSide).map(m => ({ dbId: m.dbId, x: m.gridX, y: m.gridY }));
    const evoEnemy = gameEngine.boardMonsters.filter(m => m.team === oppSide).map(m => ({ dbId: m.dbId, x: m.gridX, y: m.gridY }));
    const oppMy = gameEngine.boardMonsters.filter(m => m.team === oppSide).map(m => ({ dbId: m.dbId, x: m.gridX, y: m.gridY }));

    // 进化侧放置（bundle 引擎，传当前手牌）
    const realRandom = Math.random;
    Math.random = rng;
    let evoPlan: { monsterId: number; x: number; y: number }[] = [];
    try {
      evoPlan = evolvedRoundPlan(ai, evoSide === 1 ? 'p1' : 'p2', round, evoBudget,
        evoHand.map(id => ({ monsterId: id, badgeIds: f.team.find(s => s.monsterId === id)?.badgeIds ?? [] })),
        evoMy, evoEnemy, f);
    } finally { Math.random = realRandom; }

    // 规则随机对手放置（传当前手牌）
    const oppPlan = ruleRandomPlace(oppDeck, oppHand, oppBudget, oppSide, oppMy, rng);

    // 放置进化侧（成功后从手牌移除）
    {
      const ordered = [...evoPlan].sort((a, b) => (PRIORITY[a.monsterId] ?? 9) - (PRIORITY[b.monsterId] ?? 9));
      const occ = new Set(evoMy.map(m => m.x * 10 + m.y));
      for (const p of ordered) {
        const slot = evoTeam.find(s => s.monsterId === p.monsterId);
        if (!slot || !evoHand.includes(p.monsterId)) continue;
        let px = evoSide === 1 ? 10 - p.x : p.x;
        let py = p.y;
        if (occ.has(px * 10 + py) || !gameEngine.placeMonster(slot, px, py, evoSide === 1)) {
          const r = relocateNear(px, py, evoSide === 1 ? 'p1' : 'p2', occ);
          if (!r) continue;
          px = r[0]; py = r[1];
          if (occ.has(px * 10 + py)) continue;
          if (!gameEngine.placeMonster(slot, px, py, evoSide === 1)) continue;
        }
        occ.add(px * 10 + py);
        evoHand.splice(evoHand.indexOf(p.monsterId), 1);
      }
    }
    // 放置随机对手（成功后从手牌移除）
    {
      const occ = new Set(oppMy.map(m => m.x * 10 + m.y));
      for (const p of oppPlan) {
        const slot = oppDeck.find(s => s.monsterId === p.monsterId);
        if (!slot || !oppHand.includes(p.monsterId)) continue;
        const lo = oppSide === 1 ? 0 : 6, hi = oppSide === 1 ? 4 : 10;
        const free: { x: number; y: number }[] = [];
        for (let y = 0; y < 5; y++) for (let x = lo; x <= hi; x++) if (!occ.has(x * 10 + y)) free.push({ x, y });
        if (free.length === 0) break;
        const cell = free[Math.floor(rng() * free.length)];
        if (!gameEngine.placeMonster(slot, cell.x, cell.y, oppSide === 1)) continue;
        occ.add(cell.x * 10 + cell.y);
        oppHand.splice(oppHand.indexOf(p.monsterId), 1);
      }
    }

    const s1 = gameEngine.p1Score;
    const s2 = gameEngine.p2Score;
    battleSystem.startBattle();
    let elapsed = 0;
    while (battleSystem.active && elapsed < TIMEOUT_SEC) {
      battleSystem.update(BATTLE_DT);
      vfx.update(BATTLE_DT);
      elapsed += BATTLE_DT;
    }
    if (battleSystem.active) (battleSystem as any).endBattle(null);
    scores[0] += gameEngine.p1Score - s1;
    scores[1] += gameEngine.p2Score - s2;
    vfx.particles.length = 0;
    vfx.backgroundParticles.length = 0;
    vfx.projectiles.length = 0;
    vfx.floatingTexts.length = 0;
    vfx.auraCircles = [];
    gameEngine.resetBoardForNextRound();
  }

  const evoWon = evoSide === 1 ? scores[0] : scores[1];
  const evoLost = evoSide === 1 ? scores[1] : scores[0];
  if (evoWon === evoLost) return { w: 0, d: 1, l: 0 };
  return evoWon > evoLost ? { w: 1, d: 0, l: 0 } : { w: 0, d: 0, l: 1 };
}

function main(): void {
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
  const jsonPath = ARGV.json ?? 'reports/evolution2_result.json';
  const games = Number(ARGV.games ?? 20);
  const bundlePath = ARGV.bundle ?? 'public/ai-bundle.iife.js';

  const BundleAI = loadBundle(bundlePath);
  if (!BundleAI) { console.error('bundle 未加载'); process.exit(1); }
  initCost();

  const raw = JSON.parse(readFileSync(resolve(jsonPath), 'utf8'));
  const evolved = reviveFormation(raw.formation);
  console.log('=== vs 规则随机（随机卡组 + 完全随机站位） ===');
  console.log(summarizeEvolFormation(evolved));
  console.log('');

  // 7 套卡组
  const decks = FORMATION_LIBRARY.map(f => f.team.filter(s => s.monsterId > 0));
  let w = 0, d = 0, l = 0;
  const t0 = Date.now();
  for (let g = 0; g < games; g++) {
    const oppDeck = decks[g % decks.length];
    const evoSide: 1 | 2 = g % 2 === 0 ? 1 : 2;
    const r = playOne(BundleAI, evolved, oppDeck, evoSide, 3000 + g);
    w += r.w; d += r.d; l += r.l;
  }
  const t = w + d + l;
  const ms = Date.now() - t0;
  console.log(`vs 规则随机 ${t} 局: ${w}胜 ${d}平 ${l}负`);
  console.log(`  纯胜率  ${(w / t * 100).toFixed(1)}%`);
  console.log(`  ★不败率 ${((w + d) / t * 100).toFixed(1)}%`);
  console.log(`耗时 ${(ms / 1000).toFixed(1)}s`);
}

main();
