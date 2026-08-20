// ============================================================
// src/engine/tree/product_training/formation_tiers_v4.ts
// T051: Dynamic Strength Ladder, Active-L2 Dynamic Pool & Score70 Metric System
// ============================================================

import { writeFileSync, renameSync, appendFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { T037_OUTPUT_DIR } from './04_screen';

export type DynamicTier = 'T0' | 'T1' | 'T2' | 'T3';
export type ActiveRole =
  | 'CURRENT_ROOT_MAIN'
  | 'ACTIVE_TRAINING_PARENT'
  | 'ACTIVE_COMPETITOR'
  | 'HISTORICAL_MAIN'
  | 'ARCHIVED_EXPERIMENTAL';

export type VerificationState =
  | 'INDEPENDENT_VERIFIED'
  | 'RAW_OUTCOMES_RECONCILED'
  | 'UNVERIFIED_AGGREGATE_ONLY';

export const FORMATION_TIER_POLICY_V4_PATH = resolve(`${T037_OUTPUT_DIR}/formation_tier_policy.v4.json`);
export const FORMATION_STRENGTH_LIBRARY_V4_PATH = resolve(`${T037_OUTPUT_DIR}/formation_strength_library.v4.json`);
export const ACTIVE_L2_MANIFEST_PATH = resolve(`${T037_OUTPUT_DIR}/active_l2_manifest.json`);
export const LEDGER_V4_PATH = resolve(`${T037_OUTPUT_DIR}/formation_winrate_audit_ledger.v4.jsonl`);

// ---- Score70 数学函数与不变量 ----

export interface Score70Metrics {
  w: number;
  d: number;
  l: number;
  n: number;
  primaryScore70: number; // (W + 0.70 * D) / N
  winRate: number;        // W / N
  drawRate: number;       // D / N
  lossRate: number;       // L / N
  noLossRate: number;     // (W + D) / N
  legacyScore50: number;  // (W + 0.50 * D) / N (audit-only)
}

export function computeScore70Metrics(w: number, d: number, l: number): Score70Metrics {
  const n = w + d + l;
  if (n <= 0) {
    return {
      w: 0, d: 0, l: 0, n: 0,
      primaryScore70: 0,
      winRate: 0,
      drawRate: 0,
      lossRate: 0,
      noLossRate: 0,
      legacyScore50: 0,
    };
  }

  const primaryScore70 = (w + 0.70 * d) / n;
  const winRate = w / n;
  const drawRate = d / n;
  const lossRate = l / n;
  const noLossRate = (w + d) / n;
  const legacyScore50 = (w + 0.50 * d) / n;

  return {
    w,
    d,
    l,
    n,
    primaryScore70: Number(primaryScore70.toFixed(6)),
    winRate: Number(winRate.toFixed(6)),
    drawRate: Number(drawRate.toFixed(6)),
    lossRate: Number(lossRate.toFixed(6)),
    noLossRate: Number(noLossRate.toFixed(6)),
    legacyScore50: Number(legacyScore50.toFixed(6)),
  };
}

// ---- Active-L2 动态基准清单 ----

export interface ActiveL2Member {
  r0SourceId: string;
  formationId: string;
  name: string;
  canonicalFingerprint: string;
  calculatorPolicyFingerprint: string;
  selectedAt: string;
  selectionEvidenceId: string;
}

export interface ActiveL2Manifest {
  schemaVersion: 'ACTIVE_L2_MANIFEST_V1';
  manifestRevision: string;
  manifestHash: string;
  createdAt: string;
  description: string;
  members: ActiveL2Member[];
}

export function createActiveL2Manifest(members: ActiveL2Member[], revision: string = 'v1.0.0-t051-active-l2'): ActiveL2Manifest {
  const base = {
    schemaVersion: 'ACTIVE_L2_MANIFEST_V1' as const,
    manifestRevision: revision,
    createdAt: new Date().toISOString(),
    description: 'Dynamic Active-L2 strength benchmark pool composed of current active T0 root mains',
    members,
  };
  const manifestHash = createHash('sha256').update(JSON.stringify(base)).digest('hex').slice(0, 16);
  return {
    ...base,
    manifestHash,
  };
}

// ---- R0 不可变历史根快照 ----

export interface R0HistoricalRoot {
  r0SourceId: string;
  sourceName: string;
  immutableFingerprint: string;
  archetypeId: string;
  canonicalTeamSnapshot: any[];
}

// ---- V4 活跃阵型实体 ----

export interface ActiveFormationV4 {
  formationId: string;
  rootR0SourceId: string;
  displayName: string;
  canonicalFingerprint: string;
  calculatorPolicyFingerprint: string;
  activeRoles: ActiveRole[];
  currentDynamicTier: DynamicTier;
  previousTier: DynamicTier | null;
  activeLibraryRevision: string;
  activeL2ManifestHash: string;
  
  // 实测数据指标
  activeL2Metrics: Score70Metrics | null;
  l1Metrics: Score70Metrics | null;
  l3Metrics: Score70Metrics | null;

  verificationState: VerificationState;
  l2AttemptsCount: number;
  regradeReason: string;
  updatedAt: string;
}

// ---- V4 策略配置 ----

export interface DynamicTierPolicyV4 {
  schemaVersion: 'T051_DYNAMIC_TIER_POLICY_V1';
  policyRevision: string;
  scoreFunction: 'Score70 = (W + 0.70 * D) / N';
  regradeGates: {
    t1GateScore70: number; // 0.88
    t2GateScore70: number; // 0.60
    t3GateScore70: number; // < 0.60
  };
  capacityTargets: {
    t0MaxPerRoot: number; // unconstrained, but target ~1 per root
    t1TargetRatio: [number, number]; // [0.15, 0.25]
    t2TargetRatio: [number, number]; // [0.35, 0.50]
    t3TargetRatio: [number, number]; // [0.20, 0.35]
  };
}

export function getDefaultTierPolicyV4(): DynamicTierPolicyV4 {
  return {
    schemaVersion: 'T051_DYNAMIC_TIER_POLICY_V1',
    policyRevision: 'v4.0.0-t051-calibrated-score70-l1-primary',
    scoreFunction: 'Score70 = (W + 0.70 * D) / N',
    regradeGates: {
      t1GateScore70: 0.88,
      t2GateScore70: 0.60,
      t3GateScore70: 0.0,
    },
    capacityTargets: {
      t0MaxPerRoot: 2,
      t1TargetRatio: [0.15, 0.25],
      t2TargetRatio: [0.35, 0.50],
      t3TargetRatio: [0.20, 0.35],
    },
  };
}
