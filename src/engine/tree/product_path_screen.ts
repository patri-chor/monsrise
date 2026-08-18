// ============================================================
// T032 产品路径正式筛选
//
// 历史 arena W/D/L 不覆盖；本模块把新结果追加到独立目录并标识
// PRODUCT_PATH_FORMAL_SCREEN。所有对局经 PersistentSimPool 调度，worker 内
// 使用 playFullGame + product_tree_strategy。
// ============================================================

import '../env';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, appendFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Formation } from '../../ai/types';
import { formationToEvol, type FeatureMask, type EvolFormation } from './evol_gene';
import { generateMultiSourceCandidates } from './experience_training_pipeline';
import { PersistentSimPool, type ProductPathManifest } from './persistent_pool';
import { runFourCostFidelityGate, type FidelityGateResult } from './four_cost_fidelity_gate';
import type { MatchMetrics } from './match_metrics';

export const PRODUCT_PATH_PROTOCOL = 'PRODUCT_PATH_FORMAL_SCREEN_T032_V1';
export const PRODUCT_PATH_OUTPUT_DIR = resolve('reports/t032-product-path');

export interface ProductPathBaselineRecord {
  sourceId: string;
  sourceName: string;
  sourceIndex: number;
  metrics: MatchMetrics;
  protocol: typeof PRODUCT_PATH_PROTOCOL;
}

export interface ProductPathCandidateRecord {
  candidateId: string;
  sourceId: string;
  sourceSeedName: string;
  sourceSeedIndex: number;
  noveltyBucket: string;
  mutationDesc: string;
  metrics: MatchMetrics;
  gamesExpected: number;
  protocol: typeof PRODUCT_PATH_PROTOCOL;
  manifestHash: string;
}

export interface ProductPathScreenResult {
  outputDir: string;
  manifest: ProductPathManifest;
  manifestHash: string;
  fidelity: FidelityGateResult;
  baselines: ProductPathBaselineRecord[];
  candidates: ProductPathCandidateRecord[];
  completedCandidates: number;
  skippedCandidates: number;
  cursorPath: string;
  observationsPath: string;
  frontierPath: string;
}

function manifestHash(manifest: ProductPathManifest): string {
  return createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
}

function writeAtomic(path: string, value: unknown): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  renameSync(tmp, path);
}

function reviveCandidate(record: any): EvolFormation {
  return {
    name: record.candidateId,
    archetype: record.archetype ?? 'unknown',
    team: record.team.map((s: any) => ({ monsterId: s.monsterId, badgeIds: [...(s.badgeIds ?? [])] })),
    root: record.tree,
  } as EvolFormation;
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, work: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      out[index] = await work(items[index], index);
    }
  });
  await Promise.all(workers);
  return out;
}

function frontier(rows: ProductPathCandidateRecord[]): Array<{ sourceId: string; sourceName: string; candidateId: string; metrics: MatchMetrics }> {
  const bySource = new Map<string, ProductPathCandidateRecord>();
  for (const row of rows) {
    const old = bySource.get(row.sourceId);
    if (!old || row.metrics.trainingScore > old.metrics.trainingScore) bySource.set(row.sourceId, row);
  }
  return [...bySource.values()].map(row => ({
    sourceId: row.sourceId,
    sourceName: row.sourceSeedName,
    candidateId: row.candidateId,
    metrics: row.metrics,
  })).sort((a, b) => b.metrics.trainingScore - a.metrics.trainingScore);
}

/**
 * T032 E：产品路径四费 gate → 10 基线 → 60 候选 × 140 局。
 * 任何四费 gate/worker 错误均 fail-closed；不产生 Tier/apply/deploy 副作用。
 */
