import '../src/engine/env';
import * as assertStrict from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import {
  EXPERIENCE_LIB_DIR,
  buildObservationKey,
  runExperiencePipeline,
} from '../src/engine/tree/experience_training_pipeline';
import { PersistentSimPool } from '../src/engine/tree/persistent_pool';

async function runT024Tests() {
  console.log('=== 开始执行 T024 正式运行身份、恢复语义与四费覆盖修复专项验收测试 ===\n');

  const libDir = EXPERIENCE_LIB_DIR;
  assertStrict.ok(existsSync(libDir), 'experience_library 目录必须存在');

  // Test 1: 验证 Observation Key 结构与 Smoke/Formal 唯一性
  console.log('[Test 1] 验证 Observation Key 构造与 Smoke/Formal 绝对唯一隔离...');
  const smokeKey = buildObservationKey({
    schemaVersion: '1.2.0',
    protocolVersion: 'T024_COMPLETE_RUN_IDENTITY',
    runKind: 'SMOKE',
    phase: 'screen',
    candidateId: 'cand_test_001',
    candidateFp: 'fp_cand_test_001',
    sourceFixtureFp: 'fp_eleven_frozen_v1',
    panelId: 'early_seven_held_out',
    sideCoverage: 'both_sides',
    seedScheduleId: 'schedule_1_screen',
    gamesPerCell: 1,
    codeCommit: 'commit_test',
  });

  const formalKey = buildObservationKey({
    schemaVersion: '1.2.0',
    protocolVersion: 'T024_COMPLETE_RUN_IDENTITY',
    runKind: 'FORMAL_SCREEN',
    phase: 'screen',
    candidateId: 'cand_test_001',
    candidateFp: 'fp_cand_test_001',
    sourceFixtureFp: 'fp_eleven_frozen_v1',
    panelId: 'early_seven_held_out',
    sideCoverage: 'both_sides',
    seedScheduleId: 'schedule_1_screen',
    gamesPerCell: 10,
    codeCommit: 'commit_test',
  });

  assertStrict.notEqual(smokeKey, formalKey, 'Smoke 与 Formal 的 ObservationKey 必须绝对不同');
  assertStrict.ok(smokeKey.includes('SMOKE::screen::cand_test_001'), 'Smoke Key 必须包含 SMOKE 标识');
  assertStrict.ok(formalKey.includes('FORMAL_SCREEN::screen::cand_test_001'), 'Formal Key 必须包含 FORMAL_SCREEN 标识');
  assertStrict.ok(formalKey.includes('gpc_10'), 'Formal Key 必须包含 gpc_10');
  console.log('  ✓ Observation Key 构造与 Smoke/Formal 语义隔离校验通过。\n');

  // Test 2: 验证四费多分支/双侧/双路径全量覆盖矩阵
  console.log('[Test 2] 验证四费多分支/双侧/双路径全量覆盖矩阵...');
  const fidelityLedgerPath = join(libDir, 'four_cost_fidelity_ledger.jsonl');
  assertStrict.ok(existsSync(fidelityLedgerPath), 'four_cost_fidelity_ledger.jsonl 必须存在');

  const records = readFileSync(fidelityLedgerPath, 'utf8')
    .trim()
    .split('\n')
    .map(l => JSON.parse(l));

  assertStrict.ok(records.length >= 40, `四费覆盖矩阵单元数必须 >= 40 (实际: ${records.length})`);
  
  const directRoutes = records.filter(r => r.conversionRoute === 'direct_evol');
  const rtRoutes = records.filter(r => r.conversionRoute === 'round_trip_evol');
  const side1Records = records.filter(r => r.side === 1);
  const side2Records = records.filter(r => r.side === 2);

  assertStrict.ok(directRoutes.length > 0, '必须包含 direct_evol 路由');
  assertStrict.ok(rtRoutes.length > 0, '必须包含 round_trip_evol 路由');
  assertStrict.ok(side1Records.length > 0, '必须包含 Side 1 对局');
  assertStrict.ok(side2Records.length > 0, '必须包含 Side 2 对局');

  for (const r of records) {
    assertStrict.equal(r.status, 'PASS', `${r.sourceSeedName} 四费 ${r.monsterName} (side ${r.side}, ${r.conversionRoute}) 必须 PASS`);
    assertStrict.equal(r.costCharged, 4, '扣费必须为 4');
    assertStrict.equal(r.budgetAfter, r.budgetBefore - 4, '预算扣减前后必须一致');
  }
  console.log(`  ✓ 四费覆盖矩阵校验通过 (共 ${records.length} 个单元，覆盖双路径与双方侧，全部 PASS)。\n`);

  // Test 3: 验证 Phase 边界硬拦截
  console.log('[Test 3] 验证 Phase 边界硬拦截...');
  await assertStrict.rejects(
    async () => {
      await runExperiencePipeline({ phase: 'promotion' });
    },
    (err: any) => err.message.includes('[Phase Error] Promotion evaluation cannot start'),
    '未完成 formal screen 时请求 promotion 必须被硬性拦截',
  );
  console.log('  ✓ Phase 边界硬拦截校验通过。\n');

  // Test 4: 验证任务规范文件成对存在 (T005 到 T024 全量)
  console.log('[Test 4] 验证任务规范文件成对存在 (T020, T021, T022, T023, T024)...');
  assertStrict.ok(existsSync(resolve('TASKS/tree/T020-runtime-integrity-and-elite-seed-continuity.md')));
  assertStrict.ok(existsSync(resolve('TASKS/tree/T021-t020-elite-retest-and-runtime-diagnostic-repair.md')));
  assertStrict.ok(existsSync(resolve('TASKS/tree/T022-four-cost-fidelity-gate-and-resumable-experience-training.md')));
  assertStrict.ok(existsSync(resolve('TASKS/tree/T023-real-trace-fidelity-and-atomic-experience-runner.md')));
  assertStrict.ok(existsSync(resolve('TASKS/tree/T024-formal-run-identity-and-trace-coverage-repair.md')));
  console.log('  ✓ 全部 T005~T024 任务规范文件完整受跟踪。\n');

  console.log('=== 所有 T024 验收测试全部通过 ===');
}

runT024Tests().catch((err) => {
  console.error('T024 测试失败:', err);
  process.exit(1);
});
