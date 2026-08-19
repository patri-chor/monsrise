// ============================================================
// src/engine/tree/product_training/formation_tiers.ts
// T044 双轴阵型强度梯队 (T-Axis) 与学习评测环境 (L-Axis) 状态机与阵型库
//
// 规范要求：
//   - T 轴 (Formation Tier): T0 (原始冻结11根源), T3 (早期候选), T2 (过L3>=55%), T1 (过L2>=60%)
//   - L 轴 (Learning Level): L3 (Early Bundle 8), L2 (冻结T0 11), L1 (血缘概率Melee池)
//   - 迟滞带 [55%, 60%): T3->T2 (>=55%), T2->T1 (>=60%), T1->T2降级 (<55%)
//   - T1 L1状态: L1_NOT_YET_EVALUATED, L1_ELIGIBLE (完成>=3次L2尝试), L1_STABLE, L1_DIAGNOSE_REQUIRED
//   - 权限控制: T3禁止L2/L1, T2禁止L1, T1满足条件才进L1
// ============================================================

import { writeFileSync, renameSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { T037_OUTPUT_DIR } from './04_screen';

export type FormationTier = 'T0' | 'T1' | 'T2' | 'T3';
export type LearningLevel = 'L1' | 'L2' | 'L3';
export type L1StatusMarker = 'L1_NOT_YET_EVALUATED' | 'L1_ELIGIBLE' | 'L1_STABLE' | 'L1_DIAGNOSE_REQUIRED';

export const FORMATION_TIER_POLICY_PATH = resolve(`${T037_OUTPUT_DIR}/formation_tier_policy.json`);
export const FORMATION_STRENGTH_LIBRARY_PATH = resolve(`${T037_OUTPUT_DIR}/formation_strength_library.json`);
export const FORMATION_TIER_TRANSITIONS_PATH = resolve(`${T037_OUTPUT_DIR}/formation_tier_transitions.jsonl`);
export const LEARNING_LEVEL_EVALUATIONS_PATH = resolve(`${T037_OUTPUT_DIR}/learning_level_evaluations.jsonl`);

// ---- 策略配置 ----

export interface FormationTierPolicyConfig {
  schemaVersion: 'T044_TIER_POLICY_V1';
  evidenceClass: 'AGGREGATE_EXPLORATION_ONLY';
  policyRevision: string;
  hysteresisThresholds: {
    t3ToT2GateL3: number;     // 0.55
    t2ToT1GateL2: number;     // 0.60
    t1ToT2DemoteL2: number;   // 0.55
    hysteresisBandL2: [number, number]; // [0.55, 0.60]
  };
  learningLevels: {
    L3: { name: string; opponentCount: number; description: string };
    L2: { name: string; opponentCount: number; description: string };
    L1: { name: string; description: string };
  };
  permissionRules: {
    T3: { allowedLevels: LearningLevel[]; canDispatchL2: boolean; canDispatchL1: boolean };
    T2: { allowedLevels: LearningLevel[]; canDispatchL2: boolean; canDispatchL1: boolean };
    T1: { allowedLevels: LearningLevel[]; canDispatchL2: boolean; canDispatchL1: boolean; l1EligibilityRequiresL2Attempts: number };
    T0: { immutable: boolean; role: string };
  };
}

export function getDefaultTierPolicy(): FormationTierPolicyConfig {
  return {
    schemaVersion: 'T044_TIER_POLICY_V1',
    evidenceClass: 'AGGREGATE_EXPLORATION_ONLY',
    policyRevision: 'v1.0.0-t044-two-axis',
    hysteresisThresholds: {
      t3ToT2GateL3: 0.55,
      t2ToT1GateL2: 0.60,
      t1ToT2DemoteL2: 0.55,
      hysteresisBandL2: [0.55, 0.60],
    },
    learningLevels: {
      L3: { name: 'Early Bundle 8', opponentCount: 8, description: 'Early 7 bundles + historical Gift Jungle' },
      L2: { name: 'Frozen T0 11', opponentCount: 11, description: 'Original frozen 11 root formations benchmark' },
      L1: { name: 'Lineage Probabilistic Melee', description: 'T042 Root-Lineage Melee Catalog sampling' },
    },
    permissionRules: {
      T3: { allowedLevels: ['L3'], canDispatchL2: false, canDispatchL1: false },
      T2: { allowedLevels: ['L3', 'L2'], canDispatchL2: true, canDispatchL1: false },
      T1: { allowedLevels: ['L3', 'L2', 'L1'], canDispatchL2: true, canDispatchL1: true, l1EligibilityRequiresL2Attempts: 3 },
      T0: { immutable: true, role: 'ANCHOR_ROOT_SOURCE_AND_L2_BENCHMARK' },
    },
  };
}

export function saveTierPolicy(policy: FormationTierPolicyConfig = getDefaultTierPolicy()): void {
  const tmp = `${FORMATION_TIER_POLICY_PATH}.tmp`;
  writeFileSync(tmp, JSON.stringify(policy, null, 2), 'utf8');
  renameSync(tmp, FORMATION_TIER_POLICY_PATH);
}

// ---- 阵型库记录与阵型条目 ----

export interface FormationLibraryEntry {
  formationId: string;
  canonicalFingerprint: string;
  rootT0SourceId: string;
  lineageProof: string;
  currentTier: FormationTier;
  l1Status: L1StatusMarker;
  allowedLearningLevels: LearningLevel[];
  l3Score: number | null;
  l2Score: number | null;
  l1Score: number | null;
  l2AttemptsCount: number;
  lastEvaluatedAt: string;
  evidenceClass: 'AGGREGATE_EXPLORATION_ONLY';
  noApplyConfirmation: 'NO_APPLY_NO_DEPLOY_NO_PUBLISH_NO_TIER_CHANGE';
}

export interface FormationStrengthLibraryFile {
  schemaVersion: 'T044_FORMATION_STRENGTH_LIBRARY_V1';
  evidenceClass: 'AGGREGATE_EXPLORATION_ONLY';
  policyRevision: string;
  updatedAt: string;
  counts: {
    T0Count: number;
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

/** 评估梯队跃迁与门禁决策（严格迟滞带逻辑） */
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
    return { newTier: 'T0', decision: 'RETAINED', reason: 'T0 is immutable original root benchmark' };
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
          reason: `Maintained L2 strength: score=${score.toFixed(3)} >= ${t1ToT2DemoteL2} (in hysteresis band or above) -> Retained at T1`,
        };
      }
    }
  }

  return { newTier: currentTier, decision: 'RETAINED', reason: `Level ${level} evaluated for ${currentTier}` };
}

