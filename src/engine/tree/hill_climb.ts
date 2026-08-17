// ============================================================
// 树优化器 —— 模拟退火爬山（支持细粒度 64-Worker 局部并行搜索）
//
// 为什么比 GA 快：GA 每代评估整个种群（N 个体 × 每靶多局），
// 但真正有用的只是"当前最优 + 一次成功变异"。爬山法每步只评估
// 1 个或一组变异体（接受则保留、拒绝则回退）。
//
// 并行优化（64-Worker / 80% CPU 目标）：
//   - 支持单步局部并行探索：每步生成一批变异邻域候选（如 8~16 个）
//   - 所有候选的 3 靶 × 2 侧（6 格最弱测试）全部拆解为原子任务并行下发
//   - 动态自适应负载，吞吐打满
// ============================================================

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DB_BADGES } from '../../game/Database';
import { FORMATION_LIBRARY } from '../../ai/formation_library';
import type { EvolFormation, EvolNode } from './evol_gene';
import {
  cloneEvolFormation, walkEvolNodes, summarizeEvolFormation, formationToEvol,
} from './evol_gene';
import {
  swapMonsters, moveEarlier, swapRoundOrder, shiftPosition,
  mutateCondition, addBranch, removeBranch,
  monsterFeaturePool, badgeFeaturePool,
} from './tree_ops';
import { evaluateArena, formatArenaResult, type ArenaResult, type CellResult } from './arena';
import { PersistentSimPool } from './persistent_pool';
import type { SimTaskMessage } from './fine_grained_worker';

const BADGE_POOL = DB_BADGES.filter(b => ![14, 15, 19, 31, 34].includes(b.id)).map(b => b.id);

