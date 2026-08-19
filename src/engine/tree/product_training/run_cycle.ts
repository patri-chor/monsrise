// ============================================================
// src/engine/tree/product_training/run_cycle.ts
// T038R 自适应演化循环入口（唯一无人值守优化命令）
//
// 规范要求：
//   - 稳定确定 cycleId，重复调用同一周期完全幂等（no-op，不重复追加记录）
//   - 支持多周期演化状态持久化与 parent 关联
//   - 实际自适应候选生成：包含真实 strategy_schedule_branch 与 multi_monster_exploration
//   - 严格聚合实验边界标签（AGGREGATE_EXPLORATION_ONLY, isExperimentalFrontier）
//   - 外部并发 <=2，PersistentSimPool 动态负载调度
// ============================================================

import '../../env';
import { appendFileSync, existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import type { Formation } from '../../../ai/types';
import { PersistentSimPool } from '../persistent_pool';
import { loadProductSources } from './01_sources';
import { T037_OUTPUT_DIR, type ScreenObservation, type CandidateEntry, screenEntity, ensureOutputDir } from './04_screen';
import {
  computeSourcePolicies,
  rankCandidates,
  generateAdaptiveCandidatesForSource,
  type CycleDecisionRecord,
  SINGLE_OP_ESCALATION_LIMIT,
} from './05_select';
import { postPruneCandidate } from './06_prune';
import { exportRuntimeCatalog, CATALOG_PATH, type RuntimeCandidateCatalog } from './06_runtime_export';
import { formationToEvol } from '../evol_gene';
import { computeCandidateFingerprint } from './02_candidates';

// ---- 常量与路径 ----

const T038_PROTOCOL = 'PRODUCT_PATH_T038_V1';
const POLICY_VERSION = 't038r-adaptive-policy-v1';
const BASE_SEED = 38000;
const T038_CYCLE_CURSOR_PATH = resolve(`${T037_OUTPUT_DIR}/t038_cycle_cursor.json`);
const T038_DECISIONS_PATH = resolve(`${T037_OUTPUT_DIR}/t038_cycle_decisions.jsonl`);
const T038_PRUNE_TRIALS_PATH = resolve(`${T037_OUTPUT_DIR}/t038_prune_trials.jsonl`);
const T038_ESCALATIONS_PATH = resolve(`${T037_OUTPUT_DIR}/t038_escalations.jsonl`);
const T037_OBS_PATH = resolve(`${T037_OUTPUT_DIR}/screen_observations.jsonl`);

function log(msg: string) { console.log(msg); }

// ---- 幂等写入工具 ----

function appendJsonlUnique(path: string, record: { recordId?: string; [key: string]: any }, existingIds: Set<string>): boolean {
  if (record.recordId) {
    if (existingIds.has(record.recordId)) return false;
    existingIds.add(record.recordId);
  }
  appendFileSync(path, JSON.stringify(record) + '\n', 'utf8');
  return true;
}

function loadExistingRecordIds(path: string): Set<string> {
  if (!existsSync(path)) return new Set();
  const ids = new Set<string>();
  const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean);
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      if (obj.recordId) ids.add(obj.recordId);
    } catch {}
  }
  return ids;
}

// ---- Cycle Cursor ----

export interface CycleCursorState {
  protocol: string;
  sourceFixtureFp: string;
  t037ManifestHash: string;
  policyVersion: string;
  currentCycleOrdinal: number;
  completedCycles: Array<{
    cycleId: string;
    cycleOrdinal: number;
    parentCycleId: string | null;
    parentCatalogHash: string | null;
    completedSources: string[];
    completedAt: string;
  }>;
  persistentFailCounts: Record<string, number>;
  updatedAt: string;
}

