import '../src/engine/env';
import * as assertStrict from 'node:assert/strict';
import {
  runNewFormationPilot,
  getRefFormationForArch,
  ARCH_REF_FORMATION_NAME,
} from '../src/engine/tree/new_formation_pilot';
import { buildArenaTasks } from '../src/engine/tree/arena_parallel';
import { FORMATION_LIBRARY } from '../src/ai/formation_library';
import { formationToEvol } from '../src/engine/tree/evol_gene';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

async function runTests() {
  console.log('=== 开始执行 T007 新阵型生成试点与评估修正验收测试 ===\n');

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

  // 验证不相交
  for (const s of seedsCoarse) {
    assertStrict.ok(!seedsRefined.has(s), `Coarse 种子 ${s} 不应出现在 Refined 种子集合中`);
  }
  // 验证确定性
  const tasksCoarseRepeat = buildArenaTasks(mockCandidates, 2, 1000);
  assertStrict.deepEqual(tasksCoarse.map(t => t.seed), tasksCoarseRepeat.map(t => t.seed), '相同 seedBase 必须生成完全一致的种子序列');
  console.log('  ✓ 任务种子调度完全由 seedBase 确定，且不同 base 产生完全不相交集合。\n');

  // Test 2: 验证各架构使用对应的正确参考阵型且无静默回退 (T007-3)
  console.log('[Test 2] 验证各流派对应参考阵型映射与异常抛出...');
  const prayerRef = getRefFormationForArch('prayer');
  assertStrict.equal(prayerRef.name, '泉水剑', 'prayer 必须映射到 泉水剑');

  const halfRef = getRefFormationForArch('halfrush');
  assertStrict.equal(halfRef.name, '全二永平', 'halfrush 必须映射到 全二永平');

  const fullRef = getRefFormationForArch('fullrush');
  assertStrict.equal(fullRef.name, '全二冲', 'fullrush 必须映射到 全二冲');

  // 验证非法/缺失模板抛出明确异常而非静默回退
  assertStrict.throws(() => {
    getRefFormationForArch('unknown_arch' as any);
  }, /Unknown archetype/, '未知架构必须直接抛出异常');
  console.log('  ✓ 架构参考树映射准确，缺失时严格抛出异常。\n');

  // Test 3: Dry-run 模式测试 (包含流派参考阵型记录、去重、多路径覆盖) (T007-2 & T007-4)
  console.log('[Test 3] Dry-run 模式生成测试 (复用组装器、去重、产物隔离)...');
  const librarySnapshot = JSON.stringify(FORMATION_LIBRARY);

  const dryResult = await runNewFormationPilot({
    dryRun: true,
    targetCount: 6,
    workers: 2,
    seed: 2026,
    coarseSeedBase: 1000,
    refinedSeedBase: 9000,
  });

  assertStrict.equal(dryResult.candidates.length, 6, '应成功生成 6 个候选');
  assertStrict.ok(dryResult.pathsCovered.length >= 3, '应覆盖至少 3 条不同流派/模块路径');
  assertStrict.equal(dryResult.terminatedReason, 'TARGET_REACHED');

  // 验证输出文件
  const summaryFile = resolve('reports/new-formation-pilot/summary.md');
  const jsonlFile = resolve('reports/new-formation-pilot/candidates.jsonl');
  assertStrict.ok(existsSync(summaryFile), 'summary.md 文件应存在');
  assertStrict.ok(existsSync(jsonlFile), 'candidates.jsonl 文件应存在');

  const jsonlLines = readFileSync(jsonlFile, 'utf8').trim().split('\n');
  assertStrict.equal(jsonlLines.length, 6, 'JSONL 应包含 6 条独立记录');

  // 验证各记录字段与参考阵型匹配
  const canonKeys = new Set();
  const treeFps = new Set();
  for (const line of jsonlLines) {
    const c = JSON.parse(line);
    assertStrict.ok(!canonKeys.has(c.canonicalKey), `不应有重复卡组: ${c.canonicalKey}`);
    assertStrict.ok(!treeFps.has(c.treeFingerprint), `不应有重复树指纹: ${c.treeFingerprint}`);
    assertStrict.equal(c.referenceFormation, ARCH_REF_FORMATION_NAME[c.archPath as keyof typeof ARCH_REF_FORMATION_NAME], '记录的参考阵型必须与架构对应');
    assertStrict.ok(c.validation.valid, '候选卡组必须合法');
    canonKeys.add(c.canonicalKey);
    treeFps.add(c.treeFingerprint);
  }
  console.log('  ✓ Dry-run 模式测试通过，卡组与树指纹去重且正确记录 referenceFormation。\n');

  // Test 4: 有界终止测试 (T007-4)
  console.log('[Test 4] 有界尝试上限终止测试...');
  const boundedResult = await runNewFormationPilot({
    dryRun: true,
    targetCount: 9999,
    maxAttempts: 20,
    seed: 8888,
  });

  assertStrict.ok(boundedResult.attemptCount <= 20, '尝试次数不得超过 maxAttempts');
  assertStrict.equal(boundedResult.terminatedReason, 'ATTEMPT_CAP_EXHAUSTED', '超出上限时应返回 ATTEMPT_CAP_EXHAUSTED 状态');
  console.log('  ✓ 有界尝试上限与部分结果安全退出验证通过。\n');

  // Test 5: 验证 FORMATION_LIBRARY 活跃库未受修改 (T007-4)
  console.log('[Test 5] 验证 FORMATION_LIBRARY 活跃库未受修改...');
  assertStrict.equal(JSON.stringify(FORMATION_LIBRARY), librarySnapshot, 'FORMATION_LIBRARY 数据必须 100% 保持未修改');
  console.log('  ✓ 活跃库数据未被污染。\n');

  console.log('=== 所有 T007 验收测试全部通过 (5/5) ===');
}

runTests().catch(e => {
  console.error('Test failed:', e);
  process.exit(1);
});
