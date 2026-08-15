// ============================================================
// 诊断：重现指定 bundle vs 随机对局，打印每回合双方放置计划 + 棋盘布阵
// 用法：npx vite-node --script src/engine/train/diag_bundle_games.ts --deck 梯子塞雷 --games 14,18
//   --games 局号（g），seed=1000+g（与 bench_bundle_vs_random 一致）
// 棋盘：11列×5行，y 为行；p1（左 x0-4）裸名，p2（右 x6-10）名前缀 *；x5 为中界线
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
const DECK = ARGV.deck ?? '梯子塞雷';
const GAMES = (ARGV.games ?? '14,18').split(/[,\s]+/).map(Number).filter(n => !isNaN(n));
const BATTLE_DT = Number(ARGV.dt ?? 0.04); // 默认 25 帧/秒，与网页固定逻辑步长一致
const timeoutSec = 45;

const w = globalThis as any;
let BundleAI: any = null;
try {
  const code = readFileSync(resolve('public/ai-bundle.iife.js'), 'utf8');
  const factory = new Function('window', 'globalThis', '"use strict";\n' + code + '\n;return BattleAI;');
  const bundleExports = factory(w, w);
  BundleAI = bundleExports?.BattleAI ?? w.BattleAI ?? null;
} catch (e) {
  console.log(`[bundle] 加载失败: ${(e as Error).message}`);
}
if (!BundleAI) { console.log('[bundle] 未找到 BattleAI，退出'); process.exit(1); }

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

const ZONE: Record<1 | 2, { min: number; max: number }> = {
  1: { min: 0, max: 4 },
  2: { min: 6, max: 10 },
};

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

