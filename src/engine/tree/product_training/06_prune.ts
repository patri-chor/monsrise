// ============================================================
// T038 Phase-3 — 06_prune.ts
// Product-path greedy post-pruning（纯产品路径，无 arena/legacy prune）
//
// 对每个非空条件分支逐一剪枝测试：
//   candidate_with_branch vs candidate_without_branch
//   仅当移除无 material regression 时才剪枝
// ============================================================

import type { EvolFormation, EvolNode, FeatureMask } from '../evol_gene';
import { cloneEvolFormation, walkEvolNodes } from '../evol_gene';
import type { Formation } from '../../../ai/types';
import { PersistentSimPool } from '../persistent_pool';
import { computeCandidateFingerprint } from './02_candidates';
import { validateCandidateLegality } from './03_validate';
import type { MatchMetrics } from '../match_metrics';

// ---- 剪枝阈值 ----

/** 剪枝后 source-relative regression 超过此值则拒绝剪枝 */
export const PRUNE_REGRESSION_TOLERANCE = 0.05;

/** 单侧最弱侧 regression 超过此值则拒绝 */
export const PRUNE_WEAKEST_SIDE_TOLERANCE = 0.07;

/** 剪枝验证局数（轻量采样） */
export const PRUNE_GAMES_PER_CELL = 5;

export interface PruneTrialRecord {
  candidateId: string;
  branchNodeId: string;
  branchCondition: object;
  beforeFingerprint: string;
  afterFingerprint: string;
  beforeScore: number;
  afterScore: number;
  scoreDelta: number;
  beforeW: number; beforeD: number; beforeL: number;
  afterW: number;  afterD: number;  afterL: number;
  decision: 'PRUNED' | 'KEPT';
  decisionReason: string;
  seed: number;
  totalGames: number;
  completedAt: string;
}

export interface PruneResult {
  originalFingerprint: string;
  finalFingerprint: string;
  finalEvol: EvolFormation;
  trials: PruneTrialRecord[];
  totalBranchesTested: number;
  totalBranchesPruned: number;
}

/**
 * 对候选进行 greedy product-path 后剪枝。
 * 逐个测试每个非空条件分支（round>=1，非兜底），
 * 若移除后 matched product-path sample 无 material regression 则剪枝。
 */