function mulberry32(seed: number): () => number {
  let t = seed + 0x6D2B79F5;
  return () => {
    t += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function teamIds(f: EvolFormation): number[] {
  return f.team.filter(s => s.monsterId > 0).map(s => s.monsterId);
}

/** 收集所有可变异条件的节点 */
function condNodes(f: EvolFormation): EvolNode[] {
  return walkEvolNodes(f.root).filter(n => n.round >= 1);
}

/** 单次随机变异（与 evolution2.mutate 同算子集） */
export function mutate(f: EvolFormation, rng: () => number): EvolFormation | null {
  const ids = teamIds(f);
  const mPool = monsterFeaturePool();
  const bPool = badgeFeaturePool();
  for (let attempt = 0; attempt < 10; attempt++) {
    const r = rng();
    let out: EvolFormation | null = null;
    if (r < 0.15 && ids.length >= 2) {
      const i = Math.floor(rng() * ids.length);
      let j = Math.floor(rng() * ids.length);
      if (j === i) j = (j + 1) % ids.length;
      out = swapMonsters(f, ids[i], ids[j]);
    } else if (r < 0.28) {
      const monsterId = ids[Math.floor(rng() * ids.length)];
      const rounds = walkEvolNodes(f.root)
        .filter(n => n.round >= 2 && n.placements.some(p => p.monsterId === monsterId))
        .map(n => n.round);
      if (rounds.length === 0) continue;
      const fromRound = rounds[Math.floor(rng() * rounds.length)];
      const toRound = 1 + Math.floor(rng() * (fromRound - 1));
      out = moveEarlier(f, monsterId, fromRound, toRound);
    } else if (r < 0.38) {
      const nodes = walkEvolNodes(f.root).filter(n => n.placements.length >= 2);
      if (nodes.length === 0) continue;
      const node = nodes[Math.floor(rng() * nodes.length)];
      const i = Math.floor(rng() * node.placements.length);
      let j = Math.floor(rng() * node.placements.length);
      if (j === i) j = (j + 1) % node.placements.length;
      out = swapRoundOrder(f, node.id, i, j);
    } else if (r < 0.52) {
      const monsterId = ids[Math.floor(rng() * ids.length)];
      const dx = Math.floor(rng() * 5) - 2;
      const dy = Math.floor(rng() * 5) - 2;
      out = shiftPosition(f, monsterId, dx, dy);
    } else if (r < 0.72) {
      const nodes = condNodes(f);
      if (nodes.length === 0) continue;
      const node = nodes[Math.floor(rng() * nodes.length)];
      out = mutateCondition(f, node.id, mPool, bPool, rng);
    } else if (r < 0.86) {
      out = addBranch(f, mPool, bPool, rng);
    } else {
      out = removeBranch(f, rng);
    }
    if (out) return out;
  }
  return null;
}

export interface HillClimbResult {
  best: EvolFormation;
  bestFitness: number;
  bestArena: ArenaResult;
  steps: number;
  accepted: number;
  history: { step: number; fitness: number; bestFitness: number; temp: number }[];
}

const SEPARATION_TARGET_NAMES = ['全二永平', '全二冲', '泉水剑'];

/**
 * 细粒度并行评估一组候选的分离测试（3靶 × 2侧 = 6格）
 */
export async function evaluateArenaBatchParallel(
  candidates: EvolFormation[],
  gamesPerTarget: number,
  seedBase: number = 5000,
  pool?: PersistentSimPool,
): Promise<ArenaResult[]> {
  const activePool = pool ?? PersistentSimPool.getInstance();
  const tasks: SimTaskMessage[] = [];
  let taskId = 0;

  for (let cIdx = 0; cIdx < candidates.length; cIdx++) {
    const cand = candidates[cIdx];
    for (let tIdx = 0; tIdx < SEPARATION_TARGET_NAMES.length; tIdx++) {
      const oppName = SEPARATION_TARGET_NAMES[tIdx];
      for (const side of [1, 2] as (1 | 2)[]) {
        tasks.push({
          taskId: taskId++,
          candidateIdx: cIdx,
          formationA: cand,
          opponentNameOrId: oppName,
          side,
          seed: seedBase + cIdx * 100 + tIdx * 10 + side,
          games: gamesPerTarget,
        });
      }
    }
  }

  const results = await activePool.dispatchTasks(tasks);

  // 聚合各候选的 6 格结果
  const arenaResults: ArenaResult[] = candidates.map(() => {
    return {
      attackP1: { w: 0, d: 0, l: 0, undefeated: 0 },
      attackP2: { w: 0, d: 0, l: 0, undefeated: 0 },
      survivalP1: { w: 0, d: 0, l: 0, undefeated: 0 },
      survivalP2: { w: 0, d: 0, l: 0, undefeated: 0 },
      comprehensiveP1: { w: 0, d: 0, l: 0, undefeated: 0 },
      comprehensiveP2: { w: 0, d: 0, l: 0, undefeated: 0 },
      attack: { w: 0, d: 0, l: 0, undefeated: 0 },
      survival: { w: 0, d: 0, l: 0, undefeated: 0 },
      comprehensive: { w: 0, d: 0, l: 0, undefeated: 0 },
      adScore: 0,
      weakest: 0,
    };
  });

  const cellMap: Record<string, keyof ArenaResult> = {
    '全二永平_1': 'attackP1',
    '全二永平_2': 'attackP2',
    '全二冲_1': 'survivalP1',
    '全二冲_2': 'survivalP2',
    '泉水剑_1': 'comprehensiveP1',
    '泉水剑_2': 'comprehensiveP2',
  };

  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    const r = results[i];
    const cIdx = t.candidateIdx ?? 0;
    const key = `${t.opponentNameOrId}_${t.side}`;
    const field = cellMap[key];
    if (field) {
      const tot = r.w + r.d + r.l;
      const cell: CellResult = {
        w: r.w,
        d: r.d,
        l: r.l,
        undefeated: tot > 0 ? (r.w + r.d) / tot : 0,
      };
      (arenaResults[cIdx] as any)[field] = cell;
    }
  }

  for (const ar of arenaResults) {
    ar.attack = mergeCells(ar.attackP1, ar.attackP2);
    ar.survival = mergeCells(ar.survivalP1, ar.survivalP2);
    ar.comprehensive = mergeCells(ar.comprehensiveP1, ar.comprehensiveP2);
    ar.adScore = (ar.attack.undefeated + ar.survival.undefeated + ar.comprehensive.undefeated) / 3;
    ar.weakest = Math.min(
      ar.attackP1.undefeated, ar.attackP2.undefeated,
      ar.survivalP1.undefeated, ar.survivalP2.undefeated,
      ar.comprehensiveP1.undefeated, ar.comprehensiveP2.undefeated,
    );
  }

  return arenaResults;
}

function mergeCells(a: CellResult, b: CellResult): CellResult {
  const w = a.w + b.w, d = a.d + b.d, l = a.l + b.l;
  const tot = w + d + l;
  return { w, d, l, undefeated: tot > 0 ? (w + d) / tot : 0 };
}

/**
 * 模拟退火爬山优化（支持局部并行多候选采样）
 */
export async function hillClimbParallel(
  BundleAI: any,
  seedFormation: EvolFormation,
  steps: number,
  gamesPerTarget: number,
  seed: number,
  options: {
    parallelVariants?: number; // 每步并行变异体数 (默认 8~16)
    T0?: number;
    Tmin?: number;
    alpha?: number;
    evalGamesPerTarget?: number;
    pool?: PersistentSimPool;
  } = {},
): Promise<HillClimbResult> {
  const parallelVariants = options.parallelVariants ?? 8;
  const T0 = options.T0 ?? 0.10;
  const Tmin = options.Tmin ?? 0.005;
  const alpha = options.alpha ?? 0.985;
  const pool = options.pool ?? PersistentSimPool.getInstance();

  const rng = mulberry32(seed);
  let current = cloneEvolFormation(seedFormation);

  // 初始评估基线
  const initArenas = await evaluateArenaBatchParallel([current], gamesPerTarget, 5000, pool);
  let currentFit = initArenas[0].weakest;

  let best = cloneEvolFormation(current);
  let bestFit = currentFit;
  let bestArena: ArenaResult = initArenas[0];
  let accepted = 0;
  const history: HillClimbResult['history'] = [];
  let T = T0;

  for (let step = 0; step < steps; step++) {
    // 1. 每步并发生成多个候选变异体
    const candidates: EvolFormation[] = [];
    for (let v = 0; v < parallelVariants; v++) {
      const mut = mutate(current, rng);
      if (mut) candidates.push(mut);
    }

    if (candidates.length > 0) {
      // 2. 细粒度并行评测这批变异体的所有 6 格最弱测试
      const arenas = await evaluateArenaBatchParallel(candidates, gamesPerTarget, 5000 + step * 100, pool);

      // 3. 找出本批最优变异体
      let stepBestIdx = 0;
      let stepBestFit = arenas[0].weakest;
      for (let i = 1; i < arenas.length; i++) {
        if (arenas[i].weakest > stepBestFit) {
          stepBestFit = arenas[i].weakest;
          stepBestIdx = i;
        }
      }

      const child = candidates[stepBestIdx];
      const childFit = stepBestFit;
      const delta = childFit - currentFit;

      // 退火接受准则
      if (delta >= 0 || rng() < Math.exp(delta / T)) {
        current = child;
        currentFit = childFit;
        accepted++;
        if (childFit > bestFit) {
          bestFit = childFit;
          best = cloneEvolFormation(child);
          bestArena = arenas[stepBestIdx];
        }
      }
    }

    T = Math.max(Tmin, T * alpha);
    if (step % 5 === 0 || step === steps - 1) {
      console.log(`  [Parallel HillClimb] 步${step + 1}/${steps} 当前最弱 ${(currentFit * 100).toFixed(1)}% 最佳 ${(bestFit * 100).toFixed(1)}% 温度 ${T.toFixed(4)}`);
    }
    history.push({ step: step + 1, fitness: currentFit, bestFitness: bestFit, temp: T });
  }

  // 最终高局数精评
  const finalGames = options.evalGamesPerTarget ?? Math.max(gamesPerTarget, 8);
  const finalArenas = await evaluateArenaBatchParallel([best], finalGames, 9999, pool);
  bestArena = finalArenas[0];

  return { best, bestFitness: bestFit, bestArena, steps, accepted, history };
}

export function hillClimb(
  BundleAI: any,
  seedFormation: EvolFormation,
  steps: number,
  gamesPerTarget: number,
  seed: number,
  T0 = 0.10,
  Tmin = 0.005,
  alpha = 0.985,
  evalGamesPerTarget?: number,
): HillClimbResult {
  // 同步 fallback 版本
  const rng = mulberry32(seed);
  let current = cloneEvolFormation(seedFormation);
  let currentFit = evaluateArena(BundleAI, current, gamesPerTarget).weakest;

  let best = cloneEvolFormation(current);
  let bestFit = currentFit;
  let bestArena: ArenaResult | null = null;
  let accepted = 0;
  const history: HillClimbResult['history'] = [];
  let T = T0;

  for (let step = 0; step < steps; step++) {
    const child = mutate(current, rng);
    if (child) {
      const childFit = evaluateArena(BundleAI, child, gamesPerTarget).weakest;
      const delta = childFit - currentFit;
      if (delta >= 0 || rng() < Math.exp(delta / T)) {
        current = child;
        currentFit = childFit;
        accepted++;
        if (childFit > bestFit) {
          bestFit = childFit;
          best = cloneEvolFormation(child);
        }
      }
    }
    T = Math.max(Tmin, T * alpha);
    history.push({ step: step + 1, fitness: currentFit, bestFitness: bestFit, temp: T });
  }

  const finalGames = evalGamesPerTarget ?? Math.max(gamesPerTarget, 8);
  bestArena = evaluateArena(BundleAI, best, finalGames);
  return { best, bestFitness: bestFit, bestArena: bestArena!, steps, accepted, history };
}
