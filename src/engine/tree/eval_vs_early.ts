// ============================================================
// 验收基准 v2：当前产物 vs 早期 bundle AI（固定冻结对手）
//
// 背景：规则随机（L1）已过时（bundle 打它 90%+ 胜率，无区分度）。
//   改用「早期版本 bundle」作为不变基准：它带真实决策逻辑（7 阵型原始树），
//   固定冻结、不参与优化，比规则随机强得多。
//
// 对手侧：早期 bundle AI 完整决策（buildTeam 匹配 + decideWithFormation 走早期树）。
// 我方侧：当前优化产物（EvolFormation，bundle + patch selectBranch）。
// 战斗：真实 BattleSystem(dt=0.04)。
//
// 运行：npx vite-node --script src/engine/tree/eval_vs_early.ts [结果json|--native 阵型名] [局数] [--early 早期bundle路径]
// ============================================================

import '../env';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gameEngine } from '../../game/GameEngine';
import type { TeamSlot } from '../../game/GameEngine';
import { battleSystem } from '../../game/BattleSystem';
import { vfx } from '../../game/VfxManager';
import { registerAllBadges } from '../../game/BadgeSystem';
import { FORMATION_LIBRARY } from '../../ai/formation_library';
import type { EvolFormation, EvolNode, FeatureMask } from './evol_gene';
import { summarizeEvolFormation, formationToEvol, buildConditionMap, evolToBundleFormation } from './evol_gene';
import { patchBranchSelection } from './arena';

registerAllBadges();
vfx.particlesEnabled = false;

const BATTLE_DT = 0.04;
const TIMEOUT_SEC = 45;

function loadBundle(bundlePath: string): any {
  const w = globalThis as any;
  try {
    const code = readFileSync(resolve(bundlePath), 'utf8');
    const factory = new Function('window', 'globalThis', '"use strict";\n' + code + '\n;return BattleAI;');
    const b = factory(w, w);
    return b?.BattleAI ?? w.BattleAI ?? null;
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
    side: raw.condition?.side ?? null,
    main: raw.condition?.main ?? null,
    subs: raw.condition?.subs ?? [],
    keys: raw.condition?.keys ?? [],
  };
  return {
    id: raw.id, round: raw.round, condition: cond,
    placements: (raw.placements ?? []).map((p: any) => ({ monsterId: p.monsterId, x: p.x, y: p.y })),
    children: (raw.children ?? []).map((c: any) => reviveNode(c)),
  };
}
function reviveFormation(raw: any): EvolFormation {
  return {
    name: raw.name ?? 'evolved', archetype: raw.archetype ?? 'half_rush',
    team: (raw.team ?? []).map((s: any) => ({ monsterId: s.monsterId, badgeIds: [...(s.badgeIds ?? [])] })),
    root: reviveNode(raw.tree ?? raw.root),
  };
}

function buildBundleState(side: 'p1' | 'p2', round: number, my: { dbId: number; x: number; y: number }[], enemy: { dbId: number; x: number; y: number }[], budget: number): any {
  const board: any[][] = [];
  for (let y = 0; y < 5; y++) board.push(new Array(11).fill(null));
  const toP2 = (m: { dbId: number; x: number; y: number }) => side === 'p1' ? { dbId: m.dbId, x: 10 - m.x, y: m.y } : m;
  const fill = (list: { dbId: number; x: number; y: number }[], owner: 'p1' | 'p2'): any[] => {
    const deployed: any[] = [];
    list.forEach((m, i) => {
      const inst = { instanceId: i + 1, monsterId: m.dbId, badgeIds: [], position: { x: m.x, y: m.y }, owner };
      board[m.y][m.x] = inst; deployed.push(inst);
    });
    return deployed;
  };
  const players: any = { p1: { side: 'p1', deployed: [], remainingBudget: 4 }, p2: { side: 'p2', deployed: [], remainingBudget: 4 } };
  players.p1.deployed = fill(side === 'p1' ? enemy.map(toP2) : enemy, 'p1');
  players.p2.deployed = fill(side === 'p2' ? my.map(toP2) : my, 'p2');
  players.p2.remainingBudget = budget;
  return { board, players, round, phase: 'placing', currentPlayer: side, nextInstanceId: 99 };
}

