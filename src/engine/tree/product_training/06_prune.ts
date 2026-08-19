// ============================================================
// T038R — 06_prune.ts
// Product-path greedy post-pruning（纯产品路径，无 arena/legacy prune）
//
// 对每个非空条件分支逐一剪枝测试：
//   candidate_with_branch vs candidate_without_branch
//   仅当移除无 material regression 时才剪枝
//   所有记录标注 AGGREGATE_EXPLORATION_ONLY 与 AGGREGATE_HEURISTIC_UNVERIFIED
// ============================================================

import { createHash } from 'node:crypto';
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
  recordId: string;
  evidenceClass: 'AGGREGATE_EXPLORATION_ONLY';
  heuristicStatus: 'AGGREGATE_HEURISTIC_UNVERIFIED';
  cycleId: string;
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
  cycleId: string;
  candidateId: string;
  evol: EvolFormation;
  matchedOpps: Formation[];
  baselineScore: number;
  seedBase: number;
}): Promise<PruneResult> {
  const { pool, cycleId, candidateId, matchedOpps, baselineScore, seedBase } = opts;
  let currentEvol = cloneEvolFormation(opts.evol);
  const trials: PruneTrialRecord[] = [];
  let totalPruned = 0;

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

  let beforeResult = await scoreEvol(currentEvol, seed);
  const branchNodes = getBranchCandidates(currentEvol);
  const totalTested = branchNodes.length;

  for (const node of branchNodes) {
    seed += 1000;
    const beforeFp = computeCandidateFingerprint(currentEvol);

    const pruned = cloneEvolFormation(currentEvol);
    const prunedNode = walkEvolNodes(pruned.root).find(n => n.id === node.id);
    if (!prunedNode) continue;

    prunedNode.placements = [];

    const afterFp = computeCandidateFingerprint(pruned);
    const recordId = createHash('sha256')
      .update(`${cycleId}_${candidateId}_prune_${node.id}_${seed}`)
      .digest('hex')
      .slice(0, 16);

    if (afterFp === beforeFp) {
      trials.push({
        recordId,
        evidenceClass: 'AGGREGATE_EXPLORATION_ONLY',
        heuristicStatus: 'AGGREGATE_HEURISTIC_UNVERIFIED',
        cycleId,
        candidateId,
        branchNodeId: node.id,
        branchCondition: node.condition,
        beforeFingerprint: beforeFp,
        afterFingerprint: afterFp,
        beforeScore: beforeResult.score,
        afterScore: beforeResult.score,
        scoreDelta: 0,
        beforeW: beforeResult.w, beforeD: beforeResult.d, beforeL: beforeResult.l,
        afterW: beforeResult.w, afterD: beforeResult.d, afterL: beforeResult.l,
        decision: 'KEPT',
        decisionReason: 'NO_OP: fingerprint unchanged after removal',
        seed,
        totalGames: 0,
        completedAt: new Date().toISOString(),
      });
      continue;
    }

    const validation = validateCandidateLegality(pruned);
    if (!validation.valid) {
      trials.push({
        recordId,
        evidenceClass: 'AGGREGATE_EXPLORATION_ONLY',
        heuristicStatus: 'AGGREGATE_HEURISTIC_UNVERIFIED',
        cycleId,
        candidateId,
        branchNodeId: node.id,
        branchCondition: node.condition,
        beforeFingerprint: beforeFp,
        afterFingerprint: afterFp,
        beforeScore: beforeResult.score,
        afterScore: 0,
        scoreDelta: 0,
        beforeW: beforeResult.w, beforeD: beforeResult.d, beforeL: beforeResult.l,
        afterW: 0, afterD: 0, afterL: 0,
        decision: 'KEPT',
        decisionReason: `LEGALITY_FAIL: ${validation.reasons.join('; ')}`,
        seed,
        totalGames: 0,
        completedAt: new Date().toISOString(),
      });
      continue;
    }

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
      recordId,
      evidenceClass: 'AGGREGATE_EXPLORATION_ONLY',
      heuristicStatus: 'AGGREGATE_HEURISTIC_UNVERIFIED',
      cycleId,
      candidateId,
      branchNodeId: node.id,
      branchCondition: node.condition,
      beforeFingerprint: beforeFp,
      afterFingerprint: afterFp,
      beforeScore: beforeResult.score,
      afterScore: afterResult.score,
      scoreDelta: delta,
      beforeW: beforeResult.w, beforeD: beforeResult.d, beforeL: beforeResult.l,
      afterW: afterResult.w, afterD: afterResult.d, afterL: afterResult.l,
      decision,
      decisionReason,
      seed,
      totalGames: (afterResult.w + afterResult.d + afterResult.l),
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
