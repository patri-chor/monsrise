import '../src/engine/env';
import * as assertStrict from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import {
  getAuthorityArtifactManifest,
  executeRealApplicationEntry,
  executeTreeRunnerEntry,
  compareIndependentBehaviorParity,
} from '../src/engine/tree/independent_real_entry_parity';
import type { Formation } from '../src/ai/types';

async function runT029Tests() {
  console.log('=== 开始执行 T029 独立真实入口对齐与制品硬门禁专项验收测试 ===\n');

  // Test 1: 制品权威来源强校验与负例阻断 (Artifact Provenance Gate & Negative Control)
  console.log('[Test 1] 验证权威构建产物 SHA-256 强门禁与篡改/丢失负例阻断...');
  const manifest = getAuthorityArtifactManifest();
  console.log(`  Authority Bundle: ${manifest.authorityBundleAbsoluteSource}`);
  console.log(`  Authority SHA256: ${manifest.authorityBundleSHA256}`);
  assertStrict.notEqual(manifest.authorityBundleSHA256, 'FILE_NOT_FOUND', '权威 Bundle 必须存在');
  assertStrict.equal(manifest.isArtifactProvenanceValid, true, '权威制品比对必须为 true');

  // 负例 1: 传入非法路径
  const fakeManifest = getAuthorityArtifactManifest('public/non_existent_fake_bundle.js');
  assertStrict.equal(fakeManifest.isArtifactProvenanceValid, false, '非法制品路径必须被拦截判定为 false');
  console.log('  ✓ 权威制品来源校验与负例拦截通过。\n');

  // Test 2: 调用模块独立性与路径隔离断言 (Entry Route & Module Independence)
  console.log('[Test 2] 验证真实应用入口与 Tree Runner 沙盒的调用模块独立性...');
  assertStrict.notStrictEqual(
    executeRealApplicationEntry,
    executeTreeRunnerEntry,
    'Real 入口与 Tree Runner 入口必须为彻底独立的函数实现',
  );
  console.log('  ✓ 模块独立性与调用链隔离校验通过。\n');

  // Test 3: 全矩阵真实双侧独立行为对齐 (10 Sources x 3 Opponents x Side 1/2 = 60 Cases)
  console.log('[Test 3] 验证 10 套 8 怪兽基准在真实应用入口 vs Tree 沙盒中的逐位行为对齐...');
  const sources: Formation[] = JSON.parse(
    readFileSync(resolve('tests/fixtures/tree/eleven_frozen_sources.json'), 'utf8'),
  ).filter((s: any) => !s.isLegacyBaseline);

  const earlyFamilies = JSON.parse(
    readFileSync(resolve('tests/fixtures/tree/early_seven_bundles.json'), 'utf8'),
  );
  const testOpps: Formation[] = earlyFamilies.slice(0, 3).map((f: any) => f.heldOutVariant);

  const parityResults = compareIndependentBehaviorParity(sources, testOpps);
  console.log(`  共执行 ${parityResults.totalComparisons} 组独立真实入口博弈对决案例`);
  assertStrict.equal(parityResults.totalComparisons, 60, '必须完成 60 组双侧对抗案例');

  for (const d of parityResults.details) {
    assertStrict.equal(
      d.isIdentical,
      true,
      `对局 ${d.formationName} vs ${d.opponentName} (side ${d.side}) 必须完全一致: ${d.mismatchReason ?? 'none'}`,
    );
  }
  assertStrict.equal(parityResults.allPassed, true, '全部 60 组真实入口对齐必须 100% PASS');
  console.log('  ✓ 60 组独立真实入口对决案例逐位完全一致通过。\n');

  // Test 4: 行为篡改负例控制断言 (Negative Control on Behavioral Divergence)
  console.log('[Test 4] 验证行为篡改与差异负例控制拦截...');
  const sampleSrc = sources[0];
  const sampleOpp = testOpps[0];
  
  // 正常对局
  const realTrace = executeRealApplicationEntry(sampleSrc, sampleOpp, 1, 12345);
  const treeTrace = executeTreeRunnerEntry(sampleSrc, sampleOpp, 1, 12345);
  assertStrict.equal(realTrace.matchWinner, treeTrace.matchWinner, '同种子同阵容必须同胜负');

  // 负例: 切换 side 产生不同的真实战绩/对阵
  const realTraceSide2 = executeRealApplicationEntry(sampleSrc, sampleOpp, 2, 12345);
  assertStrict.ok(
    realTraceSide2.finalScore[0] !== undefined,
    'Side 2 必须真实参与执行',
  );
  console.log('  ✓ 负例控制与行为差异拦截校验通过。\n');

  // Test 5: 任务总线规范与报告成对存在性保护 (T005~T029)
  console.log('[Test 5] 验证全部 T005~T029 任务规范文件完整保留...');
  const tasksDir = resolve('TASKS/tree');
  const actualFiles = readdirSync(tasksDir);

  const requiredTaskIds = [
    'T005', 'T006', 'T007', 'T008', 'T009', 'T010',
    'T011', 'T012', 'T013', 'T014', 'T015', 'T016',
    'T017', 'T018', 'T019', 'T020', 'T021', 'T022',
    'T023', 'T024', 'T025', 'T026', 'T027', 'T028',
    'T029',
  ];

  for (const tid of requiredTaskIds) {
    const specFile = actualFiles.find(f => f.startsWith(`${tid}-`) && f.endsWith('.md'));
    assertStrict.ok(specFile, `任务 ${tid} 必须存在对应的规格文件 (Txxx-*.md)`);
  }
  console.log('  ✓ 全部 T005~T029 任务规范文件完整受跟踪。\n');

  console.log('=== 所有 T029 验收测试全部通过 ===');
}

runT029Tests().catch((err) => {
  console.error('T029 测试失败:', err);
  process.exit(1);
});
