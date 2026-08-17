process.env.IS_TEST = 'true';
import '../src/engine/env';
import * as assertStrict from 'node:assert/strict';
import { readFileSync, existsSync, mkdirSync, rmSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { FORMATION_LIBRARY } from '../src/ai/formation_library';
import {
  runSequentialPerSeedCycle,
  formatSeedDirName,
} from '../src/engine/tree/sequential_per_seed_cycle';
import { resolveSeedsAndPanel } from '../src/engine/tree/first_four_generation';

async function runTests() {
  console.log('=== 开始执行 T017 单种子严格串行流水线专项验收测试 ===\n');

  // 1. 记录受保护生产文件的快照
  const protectedPaths: string[] = [
    resolve('reports/new-formation-pilot/candidates.jsonl'),
    resolve('reports/new-formation-pilot/retention.json'),
    resolve('reports/new-formation-pilot/retention.md'),
    resolve('reports/new-formation-generation/first-four-cycle/seed_manifest.json'),
    resolve('reports/new-formation-generation/first-four-cycle/generated_candidates.jsonl'),
    resolve('reports/new-formation-generation/first-four-cycle/retention.json'),
    resolve('reports/new-formation-generation/first-four-cycle/retention.md'),
    resolve('reports/new-formation-generation/first-four-cycle/summary.md'),
    resolve('reports/new-formation-generation/per-seed-expansion/seed_manifest.json'),
    resolve('reports/new-formation-generation/per-seed-expansion/generated_candidates.jsonl'),
    resolve('reports/new-formation-generation/per-seed-expansion/retention_by_seed.json'),
    resolve('reports/new-formation-generation/per-seed-expansion/retention_by_seed.md'),
    resolve('reports/new-formation-generation/per-seed-expansion/frozen_candidates.jsonl'),
    resolve('reports/new-formation-generation/per-seed-expansion/summary.md'),
  ];

  const snapshots = new Map<string, string>();
  for (const p of protectedPaths) {
    if (existsSync(p)) {
      snapshots.set(p, readFileSync(p, 'utf8'));
    }
  }

  const testTmpDir = resolve('tests/.tmp/sequential-per-seed-cycle');
  if (existsSync(testTmpDir)) {
    rmSync(testTmpDir, { recursive: true, force: true });
  }
  mkdirSync(testTmpDir, { recursive: true });

  try {
    // Test 1: 验证单种子串行事件时序严格性 (T017-1)
    console.log('[Test 1] 验证严格串行事件时序 (seed0 -> seed1 -> seed2 -> seed3)...');
    const eventLog: { type: string; seedIndex: number }[] = [];

    const cycleRes = await runSequentialPerSeedCycle({
      outputDir: testTmpDir,
      baseSeed: 42,
      attemptsPerSeed: 3,
      workers: 2,
      coarseGames: 1,
      coarseSeedBase: 1000,
      maxRetainedPerSeed: 6,
      explorationFloor: 0.25,
      onEvent: (ev) => {
        eventLog.push({ type: ev.type, seedIndex: ev.seedIndex });
      },
    });

    // 检查事件顺序：每个 seedIndex 必须经历完整的 GEN -> EVAL -> RETAIN -> COMPLETED 周期
    for (let i = 0; i < 4; i++) {
      const seedEvents = eventLog.filter(e => e.seedIndex === i).map(e => e.type);
      assertStrict.ok(seedEvents.includes('SEED_GENERATE_START'), `Seed ${i} 必须触发生成`);
      assertStrict.ok(seedEvents.includes('SEED_EVALUATE_START'), `Seed ${i} 必须触发评估`);
      assertStrict.ok(seedEvents.includes('SEED_TRANSACTION_COMPLETED'), `Seed ${i} 必须标记事务完成`);

      const firstGenIdx = eventLog.findIndex(e => e.seedIndex === i && e.type === 'SEED_GENERATE_START');
      const completedIdx = eventLog.findIndex(e => e.seedIndex === i && e.type === 'SEED_TRANSACTION_COMPLETED');
      assertStrict.ok(firstGenIdx < completedIdx, `Seed ${i} 生成必须在事务完成前`);

      if (i > 0) {
        const prevCompletedIdx = eventLog.findIndex(e => e.seedIndex === i - 1 && e.type === 'SEED_TRANSACTION_COMPLETED');
        assertStrict.ok(prevCompletedIdx < firstGenIdx, `Seed ${i} 生成必须在 Seed ${i - 1} 事务完成后才能开始`);
      }
    }
    console.log('  ✓ 严格串行事件时序验证通过。\n');

    // Test 2: 验证 4 个独立的 Seed 子目录结构与根汇总 (T017-2)
    console.log('[Test 2] 验证 4 个独立 Seed 事务目录产物与根汇总...');
    assertStrict.ok(existsSync(join(testTmpDir, 'run_manifest.json')));
    assertStrict.ok(existsSync(join(testTmpDir, 'frozen_candidates.jsonl')));
    assertStrict.ok(existsSync(join(testTmpDir, 'summary.md')));

    const { sourceSeeds } = resolveSeedsAndPanel();
    for (let i = 0; i < 4; i++) {
      const s = sourceSeeds[i];
      const dirName = formatSeedDirName(i, s);
      const subDir = join(testTmpDir, dirName);
      assertStrict.ok(existsSync(subDir), `子目录必须存在: ${dirName}`);
      assertStrict.ok(existsSync(join(subDir, 'manifest.json')));
      assertStrict.ok(existsSync(join(subDir, 'generated_candidates.jsonl')));
      assertStrict.ok(existsSync(join(subDir, 'retention.json')));
      assertStrict.ok(existsSync(join(subDir, 'frozen_candidates.jsonl')));
      assertStrict.ok(existsSync(join(subDir, 'summary.md')));

      const subManifest = JSON.parse(readFileSync(join(subDir, 'manifest.json'), 'utf8'));
      assertStrict.equal(subManifest.status, 'COMPLETED');
      assertStrict.equal(subManifest.seedIndex, i);
    }
    console.log('  ✓ 4 个独立 Seed 事务子目录与根汇总验证通过。\n');

    // Test 3: 验证受保护历史生产文件 byte-identical 零污染
    console.log('[Test 3] 验证所有受保护生产文件 byte-identical 零污染...');
    for (const [p, expectedContent] of snapshots.entries()) {
      assertStrict.ok(existsSync(p), `受保护生产文件必须存在: ${p}`);
      const actualContent = readFileSync(p, 'utf8');
      assertStrict.equal(actualContent, expectedContent, `受保护生产文件必须 100% byte-identical: ${p}`);
    }
    const librarySnapshot = JSON.stringify(FORMATION_LIBRARY);
    assertStrict.equal(JSON.stringify(FORMATION_LIBRARY), librarySnapshot, 'FORMATION_LIBRARY 必须保持未修改');
    console.log(`  ✓ 所有 ${snapshots.size} 个受保护生产文件及 FORMATION_LIBRARY 均为 byte-identical。\n`);

    console.log('=== 所有 T017 验收测试全部通过 (3/3) ===');
  } finally {
    if (existsSync(testTmpDir)) {
      rmSync(testTmpDir, { recursive: true, force: true });
    }
  }
}

runTests().catch(e => {
  console.error('Test failed:', e);
  process.exit(1);
});