function relocateNear(x: number, y: number, side: 'p1' | 'p2', occupied: Set<number>): [number, number] | null {
  const lo = side === 'p1' ? 0 : 6, hi = side === 'p1' ? 4 : 10;
  for (let d = 1; d <= 8; d++) for (let dy = -d; dy <= d; dy++) for (let dx = -d; dx <= d; dx++) {
    if (Math.abs(dx) + Math.abs(dy) !== d) continue;
    const nx = x + dx, ny = y + dy;
    if (nx < lo || nx > hi || ny < 0 || ny > 4) continue;
    if (occupied.has(nx * 10 + ny)) continue;
    return [nx, ny];
  }
  return null;
}

const PRIORITY: Record<number, number> = { 113: 0, 107: 1, 118: 2, 114: 3, 117: 4, 106: 5, 116: 6 };

/** 我方（当前产物）整回合放置：bundle + patch selectBranch */
function evolvedRoundPlan(ai: any, side: 'p1' | 'p2', round: number, budget: number, hand: { monsterId: number; badgeIds: number[] }[], my: { dbId: number; x: number; y: number }[], enemy: { dbId: number; x: number; y: number }[], f: EvolFormation): { monsterId: number; x: number; y: number }[] {
  if (hand.length === 0) return [];
  const fe = ai.pipeline.getFormationEngine();
  const cur = fe.getSelectedFormation();
  try {
    if (cur?.name !== f.name) {
      ai.buildTeam(hand);
      quiet(() => fe.loadCustomFormation(evolToBundleFormation(f)));
      (fe as any).variant = 'original';
      patchBranchSelection(fe, buildConditionMap(f.root));
    }
  } catch (e) { return []; }
  const plan: { monsterId: number; x: number; y: number }[] = [];
  const occupied = new Set(my.map(m => m.x * 10 + m.y));
  let curBudget = budget;
  const inHand = new Set(hand.map(h => h.monsterId));
  let placements: any[] = [];
  try {
    const st = buildBundleState(side, round, my, enemy, curBudget);
    const raw = quiet(() => ai.pipeline.decideWithFormation(hand, round, st));
    placements = raw?.placements ?? [];
  } catch (e) { return []; }
  for (const a of placements) {
    if (!inHand.has(a.monsterId)) continue;
    const cost = ai.getMonster(a.monsterId)?.cost ?? 0;
    if (cost > curBudget) continue;
    if (a.x < 6 || a.x > 10 || a.y < 0 || a.y > 4) { const r = relocateNear(a.x, a.y, 'p2', occupied); if (!r) continue; a.x = r[0]; a.y = r[1]; }
    if (occupied.has(a.x * 10 + a.y)) { const r = relocateNear(a.x, a.y, 'p2', occupied); if (!r) continue; a.x = r[0]; a.y = r[1]; }
    occupied.add(a.x * 10 + a.y);
    plan.push({ monsterId: a.monsterId, x: a.x, y: a.y });
    curBudget -= cost;
  }
  return plan;
}

/** 对手（早期 bundle AI）整回合放置：走早期 bundle 原生决策（buildTeam 匹配 + decideWithFormation） */
function earlyRoundPlan(earlyAI: any, side: 'p1' | 'p2', round: number, budget: number, hand: { monsterId: number; badgeIds: number[] }[], my: { dbId: number; x: number; y: number }[], enemy: { dbId: number; x: number; y: number }[]): { monsterId: number; x: number; y: number }[] {
  if (hand.length === 0) return [];
  try {
    if (!(earlyAI as any)._inited) {
      earlyAI.buildTeam(hand);
      (earlyAI as any)._inited = true;
    }
    const st = buildBundleState(side, round, my, enemy, budget);
    const raw = quiet(() => earlyAI.pipeline.decideWithFormation(hand, round, st));
    const placements: any[] = raw?.placements ?? [];
    const out: { monsterId: number; x: number; y: number }[] = [];
    for (const a of placements) {
      // 早期 bundle 返回 P2 视角坐标，p1 侧镜像
      let x = side === 'p1' ? 10 - a.x : a.x;
      out.push({ monsterId: a.monsterId, x, y: a.y });
    }
    return out;
  } catch (e) {
    console.error(`[eval] 早期 AI 决策失败: ${(e as Error).message}`);
    return [];
  }
}

