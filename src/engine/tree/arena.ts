// ============================================================
// P2 — 分离测试竞技场（arena）
// 评估一个进化个体（EvolFormation）在多维靶上的表现，主指标=不败率（胜+平）。
//
//   attack        （攻击力）vs 全二永平：能否击杀高生存均衡阵
//   survival      （生存力）vs 全二冲：能否在高爆发下存活
//   comprehensive （综合力）vs 泉水剑：祷徒续航+祭司高伤害强阵
//   vsAll         对 7 阵型综合（参考，不计入分离分）
//
// 每个靶子分先手(side1)/后手(side2) 分开统计（用户洞察：左右主场不对称，
// 合并统计会掩盖短板）。主指标 adScore = 三维不败率均值；
// 补短板指标 weakest = 6 格最弱不败率（爬山用 maximin 优先补最弱格）。
//
// 执行机制：
//   - 候选个体（EvolFormation）：通过 loadCustomFormation 注入 bundle，
//     并 monkey-patch fe.selectBranch → 用 FeatureMask 匹配（识别学习化），
//     完整复用 bundle 的变体(注入路径下 variant=original 确定性)+特殊/瞄准索敌。
//   - 靶子：用 formation_library 原始 Formation + bundle 原生 label 匹配，
//     保证对照基准是"人工精调的最强打法"。
//   - 战斗：真实 BattleSystem，dt=0.04 固定步长，与网页一致。
//
// 运行（CLI 自测）：
//   npx vite-node --script src/engine/tree/arena.ts --formation 肃清 --games 4
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
import type { Formation, FormationTeamSlot } from '../../ai/types';
import type { EvolFormation, FeatureMask } from './evol_gene';
import {
  evolToBundleFormation, buildConditionMap, formationToEvol,
  recognizeArchetype, matchMask, maskSpecificity, emptyMask, isEmptyMask,
} from './evol_gene';

registerAllBadges();
vfx.particlesEnabled = false;

const BATTLE_DT = 0.04;
const TIMEOUT_SEC = 45;

// ---------- bundle 加载 ----------

function loadBundle(bundlePath: string): any {
  const w = globalThis as any;
  try {
    const code = readFileSync(resolve(bundlePath), 'utf8');
    const factory = new Function('window', 'globalThis', '"use strict";\n' + code + '\n;return BattleAI;');
    const bundleExports = factory(w, w);
    return bundleExports?.BattleAI ?? w.BattleAI ?? null;
  } catch (e) {
    console.error(`[arena] bundle 加载失败: ${(e as Error).message}`);
    return null;
  }
}

// ---------- 工具 ----------

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

// ---------- 分支选择 patch（识别学习化核心） ----------

/**
 * monkey-patch formationEngine.selectBranch：用三层识别标签匹配替代 label 关键词。
 * 识别逻辑见 evol_gene.ts recognizeArchetype（用户定案：祷徒>半冲>全冲 短路，
 * 附加标签 dof/盾流/礼物 可叠加，关键怪第二层）。
 * 分支按特异性降序（main 非空 + subs 数 + keys 数），第一个命中即选；主分支兜底。
 */
export interface BranchDecision {
  round: number;
  handIds: number[];
  handBadges: number[];
  boardIds: number[];
  chosenBranchId: string;
  branchLabels: string[];
}

export function patchBranchSelection(
  fe: any,
  condMap: Map<string, FeatureMask>,
  onDecision?: (d: BranchDecision) => void,
): void {
  fe.selectBranch = (gameState: any, branches: any[]): any => {
    const handIds: Set<number> = fe.opponentHandIds ?? new Set();
    const handBadges: Set<number> = fe.opponentHandBadgeIds ?? new Set();
    const boardIds: Set<number> = new Set(
      (gameState.players.p1.deployed ?? []).map((m: any) => m.monsterId),
    );
    const maskOf = (b: any): FeatureMask => condMap.get(b.id) ?? emptyMask();
    // 候选先后手：currentPlayer 即候选侧（buildBundleState 里 currentPlayer=side）
    const mySide: 1 | 2 = gameState.currentPlayer === 'p1' ? 1 : 2;

    // 识别对手三层标签
    const rec = recognizeArchetype({ handIds, handBadges, boardIds });

    // 分支按特异性降序，第一个命中的优先（更具体的条件优先于宽泛条件）
    const ranked = [...branches].sort((a, b) => maskSpecificity(maskOf(b)) - maskSpecificity(maskOf(a)));

    let mainBranch: any = null;
    for (const b of ranked) {
      const mask = maskOf(b);
      if (isEmptyMask(mask)) {
        if (!mainBranch) mainBranch = b;
        continue;
      }
      if (matchMask(mask, rec, mySide)) return choose(b);
    }
    return choose(mainBranch ?? branches[0]);

    function choose(b: any): any {
      onDecision?.({
        round: gameState.round ?? 0,
        handIds: [...handIds].sort((a, b) => a - b),
        handBadges: [...handBadges].sort((a, b) => a - b),
        boardIds: [...boardIds].sort((a, b) => a - b),
        chosenBranchId: b.id,
        branchLabels: branches.map((x: any) => x.label ?? x.id),
      });
      return b;
    }
  };
}

