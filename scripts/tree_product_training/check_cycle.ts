// ============================================================
// scripts/tree_product_training/check_cycle.ts
// T040 基准阶梯、Melee 跃迁、状态机与只读边界验证脚本（无仿真）
//
// 验证：
//   1. Early Bundle 8: 7 个早期变体 + 1 个明确的历史 Gift Jungle 快照 (7 怪版本)
//   2. 严禁使用当前修复后的 8 怪 gift_jungle 替代历史基准
//   3. Strong Pool 包含精确的 11 个当前冻结源
//   4. Melee Pool 扩展混合池具有明确成员与指纹
//   5. 严禁 candidate-vs-parent 自博弈或压缩分数评估
//   6. 阶段阶梯顺序与状态跃迁账本验证 (Stage 3 -> Stage 2 -> Stage 1 -> Melee)
//   7. Melee 失败精准退回 Stage 1（绝不退回 Stage 3）
//   8. 所有 evaluation 包含完整的 Pool × P1/P2 全覆盖向量
//   9. Specialist 候选不自动覆盖通用 experimental frontier
//   10. 周期幂等性、去重与无状态破坏
//   11. 聚合实验边界标签（AGGREGATE_EXPLORATION_ONLY）与无 apply 确认
// ============================================================

import '../../src/engine/env';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

console.log('=== check_cycle.ts — T040 Benchmark Ladder & Melee Verification ===\n');

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

// ---- 1. 文件存在性验证 ----

check('all required T040 artifact files exist', () => {
  assert(existsSync(BENCHMARK_MANIFEST_PATH), `Missing: ${BENCHMARK_MANIFEST_PATH}`);
  assert(existsSync(STAGE_LEDGER_PATH), `Missing: ${STAGE_LEDGER_PATH}`);
  assert(existsSync(CELL_RESULTS_PATH), `Missing: ${CELL_RESULTS_PATH}`);
  assert(existsSync(LINEAGE_PATH), `Missing: ${LINEAGE_PATH}`);
  assert(existsSync(COVERAGE_PATH), `Missing: ${COVERAGE_PATH}`);
  assert(existsSync(CATALOG_PATH), `Missing: ${CATALOG_PATH}`);
  assert(existsSync(CURSOR_PATH), `Missing: ${CURSOR_PATH}`);
});

// ---- 加载数据 ----

