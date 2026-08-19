// ============================================================
// src/engine/tree/product_training/run_cycle.ts
// T038 Phase-3 自适应演化循环入口（唯一无人值守优化命令）
//
// 运行：npx vite-node src/engine/tree/product_training/run_cycle.ts
//
// 周期步骤：
//   1. 加载 T037 已验证源/frontiers/coverage/cursor
//   2. 决策每个源的成熟度、可控性、弱侧需求、算子预算
//   3. 生成并验证规范新颖批次
//   4. 通过 Phase-2 产品路径筛选
//   5. 按 source-relative → weakest-side → coverage gain 排名
//   6. product-path 后剪枝选中条件候选
//   7. 保留每个源一个唯一 frontier 并追加周期决策记录
//   8. 导出只读 runtime_candidate_catalog.json
//
// 约束：
//   - PersistentSimPool → fine_grained_worker(product_path) → playFullGame
//   - 外部候选并发 <=2
//   - append-only 证据，atomic cursor
//   - 无 arena/sandbox/apply/deploy/publish/Tier 变更
// ============================================================

import '../../env';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Formation } from '../../../ai/types';
import { PersistentSimPool } from '../persistent_pool';
import { loadProductSources } from './01_sources';
import { generateCandidateBatch, T037_OUTPUT_DIR, type ScreenObservation, type CandidateEntry, screenEntity, ensureOutputDir, computeManifestHash } from './04_screen';
import { computeSourcePolicies, rankCandidates, type CycleDecisionRecord, SINGLE_OP_ESCALATION_LIMIT } from './05_select';
import { postPruneCandidate } from './06_prune';
import { exportRuntimeCatalog } from './06_runtime_export';

// ---- 常量 ----

const T038_PROTOCOL = 'PRODUCT_PATH_T038_V1';
const T038_CYCLE_CURSOR_PATH = resolve(`${T037_OUTPUT_DIR}/t038_cycle_cursor.json`);
const T038_DECISIONS_PATH = resolve(`${T037_OUTPUT_DIR}/t038_cycle_decisions.jsonl`);
const T038_PRUNE_TRIALS_PATH = resolve(`${T037_OUTPUT_DIR}/t038_prune_trials.jsonl`);
const T038_ESCALATIONS_PATH = resolve(`${T037_OUTPUT_DIR}/t038_escalations.jsonl`);
const PRUNE_SEED_BASE = 38001;

// ---- 工具函数 ----

function log(msg: string) { console.log(msg); }

function appendJsonlLocal(path: string, record: unknown): void {
  appendFileSync(path, JSON.stringify(record) + '\n', 'utf8');
}

// ---- 周期 cursor ----

interface CycleCursor {
  protocol: string;
  cycleId: string;
  startedAt: string;
  completedSources: string[];
  updatedAt: string;
}

function loadCycleCursor(): CycleCursor {
  const cycleId = randomUUID().slice(0, 8);
  if (!existsSync(T038_CYCLE_CURSOR_PATH)) {
    return { protocol: T038_PROTOCOL, cycleId, startedAt: new Date().toISOString(), completedSources: [], updatedAt: new Date().toISOString() };
  }
  const c: CycleCursor = JSON.parse(readFileSync(T038_CYCLE_CURSOR_PATH, 'utf8'));
  if (c.protocol !== T038_PROTOCOL) {
    log(`[cursor] protocol mismatch, starting fresh cycle`);
    return { protocol: T038_PROTOCOL, cycleId, startedAt: new Date().toISOString(), completedSources: [], updatedAt: new Date().toISOString() };
  }
  return c;
}

function saveCycleCursor(cursor: CycleCursor): void {
  cursor.updatedAt = new Date().toISOString();
  const tmp = `${T038_CYCLE_CURSOR_PATH}.tmp`;
  writeFileSync(tmp, JSON.stringify(cursor, null, 2), 'utf8');
  const { renameSync } = require('node:fs');
  renameSync(tmp, T038_CYCLE_CURSOR_PATH);
}

