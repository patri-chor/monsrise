// ============================================================
// T038 Phase-3 — 06_runtime_export.ts
// 只读运行时候选目录导出（无 apply/deploy/publish/Tier 变更）
// ============================================================

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import type { ScreenObservation } from './04_screen';
import type { PruneResult } from './06_prune';
import type { SourcePolicy } from './05_select';

export const CATALOG_PATH = resolve('tests/fixtures/tree/experience_library/product_path_t037/runtime_candidate_catalog.json');

export interface CatalogEntry {
  sourceId: string;
  candidateId: string;
  operatorFamily: string;
  canonicalFingerprint: string;
  trainingScore: number;
  sourceRelativeScore: number;
  baselineScore: number;
  maturity: string;
  controllableRatio: number;
  spatialBudget: number;
  branchesPruned: number;
  pruneTrials: number;
  finalFingerprint: string;
  isPromotion: boolean;
  cycleId: string;
  exportedAt: string;
}

export interface RuntimeCandidateCatalog {
  schemaVersion: 'T038_CATALOG_V1';
  protocol: string;
  cycleId: string;
  exportedAt: string;
  totalSources: number;
  totalEntries: number;
  promotionCount: number;
  catalogHash: string;
  entries: CatalogEntry[];
  noApplyConfirmation: 'NO_APPLY_NO_DEPLOY_NO_PUBLISH_NO_TIER_CHANGE';
}

export function exportRuntimeCatalog(opts: {
  cycleId: string;
  protocol: string;
  entries: Array<{
    policy: SourcePolicy;
    candidateId: string;
    operatorFamily: string;
    canonicalFingerprint: string;
    obs: ScreenObservation;
    pruneResult: PruneResult | null;
    isPromotion: boolean;
  }>;
}): RuntimeCandidateCatalog {
  const { cycleId, protocol, entries } = opts;
  const now = new Date().toISOString();

  const catalogEntries: CatalogEntry[] = entries.map(e => ({
    sourceId: e.policy.sourceId,
    candidateId: e.candidateId,
    operatorFamily: e.operatorFamily,
    canonicalFingerprint: e.canonicalFingerprint,
    trainingScore: e.obs.trainingScore,
    sourceRelativeScore: e.obs.sourceRelativeScore ?? 0,
    baselineScore: e.policy.baselineScore,
    maturity: e.policy.maturity,
    controllableRatio: e.policy.controllableRatio,
    spatialBudget: e.policy.spatialBudget,
    branchesPruned: e.pruneResult?.totalBranchesPruned ?? 0,
    pruneTrials: e.pruneResult?.totalBranchesTested ?? 0,
    finalFingerprint: e.pruneResult?.finalFingerprint ?? e.canonicalFingerprint,
    isPromotion: e.isPromotion,
    cycleId,
    exportedAt: now,
  }));

  const promotionCount = catalogEntries.filter(e => e.isPromotion).length;

  const catalog: RuntimeCandidateCatalog = {
    schemaVersion: 'T038_CATALOG_V1',
    protocol,
    cycleId,
    exportedAt: now,
    totalSources: new Set(catalogEntries.map(e => e.sourceId)).size,
    totalEntries: catalogEntries.length,
    promotionCount,
    catalogHash: '',
    entries: catalogEntries,
    noApplyConfirmation: 'NO_APPLY_NO_DEPLOY_NO_PUBLISH_NO_TIER_CHANGE',
  };

  // 计算 catalogHash（不含 catalogHash 自身）
  const forHash = { ...catalog, catalogHash: undefined };
  catalog.catalogHash = createHash('sha256').update(JSON.stringify(forHash)).digest('hex').slice(0, 16);

  // 写出（atomic: tmp→rename）
  const tmp = `${CATALOG_PATH}.tmp`;
  writeFileSync(tmp, JSON.stringify(catalog, null, 2), 'utf8');
  const { renameSync } = require('node:fs');
  renameSync(tmp, CATALOG_PATH);

  return catalog;
}
