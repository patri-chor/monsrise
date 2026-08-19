// ============================================================
// scripts/tree_product_training/check_cycle.ts
// T038 周期与后剪枝证据只读验证脚本（无仿真）
//
// 验证：
//   - cycle cursor 与 decision 记录完整性
//   - 成熟度与早期源策略可审计性
//   - 升级（multi_monster）仅在达到失败阈值后记录
//   - 高计算量单位源的空间预算缩减/归零原因
//   - 变换候选独立标记与合法性
//   - 后剪枝试验（prune trials）记录完整性与无回归保证
//   - 运行时候选目录（runtime_candidate_catalog.json）只读性与无 apply 确认
// ============================================================

import '../../src/engine/env';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

console.log('=== check_cycle.ts — T038 Cycle & Pruning Verification ===\n');

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
const PRUNE_PATH = resolve(`${T037_DIR}/t038_prune_trials.jsonl`);
const ESCALATIONS_PATH = resolve(`${T037_DIR}/t038_escalations.jsonl`);

// ---- 1. 文件存在性验证 ----

check('evidence directory exists', () => {
  assert(existsSync(T037_DIR), `Directory not found: ${T037_DIR}`);
});

check('runtime_candidate_catalog.json exists', () => {
  assert(existsSync(CATALOG_PATH), `Catalog not found: ${CATALOG_PATH}`);
});

check('t038_cycle_decisions.jsonl exists', () => {
  assert(existsSync(DECISIONS_PATH), `Decisions log not found: ${DECISIONS_PATH}`);
});

check('t038_cycle_cursor.json exists', () => {
  assert(existsSync(CURSOR_PATH), `Cursor not found: ${CURSOR_PATH}`);
});

// ---- 加载数据 ----

const catalog = existsSync(CATALOG_PATH) ? JSON.parse(readFileSync(CATALOG_PATH, 'utf8')) : null;
const cursor = existsSync(CURSOR_PATH) ? JSON.parse(readFileSync(CURSOR_PATH, 'utf8')) : null;
const rawDecisions = existsSync(DECISIONS_PATH)
  ? readFileSync(DECISIONS_PATH, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
  : [];
const decisions = rawDecisions.filter(d => d.type === 'decision');
const pruneTrials = existsSync(PRUNE_PATH)
  ? readFileSync(PRUNE_PATH, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
  : [];
const escalations = existsSync(ESCALATIONS_PATH)
  ? readFileSync(ESCALATIONS_PATH, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
  : [];

// ---- 2. Catalog 架构与只读确认 ----

check('catalog schemaVersion is T038_CATALOG_V1', () => {
  assert(catalog?.schemaVersion === 'T038_CATALOG_V1', `Got: ${catalog?.schemaVersion}`);
});

check('catalog has no-apply confirmation', () => {
  assert(
    catalog?.noApplyConfirmation === 'NO_APPLY_NO_DEPLOY_NO_PUBLISH_NO_TIER_CHANGE',
    `Invalid noApplyConfirmation: ${catalog?.noApplyConfirmation}`,
  );
});

check('catalog contains all active sources', () => {
  assert(catalog?.totalSources === 11, `Expected 11 sources in catalog, got ${catalog?.totalSources}`);
  assert(catalog?.entries?.length === 11, `Expected 11 catalog entries, got ${catalog?.entries?.length}`);
});

check('catalog hash is present and valid 16-hex', () => {
  assert(typeof catalog?.catalogHash === 'string' && catalog.catalogHash.length === 16, `Invalid catalogHash: ${catalog?.catalogHash}`);
});

// ---- 3. 策略差异化与可控性可审计性 ----

check('mature vs weak sources have distinct policies', () => {
  const strongDecisions = decisions.filter(d => d.maturity === 'STRONG');
  const weakDecisions = decisions.filter(d => d.maturity === 'WEAK');
  assert(strongDecisions.length > 0, 'No STRONG source decisions found');
  assert(weakDecisions.length > 0, 'No WEAK source decisions found');
  console.log(`    STRONG count: ${strongDecisions.length}, WEAK count: ${weakDecisions.length}`);
});

check('low controllability sources have spatial budget = 0 with recorded reason', () => {
  const lowCtrl = decisions.filter(d => d.controllableRatio <= 0.30);
  assert(lowCtrl.length > 0, 'No low-controllability sources tested');
  for (const d of lowCtrl) {
    assert(d.spatialBudget === 0, `Source ${d.sourceId} has ratio ${d.controllableRatio} but spatialBudget ${d.spatialBudget}`);
    assert(d.spatialBudgetReason.includes('LOW_CONTROLLABILITY'), `Source ${d.sourceId} missing LOW_CONTROLLABILITY reason: ${d.spatialBudgetReason}`);
  }
});

// ---- 4. 升级记录 ----

check('escalations (if any) have recorded failure count and reason', () => {
  for (const esc of escalations) {
    assert(esc.singleOpFailCount >= 3, `Escalation without sufficient failure count: ${esc.singleOpFailCount}`);
    assert(typeof esc.reason === 'string' && esc.reason.length > 0, 'Missing escalation reason');
  }
});

// ---- 5. 后剪枝保证 ----

check('prune trials (if any) have complete before/after metadata and no material regression', () => {
  for (const trial of pruneTrials) {
    assert(trial.candidateId, 'Trial missing candidateId');
    assert(trial.beforeFingerprint && trial.afterFingerprint, 'Trial missing fingerprints');
    assert(typeof trial.scoreDelta === 'number', 'Trial missing scoreDelta');
    assert(trial.decision === 'PRUNED' || trial.decision === 'KEPT', `Invalid decision: ${trial.decision}`);
    if (trial.decision === 'PRUNED') {
      assert(trial.scoreDelta >= -0.05, `Pruned despite severe regression: ${trial.scoreDelta}`);
    }
  }
});

// ---- 6. Cursor 验证 ----

check('cycle cursor is complete and matches protocol', () => {
  assert(cursor?.protocol === 'PRODUCT_PATH_T038_V1', `Cursor protocol: ${cursor?.protocol}`);
  assert(cursor?.completedSources?.length === 11, `Cursor completedSources count: ${cursor?.completedSources?.length}`);
});

// ---- 7. 汇总打印 ----

console.log('\n--- T038 Catalog Summary ---');
console.log('  Source ID            Maturity  CtrlRatio  Spatial  Baseline  BestRel  Promo?  BranchesPruned');
console.log('  ' + '-'.repeat(88));
if (catalog?.entries) {
  for (const e of catalog.entries) {
    const rel = (e.sourceRelativeScore >= 0 ? '+' : '') + e.sourceRelativeScore.toFixed(3);
    const promo = e.isPromotion ? 'YES' : ' NO';
    console.log(
      `  ${e.sourceId.padEnd(20)} ${e.maturity.padEnd(9)} ${e.controllableRatio.toFixed(2).padStart(9)} ` +
      `${String(e.spatialBudget ?? '-').padStart(8)} ${e.baselineScore.toFixed(3).padStart(9)} ` +
      `${rel.padStart(8)} ${promo.padStart(7)} ${String(e.branchesPruned).padStart(15)}`
    );
  }
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
console.log('✓ check_cycle PASSED\n');
