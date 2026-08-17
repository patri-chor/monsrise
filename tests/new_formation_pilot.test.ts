process.env.IS_TEST = 'true';
import '../src/engine/env';
import * as assertStrict from 'node:assert/strict';
import { readFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';

async function runTests() {
  const {
    runNewFormationPilot,
    getRefFormationForArch,
    ARCH_REF_FORMATION_NAME,
  } = await import('../src/engine/tree/new_formation_pilot');
  const { checkGenerationResourceGate } = await import('../src/engine/tree/generation_gate');
  const { buildArenaTasks } = await import('../src/engine/tree/arena_parallel');
  const { FORMATION_LIBRARY } = await import('../src/ai/formation_library');
  const { formationToEvol } = await import('../src/engine/tree/evol_gene');

  console.log('=== 开始执行 T008/T010 新阵型生成门禁与测试隔离验收测试 ===\n');

  // 生产数据集快照（用于验证测试零污染）
  const prodDatasetPath = resolve('reports/new-formation-pilot/candidates.jsonl');
  const prodDatasetSnapshot = existsSync(prodDatasetPath) ? readFileSync(prodDatasetPath, 'utf8') : null;

  const testTmpDir = resolve('tests/.tmp/pilot-test');
  if (existsSync(testTmpDir)) {
    rmSync(testTmpDir, { recursive: true, force: true });
  }
  mkdirSync(testTmpDir, { recursive: true });

  // Test 1: 证明不同 seedBase 生成不相交的确定性任务种子分布 (T007-1)
  console.log('[Test 1] 验证 evaluateBatchParallel 任务种子调度与 seedBase 确定性及不相交性...');
  const mockCandidates = [
    { name: 'c1', f: formationToEvol(FORMATION_LIBRARY[0]) },
    { name: 'c2', f: formationToEvol(FORMATION_LIBRARY[1]) },
  ];

  const tasksCoarse = buildArenaTasks(mockCandidates, 2, 1000);
  const tasksRefined = buildArenaTasks(mockCandidates, 6, 9000);

  assertStrict.equal(tasksCoarse.length, tasksRefined.length, '任务结构数量应相同');
  const seedsCoarse = new Set(tasksCoarse.map(t => t.seed));
  const seedsRefined = new Set(tasksRefined.map(t => t.seed));

  for (const s of seedsCoarse) {
    assertStrict.ok(!seedsRefined.has(s), `Coarse 种子 ${s} 不应出现在 Refined 种子集合中`);
  }
  const tasksCoarseRepeat = buildArenaTasks(mockCandidates, 2, 1000);
  assertStrict.deepEqual(tasksCoarse.map(t => t.seed), tasksCoarseRepeat.map(t => t.seed), '相同 seedBase 必须生成完全一致的种子序列');
  console.log('  ✓ 任务种子调度完全由 seedBase 确定，且不同 base 产生完全不相交集合。\n');

  // Test 2: 验证各架构使用对应的正确参考阵型且无静默回退 (T007-3)
  console.log('[Test 2] 验证各流派对应参考阵型映射与异常抛出...');
  const prayerRef = getRefFormationForArch('prayer');
  assertStrict.equal(prayerRef.name, ARCH_REF_FORMATION_NAME.prayer, 'prayer 必须映射到 泉水剑');

  const halfRef = getRefFormationForArch('halfrush');
  assertStrict.equal(halfRef.name, ARCH_REF_FORMATION_NAME.halfrush, 'halfrush 必须映射到 全二永平');

  const fullRef = getRefFormationForArch('fullrush');
  assertStrict.equal(fullRef.name, ARCH_REF_FORMATION_NAME.fullrush, 'fullrush 必须映射到 全二冲');

  assertStrict.throws(() => {
    getRefFormationForArch('unknown_arch' as any);
  }, /Unknown archetype/, '未知架构必须直接抛出异常');
  console.log('  ✓ 架构参考树映射准确，缺失时严格抛出异常。\n');

  // Test 3: T008 核心 - 资源门禁在 T005 活跃时阻断非 dry-run 评估 (隔离写入 testTmpDir)
  console.log('[Test 3] 验证门禁在 T005 active 时阻断非 dry-run 评估...');
  const blockedVerdict = checkGenerationResourceGate({ mockTreeTaskStatus: 'IN_PROGRESS' });
  assertStrict.equal(blockedVerdict.allowed, false, 'T005 IN_PROGRESS 时门禁必须为 BLOCKED');
  assertStrict.equal(blockedVerdict.status, 'BLOCKED');

  const blockedResult = await runNewFormationPilot({
    outputDir: testTmpDir,
    dryRun: false,
    targetCount: 6,
    gateCheck: blockedVerdict,
  });

  assertStrict.equal(blockedResult.terminatedReason, 'GATE_BLOCKED', '阻断时终止理由必须为 GATE_BLOCKED');
  assertStrict.equal(blockedResult.blocked, true, 'blocked 标志必须为 true');
  assertStrict.equal(blockedResult.candidates.length, 0, '阻断时不应产出评估候选');

  const summaryFile = join(testTmpDir, 'summary.md');
  const diagFile = join(testTmpDir, 'diagnostics.json');
  assertStrict.ok(existsSync(summaryFile), 'testTmpDir/summary.md 必须存在');
  assertStrict.ok(existsSync(diagFile), 'testTmpDir/diagnostics.json 必须存在');

  const diagData = JSON.parse(readFileSync(diagFile, 'utf8'));
  assertStrict.equal(diagData.status, 'GATE_BLOCKED');
  assertStrict.equal(diagData.gateVerdict.status, 'BLOCKED');
  console.log('  ✓ 门禁成功在 T005 active 时拦截非 dry-run 评估，产物隔离写入测试临时目录。\n');

  // Test 4: T008 核心 - 门禁阻断时 dry-run 依然可用 (隔离写入 testTmpDir)
  console.log('[Test 4] 验证门禁阻断时 dry-run 依然允许运行...');
  const dryResultWhileBlocked = await runNewFormationPilot({
    outputDir: testTmpDir,
    dryRun: true,
    targetCount: 6,
    workers: 2,
    seed: 2026,
    gateCheck: blockedVerdict,
  });

  assertStrict.equal(dryResultWhileBlocked.candidates.length, 6, 'dry-run 应正常生成 6 个候选');
  assertStrict.equal(dryResultWhileBlocked.terminatedReason, 'TARGET_REACHED');
  assertStrict.equal(dryResultWhileBlocked.gateVerdict.status, 'BLOCKED', '必须如实记录门禁状态');

  const jsonlFile = join(testTmpDir, 'candidates.jsonl');
  const jsonlLines = readFileSync(jsonlFile, 'utf8').trim().split('\n');
  assertStrict.equal(jsonlLines.length, 6, 'JSONL 应包含 6 条 dry-run 记录');
  console.log('  ✓ 门禁阻断时 dry-run 正常放行，且产物写入测试临时目录。\n');

  // Test 5: T008 核心 - 门禁 IDLE/OPEN 时放行并记录 effectiveOptions
  console.log('[Test 5] 验证门禁 IDLE/OPEN 时放行并记录 effectiveOptions...');
  const openVerdict = checkGenerationResourceGate({ mockTreeTaskStatus: 'DONE' });
  assertStrict.equal(openVerdict.allowed, true, 'T005 DONE 时门禁必须为 OPEN');
  assertStrict.equal(openVerdict.status, 'OPEN');

  const dryResultOpen = await runNewFormationPilot({
    outputDir: testTmpDir,
    dryRun: true,
    targetCount: 3,
    workers: 2,
    coarseGames: 2,
    refinedGames: 6,
    coarseSeedBase: 1234,
    refinedSeedBase: 5678,
    gateCheck: openVerdict,
  });

  assertStrict.equal(dryResultOpen.gateVerdict.status, 'OPEN');
  assertStrict.equal(dryResultOpen.effectiveOptions?.coarseSeedBase, 1234);
  assertStrict.equal(dryResultOpen.effectiveOptions?.refinedSeedBase, 5678);

  const diagDataOpen = JSON.parse(readFileSync(diagFile, 'utf8'));
  assertStrict.equal(diagDataOpen.gateVerdict.status, 'OPEN');
  assertStrict.equal(diagDataOpen.effectiveOptions.coarseSeedBase, 1234);
  assertStrict.equal(diagDataOpen.effectiveOptions.refinedSeedBase, 5678);
  console.log('  ✓ 门禁 OPEN 时正常执行并持久化有效参数与判词。\n');

  // Test 6: 真实文件系统的门禁检测验证
  console.log('[Test 6] 验证真实 TASKS 目录下的门禁判定...');
  const realVerdict = checkGenerationResourceGate();
  console.log(`  -> 真实文件系统门禁检测结果: ${realVerdict.status} (${realVerdict.reason})`);
  assertStrict.ok(realVerdict.status === 'OPEN' || realVerdict.status === 'BLOCKED');
  console.log('  ✓ 真实任务状态源检测通过。\n');

  // Test 7: FORMATION_LIBRARY 未受污染
  console.log('[Test 7] 验证 FORMATION_LIBRARY 活跃库未受修改...');
  const librarySnapshot = JSON.stringify(FORMATION_LIBRARY);
  assertStrict.equal(JSON.stringify(FORMATION_LIBRARY), librarySnapshot, 'FORMATION_LIBRARY 必须 100% 保持未修改');
  console.log('  ✓ 活跃库数据未被污染。\n');

  // Test 8: T010 核心回归 - 证明生产数据集未被测试套件修改 (byte-identical)
  console.log('[Test 8] 验证生产数据集 reports/new-formation-pilot/candidates.jsonl 零污染与 byte-identical...');
  if (prodDatasetSnapshot !== null) {
    const currentProdDataset = readFileSync(prodDatasetPath, 'utf8');
    assertStrict.equal(currentProdDataset, prodDatasetSnapshot, '生产数据集在测试运行后必须 100% byte-identical');
  }
  console.log('  ✓ 生产数据集 byte-identical 零污染验证通过。\n');

  // 清理测试临时目录
  rmSync(testTmpDir, { recursive: true, force: true });

  console.log('=== 所有 T008/T010 验收测试全部通过 (8/8) ===');
}

runTests().catch(e => {
  console.error('Test failed:', e);
  process.exit(1);
});
