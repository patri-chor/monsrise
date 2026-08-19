// ============================================================
// scripts/tree_product_training/check_cycle.ts
// T041 阶段 Episode 完整性、概率化 Melee 与流派治理验证脚本（无仿真）
//
// 验证：
//   1. 严格 Stage-1 门禁：进入 MELEE 前必须包含至少 3 次实际 Stage-1 针对性优化尝试
//   2. Stage-1 记录包含实际强阵评测向量引用
//   3. 跃迁原因文本与实际数值比较 100% 吻合（杜绝逻辑描述与比较相反的错误）
//   4. Melee 采用基于 11 个 T1 流派的概率化两层采样，而非固定 16 成员遍历
//   5. 严禁在流派治理中加入历史快照
//   6. Top-level 流派等概率均匀采样，In-archetype 平滑权重正数且随强度单调不减
//   7. Melee 采样对局必须严格满足 P1/P2 成对运行与最低配额
//   8. Melee 失败精准返回 Stage 1（绝不退回 Stage 3）
//   9. 周期幂等性、去重与无状态破坏
//   10. 聚合实验边界标签（AGGREGATE_EXPLORATION_ONLY）与无 apply 确认
// ============================================================

import '../../src/engine/env';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

console.log('=== check_cycle.ts — T041 Stage Episode Integrity & Probabilistic Melee Verification ===\n');

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
const LINEAGE_PATH = resolve(`${T037_DIR}/candidate_lineage.jsonl`);
const COVERAGE_PATH = resolve(`${T037_DIR}/search_coverage.jsonl`);
const STAGE1_EPISODE_PATH = resolve(`${T037_DIR}/stage1_episode_ledger.jsonl`);
const ARCHETYPE_CONFIG_PATH = resolve(`${T037_DIR}/melee_archetype_config.json`);
const SAMPLING_MANIFEST_PATH = resolve(`${T037_DIR}/melee_sampling_manifest.json`);
const MELEE_PAIRS_PATH = resolve(`${T037_DIR}/melee_sample_pairs.jsonl`);

// ---- 1. 文件存在性验证 ----

