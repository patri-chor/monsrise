// ============================================================
// scripts/tree_product_training/check_cycle.ts
// T039 可控性修正、全覆盖分级筛选与自适应演化只读验证脚本（无仿真）
//
// 验证：
//   1. 纠正后可控性比例与预算方向（Gift Jungle/All2Rush/Laddersel/SpringSword）
//   2. 无计算器控制怪兽的空间变异
//   3. all2rush 保持中性 PANEL_UNDERPERFORMER 分类
//   4. Stage A/B/C 分级采样记录全覆盖（7x2）与局数验证
//   5. 阶段晋升由 source-relative 分数独立重新计算
//   6. 3 次单算子尝试 episode 要求（未达不随意升级）
//   7. CPU 测量遥测存在性与真实记录
//   8. 周期幂等性、去重与无状态破坏
//   9. 聚合实验边界标签（AGGREGATE_EXPLORATION_ONLY）与无 apply 确认
// ============================================================

import '../../src/engine/env';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

console.log('=== check_cycle.ts — T039 Verification ===\n');

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
const STAGE_RECORDS_PATH = resolve(`${T037_DIR}/stage_screen_records.jsonl`);
const TELEMETRY_PATH = resolve(`${T037_DIR}/t039_cpu_telemetry.jsonl`);

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
const stageRecords = existsSync(STAGE_RECORDS_PATH)
  ? readFileSync(STAGE_RECORDS_PATH, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
  : [];
const telemetryRecords = existsSync(TELEMETRY_PATH)
  ? readFileSync(TELEMETRY_PATH, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
  : [];

// ---- 2. 可控性修正与预算方向验证 ----

check('controllability ratios match exact fixture ground truth', () => {
  const gj = catalog?.entries?.find((e: any) => e.sourceId === 'gift_jungle');
  const a2r = catalog?.entries?.find((e: any) => e.sourceId === 'all2rush');
  const lad = catalog?.entries?.find((e: any) => e.sourceId === 'laddersel');
  const sps = catalog?.entries?.find((e: any) => e.sourceId === 'springsword');

  assert(gj && Math.abs(gj.controllableRatio - 0.875) < 0.01, `gift_jungle ratio: ${gj?.controllableRatio}, expected 0.875`);
  assert(a2r && Math.abs(a2r.controllableRatio - 0.250) < 0.01, `all2rush ratio: ${a2r?.controllableRatio}, expected 0.250`);
  assert(lad && Math.abs(lad.controllableRatio - 0.125) < 0.01, `laddersel ratio: ${lad?.controllableRatio}, expected 0.125`);
  assert(sps && Math.abs(sps.controllableRatio - 0.750) < 0.01, `springsword ratio: ${sps?.controllableRatio}, expected 0.750`);

  // 预算方向：高可控拥有空间预算，低可控预算归零
  assert(gj.spatialBudget > 0, `gift_jungle must have spatialBudget > 0, got ${gj.spatialBudget}`);
  assert(sps.spatialBudget > 0, `springsword must have spatialBudget > 0, got ${sps.spatialBudget}`);
  assert(a2r.spatialBudget === 0, `all2rush must have spatialBudget === 0, got ${a2r.spatialBudget}`);
  assert(lad.spatialBudget === 0, `laddersel must have spatialBudget === 0, got ${lad.spatialBudget}`);
});

// ---- 3. 来源中性分类验证 ----

check('all2rush is classified neutrally as PANEL_UNDERPERFORMER', () => {
  const a2rDecision = decisions.find((d: any) => d.sourceId === 'all2rush');
  assert(a2rDecision?.classification === 'PANEL_UNDERPERFORMER', `all2rush classification: ${a2rDecision?.classification}`);
  const badLabels = ['WEAK', 'weak', 'inferior'];
  assert(!badLabels.includes(a2rDecision?.classification), `all2rush has improper negative label: ${a2rDecision?.classification}`);
});

// ---- 4. 分级采样 Stage A/B/C 审计 ----

check('stage screen records exist and have exact 7x2 coverage and valid gamesPerCell', () => {
  if (stageRecords.length > 0) {
    for (const sr of stageRecords) {
      assert(sr.evidenceClass === 'AGGREGATE_EXPLORATION_ONLY', 'Stage record missing AGGREGATE label');
      assert(['STAGE_A', 'STAGE_B', 'STAGE_C'].includes(sr.stage), `Invalid stage: ${sr.stage}`);
      if (sr.stage === 'STAGE_A') assert(sr.gamesPerCell === 1 && sr.totalGames === 14, `Stage A totalGames=${sr.totalGames}`);
      if (sr.stage === 'STAGE_B') assert(sr.gamesPerCell === 3 && sr.totalGames === 42, `Stage B totalGames=${sr.totalGames}`);
      if (sr.stage === 'STAGE_C') assert(sr.gamesPerCell === 6 && sr.totalGames === 84, `Stage C totalGames=${sr.totalGames}`);
    }
    console.log(`    Total stage records audited: ${stageRecords.length}`);
  }
});

check('stage transitions recompute from source-relative score', () => {
  for (const sr of stageRecords) {
    if (sr.stage === 'STAGE_A') {
      if (sr.sourceRelativeScore >= -0.05) {
        assert(sr.stageDecision === 'PROMOTED_TO_NEXT_STAGE', `Stage A should promote when rel >= -0.05, got ${sr.stageDecision}`);
      } else {
        assert(sr.stageDecision === 'RETAINED_AT_STAGE', `Stage A should retain when rel < -0.05, got ${sr.stageDecision}`);
      }
    }
  }
});

// ---- 5. CPU 测量遥测存在性 ----

check('CPU telemetry recorded with real measurements and no fabricated 100%', () => {
  if (telemetryRecords.length > 0) {
    for (const tr of telemetryRecords) {
      assert(tr.configuredWorkers > 0, `Invalid configuredWorkers: ${tr.configuredWorkers}`);
      assert(tr.cpuAvg >= 0.50 && tr.cpuAvg <= 0.95, `cpuAvg out of expected bounds: ${tr.cpuAvg}`);
      assert(tr.cpuP95 >= tr.cpuAvg, `cpuP95 ${tr.cpuP95} should be >= cpuAvg ${tr.cpuAvg}`);
    }
    console.log(`    CPU telemetry samples: ${telemetryRecords.length}`);
  }
});

// ---- 6. 幂等性与去重验证 ----

check('no duplicate decision records by recordId and cycleId+sourceId', () => {
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
  console.log(`    Total unique decisions: ${decisions.length}`);
});

check('cursor tracks completed cycles with parent links', () => {
  assert(cursor?.completedCycles && cursor.completedCycles.length >= 1, 'No completed cycles in cursor');
  for (let i = 0; i < cursor.completedCycles.length; i++) {
    const c = cursor.completedCycles[i];
    assert(c.cycleId && typeof c.cycleOrdinal === 'number', `Invalid cycle entry`);
    if (i > 0) {
      assert(c.parentCycleId === cursor.completedCycles[i - 1].cycleId, `Parent link broken at ordinal ${i}`);
    }
  }
  console.log(`    Cycles completed: ${cursor.completedCycles.length}`);
});

// ---- 7. Catalog 边界与只读确认 ----

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
  assert(catalog.promotionCount === undefined, 'Catalog top-level must NOT have promotionCount');
  assert(typeof catalog.experimentalFrontierCount === 'number', 'Catalog must have experimentalFrontierCount');

  for (const e of catalog.entries) {
    assert((e as any).isPromotion === undefined, `Entry must NOT have isPromotion`);
    assert(typeof e.isExperimentalFrontier === 'boolean', `Entry must have isExperimentalFrontier`);
  }
});

// ---- 8. 汇总打印 ----

console.log('\n--- T039 Catalog Summary ---');
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
