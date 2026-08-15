// ============================================================
// 7×7 阵型相互胜率：bundle AI（各行阵型）vs bundle AI（各列阵型）
// 每对：交替 bundle 侧（行阵型 p1/列阵型 p2 ↔ 反向），固定 seed 可复现
// 运行：npx vite-node --script engine/train/bench_bundle_vs_bundle.ts [--games 20] [--bundle 路径]
// 输出：7×7 胜率矩阵（行胜率 = 行阵型作为 bundle 侧胜率）
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
const N_GAMES = Number(ARGV.games ?? 10);
const BATTLE_DT = Number(ARGV.dt ?? 0.04);
const BUNDLE_PATH = ARGV.bundle ?? 'public/ai-bundle.iife.js';
const ONLY = ARGV.only ?? null; // 只跑与指定阵型相关的对阵（含镜像），其余格子留空
const timeoutSec = 45;

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

/** bundle 整回合放置计划（formationName 强制卡组对应阵型；内部恒 p2 视角） */
function bundleRoundPlan(
  ai: any,
  side: 'p1' | 'p2',
  round: number,
  budget: number,
  hand: { monsterId: number; badgeIds: number[] }[],
  my: { dbId: number; x: number; y: number }[],
  enemy: { dbId: number; x: number; y: number }[],
  formationName: string,
  oppHand?: { monsterId: number; badgeIds: number[] }[],
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
    // 传入对手手牌前 4 张（体系识别：祷徒/全冲/肃清），与真实前端一致
    if (oppHand && oppHand.length > 0) {
      quiet(() => fe.setOpponentHand(oppHand.slice(0, 4)));
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
    // bundle 内部恒为 p2 视角（buildBundleState 已把 my/enemy 统一到 p2 视角），
    // 此处坐标已是 p2 视角（x6-10 我方），不需要再按 side 镜像/relocate 混用空间。
    const lo = 6, hi = 10;
    if (a.x < lo || a.x > hi || a.y < 0 || a.y > 4) {
      // 越界（罕见）：就近重定位到我方 p2 半区
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

/** 双方都是 bundle：A 阵型 vs B 阵型（各自 AI 实例，独立阵型状态） */
function playOne(
  teamA: FormationTeamSlot[],
  nameA: string,
  teamB: FormationTeamSlot[],
  nameB: string,
  aSide: 1 | 2,
  seed: number,
): { w: number; d: number; l: number; summary: string } {
  gameEngine.restartGame();
  gameEngine.mode = 'ai';
  gameEngine.teams = [teamA as TeamSlot[], teamB as TeamSlot[]];
  gameEngine.setReplaySeed(seed);
  const aiA = new BundleAI();
  const aiB = new BundleAI();
  aiA.setDifficulty('normal');
  aiB.setDifficulty('normal');
  const scores = [0, 0];
  const roundResults: (0 | 1 | 2)[] = [];
  for (let round = 1; round <= gameEngine.maxRounds; round++) {
    if (gameEngine.isGameOver()) break;
    gameEngine.currentRound = round;
    const rng = mulberry32(seed * 2654435761 + round);
    // A 先手/后手交替由调用方控制（aSide 定 A 在哪边）
    const placeBundle = (side: 1 | 2, ai: any, team: FormationTeamSlot[], name: string, r: () => number, oppTeam: FormationTeamSlot[]) => {
      const my = gameEngine.boardMonsters.filter(m => m.team === side).map(m => ({ dbId: m.dbId, x: m.gridX, y: m.gridY }));
      const enemy = gameEngine.boardMonsters.filter(m => m.team !== side).map(m => ({ dbId: m.dbId, x: m.gridX, y: m.gridY }));
      const budget = gameEngine[side === 1 ? 'p1RemainingBudget' : 'p2RemainingBudget'];
      const realRandom = Math.random;
      Math.random = r;
      try {
        // bundleRoundPlan 内部恒为 p2 视角输出；真实放置时 p1 侧需镜像回真实坐标
        const plan = bundleRoundPlan(ai, side === 1 ? 'p1' : 'p2', round, budget, team, my, enemy, name, oppTeam);
        // 放置优先级：位置越锁定的越先放（锁定位被占后回退空间小）
        // 矿爆113(锁祈祷.x+6) > 咒法107(防钻头安全位) > 塞雷118 > 突突114 >
        // 铁甲117(贴队友) > 冲锋106(对线,行可变) > 钻头116(落点灵活,可选多)
        const PRIORITY: Record<number, number> = {
          113: 0,   // 矿爆：落点锁定
          107: 1,   // 咒法：安全位较固定
          118: 2,   // 塞雷：贴帝国上下
          114: 3,   // 突突：同行可变
          117: 4,   // 铁甲：贴防装队友
          106: 5,   // 冲锋：对线行，灵活
          116: 6,   // 钻头：可选位置最多
        };
        const ordered = [...plan].sort((a, b) =>
          (PRIORITY[a.monsterId] ?? 9) - (PRIORITY[b.monsterId] ?? 9));
        const occupiedNow = new Set(gameEngine.boardMonsters.filter(m => m.team === side).map(m => m.gridX * 10 + m.gridY));
        for (const p of ordered) {
          const slot = team.find(s => s.monsterId === p.monsterId);
          if (!slot) continue;
          let px = side === 1 ? 10 - p.x : p.x;
          let py = p.y;
          // 占位冲突（同回合多只特殊/AIM 怪可能算出同点）：就近找空位，模拟前端占位回退
          if (occupiedNow.has(px * 10 + py) || !gameEngine.placeMonster(slot, px, py, side === 1)) {
            const r = relocateNear(px, py, side === 1 ? 'p1' : 'p2', occupiedNow);
            if (!r) continue;
            px = r[0]; py = r[1];
            if (occupiedNow.has(px * 10 + py)) continue;
            if (!gameEngine.placeMonster(slot, px, py, side === 1)) continue;
          }
          occupiedNow.add(px * 10 + py);
        }
      } finally { Math.random = realRandom; }
    };
    // A 在 aSide 边，B 在另一边；先后手各半由调用方换 aSide
    placeBundle(aSide, aiA, teamA, nameA, rng, teamB);
    placeBundle(aSide === 1 ? 2 : 1, aiB, teamB, nameB, rng, teamA);

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
  const aWon = aSide === 1 ? scores[0] : scores[1];
  const aLost = aSide === 1 ? scores[1] : scores[0];
  const summary = `A@side${aSide} ${roundResults.join('')} ${scores[0]}:${scores[1]}`;
  if (aWon === aLost) return { w: 0, d: 1, l: 0, summary };
  return aWon > aLost ? { w: 1, d: 0, l: 0, summary } : { w: 0, d: 0, l: 1, summary };
}

function main(): void {
  const decks = FORMATION_LIBRARY;
  const n = decks.length;
  // win[i][j] = 阵型i(行) 胜 阵型j(列) 的局数；half = 平局算0.5
  const win: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  const half: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  const total: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  const t0 = Date.now();

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (ONLY && decks[i].name !== ONLY && decks[j].name !== ONLY) continue;
      const teamA = decks[i].team.filter(s => s.monsterId > 0);
      const teamB = decks[j].team.filter(s => s.monsterId > 0);
      for (let g = 0; g < N_GAMES; g++) {
        const aSide: 1 | 2 = g % 2 === 0 ? 1 : 2; // 交替 A 先/后（镜像局同样交替，暴露先后手不对称）
        const r = playOne(teamA, decks[i].name, teamB, decks[j].name, aSide, 1000 + i * 100 + j * 7 + g);
        total[i][j]++;
        if (r.w) win[i][j]++;
        else if (r.d) half[i][j]++;
      }
    }
  }

  // 矩阵对称化：merge[i][j] = i(行) 对 j(列) 的综合战绩（合并两个方向，各 20 局）
  // i 当 A 的胜场 win[i][j] + i 当 B 的胜场（= j 当 A 时的负场 total[j][i]-win[j][i]-half[j][i]）
  const symW: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  const symD: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  const symT: number[][] = Array.from({ length: n }, () => new Array(n).fill(N_GAMES * 2));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      symW[i][j] = win[i][j] + (total[j][i] - win[j][i] - half[j][i]); // i 总胜场（含镜像 i==j：两边胜场合并）
      symD[i][j] = half[i][j] + half[j][i];                            // i 总平场
      symT[i][j] = total[i][j] + total[j][i];                          // 总场次
    }
  }

  const totalMs = Date.now() - t0;
  console.log(`\n=== 7×7 阵型相互胜率（双向合并，${N_GAMES}局/方向） ===`);
  const pad = (s: string, len = 9) => s.padStart(len);
  const names = decks.map(d => d.name);
  console.log(pad('行\\列') + names.map(nm => pad(nm)).join(''));
  for (let i = 0; i < n; i++) {
    const row = names.map((_, j) => {
      const t = symT[i][j];
      // 胜平率 = 胜率 + 平局率（平局不除二）
      const wr = t ? ((symW[i][j] + symD[i][j]) / t * 100).toFixed(1) : '-';
      return pad(wr + '%');
    }).join('');
    console.log(pad(names[i]) + row);
  }

  console.log(`\n=== 镜像对局（自己打自己，每阵型 ${N_GAMES}局×2方向，暴露先后手不对称） ===`);
  for (let i = 0; i < n; i++) {
    const w = symW[i][i], d = symD[i][i], t = symT[i][i];
    const l = t - w - d;
    const wr = t ? (w / t * 100).toFixed(1) : '-';
    const wd = t ? ((w + d) / t * 100).toFixed(1) : '-';
    console.log(`  ${names[i]} 镜像: ${w}胜 ${d}平 ${l}负 胜率${wr}% 胜平率${wd}%`);
  }

  console.log(`\n=== 详细战绩（双向合并：行阵型胜/平/负，每对40局） ===`);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const w = symW[i][j], d = symD[i][j], t = symT[i][j];
      const l = t - w - d;
      const wr = t ? (w / t * 100).toFixed(1) : '-';
      const wd = t ? ((w + d) / t * 100).toFixed(1) : '-'; // 胜平率 = 胜率 + 平局率
      console.log(`  ${names[i]} vs ${names[j]}: ${w}/${d}/${l} 胜率${wr}% 胜平率${wd}%`);
    }
  }
  console.log(`\n每对 ${N_GAMES} 局×2方向（各先手/后手各半） 总耗时${(totalMs / 1000).toFixed(1)}s`);
}

main();