// ---- 主循环 ----

log(`\n=== run_cycle.ts — T038 Adaptive Self-Evolution Cycle ===`);
log(`Protocol: ${T038_PROTOCOL}\n`);

// 步骤 1：加载 T037 证据
const T037_OBS_PATH = resolve(`${T037_OUTPUT_DIR}/screen_observations.jsonl`);
if (!existsSync(T037_OBS_PATH)) {
  console.error(`ERROR: T037 evidence not found at ${T037_OBS_PATH}`);
  console.error('Run T037 first: npx vite-node src/engine/tree/product_training/run_screen.ts');
  process.exit(1);
}
const t037Obs: ScreenObservation[] = readFileSync(T037_OBS_PATH, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
log(`T037 observations loaded: ${t037Obs.length}`);

const sources = loadProductSources();
const execSources: Formation[] = sources.executable as unknown as Formation[];
log(`Executable sources: ${execSources.length}`);

const bundlesRaw = JSON.parse(readFileSync(resolve('tests/fixtures/tree/early_seven_bundles.json'), 'utf8')) as any[];
const heldOutOpps: Formation[] = bundlesRaw.map(b => b.heldOutVariant as Formation);
log(`Held-out families: ${heldOutOpps.length}`);

// 步骤 2：决策每个源的策略
const policies = computeSourcePolicies(execSources, t037Obs);
log(`\n--- Source policies ---`);
for (const p of policies) {
  const eff = p.spatialBudget > 0 ? `spatial=${p.spatialBudget}` : 'spatial=0 (LOW_CTRL)';
  log(`  ${p.sourceId.padEnd(20)} ${p.maturity.padEnd(6)} ${eff} transform=${p.transformBudget} branch=${p.branchBudget} multiMonster=${p.allowMultiMonster}`);
}

// 步骤 3：生成并验证候选批次（确定性，基于 T037 Phase-2 生成器）
const allEntries: CandidateEntry[] = generateCandidateBatch(execSources);
const validEntries = allEntries.filter(e => !e.meta.rejected);
const rejectedEntries = allEntries.filter(e => e.meta.rejected);
log(`\nCandidate batch: ${allEntries.length} total (${validEntries.length} valid, ${rejectedEntries.length} rejected)`);

// T037 已筛选过的 fingerprints（跳过重复）
const t037Registry = JSON.parse(
  `[${readFileSync(resolve(`${T037_OUTPUT_DIR}/candidate_registry.jsonl`), 'utf8').split('\n').filter(Boolean).join(',')}]`
);
const t037Fps = new Set<string>(t037Registry.map((r: any) => r.canonicalFingerprint));

// 需要筛选的新候选（指纹未出现在 T037 中）
const newEntries = validEntries.filter(e => !t037Fps.has(e.meta.canonicalFingerprint ?? ''));
const alreadyScreened = validEntries.filter(e => t037Fps.has(e.meta.canonicalFingerprint ?? ''));
log(`New candidates to screen: ${newEntries.length} (${alreadyScreened.length} already in T037)`);

// 步骤 4：筛选新候选（通过 Phase-2 product path）
const cursor = loadCycleCursor();

// 准备 T038 筛选证据目录（与 T037 共享，追加新 cell/obs）
const paths = ensureOutputDir(T037_OUTPUT_DIR);
const t038ManifestHash = computeManifestHash({ protocol: T038_PROTOCOL, cycleId: cursor.cycleId });

const pool = await PersistentSimPool.getInstance();
log(`\nPool initialized.`);

// 合并 T037 已有观察 + 新筛选结果
const allObs: ScreenObservation[] = [...t037Obs];

// 外部候选并发 <=2：用简单串行（两个候选批次之间 await）
const OUTER_CONCURRENCY = 2;

if (newEntries.length > 0) {
  log(`\n--- Phase-2 screening of ${newEntries.length} new candidates ---`);

  const toBatch: CandidateEntry[][] = [];
  for (let i = 0; i < newEntries.length; i += OUTER_CONCURRENCY) {
    toBatch.push(newEntries.slice(i, i + OUTER_CONCURRENCY));
  }

  let screenedCount = 0;
  for (const batch of toBatch) {
    const batchResults = await Promise.all(
      batch.map(entry => screenEntity({ pool, entry, heldOutOpps, manifestHash: t038ManifestHash, paths }))
    );
    for (let i = 0; i < batch.length; i++) {
      const obs = batchResults[i];
      allObs.push(obs);
      appendJsonlLocal(T038_DECISIONS_PATH, { type: 'screen', candidateId: batch[i].meta.candidateId, obs });
      screenedCount++;
      log(`  screened [${screenedCount}/${newEntries.length}] ${batch[i].meta.candidateId}  score=${obs.trainingScore.toFixed(3)}`);
    }
  }
}

// 计算 source-relative score（基于 T037 baseline）
const baselineMap = new Map<string, number>(
  t037Obs.filter(o => o.entityKind === 'baseline').map(o => [o.sourceId, o.trainingScore])
);
for (const obs of allObs) {
  if (obs.entityKind === 'candidate' && obs.sourceRelativeScore === null) {
    const bl = baselineMap.get(obs.sourceId);
    if (bl !== undefined) obs.sourceRelativeScore = obs.trainingScore - bl;
  }
}

// 步骤 5：排名
const ranked = rankCandidates(allEntries, allObs, policies);
log(`\n--- Ranked candidates (${ranked.length} total) ---`);
for (const rc of ranked.filter(r => r.rank === 0)) {
  const rel = rc.obs.sourceRelativeScore?.toFixed(3) ?? '—';
  log(`  ${rc.entry.meta.sourceId.padEnd(20)} best=${rc.entry.meta.candidateId.padEnd(45)} rel=${rel} promo=${rc.isPromotion}`);
}

// 步骤 6：product-path 后剪枝（仅对 promotion 候选）
const promotions = ranked.filter(r => r.rank === 0 && r.isPromotion);
log(`\n--- Post-pruning ${promotions.length} promotion candidates ---`);

const pruneResults = new Map<string, ReturnType<typeof postPruneCandidate> extends Promise<infer T> ? T : never>();
for (const rc of promotions) {
  log(`  pruning ${rc.entry.meta.candidateId}...`);
  const result = await postPruneCandidate({
    pool,
    candidateId: rc.entry.meta.candidateId,
    evol: rc.entry.evol,
    matchedOpps: heldOutOpps,
    baselineScore: rc.obs.sourceRelativeScore ?? 0,
    seedBase: PRUNE_SEED_BASE,
  });
  pruneResults.set(rc.entry.meta.candidateId, result);
  for (const trial of result.trials) {
    appendJsonlLocal(T038_PRUNE_TRIALS_PATH, trial);
  }
  log(`    tested=${result.totalBranchesTested} pruned=${result.totalBranchesPruned} fp: ${result.originalFingerprint} → ${result.finalFingerprint}`);
}

// 步骤 7：周期决策记录（每个源一个 frontier）
log(`\n--- Cycle decision records ---`);
const cycleDecisions: CycleDecisionRecord[] = [];

for (const policy of policies) {
  const srcId = policy.sourceId;
  const srcRanked = ranked.filter(r => r.entry.meta.sourceId === srcId && r.rank === 0);
  const best = srcRanked[0] ?? null;

  let singleOpFail = 0;
  let escalated = false;
  let escalationReason: string | null = null;

  // 检查是否需要升级到 multi_monster
  if (!best && policy.allowMultiMonster) {
    singleOpFail = SINGLE_OP_ESCALATION_LIMIT + 1;
    escalated = true;
    escalationReason = `No improving single-op candidate found after ${SINGLE_OP_ESCALATION_LIMIT} attempts; WEAK source eligible for multi_monster in next cycle`;
    appendJsonlLocal(T038_ESCALATIONS_PATH, {
      sourceId: srcId,
      cycleId: cursor.cycleId,
      reason: escalationReason,
      maturity: policy.maturity,
      singleOpFailCount: singleOpFail,
      decidedAt: new Date().toISOString(),
    });
    log(`  [escalation] ${srcId}: ${escalationReason}`);
  }

  const decision: CycleDecisionRecord = {
    protocol: T038_PROTOCOL,
    cycleId: cursor.cycleId,
    sourceId: srcId,
    maturity: policy.maturity,
    controllableRatio: policy.controllableRatio,
    spatialBudget: policy.spatialBudget,
    spatialBudgetReason: policy.spatialBudgetReason,
    baselineScore: policy.baselineScore,
    bestCandidateId: best?.entry.meta.candidateId ?? null,
    bestCandidateScore: best?.obs.trainingScore ?? null,
    bestCandidateRel: best?.obs.sourceRelativeScore ?? null,
    isPromotion: best?.isPromotion ?? false,
    candidatesScreened: ranked.filter(r => r.entry.meta.sourceId === srcId).length,
    singleOpFailCount: singleOpFail,
    escalatedToMultiMonster: escalated,
    escalationReason,
    decidedAt: new Date().toISOString(),
  };
  cycleDecisions.push(decision);
  appendJsonlLocal(T038_DECISIONS_PATH, { type: 'decision', ...decision });
}

// 步骤 8：导出只读 runtime catalog
const catalogInputs = cycleDecisions
  .filter(d => d.bestCandidateId !== null)
  .map(d => {
    const srcId = d.sourceId;
    const best = ranked.find(r => r.entry.meta.candidateId === d.bestCandidateId)!;
    const pruneResult = pruneResults.get(d.bestCandidateId!) ?? null;
    const policy = policies.find(p => p.sourceId === srcId)!;
    return {
      policy,
      candidateId: d.bestCandidateId!,
      operatorFamily: best.entry.meta.operatorFamily,
      canonicalFingerprint: best.entry.meta.canonicalFingerprint ?? '',
      obs: best.obs,
      pruneResult,
      isPromotion: d.isPromotion,
    };
  });

const catalog = exportRuntimeCatalog({
  cycleId: cursor.cycleId,
  protocol: T038_PROTOCOL,
  entries: catalogInputs,
});

// 更新 cursor
cursor.completedSources = [...new Set([...cursor.completedSources, ...policies.map(p => p.sourceId)])];
saveCycleCursor(cursor);

// ---- 汇总 ----

log(`\n${'='.repeat(60)}`);
log(`T038 Cycle Complete`);
log(`${'='.repeat(60)}`);
log(`Cycle ID: ${cursor.cycleId}`);
log(`Sources processed: ${cycleDecisions.length}`);
log(`Promotions: ${cycleDecisions.filter(d => d.isPromotion).length}`);
log(`Escalations (→ multi_monster next): ${cycleDecisions.filter(d => d.escalatedToMultiMonster).length}`);
log(`Prune trials: ${[...pruneResults.values()].reduce((a, r) => a + r.totalBranchesTested, 0)}`);
log(`Prune removals: ${[...pruneResults.values()].reduce((a, r) => a + r.totalBranchesPruned, 0)}`);
log(`Runtime catalog: ${catalog.totalEntries} entries, ${catalog.promotionCount} promotions`);
log(`  path: tests/fixtures/tree/experience_library/product_path_t037/runtime_candidate_catalog.json`);
log(`  hash: ${catalog.catalogHash}`);
log(`\nno-apply confirmation: ${catalog.noApplyConfirmation}`);
log('\n✓ run_cycle DONE\n');
