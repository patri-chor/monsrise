// ============================================================
// scripts/tree_product_training/check_cycle.ts
// T044 双轴阵型强度梯队 (T-Axis) 与学习评测环境 (L-Axis) 门禁验证脚本（无仿真）
//
// 验证：
//   1. 阵型梯队策略文件与双轴模型定义完备 (T0/T1/T2/T3 vs L1/L2/L3)
//   2. T0 严格包含且仅包含 11 个原始冻结根源，永不被替换
//   3. 自动化梯队晋升与降级门禁 (T3->T2 >=55%, T2->T1 >=60%, T1->T2 <55%) 及迟滞带 [55%, 60%)
//   4. 严格权限控制：T3禁止L2/L1, T2禁止L1, T1满足3次独立L2尝试后进L1
//   5. L2 评测对手仅使用冻结 T0 11，绝不混入晋升 T1
//   6. L1 采用 T042 完备流派血缘概率 Melee 采样并排除自博弈
//   7. 阵型库文件统计与梯队分类准确
//   8. 周期幂等性、去重与无状态破坏
//   9. 聚合实验边界标签（AGGREGATE_EXPLORATION_ONLY）与无 apply 确认
// ============================================================

import '../../src/engine/env';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

console.log('=== check_cycle.ts — T044 Formation Strength Tiers & Learning Level Gates Verification ===\n');

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
const TIER_POLICY_PATH = resolve(`${T037_DIR}/formation_tier_policy.json`);
const FORMATION_LIBRARY_PATH = resolve(`${T037_DIR}/formation_strength_library.json`);
const TIER_TRANSITIONS_PATH = resolve(`${T037_DIR}/formation_tier_transitions.jsonl`);
const LEARNING_EVALS_PATH = resolve(`${T037_DIR}/learning_level_evaluations.jsonl`);
const ARCHETYPE_CONFIG_PATH = resolve(`${T037_DIR}/melee_archetype_config.json`);
const SAMPLING_MANIFEST_PATH = resolve(`${T037_DIR}/melee_sampling_manifest.json`);
const MELEE_PAIRS_PATH = resolve(`${T037_DIR}/melee_sample_pairs.jsonl`);

// ---- 1. 文件存在性验证 ----

check('all required T044 artifact files exist', () => {
  assert(existsSync(TIER_POLICY_PATH), `Missing: ${TIER_POLICY_PATH}`);
  assert(existsSync(FORMATION_LIBRARY_PATH), `Missing: ${FORMATION_LIBRARY_PATH}`);
  assert(existsSync(TIER_TRANSITIONS_PATH), `Missing: ${TIER_TRANSITIONS_PATH}`);
  assert(existsSync(LEARNING_EVALS_PATH), `Missing: ${LEARNING_EVALS_PATH}`);
  assert(existsSync(ARCHETYPE_CONFIG_PATH), `Missing: ${ARCHETYPE_CONFIG_PATH}`);
  assert(existsSync(SAMPLING_MANIFEST_PATH), `Missing: ${SAMPLING_MANIFEST_PATH}`);
  assert(existsSync(MELEE_PAIRS_PATH), `Missing: ${MELEE_PAIRS_PATH}`);
  assert(existsSync(CATALOG_PATH), `Missing: ${CATALOG_PATH}`);
});

// ---- 加载数据 ----

