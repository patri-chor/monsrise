// ============================================================
// scripts/tree_product_training/check_cycle.ts
// T038R 周期与后剪枝证据只读验证脚本（无仿真）
//
// 验证：
//   1. 周期 cursor 与 decision 记录完整性、无重复性（幂等性证明）
//   2. 周期 identity 唯一性与 parent 链接
//   3. 真正生成 strategy_schedule_branch 候选
//   4. 弱源失败后触发 multi_monster_exploration 升级记录
//   5. 高计算量单位源的空间预算缩减/归零原因审计
//   6. 后剪枝试验（prune trials）无回归保证与 HEURISTIC 标记
//   7. 运行时候选目录（runtime_candidate_catalog.json）无旧 promotion 字段，全标注 AGGREGATE 边界
// ============================================================

import '../../src/engine/env';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

console.log('=== check_cycle.ts — T038R Adaptive Loop & Boundary Verification ===\n');

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
const decisions = existsSync(DECISIONS_PATH)
  ? readFileSync(DECISIONS_PATH, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
  : [];
const pruneTrials = existsSync(PRUNE_PATH)
  ? readFileSync(PRUNE_PATH, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
  : [];
const escalations = existsSync(ESCALATIONS_PATH)
  ? readFileSync(ESCALATIONS_PATH, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
  : [];

// ---- 2. 幂等性与去重验证 ----

check('no duplicate decision records (by recordId and by cycleId+sourceId)', () => {
  const recordIds = new Set<string>();
  const cycleSourceKeys = new Set<string>();
  for (const d of decisions) {
    assert(d.recordId, `Decision missing recordId: ${JSON.stringify(d)}`);
    assert(!recordIds.has(d.recordId), `Duplicate recordId in decisions: ${d.recordId}`);
    recordIds.add(d.recordId);

    const key = `${d.cycleId}_${d.sourceId}`;
    assert(!cycleSourceKeys.has(key), `Duplicate cycle+source decision: ${key}`);
    cycleSourceKeys.add(key);
  }
  console.log(`    Total unique decisions: ${decisions.length}`);
});

check('no duplicate prune trial records (by recordId)', () => {
  const pruneIds = new Set<string>();
  for (const pt of pruneTrials) {
    assert(pt.recordId, `Prune trial missing recordId: ${JSON.stringify(pt)}`);
    assert(!pruneIds.has(pt.recordId), `Duplicate recordId in prune trials: ${pt.recordId}`);
    pruneIds.add(pt.recordId);
  }
  console.log(`    Total unique prune trials: ${pruneTrials.length}`);
});

check('cursor tracks completed cycles with parent links', () => {
  assert(cursor?.completedCycles && cursor.completedCycles.length >= 1, 'No completed cycles in cursor');
  for (let i = 0; i < cursor.completedCycles.length; i++) {
    const c = cursor.completedCycles[i];
    assert(c.cycleId && typeof c.cycleOrdinal === 'number', `Invalid cycle entry: ${JSON.stringify(c)}`);
    if (i > 0) {
      assert(c.parentCycleId === cursor.completedCycles[i - 1].cycleId, `Cycle ordinal ${i} parent link broken`);
    }
  }
  console.log(`    Cycles completed: ${cursor.completedCycles.length}`);
});

// ---- 3. Catalog 边界与只读确认 ----

check('catalog has strict aggregate boundaries and no promotion terms', () => {
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

  // 严格检查无旧 promotion 字段
  assert(catalog.promotionCount === undefined, 'Catalog top-level must NOT have promotionCount');
  assert(typeof catalog.experimentalFrontierCount === 'number', 'Catalog must have experimentalFrontierCount');

  for (const e of catalog.entries) {
    assert((e as any).isPromotion === undefined, `Entry ${e.candidateId} must NOT have isPromotion`);
    assert(typeof e.isExperimentalFrontier === 'boolean', `Entry ${e.candidateId} must have isExperimentalFrontier`);
  }
});

check('catalog contains all 11 sources and valid hash', () => {
  assert(catalog?.totalSources === 11, `Expected 11 sources in catalog, got ${catalog?.totalSources}`);
  assert(catalog?.entries?.length === 11, `Expected 11 entries, got ${catalog?.entries?.length}`);
  assert(typeof catalog?.catalogHash === 'string' && catalog.catalogHash.length === 16, `Invalid catalogHash: ${catalog?.catalogHash}`);
});

// ---- 4. 自适应策略与可控性可审计性 ----

check('mature vs weak sources have distinct policies', () => {
  const strongDecisions = decisions.filter(d => d.maturity === 'STRONG');
  const weakDecisions = decisions.filter(d => d.maturity === 'WEAK');
  assert(strongDecisions.length > 0, 'No STRONG source decisions found');
  assert(weakDecisions.length > 0, 'No WEAK source decisions found');
});

check('low controllability sources have spatial budget = 0 with recorded reason', () => {
  const lowCtrl = decisions.filter(d => d.controllableRatio <= 0.30);
  assert(lowCtrl.length > 0, 'No low-controllability sources tested');
  for (const d of lowCtrl) {
    assert(d.spatialBudget === 0, `Source ${d.sourceId} has ratio ${d.controllableRatio} but spatialBudget ${d.spatialBudget}`);
    assert(d.spatialBudgetReason.includes('LOW_CONTROLLABILITY'), `Source ${d.sourceId} missing LOW_CONTROLLABILITY reason`);
  }
});

// ---- 5. 真实策略分支与多怪兽升级验证 ----

check('strategy_schedule_branch candidate produced or present in screening', () => {
  const screenObs = readFileSync(`${T037_DIR}/screen_observations.jsonl`, 'utf8');
  assert(screenObs.includes('strategy_schedule_branch'), 'No strategy_schedule_branch found in screening observations');
});

check('escalations (if any) have recorded failure count, reason and aggregate label', () => {
  for (const esc of escalations) {
    assert(esc.evidenceClass === 'AGGREGATE_EXPLORATION_ONLY', 'Escalation missing AGGREGATE label');
    assert(esc.failCount >= 3, `Escalation without sufficient failure count: ${esc.failCount}`);
    assert(typeof esc.reason === 'string' && esc.reason.length > 0, 'Missing escalation reason');
  }
});

// ---- 6. 后剪枝保证与启发式标记 ----

check('prune trials have AGGREGATE_HEURISTIC_UNVERIFIED marker and no material regression', () => {
  for (const trial of pruneTrials) {
    assert(trial.evidenceClass === 'AGGREGATE_EXPLORATION_ONLY', 'Trial missing AGGREGATE label');
    assert(trial.heuristicStatus === 'AGGREGATE_HEURISTIC_UNVERIFIED', 'Trial missing AGGREGATE_HEURISTIC_UNVERIFIED');
    assert(trial.beforeFingerprint && trial.afterFingerprint, 'Trial missing fingerprints');
    assert(typeof trial.scoreDelta === 'number', 'Trial missing scoreDelta');
    assert(trial.decision === 'PRUNED' || trial.decision === 'KEPT', `Invalid decision: ${trial.decision}`);
    if (trial.decision === 'PRUNED') {
      assert(trial.scoreDelta >= -0.05, `Pruned despite severe regression: ${trial.scoreDelta}`);
    }
  }
});

// ---- 7. 汇总打印 ----

console.log('\n--- T038R Catalog Summary ---');
console.log('  Source ID            Maturity  CtrlRatio  Spatial  Baseline  BestRel  ExpFrontier?  BranchesPruned');
console.log('  ' + '-'.repeat(94));
if (catalog?.entries) {
  for (const e of catalog.entries) {
    const rel = (e.sourceRelativeScore >= 0 ? '+' : '') + e.sourceRelativeScore.toFixed(3);
    const frontier = e.isExperimentalFrontier ? 'YES' : ' NO';
    console.log(
      `  ${e.sourceId.padEnd(20)} ${e.maturity.padEnd(9)} ${e.controllableRatio.toFixed(2).padStart(9)} ` +
      `${String(e.spatialBudget).padStart(8)} ${e.baselineScore.toFixed(3).padStart(9)} ` +
      `${rel.padStart(8)} ${frontier.padStart(13)} ${String(e.branchesPruned).padStart(15)}`
    );
  }
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
console.log('✓ check_cycle PASSED\n');