/** 单局：当前产物 vs 早期 bundle AI，返回我方 {w,d,l} */
function playVsEarly(curAI: any, earlyAI: any, f: EvolFormation, oppDeck: { monsterId: number; badgeIds: number[] }[], evoSide: 1 | 2, seed: number): { w: number; d: number; l: number } {
  const evoTeam = f.team.filter(s => s.monsterId > 0) as TeamSlot[];
  gameEngine.restartGame();
  gameEngine.mode = 'ai';
  gameEngine.teams = [evoTeam as TeamSlot[], oppDeck as TeamSlot[]];
  gameEngine.setReplaySeed(seed);
  vfx.particles.length = 0; vfx.backgroundParticles.length = 0; vfx.projectiles.length = 0; vfx.floatingTexts.length = 0; vfx.auraCircles = [];
  const ai = new curAI(); ai.setDifficulty('normal');
  const eai = new earlyAI(); eai.setDifficulty('normal');
  const scores = [0, 0];
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
    const oppEnemy = gameEngine.boardMonsters.filter(m => m.team === evoSide).map(m => ({ dbId: m.dbId, x: m.gridX, y: m.gridY }));

    // 我方放置
    const realRandom = Math.random; Math.random = rng;
    let evoPlan: { monsterId: number; x: number; y: number }[] = [];
    try {
      evoPlan = evolvedRoundPlan(ai, evoSide === 1 ? 'p1' : 'p2', round, evoBudget,
        evoHand.map(id => ({ monsterId: id, badgeIds: f.team.find(s => s.monsterId === id)?.badgeIds ?? [] })),
        evoMy, evoEnemy, f);
    } finally { Math.random = realRandom; }

    // 对手（早期 AI）放置
    Math.random = rng;
    let oppPlan: { monsterId: number; x: number; y: number }[] = [];
    try {
      oppPlan = earlyRoundPlan(eai, oppSide === 1 ? 'p1' : 'p2', round, oppBudget,
        oppHand.map(id => ({ monsterId: id, badgeIds: oppDeck.find(s => s.monsterId === id)?.badgeIds ?? [] })),
        oppMy, oppEnemy);
    } finally { Math.random = realRandom; }

    // 放置我方
    {
      const ordered = [...evoPlan].sort((a, b) => (PRIORITY[a.monsterId] ?? 9) - (PRIORITY[b.monsterId] ?? 9));
      const occ = new Set(evoMy.map(m => m.x * 10 + m.y));
      for (const p of ordered) {
        const slot = evoTeam.find(s => s.monsterId === p.monsterId);
        if (!slot || !evoHand.includes(p.monsterId)) continue;
        let px = evoSide === 1 ? 10 - p.x : p.x, py = p.y;
        if (occ.has(px * 10 + py) || !gameEngine.placeMonster(slot, px, py, evoSide === 1)) {
          const r = relocateNear(px, py, evoSide === 1 ? 'p1' : 'p2', occ);
          if (!r) continue; px = r[0]; py = r[1];
          if (occ.has(px * 10 + py)) continue;
          if (!gameEngine.placeMonster(slot, px, py, evoSide === 1)) continue;
        }
        occ.add(px * 10 + py); evoHand.splice(evoHand.indexOf(p.monsterId), 1);
      }
    }
    // 放置对手
    {
      for (const p of oppPlan) {
        const slot = oppDeck.find(s => s.monsterId === p.monsterId);
        if (!slot || !oppHand.includes(p.monsterId)) continue;
        if (!gameEngine.placeMonster(slot, p.x, p.y, oppSide === 1)) continue;
        oppHand.splice(oppHand.indexOf(p.monsterId), 1);
      }
    }

    const s1 = gameEngine.p1Score, s2 = gameEngine.p2Score;
    battleSystem.startBattle();
    let elapsed = 0;
    while (battleSystem.active && elapsed < TIMEOUT_SEC) { battleSystem.update(BATTLE_DT); vfx.update(BATTLE_DT); elapsed += BATTLE_DT; }
    if (battleSystem.active) (battleSystem as any).endBattle(null);
    scores[0] += gameEngine.p1Score - s1; scores[1] += gameEngine.p2Score - s2;
    vfx.particles.length = 0; vfx.backgroundParticles.length = 0; vfx.projectiles.length = 0; vfx.floatingTexts.length = 0; vfx.auraCircles = [];
    gameEngine.resetBoardForNextRound();
  }

  const evoWon = evoSide === 1 ? scores[0] : scores[1];
  const evoLost = evoSide === 1 ? scores[1] : scores[0];
  if (evoWon === evoLost) return { w: 0, d: 1, l: 0 };
  return evoWon > evoLost ? { w: 1, d: 0, l: 0 } : { w: 0, d: 0, l: 1 };
}

