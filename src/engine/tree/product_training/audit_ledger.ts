// ============================================================
// src/engine/tree/product_training/audit_ledger.ts
// T049: 完整阵型胜率审计总账 (Formation Win-Rate Audit Ledger)
//
// 规范要求：
//   - 独立于临时训练记录的持久化、追加写入、面向审查的胜率审计总账；
//   - 覆盖阵型库中所有活跃阵型（11 个 T0 基准 + 全部候选）；
//   - 显式绑定 Calculator Context Policy 指纹与 T048 验证状态；
//   - 严禁混淆探索聚合分数与独立验证强度。
// ============================================================

import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { computeCalculatorPolicyFingerprint } from '../calculator_policy';
import type { FormationLibraryEntry, LearningLevel } from './formation_tiers';

export const AUDIT_LEDGER_SCHEMA_VERSION = 'T049_FORMATION_WINRATE_AUDIT_LEDGER_V1';

export type VerificationState =
  | 'UNVERIFIED_AGGREGATE_ONLY'
  | 'INDEPENDENT_VERIFIED'
  | 'INDEPENDENT_REJECTED'
  | 'INDEPENDENT_INCONCLUSIVE';

export interface FormationWinrateAuditLedgerRecord {
  recordId: string;
  evaluatedAt: string;
  schemaVersion: 'T049_FORMATION_WINRATE_AUDIT_LEDGER_V1';
  formationId: string;
  rootT0SourceId: string;
  currentTier: string;
  canonicalFingerprint: string;
  calculatorPolicyFingerprint: string;
  calculatorPolicyPayloadRef: string | null;
  executionProvenance: 'PRODUCT_PATH';
  learningLevel: LearningLevel | 'HISTORIC_PRE_PRODUCT';
  benchmarkRevision: string;
  opponentPoolManifestHash: string;
  opponentCoverageCount: number;
  p1p2Coverage: 'DUAL_SIDE_EQUAL' | 'PARTIAL';
  gamesPerCell: number;
  totalGames: number;
  w: number;
  d: number;
  l: number;
  score: number;
  pureWinRate: number;
  weakestOpponentId: string | null;
  weakestSide: 1 | 2 | null;
  verificationState: VerificationState;
  workerErrors: number;
  supersedes: string | null;
  supersededBy: string | null;
  evidenceClass: 'AGGREGATE_EXPLORATION_ONLY' | 'INDEPENDENT_VERIFICATION';
  noApplyConfirmation: 'NO_APPLY_NO_DEPLOY_NO_PUBLISH_NO_TIER_CHANGE';
}

const T037_DIR = resolve('tests/fixtures/tree/experience_library/product_path_t037');
export const AUDIT_LEDGER_PATH = resolve(`${T037_DIR}/formation_winrate_audit_ledger.jsonl`);

export function appendAuditLedgerRecord(record: FormationWinrateAuditLedgerRecord): void {
  appendFileSync(AUDIT_LEDGER_PATH, JSON.stringify(record) + '\n', 'utf8');
}

export function loadAuditLedgerRecords(): FormationWinrateAuditLedgerRecord[] {
  if (!existsSync(AUDIT_LEDGER_PATH)) return [];
  return readFileSync(AUDIT_LEDGER_PATH, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(l => JSON.parse(l));
}
