// bundle（7阵型）对"规则随机"对手的胜率
// 随机对手：同一阵型的卡组，每轮在预算内随机选卡、随机合法格放置（遵守区域/占用/重复/四费限前3局规则）
// 运行：npx vite-node --script engine/train/bench_random.ts [--games 10]
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

registerAllBadges();
vfx.particlesEnabled = false;

const w = globalThis as any;
const code = readFileSync(resolve('public/ai-bundle.iife.js'), 'utf8');
const factory = new Function('window', 'globalThis', '"use strict";\n' + code + '\n;return BattleAI;');
const bundleExports = factory(w, w);
const BundleAI = bundleExports?.BattleAI ?? w.BattleAI;

function quiet<T>(fn: () => T): T {
  const log = console.log, warn = console.warn, err = console.error;
  console.log = () => {}; console.warn = () => {}; console.error = () => {};
  try { return fn(); } finally { console.log = log; console.warn = warn; console.error = err; }
}
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function buildBundleState(side, round, my, enemy, budget) {
  const board = []; for (let y = 0; y < 5; y++) board.push(new Array(11).fill(null));
  const toP2 = m => side === 'p1' ? { dbId: m.dbId, x: 10 - m.x, y: m.y } : m;
  const myV = my.map(toP2), enemyV = enemy.map(toP2);
  const fill = (list, owner) => {
    const deployed = [];
    list.forEach((m, i) => {
      const inst = { instanceId: i + 1, monsterId: m.dbId, badgeIds: [], position: { x: m.x, y: m.y }, owner };
      board[m.y][m.x] = inst; deployed.push(inst);
    });
    return deployed;
  };
  const players = { p1: { side: 'p1', deployed: [], remainingBudget: 4 }, p2: { side: 'p2', deployed: [], remainingBudget: 4 } };
  players.p1.deployed = fill(enemyV, 'p1');
  players.p2.deployed = fill(myV, 'p2');
  players.p2.remainingBudget = budget;
  return { board, players, round, phase: 'placing', currentPlayer: side, nextInstanceId: 99 };
}
function relocateNear(x, y, side, occupied) {
  const lo = side === 'p1' ? 0 : 6, hi = side === 'p1' ? 4 : 10;
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
function bundleRoundPlan(ai, side, round, budget, hand, my, enemy, formationName, oppHand) {
  if (hand.length === 0) return [];
  const fe = ai.pipeline.getFormationEngine();
  const cur = fe.getSelectedFormation();
  try {
    if (formationName && cur?.name !== formationName) {
      const f = FORMATION_LIBRARY.find(fm => fm.name === formationName);
      if (f) { ai.buildTeam(hand); quiet(() => fe.loadCustomFormation(f as any)); }
      else if (!cur) ai.buildTeam(hand);
    } else if (!cur) ai.buildTeam(hand);
    if (oppHand && oppHand.length > 0) quiet(() => fe.setOpponentHand(oppHand.slice(0, 4)));
  } catch (e) { console.log(`[bundle] 阵型加载失败: ${(e as Error).message}`); return []; }
  const plan = [];
  const occupied = new Set(my.map(m => m.x * 10 + m.y));
  let curBudget = budget;
  const inHand = new Set(hand.map(h => h.monsterId));
  let placements = [];
  try {
    const st = buildBundleState(side, round, my, enemy, curBudget);
    const raw = quiet(() => ai.pipeline.decideWithFormation(hand, round, st));
    placements = raw?.placements ?? [];
  } catch (e) { console.log(`[bundle] decideWithFormation 失败: ${(e as Error).message}`); return []; }
  for (const a of placements) {
    if (!inHand.has(a.monsterId)) continue;
    const cost = ai.getMonster(a.monsterId)?.cost ?? 0;
    if (cost > curBudget) continue;
    if (a.x < 6 || a.x > 10 || a.y < 0 || a.y > 4 || occupied.has(a.x * 10 + a.y)) {
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

/** 规则随机放置：预算内随机选卡（洗牌贪心），随机合法格 */
function randomRoundPlan(side: 1 | 2, round: number, team: any[], rng: () => number): { monsterId: number; x: number; y: number }[] {
  const zone = side === 1 ? [0, 1, 2, 3, 4] : [6, 7, 8, 9, 10];
  const occupied = new Set(gameEngine.boardMonsters.filter(m => m.team === side).map(m => m.gridX * 10 + m.gridY));
  const onBoard = new Set(gameEngine.boardMonsters.filter(m => m.team === side).map(m => m.dbId));
  const budget = gameEngine[side === 1 ? 'p1RemainingBudget' : 'p2RemainingBudget'];
  const cost = (id: number) => DB_MONSTERS.find(m => m.id === id)?.cost ?? 0;
  const avail = team.filter((s: any) => s.monsterId > 0 && !onBoard.has(s.monsterId))
    .filter((s: any) => {
      const c = cost(s.monsterId);
      return c <= budget && (round < 4 || c < 4); // 四费仅限前三局
    });
  const shuffled = [...avail].sort(() => rng() - 0.5);
  const plan: { monsterId: number; x: number; y: number }[] = [];
  let rem = budget;
  for (const s of shuffled) {
    const c = cost(s.monsterId);
    if (c > rem) continue;
    const cells: [number, number][] = [];
    for (const x of zone) for (let y = 0; y < 5; y++) if (!occupied.has(x * 10 + y)) cells.push([x, y]);
    if (cells.length === 0) break;
    const pick = cells[Math.floor(rng() * cells.length)];
    occupied.add(pick[0] * 10 + pick[1]);
    plan.push({ monsterId: s.monsterId, x: pick[0], y: pick[1] });
    rem -= c;
  }
  return plan;
}

const ARGV = process.argv;
const N_GAMES = Number(ARGV.find(a => a.startsWith('--games='))?.split('=')[1] ?? 10);
const PRIORITY: Record<number, number> = { 113: 0, 107: 1, 118: 2, 114: 3, 117: 4, 106: 5, 116: 6 };

/** 一局：bundle 阵型（aSide 边）vs 随机（另一边，同卡组） */
function playOne(team: any[], name: string, aSide: 1 | 2, seed: number): { w: number; d: number; l: number } {
  gameEngine.restartGame();
  gameEngine.mode = 'ai';
  gameEngine.teams = [team as TeamSlot[], team as TeamSlot[]];
  gameEngine.setReplaySeed(seed);
  const aiB = new BundleAI(); aiB.setDifficulty('normal');
  const scores = [0, 0];
  for (let round = 1; round <= gameEngine.maxRounds; round++) {
    if (gameEngine.isGameOver()) break;
    gameEngine.currentRound = round;
    const rng = mulberry32(seed * 2654435761 + round);
    const realRandom = Math.random;
    Math.random = rng;
    try {
      // bundle 侧
      const bSide = aSide;
      const bMy = gameEngine.boardMonsters.filter(m => m.team === bSide).map(m => ({ dbId: m.dbId, x: m.gridX, y: m.gridY }));
      const bEnemy = gameEngine.boardMonsters.filter(m => m.team !== bSide).map(m => ({ dbId: m.dbId, x: m.gridX, y: m.gridY }));
      const bBudget = gameEngine[bSide === 1 ? 'p1RemainingBudget' : 'p2RemainingBudget'];
      const plan = bundleRoundPlan(aiB, bSide === 1 ? 'p1' : 'p2', round, bBudget, team, bMy, bEnemy, name, team);
      const ordered = [...plan].sort((a, b) => (PRIORITY[a.monsterId] ?? 9) - (PRIORITY[b.monsterId] ?? 9));
      const occupiedNow = new Set(gameEngine.boardMonsters.filter(m => m.team === bSide).map(m => m.gridX * 10 + m.gridY));
      for (const p of ordered) {
        const slot = team.find(s => s.monsterId === p.monsterId);
        if (!slot) continue;
        let px = bSide === 1 ? 10 - p.x : p.x;
        let py = p.y;
        if (occupiedNow.has(px * 10 + py) || !gameEngine.placeMonster(slot, px, py, bSide === 1)) {
          const r = relocateNear(px, py, bSide === 1 ? 'p1' : 'p2', occupiedNow);
          if (!r) continue;
          px = r[0]; py = r[1];
          if (occupiedNow.has(px * 10 + py)) continue;
          if (!gameEngine.placeMonster(slot, px, py, bSide === 1)) continue;
        }
        occupiedNow.add(px * 10 + py);
      }
      // 随机侧
      const rSide: 1 | 2 = aSide === 1 ? 2 : 1;
      const rPlan = randomRoundPlan(rSide, round, team, rng);
      const rOccupied = new Set(gameEngine.boardMonsters.filter(m => m.team === rSide).map(m => m.gridX * 10 + m.gridY));
      for (const p of rPlan) {
        const slot = team.find(s => s.monsterId === p.monsterId);
        if (!slot) continue;
        if (rOccupied.has(p.x * 10 + p.y)) continue;
        if (gameEngine.placeMonster(slot, p.x, p.y, rSide === 1)) rOccupied.add(p.x * 10 + p.y);
      }
    } finally { Math.random = realRandom; }
    const s1 = gameEngine.p1Score, s2 = gameEngine.p2Score;
    battleSystem.startBattle();
    let el = 0;
    while (battleSystem.active && el < 45) { battleSystem.update(0.04); vfx.update(0.04); el += 0.04; }
    if (battleSystem.active) (battleSystem as any).endBattle(null);
    const d1 = gameEngine.p1Score - s1, d2 = gameEngine.p2Score - s2;
    scores[0] += d1; scores[1] += d2;
    vfx.particles.length = 0; vfx.backgroundParticles.length = 0; vfx.projectiles.length = 0;
    vfx.floatingTexts.length = 0; vfx.auraCircles = [];
    gameEngine.resetBoardForNextRound();
  }
  const bWon = aSide === 1 ? scores[0] : scores[1];
  const bLost = aSide === 1 ? scores[1] : scores[0];
  if (bWon === bLost) return { w: 0, d: 1, l: 0 };
  return bWon > bLost ? { w: 1, d: 0, l: 0 } : { w: 0, d: 0, l: 1 };
}

console.log(`\n=== bundle 各阵型 vs 规则随机（同卡组随机放置，${N_GAMES}局×2方向交替） ===`);
for (const f of FORMATION_LIBRARY) {
  const team = f.team.filter(s => s.monsterId > 0);
  let wc = 0, dc = 0, lc = 0;
  let p1w = 0, p1d = 0, p1l = 0; // bundle@P1
  let p2w = 0, p2d = 0, p2l = 0; // bundle@P2
  for (let g = 0; g < N_GAMES; g++) {
    const aSide: 1 | 2 = g % 2 === 0 ? 1 : 2;
    const r = playOne(team, f.name, aSide, 3000 + g);
    wc += r.w; dc += r.d; lc += r.l;
    if (aSide === 1) { p1w += r.w; p1d += r.d; p1l += r.l; }
    else { p2w += r.w; p2d += r.d; p2l += r.l; }
  }
  const t = N_GAMES; // 每阵型 N 局（先/后手各半）
  const wr = (wc / t * 100).toFixed(1);
  const wd = ((wc + dc) / t * 100).toFixed(1);
  const side = (label: string, w: number, d: number, l: number) => `${label}:${w}胜${d}平${l}负`;
  console.log(`  ${f.name}: 总${wc}胜${dc}平${lc}负 胜率${wr}% 胜平率${wd}%  ${side('@P1', p1w, p1d, p1l)} ${side('@P2', p2w, p2d, p2l)}`);
}
