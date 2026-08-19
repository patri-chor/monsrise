// ============================================================
// T038R — 06_runtime_export.ts
// 只读运行时候选目录导出（严格聚合实验模式边界，无 apply/deploy/publish/Tier 变更）
// ============================================================

import { writeFileSync, renameSync } from 'node:fs';
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
  classification: string;
  controllableRatio: number;
  spatialBudget: number;
  branchesPruned: number;
  pruneTrials: number;
  finalFingerprint: string;
  isExperimentalFrontier: boolean;
  cycleId: string;
  exportedAt: string;
}

export interface RuntimeCandidateCatalog {
  schemaVersion: 'T038_CATALOG_V1';
  protocol: string;
  evidenceClass: 'AGGREGATE_EXPLORATION_ONLY';
  integrationStatus: 'EXPERIMENTAL_UNVERIFIED_NOT_FOR_AUTO_INTEGRATION';
  formalPromotionStatus: 'NOT_EVALUATED';
  noApplyConfirmation: 'NO_APPLY_NO_DEPLOY_NO_PUBLISH_NO_TIER_CHANGE';
  cycleId: string;
  cycleOrdinal: number;
  parentCatalogHash: string | null;
  exportedAt: string;
  totalSources: number;
  totalEntries: number;
  experimentalFrontierCount: number;
  catalogHash: string;
  entries: CatalogEntry[];
}

export function exportRuntimeCatalog(opts: {
  cycleId: string;
  cycleOrdinal: number;
  protocol: string;
  parentCatalogHash?: string | null;
  entries: Array<{
    policy: SourcePolicy;
    candidateId: string;
    operatorFamily: string;
    canonicalFingerprint: string;
    obs: ScreenObservation;
    pruneResult: PruneResult | null;
    isExperimentalFrontier: boolean;
  }>;
}): RuntimeCandidateCatalog {
  const { cycleId, cycleOrdinal, protocol, parentCatalogHash = null, entries } = opts;
  const now = new Date().toISOString();

  const catalogEntries: CatalogEntry[] = entries.map(e => ({
    sourceId: e.policy.sourceId,
    candidateId: e.candidateId,
    operatorFamily: e.operatorFamily,
    canonicalFingerprint: e.canonicalFingerprint,
    trainingScore: e.obs.trainingScore,
    sourceRelativeScore: e.obs.sourceRelativeScore ?? 0,
    baselineScore: e.policy.baselineScore,
    classification: e.policy.classification,
    controllableRatio: e.policy.controllableRatio,
    spatialBudget: e.policy.spatialBudget,
    branchesPruned: e.pruneResult?.totalBranchesPruned ?? 0,
    pruneTrials: e.pruneResult?.totalBranchesTested ?? 0,
    finalFingerprint: e.pruneResult?.finalFingerprint ?? e.canonicalFingerprint,
    isExperimentalFrontier: e.isExperimentalFrontier,
    cycleId,
    exportedAt: now,
  }));

  const experimentalFrontierCount = catalogEntries.filter(e => e.isExperimentalFrontier).length;

  const catalog: RuntimeCandidateCatalog = {
    schemaVersion: 'T038_CATALOG_V1',
    protocol,
    evidenceClass: 'AGGREGATE_EXPLORATION_ONLY',
    integrationStatus: 'EXPERIMENTAL_UNVERIFIED_NOT_FOR_AUTO_INTEGRATION',
    formalPromotionStatus: 'NOT_EVALUATED',
    noApplyConfirmation: 'NO_APPLY_NO_DEPLOY_NO_PUBLISH_NO_TIER_CHANGE',
    cycleId,
    cycleOrdinal,
    parentCatalogHash,
    exportedAt: now,
    totalSources: new Set(catalogEntries.map(e => e.sourceId)).size,
    totalEntries: catalogEntries.length,
    experimentalFrontierCount,
    catalogHash: '',
    entries: catalogEntries,
  };

  const forHash = { ...catalog, catalogHash: undefined };
  catalog.catalogHash = createHash('sha256').update(JSON.stringify(forHash)).digest('hex').slice(0, 16);

  const tmp = `${CATALOG_PATH}.tmp`;
  writeFileSync(tmp, JSON.stringify(catalog, null, 2), 'utf8');
  renameSync(tmp, CATALOG_PATH);

  return catalog;
}