function loadCycleCursor(opts: { sourceFixtureFp: string; t037ManifestHash: string }): CycleCursorState {
  if (!existsSync(T038_CYCLE_CURSOR_PATH)) {
    return {
      protocol: T038_PROTOCOL,
      sourceFixtureFp: opts.sourceFixtureFp,
      t037ManifestHash: opts.t037ManifestHash,
      policyVersion: POLICY_VERSION,
      currentCycleOrdinal: 0,
      completedCycles: [],
      persistentFailCounts: {},
      updatedAt: new Date().toISOString(),
    };
  }
  return JSON.parse(readFileSync(T038_CYCLE_CURSOR_PATH, 'utf8'));
}

function saveCycleCursor(cursor: CycleCursorState): void {
  cursor.updatedAt = new Date().toISOString();
  const tmp = `${T038_CYCLE_CURSOR_PATH}.tmp`;
  writeFileSync(tmp, JSON.stringify(cursor, null, 2), 'utf8');
  renameSync(tmp, T038_CYCLE_CURSOR_PATH);
}

// ---- 稳定 Cycle ID ----

function computeCycleId(opts: {
  protocol: string;
  sourceFixtureFp: string;
  t037ManifestHash: string;
  policyVersion: string;
  baseSeed: number;
  cycleOrdinal: number;
}): string {
  return createHash('sha256')
    .update(JSON.stringify(opts))
    .digest('hex')
    .slice(0, 12);
}

// ---- 单个周期执行函数 ----

