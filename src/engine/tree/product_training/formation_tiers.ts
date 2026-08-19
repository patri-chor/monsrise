// ============================================================
// src/engine/tree/product_training/formation_tiers.ts
// T046 双轴阵型强度梯队与学习评测环境状态机（保留 80%/85% 门禁、无 Top-1 限制、T0 角色彻底隔离）
//
// 规范要求：
//   - 强度门禁：T3->T2 (L3 >= 80%), T2->T1 (L2 >= 85%), T1->T2 (L2 < 80%), 迟滞带 [80%, 85%]
//   - 无 Top-1 配额限制：每个满足 L2 >= 85% 的合规候选均可作为 T1
//   - T0 角色修复：learningPermissions=[], benchmarkRoles=['L2_FROZEN_T0_ANCHOR'],
//                 opponentCatalogRoles=['L1_ROOT_LINEAGE_MEMBER'], l1LearnerStatus='NOT_APPLICABLE', l1Score=null
// ============================================================

import { writeFileSync, renameSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { T037_OUTPUT_DIR } from './04_screen';

export type FormationTier = 'T0' | 'T1' | 'T2' | 'T3';
export type LearningLevel = 'L1' | 'L2' | 'L3';
export type L1LearnerStatus = 'L1_NOT_YET_EVALUATED' | 'L1_ELIGIBLE' | 'L1_STABLE' | 'L1_DIAGNOSE_REQUIRED' | 'L1_NOT_PERMITTED' | 'NOT_APPLICABLE';
export type BenchmarkRole = 'L2_FROZEN_T0_ANCHOR' | 'L3_BASELINE_ANCHOR';
export type OpponentCatalogRole = 'L1_ROOT_LINEAGE_MEMBER' | 'L2_BENCHMARK_OPPONENT' | 'L3_OPPONENT';

export const FORMATION_TIER_POLICY_PATH = resolve(`${T037_OUTPUT_DIR}/formation_tier_policy.json`);
export const FORMATION_STRENGTH_LIBRARY_PATH = resolve(`${T037_OUTPUT_DIR}/formation_strength_library.json`);
export const FORMATION_TIER_TRANSITIONS_PATH = resolve(`${T037_OUTPUT_DIR}/formation_tier_transitions.jsonl`);
export const LEARNING_LEVEL_EVALUATIONS_PATH = resolve(`${T037_OUTPUT_DIR}/learning_level_evaluations.jsonl`);

// ---- 策略配置 ----

export interface FormationTierPolicyConfig {
  schemaVersion: 'T046_TIER_POLICY_V1';
  evidenceClass: 'AGGREGATE_EXPLORATION_ONLY';
  policyRevision: string;
  hysteresisThresholds: {
    t3ToT2GateL3: number;     // 0.80
    t2ToT1GateL2: number;     // 0.85
    t1ToT2DemoteL2: number;   // 0.80
    hysteresisBandL2: [number, number]; // [0.80, 0.85]
  };
  learningLevels: {
    L3: { name: string; opponentCount: number; description: string };
    L2: { name: string; opponentCount: number; description: string };
    L1: { name: string; description: string };
  };
  permissionRules: {
    T3: { allowedLearnerLevels: LearningLevel[]; canDispatchL2: boolean; canDispatchL1: boolean; l1LearnerStatus: 'L1_NOT_PERMITTED' };
    T2: { allowedLearnerLevels: LearningLevel[]; canDispatchL2: boolean; canDispatchL1: boolean; l1LearnerStatus: 'L1_NOT_PERMITTED' };
    T1: { allowedLearnerLevels: LearningLevel[]; canDispatchL2: boolean; canDispatchL1: boolean; l1EligibilityRequiresL2Attempts: number };
    T0: { immutable: boolean; isLearner: false; benchmarkRoles: BenchmarkRole[]; opponentCatalogRoles: OpponentCatalogRole[]; l1LearnerStatus: 'NOT_APPLICABLE' };
  };
}

export function getDefaultTierPolicy(): FormationTierPolicyConfig {
  return {
    schemaVersion: 'T046_TIER_POLICY_V1',
    evidenceClass: 'AGGREGATE_EXPLORATION_ONLY',
    policyRevision: 'v3.1.0-t046-authorized-80-85-no-cap',
    hysteresisThresholds: {
      t3ToT2GateL3: 0.80,
      t2ToT1GateL2: 0.85,
      t1ToT2DemoteL2: 0.80,
      hysteresisBandL2: [0.80, 0.85],
    },
    learningLevels: {
      L3: { name: 'Early Bundle 8', opponentCount: 8, description: 'Early 7 bundles + historical Gift Jungle' },
      L2: { name: 'Frozen T0 11', opponentCount: 11, description: 'Original frozen 11 root formations benchmark' },
      L1: { name: 'Lineage Probabilistic Melee', description: 'T042 Root-Lineage Melee Catalog sampling' },
    },
    permissionRules: {
      T3: { allowedLearnerLevels: ['L3'], canDispatchL2: false, canDispatchL1: false, l1LearnerStatus: 'L1_NOT_PERMITTED' },
      T2: { allowedLearnerLevels: ['L3', 'L2'], canDispatchL2: true, canDispatchL1: false, l1LearnerStatus: 'L1_NOT_PERMITTED' },
      T1: { allowedLearnerLevels: ['L3', 'L2', 'L1'], canDispatchL2: true, canDispatchL1: true, l1EligibilityRequiresL2Attempts: 3 },
      T0: {
        immutable: true,
        isLearner: false,
        benchmarkRoles: ['L2_FROZEN_T0_ANCHOR'],
        opponentCatalogRoles: ['L1_ROOT_LINEAGE_MEMBER'],
        l1LearnerStatus: 'NOT_APPLICABLE',
      },
    },
  };
}

export function saveTierPolicy(policy: FormationTierPolicyConfig = getDefaultTierPolicy()): void {
  const tmp = `${FORMATION_TIER_POLICY_PATH}.tmp`;
  writeFileSync(tmp, JSON.stringify(policy, null, 2), 'utf8');
  renameSync(tmp, FORMATION_TIER_POLICY_PATH);
}

// ---- 阵型库条目 ----

export interface FormationLibraryEntry {
  formationId: string;
  canonicalFingerprint: string;
  rootT0SourceId: string;
  lineageProof: string;
  currentTier: FormationTier;
  learningPermissions: LearningLevel[];
  benchmarkRoles: BenchmarkRole[];
  opponentCatalogRoles: OpponentCatalogRole[];
  l1LearnerStatus: L1LearnerStatus;
  l3Score: number | null;
  l2Score: number | null;
  l1Score: number | null;
  l2AttemptsCount: number | null;
  lastEvaluatedAt: string;
  evidenceClass: 'AGGREGATE_EXPLORATION_ONLY';
  noApplyConfirmation: 'NO_APPLY_NO_DEPLOY_NO_PUBLISH_NO_TIER_CHANGE';
}

export interface FormationStrengthLibraryFile {
  schemaVersion: 'T046_FORMATION_STRENGTH_LIBRARY_V1';
  evidenceClass: 'AGGREGATE_EXPLORATION_ONLY';
  policyRevision: string;
  updatedAt: string;
  counts: {
    T0Count: number;
    T0L1OpponentMemberCount: number;
    T0L1LearnerCount: number;
    T1Count: number;
    T2Count: number;
    T3Count: number;
    T1L1EligibleCount: number;
    T1L1StableCount: number;
    T1L1DiagnoseRequiredCount: number;
  };
  formations: FormationLibraryEntry[];
}

export interface FormationTierTransitionRecord {
  recordId: string;
  evidenceClass: 'AGGREGATE_EXPLORATION_ONLY';
  cycleId: string;
  formationId: string;
  canonicalFingerprint: string;
  rootT0SourceId: string;
  previousTier: FormationTier;
  newTier: FormationTier;
  triggerLevel: LearningLevel;
  levelScore: number;
  decision: 'PROMOTED' | 'RETAINED' | 'DEMOTED';
  reason: string;
  timestamp: string;
}

export interface LearningLevelEvaluationRecord {
  recordId: string;
  evidenceClass: 'AGGREGATE_EXPLORATION_ONLY';
  cycleId: string;
  formationId: string;
  canonicalFingerprint: string;
  rootT0SourceId: string;
  learningLevel: LearningLevel;
  benchmarkRevision: string;
  totalGames: number;
  score: number;
  weakestOpponentId: string;
  weakestOpponentScore: number;
  weakestSide: 1 | 2;
  timestamp: string;
}

export function appendTierTransitionRecord(rec: FormationTierTransitionRecord): void {
  appendFileSync(FORMATION_TIER_TRANSITIONS_PATH, JSON.stringify(rec) + '\n', 'utf8');
}

export function appendLearningEvaluationRecord(rec: LearningLevelEvaluationRecord): void {
  appendFileSync(LEARNING_LEVEL_EVALUATIONS_PATH, JSON.stringify(rec) + '\n', 'utf8');
}

/** 评估梯队跃迁与门禁决策（严格 80%/85% 无 Top-1 cap 门禁） */
export function evaluateTierGate(opts: {
  currentTier: FormationTier;
  level: LearningLevel;
  score: number;
  policy: FormationTierPolicyConfig;
}): {
  newTier: FormationTier;
  decision: 'PROMOTED' | 'RETAINED' | 'DEMOTED';
  reason: string;
} {
  const { currentTier, level, score, policy } = opts;
  const { t3ToT2GateL3, t2ToT1GateL2, t1ToT2DemoteL2 } = policy.hysteresisThresholds;

  if (currentTier === 'T0') {
    return { newTier: 'T0', decision: 'RETAINED', reason: 'T0 is immutable original root benchmark anchor' };
  }

  if (level === 'L3') {
    if (currentTier === 'T3') {
      if (score >= t3ToT2GateL3) {
        return {
          newTier: 'T2',
          decision: 'PROMOTED',
          reason: `Passed L3 strength gate: score=${score.toFixed(3)} >= ${t3ToT2GateL3} -> Promoted to T2`,
        };
      } else {
        return {
          newTier: 'T3',
          decision: 'RETAINED',
          reason: `Did not pass L3 strength gate: score=${score.toFixed(3)} < ${t3ToT2GateL3} -> Retained at T3`,
        };
      }
    }
    return { newTier: currentTier, decision: 'RETAINED', reason: `L3 evaluation completed for ${currentTier}` };
  }

  if (level === 'L2') {
    if (currentTier === 'T2') {
      if (score >= t2ToT1GateL2) {
        return {
          newTier: 'T1',
          decision: 'PROMOTED',
          reason: `Passed L2 frozen T0 strength gate: score=${score.toFixed(3)} >= ${t2ToT1GateL2} -> Promoted to T1`,
        };
      } else {
        return {
          newTier: 'T2',
          decision: 'RETAINED',
          reason: `Did not reach T1 threshold: score=${score.toFixed(3)} < ${t2ToT1GateL2} -> Retained at T2`,
        };
      }
    }
    if (currentTier === 'T1') {
      if (score < t1ToT2DemoteL2) {
        return {
          newTier: 'T2',
          decision: 'DEMOTED',
          reason: `Failed L2 regression monitoring: score=${score.toFixed(3)} < ${t1ToT2DemoteL2} -> Demoted to T2`,
        };
      } else {
        return {
          newTier: 'T1',
          decision: 'RETAINED',
          reason: `Maintained L2 strength: score=${score.toFixed(3)} >= ${t1ToT2DemoteL2} -> Retained at T1`,
        };
      }
    }
  }

  return { newTier: currentTier, decision: 'RETAINED', reason: `Level ${level} evaluated for ${currentTier}` };
}

/** 保存并更新阵型强度库文件 */
export function saveFormationStrengthLibrary(entries: FormationLibraryEntry[]): FormationStrengthLibraryFile {
  const policy = getDefaultTierPolicy();
  let t0 = 0, t0Opponent = 0, t0Learner = 0;
  let t1 = 0, t2 = 0, t3 = 0;
  let t1Eligible = 0, t1Stable = 0, t1Diagnose = 0;

  for (const e of entries) {
    if (e.currentTier === 'T0') {
      t0++;
      if (e.opponentCatalogRoles.includes('L1_ROOT_LINEAGE_MEMBER')) t0Opponent++;
      if (e.l1LearnerStatus !== 'NOT_APPLICABLE' || e.learningPermissions.length > 0) t0Learner++;
    } else if (e.currentTier === 'T1') {
      t1++;
      if (e.l1LearnerStatus === 'L1_ELIGIBLE') t1Eligible++;
      else if (e.l1LearnerStatus === 'L1_STABLE') t1Stable++;
      else if (e.l1LearnerStatus === 'L1_DIAGNOSE_REQUIRED') t1Diagnose++;
    } else if (e.currentTier === 'T2') {
      t2++;
    } else if (e.currentTier === 'T3') {
      t3++;
    }
  }

  const file: FormationStrengthLibraryFile = {
    schemaVersion: 'T046_FORMATION_STRENGTH_LIBRARY_V1',
    evidenceClass: 'AGGREGATE_EXPLORATION_ONLY',
    policyRevision: policy.policyRevision,
    updatedAt: new Date().toISOString(),
    counts: {
      T0Count: t0,
      T0L1OpponentMemberCount: t0Opp,
      T0L1LearnerCount: t0Learner,
      T1Count: t1,
      T2Count: t2,
      T3Count: t3,
      T1L1EligibleCount: t1Eligible + t1Stable + t1Diagnose,
      T1L1StableCount: t1Stable,
      T1L1DiagnoseRequiredCount: t1Diagnose,
    },
    formations: entries,
  };

  const tmp = `${FORMATION_STRENGTH_LIBRARY_PATH}.tmp`;
  writeFileSync(tmp, JSON.stringify(file, null, 2), 'utf8');
  renameSync(tmp, FORMATION_STRENGTH_LIBRARY_PATH);

  return file;
}
