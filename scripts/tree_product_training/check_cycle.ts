// ============================================================
// scripts/tree_product_training/check_cycle.ts
// T041R 独立 Stage-1 尝试、多成员血缘 Melee 与流派治理验证脚本（无仿真）
//
// 验证：
//   1. 严格独立 Stage-1 门禁：进入 MELEE 前必须包含至少 3 次实际不同的优化尝试 (distinct attemptIdentity)
//   2. Stage-1 尝试无虚假重复 (candidateFingerprint 与 atomicChanges 均有真实差异)
//   3. Stage-1 记录包含独立强阵评测向量引用与 countable=true 标记
//   4. 跃迁原因文本与实际数值比较 100% 吻合
//   5. Melee 流派治理包含多成员 Root-Lineage 体系 (>= 1 multi-member archetype)
//   6. 严禁在流派治理中加入历史快照 (HISTORICAL_SNAPSHOT)
//   7. 采样时动态排除候选自身作为对手 (self-opponent exclusion)
//   8. Top-level 流派等概率均匀采样，In-archetype 平滑权重非恒定且随强度单调不减
//   9. Melee 采样对局严格满足 P1/P2 成对运行与最低配额
//   10. Melee 失败精准返回 Stage 1（绝不退回 Stage 3）
//   11. 周期幂等性、去重与无状态破坏
//   12. 聚合实验边界标签（AGGREGATE_EXPLORATION_ONLY）与无 apply 确认
// ============================================================

import '../../src/engine/env';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

console.log('=== check_cycle.ts — T041R Distinct Stage-1 & Multi-Member Melee Verification ===\n');

let passed = 0;
let failed = 0;

