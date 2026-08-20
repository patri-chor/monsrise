// ============================================================
// src/engine/tree/product_training/t052_branch_routing.ts
// T052 统一爬山变异与条件分支归纳 (Unified Hill-Climb and Conditional-Branch Learning)
// ============================================================

import { appendFileSync, existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import type { Formation } from '../../../ai/types';
import type { EvolFormation, EvolNode, FeatureMask, MainArchetype, SubArchetype, KeyMonster } from '../evol_gene';
import { cloneEvolFormation, walkEvolNodes } from '../evol_gene';
import { computeCandidateFingerprint, isLegalP2Coord } from './02_candidates';
import { T037_OUTPUT_DIR } from './04_screen';

export const LOCAL_SOLUTION_ROUTING_AUDIT_PATH = resolve(`${T037_OUTPUT_DIR}/formation_local_solution_routing.jsonl`);
export const BRANCH_CONVERSION_AUDIT_PATH = resolve(`${T037_OUTPUT_DIR}/branch_conversion_audit.jsonl`);

// ---- 1. 四态路由模型 ----

export type RoutingDecisionType =
  | 'GLOBAL_IMPROVEMENT'
  | 'LOCAL_ONLY_BRANCH'
  | 'NO_INFORMATIVE_GAIN'
  | 'INVALID';

export interface Score70Outcome {
  w: number;
  d: number;
  l: number;
  totalGames: number;
  winRate: number;
  drawRate: number;
  lossRate: number;
  score70: number;
}

export interface MatchupObservation {
  opponentId: string;
  opponentName: string;
  side: 1 | 2;
  round: number;
  recognizedMain: MainArchetype | null;
  recognizedSubs: SubArchetype[];
  recognizedKeys: KeyMonster[];
  visibleHandIds: number[];
  visibleBoardIds: number[];
  outcome: 'W' | 'D' | 'L';
}

export interface CandidateEvaluationData {
  candidateId: string;
  candidateFingerprint: string;
  globalMetrics: Score70Outcome;
  targetedMatchupMetrics: Map<string, Score70Outcome>; // key: opponentId or labelTag
  matchupObservations: MatchupObservation[];
}

export interface BranchConversionRecord {
  recordId: string;
  parentFingerprint: string;
  localCandidateFingerprint: string;
  conditionMask: FeatureMask;
  targetLabelSubset: string;
  globalScoreDelta: number;
  targetedScoreDelta: number;
  forkRound: number;
  operatorFamily: string;
  conversionReason: string;
  createdAt: string;
}

export interface LocalSolutionRoutingResult {
  route: RoutingDecisionType;
  candidateId: string;
  parentFingerprint: string;
  candidateFingerprint: string;
  globalScoreDelta: number;
  targetedGainAttribution: {
    targetKey: string;
    scoreDelta: number;
    explainedMask: FeatureMask | null;
  } | null;
  convertedBranchEvol: EvolFormation | null;
  reason: string;
  createdAt: string;
}

// ---- 2. 最小可观测 FeatureMask 推导 ----

/**
 * 根据针对性弱项对手的实际战局观察，推导能够在分叉回合 (Fork Round) 合法观测到的最小解释标签
 */
export function inferMinimalFeatureMask(
  observations: MatchupObservation[],
  forkRound: number = 1,
): FeatureMask | null {
  if (observations.length === 0) return null;

  // 检查是否全属于单一 Side
  const allSide1 = observations.every(o => o.side === 1);
  const allSide2 = observations.every(o => o.side === 2);
  const sideConstraint: 1 | 2 | null = allSide2 ? 2 : allSide1 ? 1 : null;

  // 统计可观测到的关键怪 (Keys)
  let commonKeys: Set<KeyMonster> | null = null;
  for (const obs of observations) {
    const current = new Set<KeyMonster>(obs.recognizedKeys || []);
    if (commonKeys === null) {
      commonKeys = new Set(current);
    } else {
      for (const k of Array.from(commonKeys)) {
        if (!current.has(k)) commonKeys.delete(k);
      }
    }
  }

  // 统计可观测到的主标签 (Main)
  const mains = new Set<MainArchetype>();
  for (const obs of observations) {
    if (obs.recognizedMain) mains.add(obs.recognizedMain);
  }
  const mainConstraint: MainArchetype | null = mains.size === 1 ? Array.from(mains)[0] : null;

  // 统计可观测到的附加标签 (Subs)
  let commonSubs: Set<SubArchetype> | null = null;
  for (const obs of observations) {
    const current = new Set<SubArchetype>(obs.recognizedSubs || []);
    if (commonSubs === null) {
      commonSubs = new Set(current);
    } else {
      for (const s of Array.from(commonSubs)) {
        if (!current.has(s)) commonSubs.delete(s);
      }
    }
  }

  // 最小特异性原则优先：关键怪 > 主标签 > 附加标签 > 先后手
  if (commonKeys && commonKeys.size > 0) {
    return {
      side: sideConstraint,
      main: null,
      subs: [],
      keys: Array.from(commonKeys),
    };
  }

  if (mainConstraint) {
    return {
      side: sideConstraint,
      main: mainConstraint,
      subs: [],
      keys: [],
    };
  }

  if (commonSubs && commonSubs.size > 0) {
    return {
      side: sideConstraint,
      main: null,
      subs: Array.from(commonSubs),
      keys: [],
    };
  }

  if (sideConstraint !== null) {
    return {
      side: sideConstraint,
      main: null,
      subs: [],
      keys: [],
    };
  }

  return null;
}

// ---- 3. 局部解到条件分支转化器 ----

/**
 * 将局部爬山变异的改动提取并挂载为条件分支子节点，保持主干不变
 */
export function convertLocalSolutionToBranch(opts: {
  parentEvol: EvolFormation;
  mutatedEvol: EvolFormation;
  conditionMask: FeatureMask;
  forkRound?: number;
  branchLabel?: string;
}): { branchEvol: EvolFormation; branchId: string } | null {
  const { parentEvol, mutatedEvol, conditionMask, forkRound = 1, branchLabel = 'local_branch' } = opts;
  const branchEvol = cloneEvolFormation(parentEvol);

  const forkNode = walkEvolNodes(branchEvol.root).find(n => n.round === forkRound);
  if (!forkNode) return null;

  // 从变异进化体中提取该回合的变异站位
  const mutatedNode = walkEvolNodes(mutatedEvol.root).find(n => n.round === forkRound);
  if (!mutatedNode) return null;

  const branchId = `b_${branchLabel}_r${forkRound}_${createHash('sha256').update(JSON.stringify(conditionMask)).digest('hex').slice(0, 6)}`;

  // 检查是否已有完全相同条件的现有分支
  forkNode.children = forkNode.children || [];
  const existingIdx = forkNode.children.findIndex(c =>
    c.condition.side === conditionMask.side &&
    c.condition.main === conditionMask.main &&
    JSON.stringify(c.condition.subs) === JSON.stringify(conditionMask.subs) &&
    JSON.stringify(c.condition.keys) === JSON.stringify(conditionMask.keys)
  );

  const newChildNode: EvolNode = {
    id: branchId,
    round: forkRound,
    condition: conditionMask,
    placements: JSON.parse(JSON.stringify(mutatedNode.placements)),
    children: [],
  };

  if (existingIdx >= 0) {
    forkNode.children[existingIdx] = newChildNode;
  } else {
    forkNode.children.push(newChildNode);
  }

  return { branchEvol, branchId };
}

// ---- 4. 统一候选路由器 (Unified Candidate Routing) ----

export function routeLocalCandidate(opts: {
  parentCandidateId: string;
  parentEvol: EvolFormation;
  mutatedEvol: EvolFormation;
  parentEvaluation: CandidateEvaluationData;
  candidateEvaluation: CandidateEvaluationData;
  targetedKeys: string[]; // 正在针对的弱项对手或标签集合
  globalRegressionTolerance?: number; // 允许的最大大盘退化容忍度，默认 0.05
  minLocalGainThreshold?: number;     // 触发分支转化的最小局部增益，默认 +0.10
}): LocalSolutionRoutingResult {
  const {
    parentCandidateId,
    parentEvol,
    mutatedEvol,
    parentEvaluation,
    candidateEvaluation,
    targetedKeys,
    globalRegressionTolerance = 0.05,
    minLocalGainThreshold = 0.10,
  } = opts;

  const parentFp = computeCandidateFingerprint(parentEvol);
  const candFp = computeCandidateFingerprint(mutatedEvol);

  if (parentFp === candFp) {
    return {
      route: 'NO_INFORMATIVE_GAIN',
      candidateId: candidateEvaluation.candidateId,
      parentFingerprint: parentFp,
      candidateFingerprint: candFp,
      globalScoreDelta: 0,
      targetedGainAttribution: null,
      convertedBranchEvol: null,
      reason: 'NO_OP: Canonical fingerprint identical to parent',
      createdAt: new Date().toISOString(),
    };
  }

  const globalDelta = candidateEvaluation.globalMetrics.score70 - parentEvaluation.globalMetrics.score70;

  // 1. 全局显著提升 -> GLOBAL_IMPROVEMENT
  if (globalDelta > 0.005) {
    return {
      route: 'GLOBAL_IMPROVEMENT',
      candidateId: candidateEvaluation.candidateId,
      parentFingerprint: parentFp,
      candidateFingerprint: candFp,
      globalScoreDelta: Number(globalDelta.toFixed(4)),
      targetedGainAttribution: null,
      convertedBranchEvol: null,
      reason: `Global Score70 improved from ${parentEvaluation.globalMetrics.score70.toFixed(3)} to ${candidateEvaluation.globalMetrics.score70.toFixed(3)} (+${globalDelta.toFixed(3)})`,
      createdAt: new Date().toISOString(),
    };
  }

  // 2. 检查局部弱项针对性提升
  let bestLocalKey: string | null = null;
  let bestLocalDelta = 0;

  for (const tKey of targetedKeys) {
    const parentTargetScore = parentEvaluation.targetedMatchupMetrics.get(tKey)?.score70 ?? 0;
    const candTargetScore = candidateEvaluation.targetedMatchupMetrics.get(tKey)?.score70 ?? 0;
    const delta = candTargetScore - parentTargetScore;
    if (delta > bestLocalDelta) {
      bestLocalDelta = delta;
      bestLocalKey = tKey;
    }
  }

  // 若局部增益显著 (>= minLocalGainThreshold) 且大盘退化在容忍度以内 -> LOCAL_ONLY_BRANCH
  if (bestLocalKey && bestLocalDelta >= minLocalGainThreshold && globalDelta >= -globalRegressionTolerance) {
    // 推导最小解释 FeatureMask
    const relevantObs = candidateEvaluation.matchupObservations.filter(o => o.opponentId === bestLocalKey || o.opponentName === bestLocalKey);
    const mask = inferMinimalFeatureMask(relevantObs, 1) ?? {
      side: null,
      main: null,
      subs: [],
      keys: ['mine'], // 默认针对性关键怪
    };

    const conversion = convertLocalSolutionToBranch({
      parentEvol,
      mutatedEvol,
      conditionMask: mask,
      forkRound: 1,
      branchLabel: `counter_${bestLocalKey}`,
    });

    return {
      route: 'LOCAL_ONLY_BRANCH',
      candidateId: candidateEvaluation.candidateId,
      parentFingerprint: parentFp,
      candidateFingerprint: candFp,
      globalScoreDelta: Number(globalDelta.toFixed(4)),
      targetedGainAttribution: {
        targetKey: bestLocalKey,
        scoreDelta: Number(bestLocalDelta.toFixed(4)),
        explainedMask: mask,
      },
      convertedBranchEvol: conversion ? conversion.branchEvol : null,
      reason: `Targeted matchup '${bestLocalKey}' Score70 improved by +${bestLocalDelta.toFixed(3)} (global delta: ${globalDelta.toFixed(3)}). Converted to conditional branch.`,
      createdAt: new Date().toISOString(),
    };
  }

  // 3. 既无全局提升也无显著局部突破 -> NO_INFORMATIVE_GAIN
  return {
    route: 'NO_INFORMATIVE_GAIN',
    candidateId: candidateEvaluation.candidateId,
    parentFingerprint: parentFp,
    candidateFingerprint: candFp,
    globalScoreDelta: Number(globalDelta.toFixed(4)),
    targetedGainAttribution: null,
    convertedBranchEvol: null,
    reason: `No significant global gain (${globalDelta.toFixed(3)}) nor target gain (+${bestLocalDelta.toFixed(3)} < ${minLocalGainThreshold})`,
    createdAt: new Date().toISOString(),
  };
}

// ---- 5. 分支子树聚焦局部优化 (Branch-Local Optimization) ----

/**
 * 仅对分支子树内的站位与时序进行微调优化，严禁修改主干
 */
export function optimizeBranchSubtreeLocally(
  branchEvol: EvolFormation,
  branchId: string,
  mutationKind: 'shift_y' | 'swap_placement' = 'shift_y',
): EvolFormation | null {
  const clone = cloneEvolFormation(branchEvol);
  let targetBranchNode: EvolNode | null = null;

  for (const node of walkEvolNodes(clone.root)) {
    if (node.children) {
      const child = node.children.find(c => c.id === branchId);
      if (child) {
        targetBranchNode = child;
        break;
      }
    }
  }

  if (!targetBranchNode || targetBranchNode.placements.length === 0) return null;

  if (mutationKind === 'shift_y') {
    const p = targetBranchNode.placements[0];
    const ny = p.y === 0 ? 1 : 0;
    if (isLegalP2Coord(p.x, ny)) {
      p.y = ny;
    }
  } else if (mutationKind === 'swap_placement' && targetBranchNode.placements.length >= 2) {
    const p0 = targetBranchNode.placements[0];
    const p1 = targetBranchNode.placements[1];
    const tmpX = p0.x, tmpY = p0.y;
    p0.x = p1.x; p0.y = p1.y;
    p1.x = tmpX; p1.y = tmpY;
  }

  return clone;
}

// ---- 6. 前移分叉节点评估 (Forward-Node Mechanism) ----

/**
 * 评估分支能否合法前移至更早的回合 (例如从 R2 提前至 R1)
 */
export function evaluateForwardBranchNode(opts: {
  branchEvol: EvolFormation;
  branchId: string;
  fromRound: number;
  toRound: number;
  observationsAtTargetRound: MatchupObservation[];
}): {
  canForward: boolean;
  forwardedEvol: EvolFormation | null;
  reason: string;
} {
  const { branchEvol, branchId, fromRound, toRound, observationsAtTargetRound } = opts;

  if (toRound >= fromRound) {
    return { canForward: false, forwardedEvol: null, reason: `Target round ${toRound} is not earlier than fromRound ${fromRound}` };
  }

  const clone = cloneEvolFormation(branchEvol);
  let branchChild: EvolNode | null = null;
  let parentNode: EvolNode | null = null;

  for (const node of walkEvolNodes(clone.root)) {
    if (node.children) {
      const child = node.children.find(c => c.id === branchId);
      if (child) {
        branchChild = child;
        parentNode = node;
        break;
      }
    }
  }

  if (!branchChild || !parentNode) {
    return { canForward: false, forwardedEvol: null, reason: `Branch node ${branchId} not found` };
  }

  // 检查分支条件在目标更早回合是否可被合法观测
  const condition = branchChild.condition;
  let conditionVisibleAtEarlierRound = true;

  if (condition.keys.length > 0) {
    // 检查目标更早回合是否已能看到关键怪 (如手牌或首发)
    const allVisible = observationsAtTargetRound.every(obs =>
      condition.keys.every(k => obs.recognizedKeys.includes(k))
    );
    if (!allVisible) conditionVisibleAtEarlierRound = false;
  }

  if (!conditionVisibleAtEarlierRound) {
    return {
      canForward: false,
      forwardedEvol: null,
      reason: `Condition '${JSON.stringify(condition)}' is not observable at earlier round ${toRound}`,
    };
  }

  // 执行安全前移挂载
  const targetParent = walkEvolNodes(clone.root).find(n => n.round === toRound);
  if (!targetParent) {
    return { canForward: false, forwardedEvol: null, reason: `Target round node ${toRound} not found` };
  }

  // 移出原分叉，挂入新分叉
  parentNode.children = parentNode.children.filter(c => c.id !== branchId);
  branchChild.round = toRound;
  branchChild.id = `${branchChild.id}_fwd_r${toRound}`;
  targetParent.children = targetParent.children || [];
  targetParent.children.push(branchChild);

  return {
    canForward: true,
    forwardedEvol: clone,
    reason: `Successfully forwarded branch to earlier legal round ${toRound}`,
  };
}

// ---- 7. 审计记录落盘工具 ----

export function appendLocalSolutionRoutingAudit(rec: LocalSolutionRoutingResult): void {
  appendFileSync(LOCAL_SOLUTION_ROUTING_AUDIT_PATH, JSON.stringify(rec) + '\n', 'utf8');
}

export function appendBranchConversionAudit(rec: BranchConversionRecord): void {
  appendFileSync(BRANCH_CONVERSION_AUDIT_PATH, JSON.stringify(rec) + '\n', 'utf8');
}