export async function postPruneCandidate(opts: {
  pool: PersistentSimPool;
  candidateId: string;
  evol: EvolFormation;
  matchedOpps: Formation[];
  baselineScore: number;
  seedBase: number;
}): Promise<PruneResult> {
  const { pool, candidateId, matchedOpps, baselineScore, seedBase } = opts;
  let currentEvol = cloneEvolFormation(opts.evol);
  const trials: PruneTrialRecord[] = [];
  let totalPruned = 0;

  // 找所有非空条件分支节点（有 condition.main 或 condition.side 的 round>=1 节点）
  const getBranchCandidates = (evol: EvolFormation): EvolNode[] => {
    return walkEvolNodes(evol.root).filter(n =>
      n.round >= 1 &&
      (n.condition.main !== null || n.condition.side !== null) &&
      n.placements.length > 0,
    );
  };

  const emptyMask: FeatureMask = { side: null, main: null, subs: [], keys: [] };

  const scoreEvol = async (evol: EvolFormation, seed: number): Promise<{ score: number; w: number; d: number; l: number }> => {
    const metrics: MatchMetrics[] = await pool.evalCandidateBatchOnMatchedParallel(
      [evol],
      emptyMask,
      matchedOpps,
      PRUNE_GAMES_PER_CELL,
      seed,
      'product_path',
    );
    const m = metrics[0];
    const totalGames = (m.win + m.draw + m.loss);
    const score = totalGames > 0 ? (m.win + 0.5 * m.draw) / totalGames : 0;
    return { score, w: m.win, d: m.draw, l: m.loss };
  };

  const originalFingerprint = computeCandidateFingerprint(currentEvol);
  let seed = seedBase;

  // 评估当前（before）分数
  let beforeResult = await scoreEvol(currentEvol, seed);

  const branchNodes = getBranchCandidates(currentEvol);
  const totalTested = branchNodes.length;

  for (const node of branchNodes) {
    seed += 1000;
    const beforeFp = computeCandidateFingerprint(currentEvol);

    // 构造移除该分支后的候选（将 placements 清空）
    const pruned = cloneEvolFormation(currentEvol);
    const prunedNode = walkEvolNodes(pruned.root).find(n => n.id === node.id);
    if (!prunedNode) continue;

    // 合并放置到兜底分支（round 同级，condition 为空 mask 的节点）
    // 简单策略：直接清空 placements（兜底分支已有放置）
    prunedNode.placements = [];

    const afterFp = computeCandidateFingerprint(pruned);
    if (afterFp === beforeFp) {
      trials.push({
        candidateId, branchNodeId: node.id, branchCondition: node.condition,
        beforeFingerprint: beforeFp, afterFingerprint: afterFp,
        beforeScore: beforeResult.score, afterScore: beforeResult.score, scoreDelta: 0,
        beforeW: beforeResult.w, beforeD: beforeResult.d, beforeL: beforeResult.l,
        afterW: beforeResult.w, afterD: beforeResult.d, afterL: beforeResult.l,
        decision: 'KEPT', decisionReason: 'NO_OP: fingerprint unchanged after removal',
        seed, totalGames: 0, completedAt: new Date().toISOString(),
      });
      continue;
    }

    // 验证合法性
    const validation = validateCandidateLegality(pruned);
    if (!validation.valid) {
      trials.push({
        candidateId, branchNodeId: node.id, branchCondition: node.condition,
        beforeFingerprint: beforeFp, afterFingerprint: afterFp,
        beforeScore: beforeResult.score, afterScore: 0, scoreDelta: 0,
        beforeW: beforeResult.w, beforeD: beforeResult.d, beforeL: beforeResult.l,
        afterW: 0, afterD: 0, afterL: 0,
        decision: 'KEPT', decisionReason: `LEGALITY_FAIL: ${validation.reasons.join('; ')}`,
        seed, totalGames: 0, completedAt: new Date().toISOString(),
      });
      continue;
    }

    // 评估剪枝后分数
    const afterResult = await scoreEvol(pruned, seed);
    const delta = afterResult.score - beforeResult.score;

    const shouldPrune =
      afterResult.score >= beforeResult.score - PRUNE_REGRESSION_TOLERANCE &&
      (afterResult.score - baselineScore) >= (beforeResult.score - baselineScore) - PRUNE_WEAKEST_SIDE_TOLERANCE;

    const decision: 'PRUNED' | 'KEPT' = shouldPrune ? 'PRUNED' : 'KEPT';
    const decisionReason = shouldPrune
      ? `PRUNED: delta=${delta.toFixed(3)} within tolerance (${PRUNE_REGRESSION_TOLERANCE})`
      : `KEPT: regression delta=${delta.toFixed(3)} exceeds tolerance (${PRUNE_REGRESSION_TOLERANCE})`;

    trials.push({
      candidateId, branchNodeId: node.id, branchCondition: node.condition,
      beforeFingerprint: beforeFp, afterFingerprint: afterFp,
      beforeScore: beforeResult.score, afterScore: afterResult.score, scoreDelta: delta,
      beforeW: beforeResult.w, beforeD: beforeResult.d, beforeL: beforeResult.l,
      afterW: afterResult.w, afterD: afterResult.d, afterL: afterResult.l,
      decision, decisionReason,
      seed, totalGames: (afterResult.w + afterResult.d + afterResult.l),
      completedAt: new Date().toISOString(),
    });

    if (shouldPrune) {
      currentEvol = pruned;
      beforeResult = afterResult;
      totalPruned++;
    }
  }

  return {
    originalFingerprint,
    finalFingerprint: computeCandidateFingerprint(currentEvol),
    finalEvol: currentEvol,
    trials,
    totalBranchesTested: totalTested,
    totalBranchesPruned: totalPruned,
  };
}