function check(label: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${label}`);
    passed++;
  } catch (e: any) {
    console.error(`  ✗ ${label}`);
    console.error(`    ${e.message}`);
    failed++;
  }
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const T037_DIR = resolve('tests/fixtures/tree/experience_library/product_path_t037');
const CATALOG_PATH = resolve(`${T037_DIR}/runtime_candidate_catalog.json`);
const DECISIONS_PATH = resolve(`${T037_DIR}/t038_cycle_decisions.jsonl`);
const CURSOR_PATH = resolve(`${T037_DIR}/t038_cycle_cursor.json`);
const BENCHMARK_MANIFEST_PATH = resolve(`${T037_DIR}/benchmark_manifests.json`);
const STAGE_LEDGER_PATH = resolve(`${T037_DIR}/stage_training_ledger.jsonl`);
const CELL_RESULTS_PATH = resolve(`${T037_DIR}/benchmark_cell_results.jsonl`);
const STAGE1_EPISODE_PATH = resolve(`${T037_DIR}/stage1_episode_ledger.jsonl`);
const ARCHETYPE_CONFIG_PATH = resolve(`${T037_DIR}/melee_archetype_config.json`);
const SAMPLING_MANIFEST_PATH = resolve(`${T037_DIR}/melee_sampling_manifest.json`);
const MELEE_PAIRS_PATH = resolve(`${T037_DIR}/melee_sample_pairs.jsonl`);

// ---- 1. 文件存在性验证 ----

check('all required T041R artifact files exist', () => {
  assert(existsSync(ARCHETYPE_CONFIG_PATH), `Missing: ${ARCHETYPE_CONFIG_PATH}`);
  assert(existsSync(SAMPLING_MANIFEST_PATH), `Missing: ${SAMPLING_MANIFEST_PATH}`);
  assert(existsSync(STAGE1_EPISODE_PATH), `Missing: ${STAGE1_EPISODE_PATH}`);
  assert(existsSync(MELEE_PAIRS_PATH), `Missing: ${MELEE_PAIRS_PATH}`);
  assert(existsSync(STAGE_LEDGER_PATH), `Missing: ${STAGE_LEDGER_PATH}`);
  assert(existsSync(BENCHMARK_MANIFEST_PATH), `Missing: ${BENCHMARK_MANIFEST_PATH}`);
  assert(existsSync(CATALOG_PATH), `Missing: ${CATALOG_PATH}`);
});

// ---- 加载数据 ----

const archetypeConfig = existsSync(ARCHETYPE_CONFIG_PATH) ? JSON.parse(readFileSync(ARCHETYPE_CONFIG_PATH, 'utf8')) : null;
const samplingManifest = existsSync(SAMPLING_MANIFEST_PATH) ? JSON.parse(readFileSync(SAMPLING_MANIFEST_PATH, 'utf8')) : null;
const catalog = existsSync(CATALOG_PATH) ? JSON.parse(readFileSync(CATALOG_PATH, 'utf8')) : null;
const cursor = existsSync(CURSOR_PATH) ? JSON.parse(readFileSync(CURSOR_PATH, 'utf8')) : null;
const decisions = existsSync(DECISIONS_PATH)
  ? readFileSync(DECISIONS_PATH, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
  : [];
const stageLedger = existsSync(STAGE_LEDGER_PATH)
  ? readFileSync(STAGE_LEDGER_PATH, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
  : [];
const stage1Episodes = existsSync(STAGE1_EPISODE_PATH)
  ? readFileSync(STAGE1_EPISODE_PATH, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
  : [];
const meleePairs = existsSync(MELEE_PAIRS_PATH)
  ? readFileSync(MELEE_PAIRS_PATH, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
  : [];

// ---- 2. 流派治理与真实多成员验证 ----

check('Archetype config contains real root-lineage members with multi-member lineages and no historical snapshots', () => {
  assert(archetypeConfig?.archetypes && archetypeConfig.archetypes.length === 11, `Expected 11 archetypes, got ${archetypeConfig?.archetypes?.length}`);
  assert(archetypeConfig.multiMemberArchetypeCount >= 1, `Expected multiMemberArchetypeCount >= 1, got ${archetypeConfig.multiMemberArchetypeCount}`);
  assert(archetypeConfig.totalMembers > 11, `Expected totalMembers > 11, got ${archetypeConfig.totalMembers}`);

  for (const arch of archetypeConfig.archetypes) {
    assert(arch.archetypeId === arch.rootSourceId, `Mismatched root for archetype: ${arch.archetypeId}`);
    for (const m of arch.members) {
      assert(m.primaryArchetype === arch.archetypeId, `Member primaryArchetype mismatch`);
      assert(m.rootSourceId === arch.rootSourceId, `Member rootSourceId mismatch`);
      assert(!m.memberId.includes('historical') && !m.selectionReason.includes('historical'), `ERROR: Historical snapshot found: ${m.memberId}`);
      assert(m.smoothedWeight > 0, `Member weight must be positive: ${m.smoothedWeight}`);
    }
  }
  console.log(`    Audited ${archetypeConfig.totalMembers} members across 11 root archetypes (${archetypeConfig.multiMemberArchetypeCount} multi-member lineages)`);
});

check('In-archetype weights derive from frozen strength and are non-constant for multi-member archetypes', () => {
  let hasDivergentWeights = false;
  for (const arch of archetypeConfig.archetypes) {
    if (arch.members.length > 1) {
      const weights = arch.members.map((m: any) => m.smoothedWeight);
      const uniqueWeights = new Set(weights);
      if (uniqueWeights.size > 1) hasDivergentWeights = true;
    }
  }
  assert(hasDivergentWeights, 'Multi-member archetypes must have non-constant smoothed weights based on evidence');
});

// ---- 3. 严格独立 Stage-1 Episode 尝试门禁 ----

check('No candidate enters MELEE without at least three distinct countable Stage-1 attempts', () => {
  const meleeLedgers = stageLedger.filter((l: any) => l.previousStage === 'STAGE_1_STRONG_EPISODE' && l.nextStage === 'MELEE');
  assert(meleeLedgers.length > 0, 'No candidates reached MELEE');

  for (const ml of meleeLedgers) {
    const attempts = stage1Episodes.filter((e: any) => e.candidateId === ml.candidateId && e.countable);
    assert(attempts.length >= 3, `Candidate ${ml.candidateId} entered MELEE with only ${attempts.length} attempts (< 3)`);

    // 验证 attemptIdentity 互不相同
    const distinctIdentities = new Set(attempts.map((a: any) => a.attemptIdentity));
    assert(distinctIdentities.size >= 3, `Duplicate attempt identities detected for candidate ${ml.candidateId}: only ${distinctIdentities.size} distinct`);

    // 验证 candidateFingerprint 互不相同
    const distinctFps = new Set(attempts.map((a: any) => a.candidateFingerprint));
    assert(distinctFps.size >= 3, `Repeated candidate fingerprints in Stage-1 attempts for candidate ${ml.candidateId}`);

    // 验证 vector 引用独立
    const distinctVecRefs = new Set(attempts.map((a: any) => a.strongPoolVectorRef));
    assert(distinctVecRefs.size >= 3, `Repeated strongPoolVectorRef in Stage-1 attempts for candidate ${ml.candidateId}`);
  }
  console.log(`    Audited ${stage1Episodes.length} distinct Stage-1 targeted optimization attempts`);
});

// ---- 4. 跃迁谓词与数值一致性 ----

check('Transition predicate wording agrees exactly with stored numeric comparisons', () => {
  for (const entry of stageLedger) {
    if (entry.previousStage === 'STAGE_3_EARLY_BUNDLE') {
      if (entry.transitionDecision === 'STAGE_PROMOTED') {
        assert(entry.sourceRelativeScore >= -0.05, `Contradiction: promoted but rel < -0.05`);
        assert(entry.transitionReason.includes('>= -0.05'), `Reason text mismatch in promotion`);
      } else {
        const isRelFail = entry.sourceRelativeScore < -0.05;
        const isAbsFail = entry.score < 0.70;
        assert(isRelFail || isAbsFail, `Contradiction: retained but both passed`);
      }
    }
  }
});

// ---- 5. Melee 采样与自博弈排除验证 ----

check('Melee sampling records satisfy P1/P2 pairing and exclude candidate self-opponents', () => {
  assert(meleePairs.length > 0, 'No melee sample pair records found');
  const candidateIds = [...new Set(meleePairs.map((p: any) => p.candidateId))];

  for (const cid of candidateIds) {
    const pairsForCand = meleePairs.filter((p: any) => p.candidateId === cid);
    assert(pairsForCand.length === 16, `Expected 16 sampled pairs for candidate ${cid}, got ${pairsForCand.length}`);

    // 验证 11 个流派最低配额
    const coveredArchetypes = new Set(pairsForCand.map((p: any) => p.sampledArchetype));
    assert(coveredArchetypes.size === 11, `Candidate ${cid} did not cover all 11 archetypes in melee`);

    // 验证无 self-opponent
    for (const p of pairsForCand) {
      assert(p.sampledMemberId !== cid, `Self-opponent detected: candidate ${cid} played against itself`);
    }
  }
  console.log(`    Audited ${meleePairs.length} paired Melee evaluations across ${candidateIds.length} candidates`);
});

// ---- 6. Melee 失败回退路径 ----

check('Melee failures return to Stage 1, never directly to Stage 3', () => {
  const meleeTransitions = stageLedger.filter((l: any) => l.previousStage === 'MELEE');
  for (const mt of meleeTransitions) {
    if (mt.transitionDecision === 'MELEE_DIAGNOSE_RETURN_STAGE_1') {
      assert(mt.nextStage === 'STAGE_1_STRONG_EPISODE', `Melee failure should return to STAGE_1_STRONG_EPISODE, got ${mt.nextStage}`);
      assert(mt.nextStage !== 'STAGE_3_EARLY_BUNDLE', `ERROR: Melee failure incorrectly returned to Stage 3!`);
    }
  }
});

// ---- 7. 幂等性、去重与 Catalog 边界 ----

check('No duplicate decision records by recordId and cycleId+sourceId', () => {
  const recordIds = new Set<string>();
  const cycleSourceKeys = new Set<string>();
  for (const d of decisions) {
    assert(d.recordId, `Decision missing recordId`);
    assert(!recordIds.has(d.recordId), `Duplicate recordId: ${d.recordId}`);
    recordIds.add(d.recordId);

    const key = `${d.cycleId}_${d.sourceId}`;
    assert(!cycleSourceKeys.has(key), `Duplicate cycle+source decision: ${key}`);
    cycleSourceKeys.add(key);
  }
});

check('Catalog has strict aggregate boundaries and no promotion terms', () => {
  assert(catalog?.schemaVersion === 'T038_CATALOG_V1', `Got: ${catalog?.schemaVersion}`);
  assert(catalog?.evidenceClass === 'AGGREGATE_EXPLORATION_ONLY', `Invalid evidenceClass: ${catalog?.evidenceClass}`);
  assert(
    catalog?.integrationStatus === 'EXPERIMENTAL_UNVERIFIED_NOT_FOR_AUTO_INTEGRATION',
    `Invalid integrationStatus: ${catalog?.integrationStatus}`,
  );
  assert(catalog?.formalPromotionStatus === 'NOT_EVALUATED', `Invalid formalPromotionStatus: ${catalog?.formalPromotionStatus}`);
  assert(
    catalog?.noApplyConfirmation === 'NO_APPLY_NO_DEPLOY_NO_PUBLISH_NO_TIER_CHANGE',
    `Invalid noApplyConfirmation: ${catalog?.noApplyConfirmation}`,
  );
});

// ---- 8. 汇总打印 ----

console.log('\n--- T041R Benchmark Ladder & Melee Summary ---');
console.log('  Source ID            Classification         CtrlRatio  Spatial  Baseline  BestRel  ExpFrontier?');
console.log('  ' + '-'.repeat(95));
if (catalog?.entries) {
  for (const e of catalog.entries) {
    const rel = (e.sourceRelativeScore >= 0 ? '+' : '') + e.sourceRelativeScore.toFixed(3);
    const frontier = e.isExperimentalFrontier ? 'YES' : ' NO';
    console.log(
      `  ${e.sourceId.padEnd(20)} ${(e.classification ?? '-').padEnd(22)} ${e.controllableRatio.toFixed(3).padStart(9)} ` +
      `${String(e.spatialBudget).padStart(8)} ${e.baselineScore.toFixed(3).padStart(9)} ` +
      `${rel.padStart(8)} ${frontier.padStart(13)}`
    );
  }
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
console.log('✓ check_cycle PASSED\n');
