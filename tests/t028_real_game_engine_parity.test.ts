import '../src/engine/env';
import * as assertStrict from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  checkEngineArtifactIdentity,
  runBehavioralParityHarness,
} from '../src/engine/tree/real_game_engine_parity_gate';
import { PersistentSimPool } from '../src/engine/tree/persistent_pool';

async function runT028Tests() {
  console.log('=== 开始执行 T028 真实游戏引擎字节与行为一致性对齐专项验收测试 ===\n');

  // Test 1: 验证 Bundle SHA-256 字节级哈希绝对一致
  console.log('[Test 1] 验证真实应用 Bundle 与 Tree Runner Bundle SHA-256 字节一致性...');
  const identity = checkEngineArtifactIdentity();
  console.log(`  Real Bundle Path:   ${identity.realGameBundleAbsoluteSource}`);
  console.log(`  Real Bundle SHA256: ${identity.realGameBundleSHA256}`);
  console.log(`  Runner Bundle SHA256: ${identity.treeRunnerBundleSHA256}`);

  assertStrict.notEqual(identity.realGameBundleSHA256, 'NOT_FOUND', '主工作区 Bundle 必须存在');
  assertStrict.notEqual(identity.treeRunnerBundleSHA256, 'NOT_FOUND', 'Runner Bundle 必须存在');
  assertStrict.equal(
    identity.realGameBundleSHA256,
    identity.treeRunnerBundleSHA256,
    '主工作区 Bundle 与 Runner Bundle SHA-256 必须完全一致 (0 漂移)',
  );
  assertStrict.equal(identity.isByteIdentical, true, 'isByteIdentical 必须为 true');
  console.log('  ✓ 字节级 SHA-256 完全一致性校验通过。\n');

  // Test 2: 验证全量行为一致性对齐测试 (Behavioral Parity Harness)
  console.log('[Test 2] 执行真实运行时行为一致性对齐测试 (对阵、落点、费用、胜负逐位比对)...');
  const pool = new PersistentSimPool({ workerCount: 4, enableCpuMonitor: false });
  await pool.init();

  const sources = JSON.parse(readFileSync(resolve('tests/fixtures/tree/eleven_frozen_sources.json'), 'utf8'));
  const earlyFamilies = JSON.parse(readFileSync(resolve('tests/fixtures/tree/early_seven_bundles.json'), 'utf8'));

  const parityResult = await runBehavioralParityHarness(pool, sources, earlyFamilies);
  pool.destroy();

  console.log(`  共执行 ${parityResult.caseResults.length} 个行为对齐对比案例`);
  assertStrict.ok(parityResult.caseResults.length >= 20, '对齐案例数必须 >= 20');
  for (const c of parityResult.caseResults) {
    assertStrict.equal(
      c.isBehavioralIdentical,
      true,
      `阵型 ${c.formationName} vs ${c.opponentName} (side ${c.side}) 行为必须逐位完全一致: ${c.mismatchReason ?? 'none'}`,
    );
  }
  assertStrict.equal(parityResult.passed, true, 'Behavioral Parity Gate 必须 100% PASS');
  console.log('  ✓ 真实运行时行为一致性逐位对齐测试 100% PASS。\n');

  // Test 3: 任务规范文件保护
  console.log('[Test 3] 验证 T020~T028 任务规范文件完整保留...');
  assertStrict.ok(existsSync(resolve('TASKS/tree/T020-runtime-integrity-and-elite-seed-continuity.md')));
  assertStrict.ok(existsSync(resolve('TASKS/tree/T026-t025-executor-test-verification.md')));
  assertStrict.ok(existsSync(resolve('TASKS/tree/T028-real-game-engine-parity-gate.md')));
  console.log('  ✓ 任务规范文件完整存在。\n');

  console.log('=== 所有 T028 验收测试全部通过 ===');
}

runT028Tests().catch((err) => {
  console.error('T028 测试失败:', err);
  process.exit(1);
});
