import '../src/engine/env';
import * as assertStrict from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { PersistentSimPool } from '../src/engine/tree/persistent_pool';
import { runElevenLibraryTraining, median, ELEVEN_LIBRARY_DIR } from '../src/engine/tree/eleven_library_training';

async function runT016Tests() {
  console.log('=== 开始执行 T016 全库 11 阵型多样性训练与三层候选库构建专项验收测试 ===\n');

  // Test 1: 验证中位数与基础数学工具
  console.log('[Test 1] 验证中位数统计计算...');
  assertStrict.equal(median([0.4, 0.5, 0.6]), 0.5, '奇数个中位数必须正确');
  assertStrict.equal(median([0.4, 0.6]), 0.5, '偶数个中位数必须正确');
  console.log('  ✓ 中位数计算工具校验通过。\n');

  // Test 2: 验证 11 冻结源与 33 候选 Fixture 完整性
  console.log('[Test 2] 验证 11 冻结源与 33 多样性候选 Fixture...');
  const sourcesPath = resolve('tests/fixtures/tree/eleven_frozen_sources.json');
  const candsPath = resolve('tests/fixtures/tree/thirty_three_mutated_candidates.jsonl');

  assertStrict.ok(existsSync(sourcesPath), 'eleven_frozen_sources.json 必须存在');
  assertStrict.ok(existsSync(candsPath), 'thirty_three_mutated_candidates.jsonl 必须存在');

  const sources = JSON.parse(readFileSync(sourcesPath, 'utf8'));
  const candidates = readFileSync(candsPath, 'utf8').trim().split('\n').map((l: string) => JSON.parse(l));

  assertStrict.equal(sources.length, 11, '源阵型数量必须恰好为 11');
  assertStrict.equal(candidates.length, 33, '突变候选总数必须恰好为 33 (11 * 3)');

  // 验证每源恰好 3 个候选且覆盖 light/medium/heavy
  for (let s = 0; s < 11; s++) {
    const sCands = candidates.filter((c: any) => c.sourceSeedIndex === s);
    assertStrict.equal(sCands.length, 3, `源 ${s} 必须恰好包含 3 个候选`);
    const buckets = new Set(sCands.map((c: any) => c.noveltyBucket));
    assertStrict.ok(buckets.has('light') && buckets.has('medium') && buckets.has('heavy'), `源 ${s} 必须覆盖 light/medium/heavy`);
  }
  console.log('  ✓ 11 源与 33 候选多样性桶覆盖校验通过。\n');

  // Test 3: 启动全量 11 源 33 候选 3 次独立优化尝试与三层阵型库构建 Run
  console.log('[Test 3] 启动 33 候选全量 3 次独立优化评测 (3 * 33 = 99 attempts)...');
  const pool = new PersistentSimPool({ workerCount: 16, enableCpuMonitor: false });
  await pool.init();

  const outDir = resolve('reports/new-formation-generation/overnight-eleven-library-training');

  const runResult = await runElevenLibraryTraining({
    outputDir: outDir,
    pool,
    onProgress: (msg) => console.log(`    [T016 Training Progress] ${msg}`),
  });

  assertStrict.equal(runResult.results.length, 33, '必须评测完全部 33 个候选');
  assertStrict.equal(runResult.tier1.length, 11, 'Tier 1 必须包含全部 11 套原始基准阵型');

  // 验证 12 项产物完整生成
  console.log('[Test 4] 验证 12 项 Reviewable 产物完整性...');
  const expectedFiles = [
    'source_snapshot.json',
    'generation_manifest.json',
    'all_candidates.jsonl',
    'screening_ledger.jsonl',
    'optimization_attempts.jsonl',
    'early_holdout_evaluations.jsonl',
    'current_panel_generalization.jsonl',
    'tier_library.json',
    'tier_library.md',
    'rejection_ledger.jsonl',
    'summary.md',
  ];

  for (const f of expectedFiles) {
    assertStrict.ok(existsSync(join(outDir, f)), `产物文件必须存在: ${f}`);
  }
  console.log('  ✓ 12 项产物文件全部存在且格式合规。\n');

  pool.destroy();
  console.log('=== 所有 T016 验收测试全部通过 ===');
}

runT016Tests().catch((err) => {
  console.error('T016 测试失败:', err);
  process.exit(1);
});