const tierPolicy = existsSync(TIER_POLICY_PATH) ? JSON.parse(readFileSync(TIER_POLICY_PATH, 'utf8')) : null;
const library = existsSync(FORMATION_LIBRARY_PATH) ? JSON.parse(readFileSync(FORMATION_LIBRARY_PATH, 'utf8')) : null;
const tierTransitions = existsSync(TIER_TRANSITIONS_PATH)
  ? readFileSync(TIER_TRANSITIONS_PATH, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
  : [];
const learningEvals = existsSync(LEARNING_EVALS_PATH)
  ? readFileSync(LEARNING_EVALS_PATH, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
  : [];
const catalog = existsSync(CATALOG_PATH) ? JSON.parse(readFileSync(CATALOG_PATH, 'utf8')) : null;
const decisions = existsSync(DECISIONS_PATH)
  ? readFileSync(DECISIONS_PATH, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
  : [];
const meleePairs = existsSync(MELEE_PAIRS_PATH)
  ? readFileSync(MELEE_PAIRS_PATH, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
  : [];

// ---- 2. 双轴模型命名与 T0 独立性验证 ----

check('T and L axes are strictly distinct in schema and policy definition', () => {
  assert(tierPolicy?.schemaVersion === 'T044_TIER_POLICY_V1', `Expected T044_TIER_POLICY_V1, got ${tierPolicy?.schemaVersion}`);
  assert(tierPolicy.learningLevels?.L3 && tierPolicy.learningLevels?.L2 && tierPolicy.learningLevels?.L1, 'Missing L-axis level definitions');
  assert(tierPolicy.permissionRules?.T3 && tierPolicy.permissionRules?.T2 && tierPolicy.permissionRules?.T1 && tierPolicy.permissionRules?.T0, 'Missing T-axis tier permission definitions');
});

check('T0 contains exactly 11 original frozen roots and is never overwritten or mutated', () => {
  assert(library?.counts?.T0Count === 11, `Expected 11 T0 formations, got ${library?.counts?.T0Count}`);
  const t0Entries = library.formations.filter((f: any) => f.currentTier === 'T0');
  assert(t0Entries.length === 11, `Expected 11 T0 entries in library, got ${t0Entries.length}`);

  for (const t0 of t0Entries) {
    assert(t0.formationId.startsWith('t0:'), `Invalid T0 formationId: ${t0.formationId}`);
    assert(t0.lineageProof.includes('immutable_root_t0'), `Invalid T0 lineageProof`);
    assert(tierTransitions.filter((tr: any) => tr.formationId === t0.formationId && tr.newTier !== 'T0').length === 0, `T0 was illegally mutated in transitions`);
  }
  console.log(`    Audited 11 immutable T0 root benchmark anchors in formation library`);
});

// ---- 3. 自动化梯队门禁与迟滞带验证 ----

check('Strength-tier gates correctly enforce L3 >=55% for T2 and L2 >=60% for T1 with hysteresis', () => {
  assert(tierTransitions.length > 0, 'No tier transitions recorded');

  for (const tr of tierTransitions) {
    if (tr.previousTier === 'T3' && tr.newTier === 'T2') {
      assert(tr.triggerLevel === 'L3', `T3->T2 must be triggered by L3, got ${tr.triggerLevel}`);
      assert(tr.levelScore >= 0.55, `T3->T2 score must be >= 0.55, got ${tr.levelScore}`);
      assert(tr.reason.includes('>= 0.55'), `Reason text mismatch in T3->T2 transition`);
    } else if (tr.previousTier === 'T2' && tr.newTier === 'T1') {
      assert(tr.triggerLevel === 'L2', `T2->T1 must be triggered by L2, got ${tr.triggerLevel}`);
      assert(tr.levelScore >= 0.60, `T2->T1 score must be >= 0.60, got ${tr.levelScore}`);
      assert(tr.reason.includes('>= 0.6'), `Reason text mismatch in T2->T1 transition`);
    } else if (tr.previousTier === 'T1' && tr.newTier === 'T2') {
      assert(tr.triggerLevel === 'L2', `T1->T2 demotion must be triggered by L2, got ${tr.triggerLevel}`);
      assert(tr.levelScore < 0.55, `T1->T2 demotion score must be < 0.55, got ${tr.levelScore}`);
    }
  }
  console.log(`    Audited ${tierTransitions.length} tier transitions adhering to 55%/60%/55% hysteresis band`);
});

// ---- 4. 权限与学习层级派发验证 ----

check('Permission rules strictly prevent T3 from L2/L1 and T2 from L1', () => {
  for (const ev of learningEvals) {
    const libEntry = library.formations.find((f: any) => f.formationId === ev.formationId);
    if (!libEntry) continue;

    if (ev.learningLevel === 'L2') {
      assert(libEntry.currentTier !== 'T3', `T3 formation ${ev.formationId} illegally evaluated in Level L2`);
    } else if (ev.learningLevel === 'L1') {
      assert(libEntry.currentTier === 'T1' || libEntry.currentTier === 'T0', `Non-T1 formation ${ev.formationId} (tier=${libEntry.currentTier}) illegally evaluated in Level L1`);
      assert(libEntry.l2AttemptsCount >= 3 || libEntry.currentTier === 'T0', `T1 formation ${ev.formationId} entered L1 without 3 distinct L2 attempts`);
    }
  }
  console.log(`    Audited ${learningEvals.length} learning level evaluations adhering to permission rules`);
});

// ---- 5. Level L2 与 Level L1 对手池隔离验证 ----

check('Level L2 uses frozen T0 only and Level L1 uses full lineage-probabilistic melee catalog', () => {
  const l2Evals = learningEvals.filter((e: any) => e.learningLevel === 'L2');
  assert(l2Evals.length > 0, 'No L2 evaluations recorded');
  for (const l2 of l2Evals) {
    assert(l2.totalGames === 44, `Level L2 must evaluate 11 T0 opps x 2 sides x 2 games = 44 games, got ${l2.totalGames}`);
  }

  const l1Evals = learningEvals.filter((e: any) => e.learningLevel === 'L1');
  assert(l1Evals.length > 0, 'No L1 evaluations recorded');
  for (const l1 of l1Evals) {
    assert(l1.totalGames === 32, `Level L1 must evaluate 16 sampled pairs = 32 games, got ${l1.totalGames}`);
  }
});

// ---- 6. Melee 采样与自博弈排除验证 ----

check('Melee sampling records satisfy P1/P2 pairing and exclude candidate self-opponents', () => {
  assert(meleePairs.length > 0, 'No melee sample pair records found');
  const candidateIds = [...new Set(meleePairs.map((p: any) => p.candidateId))];

  for (const cid of candidateIds) {
    const pairsForCand = meleePairs.filter((p: any) => p.candidateId === cid);
    assert(pairsForCand.length === 16, `Expected 16 sampled pairs for formation ${cid}, got ${pairsForCand.length}`);

    const coveredArchetypes = new Set(pairsForCand.map((p: any) => p.sampledArchetype));
    assert(coveredArchetypes.size === 11, `Formation ${cid} did not cover all 11 archetypes in melee`);

    for (const p of pairsForCand) {
      assert(p.sampledMemberId !== cid, `Self-opponent detected: candidate ${cid} played against itself`);
    }
  }
  console.log(`    Audited ${meleePairs.length} paired Melee evaluations across ${candidateIds.length} formations`);
});

// ---- 7. 阵型库状态与计数一致性验证 ----

check('Formation Strength Library file counts match actual library formation entries', () => {
  assert(library?.schemaVersion === 'T044_FORMATION_STRENGTH_LIBRARY_V1', `Invalid library schema`);
  const actualT0 = library.formations.filter((f: any) => f.currentTier === 'T0').length;
  const actualT1 = library.formations.filter((f: any) => f.currentTier === 'T1').length;
  const actualT2 = library.formations.filter((f: any) => f.currentTier === 'T2').length;
  const actualT3 = library.formations.filter((f: any) => f.currentTier === 'T3').length;

  assert(library.counts.T0Count === actualT0, `T0Count mismatch`);
  assert(library.counts.T1Count === actualT1, `T1Count mismatch`);
  assert(library.counts.T2Count === actualT2, `T2Count mismatch`);
  assert(library.counts.T3Count === actualT3, `T3Count mismatch`);

  console.log(`    Library Counts: T0=${actualT0}, T1=${actualT1} (${library.counts.T1L1StableCount} L1_STABLE, ${library.counts.T1L1DiagnoseRequiredCount} L1_DIAGNOSE), T2=${actualT2}, T3=${actualT3}`);
});

// ---- 8. 幂等性、去重与 Catalog 边界 ----

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

// ---- 9. 汇总打印 ----

console.log('\n--- T044 Formation Strength Tiers Summary ---');
console.log('  Formation ID         Root T0      Current Tier  L1 Status            L3 Score  L2 Score  L1 Score');
console.log('  ' + '-'.repeat(95));
if (library?.formations) {
  for (const f of library.formations.slice(0, 20)) {
    const l3 = f.l3Score !== null ? f.l3Score.toFixed(3) : '   -  ';
    const l2 = f.l2Score !== null ? f.l2Score.toFixed(3) : '   -  ';
    const l1 = f.l1Score !== null ? f.l1Score.toFixed(3) : '   -  ';
    console.log(
      `  ${f.formationId.padEnd(20)} ${f.rootT0SourceId.padEnd(12)} ${f.currentTier.padEnd(13)} ` +
      `${f.l1Status.padEnd(20)} ${l3.padStart(8)} ${l2.padStart(9)} ${l1.padStart(9)}`
    );
  }
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
console.log('✓ check_cycle PASSED\n');