export async function runProductPathFormalScreen(options: {
  outputDir?: string;
  pool?: PersistentSimPool;
  /** 测试可缩小样本；正式默认 false。 */
  smoke?: boolean;
} = {}): Promise<ProductPathScreenResult> {
  const outputDir = options.outputDir ?? PRODUCT_PATH_OUTPUT_DIR;
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });
  const cursorPath = join(outputDir, 'cursor.json');
  const observationsPath = join(outputDir, 'observations.jsonl');
  const frontierPath = join(outputDir, 'product_path_frontiers.json');
  const manifestPath = join(outputDir, 'manifest.json');

  const pool = options.pool ?? PersistentSimPool.getInstance();
  await pool.init();
  const manifest = pool.getProductPathManifest();
  if (manifest.observedWorkerCount < 1 || manifest.authorityBundleAbsolutePath.startsWith('.')) {
    throw new Error('PRODUCT_PATH_MANIFEST_INVALID: worker concurrency or authority artifact provenance is invalid');
  }
  const mHash = manifestHash(manifest);
  writeAtomic(manifestPath, {
    protocol: PRODUCT_PATH_PROTOCOL,
    timestamp: new Date().toISOString(),
    manifest,
    manifestHash: mHash,
    noApplyDeployOrPromotion: true,
    historicProtocolStatus: 'SANDBOX_ENGINE_UNVERIFIED_PRE_T032',
  });

  const sources: any[] = JSON.parse(readFileSync(resolve('tests/fixtures/tree/eleven_frozen_sources.json'), 'utf8'));
  const executableSources = sources.filter(s => !s.isLegacyBaseline);
  const earlyFamilies: any[] = JSON.parse(readFileSync(resolve('tests/fixtures/tree/early_seven_bundles.json'), 'utf8'));
  const heldOutOpps: Formation[] = earlyFamilies.map((f: any) => f.heldOutVariant);
  const emptyMask: FeatureMask = { side: null, main: null, subs: [], keys: [] };
  const gamesPerCell = options.smoke ? 1 : 10;

  // 1) 产品路径四费 gate，未通过即不启动正式重算。
  const fidelity = await runFourCostFidelityGate(pool, sources, earlyFamilies, 'product_path');
  if (!fidelity.passed) {
    throw new Error(`PRODUCT_PATH_FIDELITY_GATE_FAILED: ${fidelity.coverageMatrixSummary.totalUnitsPassed}/${fidelity.coverageMatrixSummary.totalUnitsExpected} four-cost units passed`);
  }

  // 2) 10 个可执行 8 怪兽源基线（同一产品路径、同一 7×2×games 样本定义）。
  const baselines: ProductPathBaselineRecord[] = [];
  for (let i = 0; i < executableSources.length; i++) {
    const source = executableSources[i];
    const metrics = (await pool.evalCandidateBatchOnMatchedParallel(
      [formationToEvol(source as Formation)],
      emptyMask,
      heldOutOpps,
      gamesPerCell,
      32_000 + i * 1_000,
      'product_path',
    ))[0];
    if ((metrics.workerErrorCount ?? 0) > 0) {
      throw new Error(`PRODUCT_PATH_BASELINE_WORKER_ERROR: ${source.id}`);
    }
    baselines.push({
      sourceId: source.id,
      sourceName: source.name,
      sourceIndex: source.sourceIndex,
      metrics,
      protocol: PRODUCT_PATH_PROTOCOL,
    });
  }

  // 3) 精确复用历史的 6 mutation defs × 10 executable sources = 60 candidates。
  const candidatesRaw = generateMultiSourceCandidates(sources);
  if (candidatesRaw.length !== 60) {
    throw new Error(`PRODUCT_PATH_CANDIDATE_COUNT_INVALID: expected 60, got ${candidatesRaw.length}`);
  }

  const previous = existsSync(cursorPath)
    ? JSON.parse(readFileSync(cursorPath, 'utf8'))
    : { protocol: PRODUCT_PATH_PROTOCOL, manifestHash: mHash, completedCandidateIds: [] as string[] };
  if (
    previous.protocol !== PRODUCT_PATH_PROTOCOL ||
    previous.manifestHash !== mHash ||
    (previous.gamesPerCell !== undefined && previous.gamesPerCell !== gamesPerCell)
  ) {
    throw new Error('PRODUCT_PATH_CURSOR_IDENTITY_MISMATCH: refusing to overwrite/merge another protocol, manifest, or game schedule');
  }
  const completedIds = new Set<string>(previous.completedCandidateIds ?? []);
  const completedRows: ProductPathCandidateRecord[] = [];
  if (existsSync(observationsPath)) {
    for (const line of readFileSync(observationsPath, 'utf8').split(/\r?\n/)) {
      if (!line.trim()) continue;
      const row = JSON.parse(line) as ProductPathCandidateRecord;
      if (row.protocol === PRODUCT_PATH_PROTOCOL && row.manifestHash === mHash) completedRows.push(row);
    }
  }

  const pending = candidatesRaw.filter(c => !completedIds.has(c.candidateId));
  const newRows = await mapWithConcurrency(pending, 2, async (candidate) => {
    const evol = reviveCandidate(candidate);
    const metrics = (await pool.evalCandidateBatchOnMatchedParallel(
      [evol],
      emptyMask,
      heldOutOpps,
      gamesPerCell,
      50_000 + (candidatesRaw.indexOf(candidate) * 500),
      'product_path',
    ))[0];
    if ((metrics.workerErrorCount ?? 0) > 0 || metrics.total !== heldOutOpps.length * 2 * gamesPerCell) {
      throw new Error(`PRODUCT_PATH_CANDIDATE_WORKER_ERROR: ${candidate.candidateId}`);
    }
    const row: ProductPathCandidateRecord = {
      candidateId: candidate.candidateId,
      sourceId: candidate.sourceId,
      sourceSeedName: candidate.sourceSeedName,
      sourceSeedIndex: candidate.sourceSeedIndex,
      noveltyBucket: candidate.noveltyBucket,
      mutationDesc: candidate.mutationDesc,
      metrics,
      gamesExpected: heldOutOpps.length * 2 * gamesPerCell,
      protocol: PRODUCT_PATH_PROTOCOL,
      manifestHash: mHash,
    };
    // Append-only observation first, then atomic cursor; an interrupted run can safely replay a duplicate-free ID.
    appendFileSync(observationsPath, `${JSON.stringify(row)}\n`, 'utf8');
    completedIds.add(row.candidateId);
    writeAtomic(cursorPath, {
      protocol: PRODUCT_PATH_PROTOCOL,
      manifestHash: mHash,
      configuredWorkerConcurrency: manifest.configuredWorkerCount,
      observedWorkerConcurrency: manifest.observedWorkerCount,
      gamesPerCell,
      completedCandidateIds: [...completedIds].sort(),
      lastCompletedCandidateId: row.candidateId,
      updatedAt: new Date().toISOString(),
    });
    return row;
  });

  const allRows = [...completedRows, ...newRows];
  const frontiers = frontier(allRows);
  writeAtomic(frontierPath, {
    protocol: PRODUCT_PATH_PROTOCOL,
    manifestHash: mHash,
    signalOnly: true,
    tierPromotion: 'NOT_PERFORMED',
    frontiers,
  });

  return {
    outputDir,
    manifest,
    manifestHash: mHash,
    fidelity,
    baselines,
    candidates: allRows,
    completedCandidates: newRows.length,
    skippedCandidates: completedRows.length,
    cursorPath,
    observationsPath,
    frontierPath,
  };
}