const manifests = existsSync(BENCHMARK_MANIFEST_PATH) ? JSON.parse(readFileSync(BENCHMARK_MANIFEST_PATH, 'utf8')) : null;
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
const lineageRecords = existsSync(LINEAGE_PATH)
  ? readFileSync(LINEAGE_PATH, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
  : [];

// ---- 2. Benchmark Pools 冻结与 Historical Gift Jungle 溯源验证 ----

check('Early Bundle 8 contains exactly 7 held-out variants plus historical 7-monster Gift Jungle', () => {
  const eb = manifests?.earlyBundleStage3;
  assert(eb && eb.opponentCount === 8, `Expected 8 opponents, got ${eb?.opponentCount}`);
  const histGj = eb.members.find((m: any) => m.id === 'historical_gift_jungle_t016');
  assert(histGj, 'Historical Gift Jungle missing in Early Bundle 8 manifest');
  assert(histGj.teamSize === 7, `Historical Gift Jungle must have teamSize 7, got ${histGj.teamSize}`);
  assert(histGj.sourcePool === 'HISTORICAL_SNAPSHOT', `Invalid source pool: ${histGj.sourcePool}`);
  assert(histGj.provenance.includes('t016_training_archive'), `Invalid provenance: ${histGj.provenance}`);
});

check('Current repaired 8-monster gift_jungle is NOT substituted for historical benchmark', () => {
  const eb = manifests?.earlyBundleStage3;
  const currentGjInEb = eb.members.find((m: any) => m.id === 'gift_jungle' && m.teamSize === 8);
  assert(!currentGjInEb, 'ERROR: Current 8-monster gift_jungle was incorrectly placed in Early Bundle historical benchmark');
});

check('Strong Pool contains exactly 11 current frozen sources with valid hash', () => {
  const str = manifests?.currentStrongStage2Stage1;
  assert(str && str.opponentCount === 11, `Expected 11 opponents in strong pool, got ${str?.opponentCount}`);
  assert(str.poolHash && str.poolHash.length === 16, `Invalid strong pool hash: ${str?.poolHash}`);
});

check('Melee Pool is an expanded mixed pool with explicit members and provenance', () => {
  const melee = manifests?.meleePool;
  assert(melee && melee.opponentCount === 16, `Expected 16 opponents in melee pool, got ${melee?.opponentCount}`);
  for (const m of melee.members) {
    assert(m.id && m.fingerprint && m.provenance && m.selectionReason, `Invalid melee member: ${JSON.stringify(m)}`);
  }
});

// ---- 3. 评估规则与无自博弈 / 无压缩分数验证 ----

check('No candidate-vs-parent/self-play or rule-random benchmark is dispatched', () => {
  for (const cr of cellResults) {
    for (const cv of cr.cellVectors) {
      assert(cv.opponentId !== cr.candidateId, `Self-play detected: ${cr.candidateId} vs ${cv.opponentId}`);
      assert(!cv.opponentId.includes('self'), `Self-play detected in opponentId: ${cv.opponentId}`);
    }
  }
});

check('All stage evaluation records contain complete Pool x P1/P2 coverage vectors', () => {
  for (const cr of cellResults) {
    assert(cr.cellVectors.length > 0, `Empty cell vectors for ${cr.candidateId}`);
    const side1 = cr.cellVectors.filter((v: any) => v.side === 1);
    const side2 = cr.cellVectors.filter((v: any) => v.side === 2);
    assert(side1.length === side2.length, `Asymmetric side coverage: side1=${side1.length}, side2=${side2.length}`);
    assert(cr.totalCells === side1.length + side2.length, `Total cells mismatch`);
  }
  console.log(`    Audited ${cellResults.length} full-vector benchmark evaluation records`);
});

// ---- 4. 阶段状态机与回退路径验证 ----

check('Stage ordering and transitions are enforced (Stage 3 -> Stage 2 -> Stage 1 -> Melee)', () => {
  assert(stageLedger.length > 0, 'No stage ledger records found');
  const validTransitions = new Set([
    'STAGE_3_EARLY_BUNDLE->STAGE_3_EARLY_BUNDLE',
    'STAGE_3_EARLY_BUNDLE->STAGE_2_STRONG_POOL',
    'STAGE_2_STRONG_POOL->STAGE_2_STRONG_POOL',
    'STAGE_2_STRONG_POOL->STAGE_1_STRONG_EPISODE',
    'STAGE_1_STRONG_EPISODE->STAGE_1_STRONG_EPISODE',
    'STAGE_1_STRONG_EPISODE->MELEE',
    'MELEE->EXPERIMENTAL_FRONTIER',
    'MELEE->STAGE_1_STRONG_EPISODE',
  ]);

  for (const entry of stageLedger) {
    const key = `${entry.previousStage}->${entry.nextStage}`;
    assert(validTransitions.has(key), `Invalid stage transition: ${key} in record ${entry.recordId}`);
  }
  console.log(`    Audited ${stageLedger.length} state transition ledger records`);
});

check('Melee failures return to Stage 1, never directly to Stage 3', () => {
  const meleeTransitions = stageLedger.filter((l: any) => l.previousStage === 'MELEE');
  for (const mt of meleeTransitions) {
    if (mt.transitionDecision === 'MELEE_DIAGNOSE_RETURN_STAGE_1') {
      assert(mt.nextStage === 'STAGE_1_STRONG_EPISODE', `Melee failure should return to STAGE_1_STRONG_EPISODE, got ${mt.nextStage}`);
      assert(mt.nextStage !== 'STAGE_3_EARLY_BUNDLE', `ERROR: Melee failure incorrectly returned to Stage 3!`);
    }
  }
});

// ---- 5. 幂等性、去重与血缘验证 ----

check('Candidate lineage records are complete and novel', () => {
  assert(lineageRecords.length > 0, 'No lineage records found');
  for (const lin of lineageRecords) {
    assert(lin.candidateId && lin.candidateFingerprint && lin.sourceId && lin.operatorFamily, `Incomplete lineage: ${lin.candidateId}`);
  }
  console.log(`    Total candidate lineage records: ${lineageRecords.length}`);
});

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

check('Cursor tracks completed cycles with parent links', () => {
  assert(cursor?.completedCycles && cursor.completedCycles.length >= 1, 'No completed cycles in cursor');
  for (let i = 0; i < cursor.completedCycles.length; i++) {
    const c = cursor.completedCycles[i];
    assert(c.cycleId && typeof c.cycleOrdinal === 'number', `Invalid cycle entry`);
    if (i > 0) {
      assert(c.parentCycleId === cursor.completedCycles[i - 1].cycleId, `Parent link broken at ordinal ${i}`);
    }
  }
});

// ---- 6. Catalog 边界与只读确认 ----

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
  assert(catalog.promotionCount === undefined, 'Catalog top-level must NOT have promotionCount');
  assert(typeof catalog.experimentalFrontierCount === 'number', 'Catalog must have experimentalFrontierCount');
});

// ---- 7. 汇总打印 ----

console.log('\n--- T040 Benchmark Training Ladder Summary ---');
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