function buildBundleState(
  side: 'p1' | 'p2', round: number,
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

function bundleRoundPlan(
  ai: any, side: 'p1' | 'p2', round: number, budget: number,
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
    if (!inHand.has(a.monsterId)) continue;
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

function nameOf(dbId: number): string {
  const db = DB_MONSTERS.find(d => d.id === dbId);
  return db ? db.name : `#${dbId}`;
}

/** 战前棋盘：11列×5行，p1 裸名、p2 前缀 *，x5 中线 */
function boardStr(): string {
  const grid: string[][] = [];
  for (let y = 0; y < 5; y++) grid.push(new Array(11).fill('·'));
  for (const m of gameEngine.boardMonsters) {
    const s = nameOf(m.dbId);
    grid[m.gridY][m.gridX] = m.team === 1 ? s : '*' + s;
  }
  const lines: string[] = [];
  const hdr = '       ' + Array.from({ length: 11 }, (_, x) => (x === 5 ? '│' : String(x).padStart(2))).join(' ');
  lines.push(hdr);
  for (let y = 0; y < 5; y++) {
    lines.push(`y=${y}  ` + grid[y].map((c, x) => (x === 5 ? '│' : c.padEnd(2).slice(0, 3).padEnd(3))).join(' '));
  }
  return lines.join('\n');
}

function placePlanStr(plan: { monsterId: number; x: number; y: number }[]): string {
  if (plan.length === 0) return '(空)';
  return plan.map(p => `${nameOf(p.monsterId)}(${p.x},${p.y})`).join('  ');
}

/** 重现一局并打印每回合布阵。返回 (胜/平/负) */
function replay(team: FormationTeamSlot[], formationName: string, bundleSide: 1 | 2, bundleFirst: boolean, seed: number): void {
  gameEngine.restartGame();
  gameEngine.mode = 'ai';
  gameEngine.teams = [team as TeamSlot[], team as TeamSlot[]];
  gameEngine.setReplaySeed(seed);
  const ai = new BundleAI();
  ai.setDifficulty('normal');
  const randFormation = FORMATION_LIBRARY[Math.floor(mulberry32(seed * 15485863)() * FORMATION_LIBRARY.length)];
  const randTeam = randFormation.team.filter(s => s.monsterId > 0);
  const scores = [0, 0];
  console.log(`\n================ 局 seed=${seed} (g${seed - 1000}) bundle侧=${bundleSide === 1 ? 'p1' : 'p2'} bundle${bundleFirst ? '先' : '后'}入数组 ================`);
  console.log(`bundle 卡组: ${formationName}  随机卡组: ${randFormation.name}`);
  for (let round = 1; round <= gameEngine.maxRounds; round++) {
    if (gameEngine.isGameOver()) break;
    gameEngine.currentRound = round;
    const bundleS = bundleSide === 1 ? 'p1' : 'p2';
    const randS = bundleSide === 1 ? 'p2' : 'p1';
    const rng = mulberry32(seed * 2654435761 + round);
    console.log(`\n---------- R${round} (预算 p1=${gameEngine.p1RemainingBudget} p2=${gameEngine.p2RemainingBudget}) ----------`);
    const realRandom = Math.random;
    Math.random = rng;
    let bundlePlan: { monsterId: number; x: number; y: number }[] = [];
    let randPlan: { monsterId: number; x: number; y: number }[] = [];
    try {
      if (bundleFirst) {
        bundlePlan = placeAndGet(bundleS, 'bundle', ai, team, formationName, rng);
        randPlan = placeAndGet(randS, 'random', ai, randTeam, formationName, rng);
      } else {
        randPlan = placeAndGet(randS, 'random', ai, randTeam, formationName, rng);
        bundlePlan = placeAndGet(bundleS, 'bundle', ai, team, formationName, rng);
      }
    } finally {
      Math.random = realRandom;
    }
    console.log(`bundle(${bundleS}) 放置: ${placePlanStr(bundlePlan)}`);
    console.log(`随机(${randS}) 放置: ${placePlanStr(randPlan)}`);
    console.log(boardStr());
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
    console.log(`→ R${round} 得分 p1+${d1} p2+${d2}  累计 ${scores[0]}:${scores[1]}`);
    vfx.particles.length = 0;
    vfx.backgroundParticles.length = 0;
    vfx.projectiles.length = 0;
    vfx.floatingTexts.length = 0;
    vfx.auraCircles = [];
    gameEngine.resetBoardForNextRound();
  }
  const bw = bundleSide === 1 ? scores[0] : scores[1];
  const bl = bundleSide === 1 ? scores[1] : scores[0];
  console.log(`\n==== 局终 ${scores[0]}:${scores[1]} → bundle ${bw === bl ? '平' : bw > bl ? '胜' : '负'} ====`);
}

/** 放置一侧并返回放置计划（供打印）。'bundle' 走 bundle 决策；'random' 走随机乱放 */
function placeAndGet(
  side: 'p1' | 'p2',
  kind: 'bundle' | 'random',
  ai: any,
  team: FormationTeamSlot[],
  formationName: string,
  rng: () => number,
): { monsterId: number; x: number; y: number }[] {
  const teamId = side === 'p1' ? 1 : 2;
  const my = gameEngine.boardMonsters.filter(m => m.team === teamId).map(m => ({ dbId: m.dbId, x: m.gridX, y: m.gridY }));
  const enemy = gameEngine.boardMonsters.filter(m => m.team !== teamId).map(m => ({ dbId: m.dbId, x: m.gridX, y: m.gridY }));
  const budget = gameEngine[teamId === 1 ? 'p1RemainingBudget' : 'p2RemainingBudget'];
  let plan: { monsterId: number; x: number; y: number }[] = [];
  if (kind === 'bundle') {
    plan = bundleRoundPlan(ai, side, gameEngine.currentRound, budget, team, my, enemy, formationName);
    for (const p of plan) {
      const slot = team.find(s => s.monsterId === p.monsterId);
      if (!slot) continue;
      gameEngine.placeMonster(slot, p.x, p.y, teamId === 1);
    }
  } else {
    const rand = randPlacementPlan(team, teamId, budget, gameEngine.boardMonsters.filter(m => m.team === teamId), rng);
    plan = rand;
    for (const p of rand) {
      gameEngine.placeMonster(p as unknown as TeamSlot, p.x, p.y, teamId === 1);
    }
  }
  return plan;
}

function main(): void {
  const deck = FORMATION_LIBRARY.find(f => f.name === DECK);
  if (!deck) {
    console.log(`[错误] 未找到卡组 ${DECK}，可用: ${FORMATION_LIBRARY.map(f => f.name).join('/')}`);
    return;
  }
  const team = deck.team.filter(s => s.monsterId > 0);
  console.log(`卡组 ${DECK} 怪兽:`);
  for (const s of team) console.log(`  ${nameOf(s.monsterId)} (${s.monsterId}) 徽章[${s.badgeIds.join(',')}] 费${DB_MONSTERS.find(d => d.id === s.monsterId)?.cost}`);
  for (const g of GAMES) {
    const seed = 1000 + g;
    const bundleSide: 1 | 2 = g % 2 === 0 ? 1 : 2;
    const bundleFirst = (g % 4) < 2;
    replay(team, deck.name, bundleSide, bundleFirst, seed);
  }
}

main();