/** 早期 bundle 基准结果 */
export interface EarlyResult {
  w: number; d: number; l: number;
  undefeated: number;  // 不败率（胜+平）/总
  winRate: number;     // 纯胜率
}

/**
 * 可复用：评估一个进化产物 vs 早期 bundle 的不败率（不变基准）。
 * 对手卡组从早期 7 阵型随机选，对手决策走早期 bundle 原生逻辑。
 */
export function evalVsEarly(evolved: EvolFormation, games: number, earlyPath?: string): EarlyResult {
  const curAI = loadBundle('public/ai-bundle.iife.js');
  const earlyAI = loadBundle(earlyPath ?? 'reports/sync_backup_20260814_194412/ai-bundle_src.bak');
  if (!curAI || !earlyAI) throw new Error('bundle 加载失败');
  const decks = FORMATION_LIBRARY.slice(0, 7).map(f => f.team.filter(s => s.monsterId > 0));
  const deckRng = mulberry32(12345);
  let w = 0, d = 0, l = 0;
  for (let g = 0; g < games; g++) {
    const oppDeck = decks[Math.floor(deckRng() * decks.length)];
    const evoSide: 1 | 2 = g % 2 === 0 ? 1 : 2;
    const r = playVsEarly(curAI, earlyAI, evolved, oppDeck, evoSide, 3000 + g);
    w += r.w; d += r.d; l += r.l;
  }
  const t = w + d + l;
  return { w, d, l, undefeated: (w + d) / t, winRate: w / t };
}

function main(): void {
  const ARGV: Record<string, string> = {};
  for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i];
    if (a.startsWith('--')) { const k = a.slice(2); const v = process.argv[i + 1]; if (v !== undefined && !v.startsWith('--')) { ARGV[k] = v; i++; } else ARGV[k] = 'true'; }
  }
  const target = process.argv[2] || 'reports/evolution2_result.json';
  const games = Number(process.argv[3] || 20);
  const earlyPath = ARGV.early ?? 'reports/sync_backup_20260814_194412/ai-bundle_src.bak';
  const nativeName = ARGV.native ?? null;

  const curAI = loadBundle('public/ai-bundle.iife.js');
  const earlyAI = loadBundle(earlyPath);
  if (!curAI || !earlyAI) { console.error('bundle 加载失败'); process.exit(1); }

  let evolved: EvolFormation;
  if (nativeName) {
    const src = FORMATION_LIBRARY.find(f => f.name === nativeName);
    if (!src) { console.error(`阵型不存在: ${nativeName}`); process.exit(1); }
    evolved = formationToEvol(src);
  } else {
    const raw = JSON.parse(readFileSync(resolve(target), 'utf8'));
    evolved = reviveFormation(raw.formation);
  }

  console.log('=== vs 早期 bundle AI（固定冻结基准，7 阵型原始树） ===');
  console.log(summarizeEvolFormation(evolved));
  console.log(`早期 bundle: ${earlyPath}\n`);

  const t0 = Date.now();
  const r = evalVsEarly(evolved, games, earlyPath);
  const ms = Date.now() - t0;
  const t = r.w + r.d + r.l;
  console.log(`vs 早期 bundle ${t} 局: ${r.w}胜 ${r.d}平 ${r.l}负`);
  console.log(`  纯胜率  ${(r.winRate * 100).toFixed(1)}%`);
  console.log(`  ★不败率 ${(r.undefeated * 100).toFixed(1)}%`);
  console.log(`耗时 ${(ms / 1000).toFixed(1)}s`);
}

// 仅 CLI 直接运行时执行 main（被 import 时不执行）
if (process.argv[1] && process.argv[1].endsWith('eval_vs_early.ts')) {
  main();
}
