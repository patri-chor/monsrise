import '../src/engine/env';
import * as assertStrict from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PersistentSimPool } from '../src/engine/tree/persistent_pool';
import { formationToEvol, type FeatureMask, type EvolFormation } from '../src/engine/tree/evol_gene';
import type { Formation } from '../src/ai/types';

async function runT020Tests() {
  console.log('=== 开始执行 T020 运行时完整性与精英种子连续性专项验收测试 ===\n');

  const pool = new PersistentSimPool({ workerCount: 4, enableCpuMonitor: false });
  await pool.init();

  const emptyMask: FeatureMask = { side: null, main: null, subs: [], keys: [] };

  // Test 1: 验证 Worker 异常绝不转为普通失败，显式暴露在 MatchMetrics 中
  console.log('[Test 1] 验证 Worker 异常完整传播与错误保留契约...');
  const fakeFormation: any = {
    name: 'FakeErrorTest',
    archetype: 'prayer',
    team: [{ monsterId: 110, badgeIds: [] }],
    root: null, // 触发 worker 内部 evolToBundleFormation / 遍历异常
  };

  const fakeOpp: any = {
    id: 'springsword',
    name: '泉水剑',
    archetype: 'prayer',
    team: [{ monsterId: 110, badgeIds: [] }],
    tree: null,
  };

  const [errorMetrics] = await pool.evalCandidateBatchOnMatchedParallel([fakeFormation], emptyMask, [fakeOpp], 1, 1234);
  assertStrict.equal(errorMetrics.isEvaluationComplete, false, '发生异常时 isEvaluationComplete 必须为 false');
  assertStrict.ok((errorMetrics.workerErrorCount ?? 0) > 0, 'workerErrorCount 必须大于 0');
  assertStrict.ok(errorMetrics.workerErrors && errorMetrics.workerErrors.length > 0, 'workerErrors 必须包含具体异常信息');
  console.log('  ✓ Worker 异常完整传播验证通过 (workerErrorCount 显式暴露)。\n');

  // Test 2: 验证持久化精英种子池 (persistent_elite_seeds.json) 完整性
  console.log('[Test 2] 验证持久化精英种子池 Fixture 与历史 T014 溯源...');
  const elitePath = resolve('tests/fixtures/tree/persistent_elite_seeds.json');
  assertStrict.ok(existsSync(elitePath), 'persistent_elite_seeds.json 必须存在');

  const eliteSeeds = JSON.parse(readFileSync(elitePath, 'utf8'));
  assertStrict.equal(eliteSeeds.length, 3, '必须包含 3 个 T014 精英种子');

  const eliteIds = new Set(eliteSeeds.map((e: any) => e.candidateId));
  assertStrict.ok(eliteIds.has('cand_s1_1_2a'), '必须包含 cand_s1_1_2a (泉水剑)');
  assertStrict.ok(eliteIds.has('cand_s1_2_2b'), '必须包含 cand_s1_2_2b (泉水剑)');
  assertStrict.ok(eliteIds.has('cand_s2_1_8e'), '必须包含 cand_s2_1_8e (坚果救星)');

  for (const e of eliteSeeds) {
    assertStrict.equal(e.provenanceTask, 'T014', '溯源任务必须为 T014');
    assertStrict.ok(e.historicalT014Metrics.earlyHeldOutDelta > 0, '历史 Held-Out delta 必须为正');
  }
  console.log('  ✓ 3 个 T014 精英种子完整存在并保留历史溯源。\n');

  // Test 3: 在无错误环境中对精英种子进行重新测试并验证无 worker 异常
  console.log('[Test 3] 对持久化精英种子进行独立真实评测...');
  const families = JSON.parse(readFileSync(resolve('tests/fixtures/tree/early_seven_bundles.json'), 'utf8'));
  const trainingOpps = families.map((f: any) => f.trainingVariant);
  const heldOutOpps = families.map((f: any) => f.heldOutVariant);

  for (const e of eliteSeeds) {
    const evol = formationToEvol(e as unknown as Formation);
    const [preflight] = await pool.evalCandidateBatchOnMatchedParallel([evol], emptyMask, trainingOpps, 1, 5555);
    assertStrict.equal(preflight.workerErrorCount ?? 0, 0, `${e.candidateId} preflight 必须 0 错误`);

    const [heldOut] = await pool.evalCandidateBatchOnMatchedParallel([evol], emptyMask, heldOutOpps, 5, 6666);
    assertStrict.equal(heldOut.workerErrorCount ?? 0, 0, `${e.candidateId} heldOut 评测必须 0 错误`);
    console.log(`  ✓ 精英种子 ${e.candidateId} (${e.sourceSeedName}) 独立评测通过 (0 Errors, TrainingScore: ${(heldOut.trainingScore * 100).toFixed(1)}%)`);
  }
  console.log();

  pool.destroy();
  console.log('=== 所有 T020 验收测试全部通过 ===');
}

runT020Tests().catch((err) => {
  console.error('T020 测试失败:', err);
  process.exit(1);
});