export async function executeCycle(opts: {
  pool: PersistentSimPool;
  cycleOrdinal: number;
  maxCyclesToRun?: number;
}): Promise<{ cycleId: string; isNoOp: boolean; catalog: RuntimeCandidateCatalog }> {
  const { pool, cycleOrdinal } = opts;
  const paths = ensureOutputDir(T037_OUTPUT_DIR);

  // 1. 加载 T037 证据与来源
  if (!existsSync(T037_OBS_PATH)) {
    throw new Error(`T037 evidence not found at ${T037_OBS_PATH}`);
  }
  const t037Manifest = JSON.parse(readFileSync(resolve(`${T037_OUTPUT_DIR}/manifest.json`), 'utf8'));
  const t037ManifestHash: string = t037Manifest.manifestHash;
  const t037Obs: ScreenObservation[] = readFileSync(T037_OBS_PATH, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));

  const sources = loadProductSources();
  const execSources: Formation[] = sources.executable as unknown as Formation[];
  const sourceFixtureFp = createHash('sha256')
    .update(JSON.stringify(execSources.map((s: any) => s.fingerprint)))
    .digest('hex').slice(0, 16);

  const bundlesRaw = JSON.parse(readFileSync(resolve('tests/fixtures/tree/early_seven_bundles.json'), 'utf8')) as any[];
  const heldOutOpps: Formation[] = bundlesRaw.map(b => b.heldOutVariant as Formation);

  // 2. 计算 cycleId
  const cycleIdentityParams = {
    protocol: T038_PROTOCOL,
    sourceFixtureFp,
    t037ManifestHash,
    policyVersion: POLICY_VERSION,
    baseSeed: BASE_SEED,
    cycleOrdinal,
  };
  const cycleId = computeCycleId(cycleIdentityParams);

  log(`\n============================================================`);
  log(`T038 Cycle Ordinal ${cycleOrdinal} (cycleId: ${cycleId})`);
  log(`============================================================`);

  // 3. 检查 Cursor 幂等性
  const cursor = loadCycleCursor({ sourceFixtureFp, t037ManifestHash });
  const alreadyCompleted = cursor.completedCycles.find(c => c.cycleId === cycleId && c.completedSources.length === execSources.length);
  if (alreadyCompleted) {
    log(`[IDEMPOTENT NO-OP] Cycle ${cycleId} (ordinal ${cycleOrdinal}) is already fully completed.`);
    log(`No records appended, no candidates evaluated.`);
    const existingCatalog: RuntimeCandidateCatalog = existsSync(CATALOG_PATH)
      ? JSON.parse(readFileSync(CATALOG_PATH, 'utf8'))
      : null;
    return { cycleId, isNoOp: true, catalog: existingCatalog };
  }

  // 4. 确定父级目录与 frontier
  const parentCycle = cycleOrdinal > 0
    ? cursor.completedCycles.find(c => c.cycleOrdinal === cycleOrdinal - 1)
    : null;
  const parentCycleId = parentCycle ? parentCycle.cycleId : null;
  const parentCatalogHash = parentCycle ? parentCycle.parentCatalogHash : null;

  // 5. 策略与跨周期失败计数
  const failCountMap = new Map<string, number>(Object.entries(cursor.persistentFailCounts));
  const policies = computeSourcePolicies(execSources, t037Obs, failCountMap);

  log(`\n--- Active Source Policies (cycleOrdinal=${cycleOrdinal}) ---`);
  for (const p of policies) {
    const eff = p.spatialBudget > 0 ? `spatial=${p.spatialBudget}` : 'spatial=0 (LOW_CTRL)';
    log(`  ${p.sourceId.padEnd(20)} ${p.maturity.padEnd(6)} ${eff.padEnd(22)} trans=${p.transformBudget} branch=${p.branchBudget} failCount=${p.singleOpFailCount} multi=${p.allowMultiMonster}`);
  }

  // 6. 加载已存在的 record IDs 集合防重
  const existingDecisionIds = loadExistingRecordIds(T038_DECISIONS_PATH);
  const existingPruneIds = loadExistingRecordIds(T038_PRUNE_TRIALS_PATH);

  // 7. 加载所有已有观察
  const allObs: ScreenObservation[] = [...t037Obs];
  const allScreenObsRaw = readFileSync(paths.observationsPath, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  const obsMap = new Map<string, ScreenObservation>(allScreenObsRaw.map((o: any) => [o.entityId, o]));

  // 8. 自适应生成候选并筛选
  const seenFps = new Set<string>();
  for (const src of execSources) {
    const evol = formationToEvol(src);
    seenFps.add(computeCandidateFingerprint(evol));
  }

  const generatedBatch: CandidateEntry[] = [];
  for (const src of execSources) {
    const evol = formationToEvol(src);
    const policy = policies.find(p => p.sourceId === (src as any).id)!;
    const candidates = generateAdaptiveCandidatesForSource({
      source: src,
      parentEvol: evol,
      policy,
      cycleOrdinal,
      seedBase: BASE_SEED,
      seenFingerprints: seenFps,
    });
    generatedBatch.push(...candidates);
  }

  log(`\nGenerated adaptive candidate batch: ${generatedBatch.length} candidates (${generatedBatch.filter(e => !e.meta.rejected).length} valid, ${generatedBatch.filter(e => e.meta.rejected).length} rejected)`);

  // 9. 筛选有效未评估候选（外部并发 <=2）
  const validToScreen = generatedBatch.filter(e => !e.meta.rejected && !obsMap.has(e.meta.candidateId));
  log(`Candidates requiring product-path screen: ${validToScreen.length}`);

  if (validToScreen.length > 0) {
    const OUTER_CONCURRENCY = 2;
    for (let i = 0; i < validToScreen.length; i += OUTER_CONCURRENCY) {
      const batch = validToScreen.slice(i, i + OUTER_CONCURRENCY);
      const batchObs = await Promise.all(
        batch.map(entry => screenEntity({ pool, entry, heldOutOpps, manifestHash: t037ManifestHash, paths }))
      );
      for (let j = 0; j < batch.length; j++) {
        const obs = batchObs[j];
        allObs.push(obs);
        obsMap.set(batch[j].meta.candidateId, obs);
        log(`  [screened] ${batch[j].meta.candidateId.padEnd(50)} score=${obs.trainingScore.toFixed(3)} W=${obs.w} D=${obs.d} L=${obs.l}`);
      }
    }
  }

  // 计算 source-relative scores
  const baselineScoreMap = new Map<string, number>(
    t037Obs.filter(o => o.entityKind === 'baseline').map(o => [o.sourceId, o.trainingScore])
  );
  for (const obs of allObs) {
    if (obs.entityKind === 'candidate' && (obs.sourceRelativeScore === null || obs.sourceRelativeScore === undefined)) {
      const bl = baselineScoreMap.get(obs.sourceId);
      if (bl !== undefined) obs.sourceRelativeScore = obs.trainingScore - bl;
    }
  }

  // 10. 候选排名
  const allScreenedEntries = generatedBatch.filter(e => !e.meta.rejected);
  const ranked = rankCandidates(allScreenedEntries, allObs, policies);

  // 11. 针对 experimental frontier 进行贪心后剪枝
  const frontiersToPrune = ranked.filter(r => r.rank === 0 && r.isExperimentalFrontier);
  log(`\n--- Post-pruning ${frontiersToPrune.length} experimental frontiers (heuristic sample) ---`);

  const pruneResults = new Map<string, any>();
  for (const rc of frontiersToPrune) {
    log(`  pruning candidate ${rc.entry.meta.candidateId}...`);
    const pruneRes = await postPruneCandidate({
      pool,
      cycleId,
      candidateId: rc.entry.meta.candidateId,
      evol: rc.entry.evol,
      matchedOpps: heldOutOpps,
      baselineScore: rc.obs.sourceRelativeScore ?? 0,
      seedBase: BASE_SEED + cycleOrdinal * 500,
    });
    pruneResults.set(rc.entry.meta.candidateId, pruneRes);
    for (const trial of pruneRes.trials) {
      appendJsonlUnique(T038_PRUNE_TRIALS_PATH, trial, existingPruneIds);
    }
    log(`    tested=${pruneRes.totalBranchesTested} pruned=${pruneRes.totalBranchesPruned} fp: ${pruneRes.originalFingerprint} → ${pruneRes.finalFingerprint}`);
  }

  // 12. 记录周期决策与更新失败计数
  log(`\n--- Writing Cycle Decision Records ---`);
  const cycleDecisions: CycleDecisionRecord[] = [];

  for (const policy of policies) {
    const srcId = policy.sourceId;
    const srcRanked = ranked.filter(r => r.entry.meta.sourceId === srcId && r.rank === 0);
    const best = srcRanked[0] ?? null;

    let failCount = cursor.persistentFailCounts[srcId] ?? 0;
    let escalated = false;
    let escalationReason: string | null = null;

    if (!best || !best.isExperimentalFrontier) {
      failCount++;
      if (failCount >= SINGLE_OP_ESCALATION_LIMIT && policy.allowMultiMonster) {
        escalated = true;
        escalationReason = `SINGLE_OP_FAIL_THRESHOLD_REACHED: failCount=${failCount} >= ${SINGLE_OP_ESCALATION_LIMIT}`;
        appendJsonlUnique(
          T038_ESCALATIONS_PATH,
          {
            recordId: `esc_${cycleId}_${srcId}_${failCount}`,
            evidenceClass: 'AGGREGATE_EXPLORATION_ONLY',
            sourceId: srcId,
            cycleId,
            cycleOrdinal,
            failCount,
            reason: escalationReason,
            decidedAt: new Date().toISOString(),
          },
          new Set()
        );
      }
    } else {
      failCount = 0; // 成功改进则重置失败计数
    }
    cursor.persistentFailCounts[srcId] = failCount;

    const recordId = createHash('sha256')
      .update(`${cycleId}_${srcId}_decision`)
      .digest('hex')
      .slice(0, 16);

    const decision: CycleDecisionRecord = {
      recordId,
      evidenceClass: 'AGGREGATE_EXPLORATION_ONLY',
      protocol: T038_PROTOCOL,
      cycleId,
      cycleOrdinal,
      sourceId: srcId,
      maturity: policy.maturity,
      controllableRatio: policy.controllableRatio,
      spatialBudget: policy.spatialBudget,
      spatialBudgetReason: policy.spatialBudgetReason,
      baselineScore: policy.baselineScore,
      bestCandidateId: best?.entry.meta.candidateId ?? null,
      bestCandidateScore: best?.obs.trainingScore ?? null,
      bestCandidateRel: best?.obs.sourceRelativeScore ?? null,
      isExperimentalFrontier: best?.isExperimentalFrontier ?? false,
      candidatesScreened: ranked.filter(r => r.entry.meta.sourceId === srcId).length,
      singleOpFailCount: failCount,
      escalatedToMultiMonster: escalated,
      escalationReason,
      decidedAt: new Date().toISOString(),
    };
    cycleDecisions.push(decision);
    appendJsonlUnique(T038_DECISIONS_PATH, decision, existingDecisionIds);
  }

  // 13. 导出只读 Catalog
  const catalogInputs = cycleDecisions
    .map(d => {
      const srcId = d.sourceId;
      const policy = policies.find(p => p.sourceId === srcId)!;
      if (d.bestCandidateId) {
        const best = ranked.find(r => r.entry.meta.candidateId === d.bestCandidateId)!;
        const pruneResult = pruneResults.get(d.bestCandidateId!) ?? null;
        return {
          policy,
          candidateId: d.bestCandidateId,
          operatorFamily: best.entry.meta.operatorFamily,
          canonicalFingerprint: best.entry.meta.canonicalFingerprint ?? '',
          obs: best.obs,
          pruneResult,
          isExperimentalFrontier: d.isExperimentalFrontier,
        };
      } else {
        const baselineObs = t037Obs.find(o => o.sourceId === srcId && o.entityKind === 'baseline')!;
        return {
          policy,
          candidateId: `baseline:${srcId}`,
          operatorFamily: 'baseline',
          canonicalFingerprint: baselineObs.entityFingerprint,
          obs: baselineObs,
          pruneResult: null,
          isExperimentalFrontier: false,
        };
      }
    });

  const catalog = exportRuntimeCatalog({
    cycleId,
    cycleOrdinal,
    protocol: T038_PROTOCOL,
    parentCatalogHash,
    entries: catalogInputs,
  });

  // 14. 更新原子 Cursor
  cursor.completedCycles.push({
    cycleId,
    cycleOrdinal,
    parentCycleId,
    parentCatalogHash: catalog.catalogHash,
    completedSources: execSources.map((s: any) => s.id),
    completedAt: new Date().toISOString(),
  });
  cursor.currentCycleOrdinal = cycleOrdinal + 1;
  saveCycleCursor(cursor);

  log(`\n--- Cycle ${cycleId} Summary ---`);
  log(`  Completed sources: ${execSources.length}`);
  log(`  Experimental frontiers: ${catalog.experimentalFrontierCount}`);
  log(`  Catalog hash: ${catalog.catalogHash}`);
  log(`  Prune trials: ${[...pruneResults.values()].reduce((a, r) => a + r.totalBranchesTested, 0)}`);

  return { cycleId, isNoOp: false, catalog };
}