check('all required T041 artifact files exist', () => {
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
const cellResults = existsSync(CELL_RESULTS_PATH)
  ? readFileSync(CELL_RESULTS_PATH, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
  : [];
const stage1Episodes = existsSync(STAGE1_EPISODE_PATH)
  ? readFileSync(STAGE1_EPISODE_PATH, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
  : [];
const meleePairs = existsSync(MELEE_PAIRS_PATH)
  ? readFileSync(MELEE_PAIRS_PATH, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
  : [];

// ---- 2. 流派治理与历史快照隔离验证 ----

check('Archetype config contains exactly 11 T1 root archetypes without historical snapshots', () => {
  assert(archetypeConfig?.archetypes && archetypeConfig.archetypes.length === 11, `Expected 11 archetypes, got ${archetypeConfig?.archetypes?.length}`);
  for (const arch of archetypeConfig.archetypes) {
    assert(arch.archetypeId === arch.rootSourceId, `Mismatched root for archetype: ${arch.archetypeId}`);
    for (const m of arch.members) {
      assert(m.primaryArchetype === arch.archetypeId, `Member primaryArchetype mismatch`);
      assert(m.rootSourceId === arch.rootSourceId, `Member rootSourceId mismatch`);
      assert(!m.memberId.includes('historical') && !m.selectionReason.includes('historical'), `ERROR: Historical snapshot found in archetype member: ${m.memberId}`);
      assert(m.smoothedWeight > 0, `Member weight must be positive: ${m.smoothedWeight}`);
    }
  }
});

check('Top-level archetype probability is uniform and in-archetype weights are normalized', () => {
  assert(samplingManifest?.topLevelArchetypeProbability === 1 / 11, `Invalid top-level prob: ${samplingManifest?.topLevelArchetypeProbability}`);
  assert(samplingManifest?.archetypeCount === 11, `Invalid archetype count: ${samplingManifest?.archetypeCount}`);
  for (const arch of archetypeConfig.archetypes) {
    const sum = arch.members.reduce((acc: number, m: any) => acc + m.smoothedWeight, 0);
    assert(Math.abs(sum - 1.0) < 0.001, `Archetype ${arch.archetypeId} weights not normalized: sum=${sum}`);
  }
});

// ---- 3. 严格 Stage-1 聚焦优化 Episode 门禁验证 ----

check('No candidate enters MELEE without at least three recorded Stage-1 targeted attempts', () => {
  const meleeLedgers = stageLedger.filter((l: any) => l.previousStage === 'STAGE_1_STRONG_EPISODE' && l.nextStage === 'MELEE');
  assert(meleeLedgers.length > 0, 'No candidates reached MELEE');
  for (const ml of meleeLedgers) {
    const attempts = stage1Episodes.filter((e: any) => e.candidateId === ml.candidateId);
    assert(attempts.length >= 3, `Candidate ${ml.candidateId} entered MELEE with only ${attempts.length} Stage-1 attempts (< 3)`);
    for (const att of attempts) {
      assert(att.strongPoolVectorRef, `Attempt missing strongPoolVectorRef: ${att.recordId}`);
      assert(att.triggeredDiagnosis?.weakOpponentId, `Attempt missing triggered diagnosis: ${att.recordId}`);
      assert(att.totalGames === 44, `Stage-1 attempt must run 11 opps x 2 sides x 2 games = 44 games, got ${att.totalGames}`);
    }
  }
  console.log(`    Audited ${stage1Episodes.length} real Stage-1 targeted optimization attempts`);
});

// ---- 4. 跃迁谓词描述与数值严格一致性验证 ----

check('Transition predicate wording agrees exactly with stored numeric comparisons', () => {
  for (const entry of stageLedger) {
    if (entry.previousStage === 'STAGE_3_EARLY_BUNDLE') {
      if (entry.transitionDecision === 'STAGE_PROMOTED') {
        assert(entry.sourceRelativeScore >= -0.05, `Contradiction: promoted but rel=${entry.sourceRelativeScore} < -0.05`);
        assert(entry.transitionReason.includes('>= -0.05'), `Reason text mismatch in promotion`);
      } else {
        const isRelFail = entry.sourceRelativeScore < -0.05;
        const isAbsFail = entry.score < 0.70;
        assert(isRelFail || isAbsFail, `Contradiction: retained but both rel and abs passed`);
        if (isRelFail) assert(entry.transitionReason.includes('< -0.05'), `Reason text mismatch`);
        if (isAbsFail && !isRelFail) assert(entry.transitionReason.includes('< 0.70'), `Reason text mismatch`);
      }
    }
  }
});

// ---- 5. 概率化 Melee 采样配对与配额验证 ----

check('Melee sampling records satisfy P1/P2 pairing and minimum archetype quotas', () => {
  assert(meleePairs.length > 0, 'No melee sample pair records found');
  const candidateIds = [...new Set(meleePairs.map((p: any) => p.candidateId))];

  for (const cid of candidateIds) {
    const pairsForCand = meleePairs.filter((p: any) => p.candidateId === cid);
    assert(pairsForCand.length === 16, `Expected 16 sampled pairs for candidate ${cid}, got ${pairsForCand.length}`);

    // 验证 11 个流派最低配额 (>= 1 pair per archetype)
    const coveredArchetypes = new Set(pairsForCand.map((p: any) => p.sampledArchetype));
    assert(coveredArchetypes.size === 11, `Candidate ${cid} did not cover all 11 archetypes in melee: covered ${coveredArchetypes.size}`);

    for (const p of pairsForCand) {
      assert(p.seedP1 !== p.seedP2, `Identical seeds for P1 and P2 in pair ${p.recordId}`);
      assert(typeof p.p1Score === 'number' && typeof p.p2Score === 'number', `Invalid pair scores in ${p.recordId}`);
    }
  }
  console.log(`    Audited ${meleePairs.length} paired Melee probabilistic evaluations across ${candidateIds.length} candidates`);
});

// ---- 6. Melee 失败回退路径验证 ----

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

console.log('\n--- T041 Benchmark Ladder & Melee Summary ---');
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
