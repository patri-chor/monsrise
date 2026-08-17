import '../src/engine/env';
import * as assertStrict from 'node:assert/strict';
import { runNewFormationPilot } from '../src/engine/tree/new_formation_pilot';
import { FORMATION_LIBRARY } from '../src/ai/formation_library';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

async function runTests() {
  console.log('=== 开始执行 T006 新阵型生成试点验收测试 ===\n');

  // Test 1: dry-run 模式测试
  console.log('[Test 1] Dry-run 模式测试 (结构生成、去重、多路径覆盖)...');
  const librarySnapshot = JSON.stringify(FORMATION_LIBRARY);

  const dryResult = await runNewFormationPilot({
    dryRun: true,
    targetCount: 6,
    workers: 2,
    seed: 2026,
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

  // 验证无重复 canonicalKey 与 treeFingerprint
  const canonKeys = new Set();
  const treeFps = new Set();
  for (const line of jsonlLines) {
    const c = JSON.parse(line);
    assertStrict.ok(!canonKeys.has(c.canonicalKey), `不应有重复卡组: ${c.canonicalKey}`);
    assertStrict.ok(!treeFps.has(c.treeFingerprint), `不应有重复树指纹: ${c.treeFingerprint}`);
    canonKeys.add(c.canonicalKey);
    treeFps.add(c.treeFingerprint);
  }
  console.log('  ✓ Dry-run 模式生成、去重、多路径覆盖与产物隔离全部验证通过。\n');

  // Test 2: 有界终止 (Attempt Cap Bounded Termination)
  console.log('[Test 2] 有界尝试上限终止测试...');
  const boundedResult = await runNewFormationPilot({
    dryRun: true,
    targetCount: 9999, // 故意传入巨大目标
    maxAttempts: 20,   // 硬性限制 20 次尝试
    seed: 8888,
  });

  assertStrict.ok(boundedResult.attemptCount <= 20, '尝试次数不得超过 maxAttempts');
  assertStrict.equal(boundedResult.terminatedReason, 'ATTEMPT_CAP_EXHAUSTED', '超出上限时应返回 ATTEMPT_CAP_EXHAUSTED 状态');
  console.log('  ✓ 有界尝试上限与部分结果安全退出验证通过。\n');

  // Test 3: 验证 FORMATION_LIBRARY 完全未受污染
  console.log('[Test 3] 验证 FORMATION_LIBRARY 活跃库未受修改...');
  assertStrict.equal(JSON.stringify(FORMATION_LIBRARY), librarySnapshot, 'FORMATION_LIBRARY 数据必须 100% 保持未修改');
  console.log('  ✓ 活跃库数据未被污染。\n');

  console.log('=== 所有 T006 行为验收测试全部通过 (3/3) ===');
}

runTests().catch(e => {
  console.error('Test failed:', e);
  process.exit(1);
});