// ---- 主运行入口 ----

async function main() {
  log(`\n=== run_cycle.ts — T038R Adaptive Evolution & Verification ===`);
  const pool = await PersistentSimPool.getInstance();

  try {
    // 运行周期 0（初始自适应演化）
    await executeCycle({ pool, cycleOrdinal: 0 });

    // 运行周期 1（演示持久化状态链接与策略分支/多怪升级）
    await executeCycle({ pool, cycleOrdinal: 1 });

    // 运行周期 1 再次调用（演示幂等性 no-op）
    log(`\n--- Demonstrating Idempotent Rerun of Cycle Ordinal 1 ---`);
    const res1Rerun = await executeCycle({ pool, cycleOrdinal: 1 });
    if (res1Rerun.isNoOp) {
      log(`✓ Idempotency verified: re-running completed cycle produced NO new records.`);
    }

    log(`\n============================================================`);
    log(`T038R Adaptive Loops Complete`);
    log(`Catalog written to: tests/fixtures/tree/experience_library/product_path_t037/runtime_candidate_catalog.json`);
    log(`No-apply confirmation: NO_APPLY_NO_DEPLOY_NO_PUBLISH_NO_TIER_CHANGE`);
    log(`============================================================\n`);
  } finally {
    // 保持 pool 状态
  }
}

await main();
