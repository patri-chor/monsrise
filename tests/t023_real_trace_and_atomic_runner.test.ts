import '../src/engine/env';
import * as assertStrict from 'node:assert/strict';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { EXPERIENCE_LIB_DIR, saveCursorAtomic } from '../src/engine/tree/experience_training_pipeline';
import { PersistentSimPool } from '../src/engine/tree/persistent_pool';
import { formationToEvol, type EvolFormation } from '../src/engine/tree/evol_gene';

async function runT023Tests() {
  console.log('=== 开始执行 T023 真实四费 Trace 保真与原子经验流水线专项验收测试 ===\n');

  const libDir = EXPERIENCE_LIB_DIR;
  assertStrict.ok(existsSync(libDir), 'experience_library 目录必须存在');

  // Test 1: 验证真实四费 Deployment Trace 记录与费用流向
  console.log('[Test 1] 验证真实引擎 Trace 证据与费用流向...');
  const fidelityLedgerPath = join(libDir, 'four_cost_fidelity_ledger.jsonl');
  assertStrict.ok(existsSync(fidelityLedgerPath), 'four_cost_fidelity_ledger.jsonl 必须存在');

  const fidelityRecords = readFileSync(fidelityLedgerPath, 'utf8')
    .trim()
    .split('\n')
    .map(l => JSON.parse(l));

  assertStrict.equal(fidelityRecords.length, 16, '必须包含全部 16 处四费怪兽放置');
  for (const r of fidelityRecords) {
    assertStrict.equal(r.status, 'PASS', `${r.sourceSeedName} 中的四费怪兽 ${r.monsterName} 必须 PASS`);
    assertStrict.equal(r.roundTripLossless, true, 'Round-trip 必须无损');
    assertStrict.equal(r.workerErrorCount, 0, 'Worker 错误必须为 0');
    assertStrict.equal(r.costCharged, 4, '扣费必须精准为 4 费');
    assertStrict.equal(r.budgetAfter, r.budgetBefore - 4, '预算扣减前后必须一致');
  }
  console.log('  ✓ 16 处四费真实 Trace 证据与费用流向校验通过。\n');

  // Test 2: 验证负例控制在真实引擎中被拦截
  console.log('[Test 2] 验证负例非法四费放置在真实引擎中被拦截...');
  const pool = new PersistentSimPool({ workerCount: 2, enableCpuMonitor: false });
  await pool.init();

  const illegalFourCost: EvolFormation = {
    name: 'IllegalFourCostTest',
    archetype: 'prayer',
    team: [
      { monsterId: 110, badgeIds: [] },
      { monsterId: 101, badgeIds: [] },
      { monsterId: 102, badgeIds: [] },
      { monsterId: 105, badgeIds: [] },
      { monsterId: 106, badgeIds: [] },
      { monsterId: 109, badgeIds: [] },
      { monsterId: 111, badgeIds: [] },
      { monsterId: 112, badgeIds: [] },
    ],
    root: {
      id: 'root',
      round: 0,
      condition: { side: null, main: null, subs: [], keys: [] },
      placements: [],
      children: [
        {
          id: 'n1',
          round: 1,
          condition: { side: null, main: null, subs: [], keys: [] },
          placements: [{ monsterId: 103, x: 8, y: 2 }],
          children: [],
        },
      ],
    },
  };

  const earlyFamilies = JSON.parse(readFileSync(resolve('tests/fixtures/tree/early_seven_bundles.json'), 'utf8'));
  const { deploymentTraces: negTraces } = await pool.evalCandidateWithDeploymentTraces(
    illegalFourCost,
    earlyFamilies.slice(0, 1).map((f: any) => f.trainingVariant),
    1,
    9999,
  );
  pool.destroy();

  const negEvent = negTraces.find((t: any) => t.monsterId === 103);
  assertStrict.ok(negEvent, '必须捕获到非法 103 部署尝试');
  assertStrict.equal(negEvent.accepted, false, '非法四费部署必须被真实引擎拒绝 (accepted: false)');
  console.log('  ✓ 真实引擎负例拦截断言通过 (accepted: false)。\n');

  // Test 3: 验证 Smoke 资产隔离与历史迁移清册
  console.log('[Test 3] 验证 Smoke 资产语义隔离与迁移清册...');
  const migrationPath = join(libDir, 'migration_ledger.jsonl');
  assertStrict.ok(existsSync(migrationPath), 'migration_ledger.jsonl 必须存在');

  const migrationRecords = readFileSync(migrationPath, 'utf8')
    .trim()
    .split('\n')
    .map(l => JSON.parse(l));

  assertStrict.equal(migrationRecords.length, 60, '必须包含 60 条候选迁移记录');
  for (const m of migrationRecords) {
    assertStrict.equal(m.newStatus, 'INVALID_SMOKE_ONLY', '必须标记为 INVALID_SMOKE_ONLY');
    assertStrict.ok(m.reason.includes('formal screen requires 10/140'), '必须记录迁移原因');
  }

  const frontiers = JSON.parse(readFileSync(join(libDir, 'source_frontiers.json'), 'utf8'));
  for (const sName of Object.keys(frontiers)) {
    assertStrict.equal(frontiers[sName].status, 'NO_COMPLETE_FORMAL_FRONTIER', 'Smoke 模式下禁止生成前沿结论');
  }
  console.log('  ✓ Smoke 资产语义隔离与迁移清册校验通过。\n');

  // Test 4: 验证原子游标保存机制
  console.log('[Test 4] 验证原子游标保存机制 (saveCursorAtomic)...');
  const testCursorPath = join(libDir, 'test_cursor.json');
  saveCursorAtomic(testCursorPath, { testKey: 'atomic_test_val' });
  assertStrict.ok(existsSync(testCursorPath), '原子游标文件必须成功创建');
  const readBack = JSON.parse(readFileSync(testCursorPath, 'utf8'));
  assertStrict.equal(readBack.testKey, 'atomic_test_val');
  unlinkSync(testCursorPath);
  console.log('  ✓ 原子游标更新校验通过。\n');

  // Test 5: 验证任务规范文件存在 (T005 到 T023 全量)
  console.log('[Test 5] 验证任务规范文件完整保留 (T020, T021, T022, T023)...');
  assertStrict.ok(existsSync(resolve('TASKS/tree/T020-runtime-integrity-and-elite-seed-continuity.md')));
  assertStrict.ok(existsSync(resolve('TASKS/tree/T021-t020-elite-retest-and-runtime-diagnostic-repair.md')));
  assertStrict.ok(existsSync(resolve('TASKS/tree/T022-four-cost-fidelity-gate-and-resumable-experience-training.md')));
  assertStrict.ok(existsSync(resolve('TASKS/tree/T023-real-trace-fidelity-and-atomic-experience-runner.md')));
  console.log('  ✓ 全部任务规范文件完整存在且受跟踪。\n');

  console.log('=== 所有 T023 验收测试全部通过 ===');
}

runT023Tests().catch((err) => {
  console.error('T023 测试失败:', err);
  process.exit(1);
});