/** 保存并更新阵型强度库文件 */
export function saveFormationStrengthLibrary(entries: FormationLibraryEntry[]): FormationStrengthLibraryFile {
  const policy = getDefaultTierPolicy();
  let t0 = 0, t1 = 0, t2 = 0, t3 = 0;
  let t1Eligible = 0, t1Stable = 0, t1Diagnose = 0;

  for (const e of entries) {
    if (e.currentTier === 'T0') t0++;
    else if (e.currentTier === 'T1') {
      t1++;
      if (e.l1Status === 'L1_ELIGIBLE') t1Eligible++;
      else if (e.l1Status === 'L1_STABLE') t1Stable++;
      else if (e.l1Status === 'L1_DIAGNOSE_REQUIRED') t1Diagnose++;
    } else if (e.currentTier === 'T2') t2++;
    else if (e.currentTier === 'T3') t3++;
  }

  const file: FormationStrengthLibraryFile = {
    schemaVersion: 'T044_FORMATION_STRENGTH_LIBRARY_V1',
    evidenceClass: 'AGGREGATE_EXPLORATION_ONLY',
    policyRevision: policy.policyRevision,
    updatedAt: new Date().toISOString(),
    counts: {
      T0Count: t0,
      T1Count: t1,
      T2Count: t2,
      T3Count: t3,
      T1L1EligibleCount: t1Eligible,
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