// ---------- 放置计划 ----------

/** 单侧规格：evol=进化个体(mask匹配) / native=原生阵型(label匹配) */
export type SideSpec =
  | { kind: 'evol'; f: EvolFormation }
  | { kind: 'native'; f: Formation };

function teamOf(spec: SideSpec): FormationTeamSlot[] {
  return spec.f.team.filter(s => s.monsterId > 0);
}

/**
 * 用 bundle 引擎执行单侧整回合放置计划。
 * evol 侧：loadCustomFormation 注入 + patch selectBranch（首次）。
 * native 侧：loadCustomFormation 注入原始 Formation，走 bundle 原生 label 匹配。
 */
function bundleRoundPlanFor(
  ai: any,
  side: 'p1' | 'p2',
  round: number,
  budget: number,
  hand: { monsterId: number; badgeIds: number[] }[],
  my: { dbId: number; x: number; y: number }[],
  enemy: { dbId: number; x: number; y: number }[],
  spec: SideSpec,
  oppHand?: { monsterId: number; badgeIds: number[] }[],
  onDecision?: (d: BranchDecision) => void,
): { monsterId: number; x: number; y: number }[] {
  if (hand.length === 0) return [];
  const fe = ai.pipeline.getFormationEngine();
  const cur = fe.getSelectedFormation();
  const name = spec.f.name;
  try {
    if (cur?.name !== name) {
      ai.buildTeam(hand);
      const bundleFmt = spec.kind === 'evol'
        ? evolToBundleFormation(spec.f as EvolFormation)
        : spec.f as unknown as any;
      quiet(() => fe.loadCustomFormation(bundleFmt));
      // 变体非对称处理（用户洞察）：
      //   - evol 侧（候选/我方）：固定 variant=original，树坐标=实际落点，学固定套路
      //   - native 侧（靶子/对手）：保留变体随机（镜像/平移），对手多样 → 学到的解法才泛化
      if (spec.kind === 'evol') {
        (fe as any).variant = 'original';
        patchBranchSelection(fe, buildConditionMap((spec.f as EvolFormation).root), onDecision);
      }
      // native 侧不设 variant，保留 buildTeam 时 selectVariant 随机选的变体
    }
    if (oppHand && oppHand.length > 0) {
      quiet(() => fe.setOpponentHand(oppHand.slice(0, 4)));
    }
  } catch (e) {
    console.error(`[arena] 阵型加载失败: ${(e as Error).message}`);
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
    console.error(`[arena] decideWithFormation 失败: ${(e as Error).message}`);
    return [];
  }
  for (const a of placements) {
    if (!inHand.has(a.monsterId)) continue;
    const cost = ai.getMonster(a.monsterId)?.cost ?? 0;
    if (cost > curBudget) continue;
    const lo = 6, hi = 10;
    if (a.x < lo || a.x > hi || a.y < 0 || a.y > 4) {
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

const PRIORITY: Record<number, number> = {
  113: 0, 107: 1, 118: 2, 114: 3, 117: 4, 106: 5, 116: 6,
};

/**
 * 单局：A vs B，双方 bundle 引擎真实执行。aSide 决定 A 在哪边。
 * 返回 A 视角 {w,d,l}。
 */
export function playSpecVsSpec(
  BundleAI: any,
  specA: SideSpec,
  specB: SideSpec,
  aSide: 1 | 2,
  seed: number,
  onDecision?: (d: BranchDecision, outcome: 1 | 0 | -1) => void,
): { w: number; d: number; l: number; summary: string; roundScores: number[] } {
  const teamA = teamOf(specA) as TeamSlot[];
  const teamB = teamOf(specB) as TeamSlot[];

  gameEngine.restartGame();
  gameEngine.mode = 'ai';
  gameEngine.teams = [teamA as TeamSlot[], teamB as TeamSlot[]];
  gameEngine.setReplaySeed(seed);
  // 开局清 vfx：restartGame/startBattle 均不清残留，上一局异常退出（超时兜底）的
  // 飞行子弹会污染本局战斗结果（沙盒 vs 网页逐位一致的关键前提）。
  vfx.particles.length = 0;
  vfx.backgroundParticles.length = 0;
  vfx.projectiles.length = 0;
  vfx.floatingTexts.length = 0;
  vfx.auraCircles = [];
  const aiA = new BundleAI();
  const aiB = new BundleAI();
  aiA.setDifficulty('normal');
  aiB.setDifficulty('normal');
  const scores = [0, 0];
  const roundResults: (0 | 1 | 2)[] = [];
  // 收集本局 A 侧分支决策（识别学习样本）
  const aDecisions: BranchDecision[] = [];

  for (let round = 1; round <= gameEngine.maxRounds; round++) {
    if (gameEngine.isGameOver()) break;
    gameEngine.currentRound = round;
    const rng = mulberry32(seed * 2654435761 + round);

    const placeBundle = (side: 1 | 2, ai: any, spec: SideSpec, r: () => number, oppSpec: SideSpec, isA: boolean) => {
      const team = teamOf(spec);
      const my = gameEngine.boardMonsters.filter(m => m.team === side).map(m => ({ dbId: m.dbId, x: m.gridX, y: m.gridY }));
      const enemy = gameEngine.boardMonsters.filter(m => m.team !== side).map(m => ({ dbId: m.dbId, x: m.gridX, y: m.gridY }));
      const budget = gameEngine[side === 1 ? 'p1RemainingBudget' : 'p2RemainingBudget'];
      const realRandom = Math.random;
      Math.random = r;
      try {
        const plan = bundleRoundPlanFor(
          ai, side === 1 ? 'p1' : 'p2', round, budget, team, my, enemy, spec, teamOf(oppSpec),
          isA ? (d) => aDecisions.push(d) : undefined,
        );
        const ordered = [...plan].sort((a, b) => (PRIORITY[a.monsterId] ?? 9) - (PRIORITY[b.monsterId] ?? 9));
        const occupiedNow = new Set(gameEngine.boardMonsters.filter(m => m.team === side).map(m => m.gridX * 10 + m.gridY));
        for (const p of ordered) {
          const slot = team.find(s => s.monsterId === p.monsterId);
          if (!slot) continue;
          let px = side === 1 ? 10 - p.x : p.x;
          let py = p.y;
          if (occupiedNow.has(px * 10 + py) || !gameEngine.placeMonster(slot, px, py, side === 1)) {
            const rl = relocateNear(px, py, side === 1 ? 'p1' : 'p2', occupiedNow);
            if (!rl) continue;
            px = rl[0]; py = rl[1];
            if (occupiedNow.has(px * 10 + py)) continue;
            if (!gameEngine.placeMonster(slot, px, py, side === 1)) continue;
          }
          occupiedNow.add(px * 10 + py);
        }
      } finally { Math.random = realRandom; }
    };

    placeBundle(aSide, aiA, specA, rng, specB, true);
    placeBundle(aSide === 1 ? 2 : 1, aiB, specB, rng, specA, false);

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
  // 决策结果：A 视角 1=胜 0=平 -1=负
  const outcome: 1 | 0 | -1 = aWon === aLost ? 0 : (aWon > aLost ? 1 : -1);
  if (onDecision) {
    for (const d of aDecisions) onDecision(d, outcome);
  }
  // 轮级比分（A 视角每轮得分差：+1 胜/0 平/-1 负），聚焦搜索"输的轮"用
  const roundScores = roundResults.map(r => {
    if (r === 0) return 0;
    const aWinRound = (aSide === 1 && r === 1) || (aSide === 2 && r === 2);
    return aWinRound ? 1 : -1;
  });
  if (aWon === aLost) return { w: 0, d: 1, l: 0, summary, roundScores };
  return aWon > aLost ? { w: 1, d: 0, l: 0, summary, roundScores } : { w: 0, d: 0, l: 1, summary, roundScores };
}

// ---------- 靶子与评估 ----------

export interface ArenaScore {
  win: number;
  draw: number;
  loss: number;
  undefeated: number; // 不败率（胜+平）/总 —— 主指标
  winRate: number;
}

/** 分侧战绩：先手(side1=p1)/后手(side2=p2) 分开统计（用户洞察：左右主场不对称） */
export interface SideScore {
  first: ArenaScore;   // 候选先手
  second: ArenaScore;  // 候选后手
}

export interface ArenaResult {
  attack: SideScore;        // 攻击力（vs 全二永平）
  survival: SideScore;      // 生存力（vs 全二冲）
  comprehensive: SideScore; // 综合能力（vs 泉水剑）
  vsAll: ArenaScore;
  adScore: number;   // 三维不败率均值 —— 主指标
  weakest: number;   // 6 格（3靶×先/后手）最弱不败率 —— 补短板指标
}

function emptyScore(): ArenaScore {
  return { win: 0, draw: 0, loss: 0, undefeated: 0, winRate: 0 };
}
function emptySide(): SideScore {
  return { first: emptyScore(), second: emptyScore() };
}
function accumulate(s: ArenaScore, r: { w: number; d: number; l: number }): void {
  s.win += r.w; s.draw += r.d; s.loss += r.l;
}
function finalize(s: ArenaScore): void {
  const t = s.win + s.draw + s.loss;
  if (t === 0) return;
  s.undefeated = (s.win + s.draw) / t;
  s.winRate = s.win / t;
}
function sideUndefeated(s: SideScore): number {
  return Math.min(s.first.undefeated, s.second.undefeated);
}

function byName(name: string): Formation {
  const f = FORMATION_LIBRARY.find(fm => fm.name === name);
  if (!f) throw new Error(`阵型不存在: ${name}`);
  return f;
}

export function evaluateArena(
  BundleAI: any,
  candidate: EvolFormation,
  gamesPerTarget: number,
  onProgress?: (label: string, i: number, total: number) => void,
): ArenaResult {
  const res: ArenaResult = {
    attack: emptySide(), survival: emptySide(), comprehensive: emptySide(),
    vsAll: emptyScore(), adScore: 0, weakest: 0,
  };

  const targets: { key: 'attack' | 'survival' | 'comprehensive'; name: string; f: Formation }[] = [
    { key: 'attack', name: '全二永平', f: byName('全二永平') },   // 攻击力：能否击杀高生存均衡阵
    { key: 'survival', name: '全二冲', f: byName('全二冲') },     // 生存力：能否在高爆发下存活
    { key: 'comprehensive', name: '泉水剑', f: byName('泉水剑') }, // 综合能力：祷徒续航+祭司高伤害强阵
  ];

  const specA: SideSpec = { kind: 'evol', f: candidate };
  let g = 0;
  for (const t of targets) {
    // 先手/后手分开统计：偶数局候选先手(side1)，奇数局候选后手(side2)
    for (let i = 0; i < gamesPerTarget; i++) {
      const aSide: 1 | 2 = i % 2 === 0 ? 1 : 2;
      const r = playSpecVsSpec(BundleAI, specA, { kind: 'native', f: t.f }, aSide, 1000 + g);
      accumulate(aSide === 1 ? res[t.key].first : res[t.key].second, r);
      onProgress?.(t.name, i + 1, gamesPerTarget);
      g++;
    }
    finalize(res[t.key].first);
    finalize(res[t.key].second);
  }

  FORMATION_LIBRARY.forEach((f, idx) => {
    const r = playSpecVsSpec(BundleAI, specA, { kind: 'native', f }, idx % 2 === 0 ? 1 : 2, 9000 + idx);
    accumulate(res.vsAll, r);
  });
  finalize(res.vsAll);

  // 主指标：三维不败率均值（先/后手合并后的每维均值）
  const avg = (s: SideScore) => (s.first.undefeated + s.second.undefeated) / 2;
  res.adScore = (avg(res.attack) + avg(res.survival) + avg(res.comprehensive)) / 3;
  // 补短板指标：6 格最弱不败率（maximin，爬山用它优先补最弱格）
  res.weakest = Math.min(
    res.attack.first.undefeated, res.attack.second.undefeated,
    res.survival.first.undefeated, res.survival.second.undefeated,
    res.comprehensive.first.undefeated, res.comprehensive.second.undefeated,
  );
  return res;
}

export function formatArenaResult(name: string, r: ArenaResult): string {
  const pct = (v: number) => (v * 100).toFixed(1) + '%';
  const fmtSide = (label: string, s: SideScore) =>
    `  ${label}: 先手 ${pct(s.first.undefeated)}(${s.first.win}/${s.first.draw}/${s.first.loss}) | 后手 ${pct(s.second.undefeated)}(${s.second.win}/${s.second.draw}/${s.second.loss})`;
  return [
    `${name} 分离测试:`,
    fmtSide('攻击力(vs全二永平)', r.attack),
    fmtSide('生存力(vs全二冲)  ', r.survival),
    fmtSide('综合力(vs泉水剑)  ', r.comprehensive),
    `  泛化(vs7阵型)      ${pct(r.vsAll.undefeated)} 不败 (${r.vsAll.win}/${r.vsAll.draw}/${r.vsAll.loss})`,
    `  ★ 分离分(三维不败均值) ${pct(r.adScore)}  最弱格 ${pct(r.weakest)}`,
  ].join('\n');
}

// ---------- CLI 自测 ----------

if (process.argv[1] && process.argv[1].endsWith('arena.ts')) {
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
  const formationName = ARGV.formation ?? '肃清';
  const games = Number(ARGV.games ?? 4);
  const bundlePath = ARGV.bundle ?? 'public/ai-bundle.iife.js';
  const BundleAI = loadBundle(bundlePath);
  if (!BundleAI) { console.error('bundle 未加载'); process.exit(1); }
  const candidate = formationToEvol(byName(formationName));
  const t0 = Date.now();
  const r = evaluateArena(BundleAI, candidate, games);
  console.log(formatArenaResult(formationName, r));
  console.log(`耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s（${games}局/靶 × 4靶 + 7局综合）`);
}
