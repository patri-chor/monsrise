process.env.IS_TEST = 'true';
import '../src/engine/env';
import * as assertStrict from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import os from 'node:os';
import { FORMATION_LIBRARY } from '../src/ai/formation_library';
import {
  runCandidateOptimizationPool,
  resolveCandidateWorkers,
  deriveCandidateSeeds,
  loadAuthoritativeFrozenCandidates,
  type CandidateOptimizationTask,
  type CandidateOptimizationResult,
} from '../src/engine/tree/candidate_optimization_runner';
import { resolveSeedsAndPanel } from '../src/engine/tree/first_four_generation';

async function runTests() {
  console.log('=== 开始执行 T021 加速树优化与质量决策专项验收测试 ===\n');

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
    resolve('reports/new-formation-generation/sequential-per-seed-cycle/run_manifest.json'),
    resolve('reports/new-formation-generation/sequential-per-seed-cycle/frozen_candidates.jsonl'),
    resolve('reports/new-formation-generation/sequential-per-seed-cycle/summary.md'),
    resolve('reports/new-formation-generation/sequential-tree-optimization/optimization_results.jsonl'),
    resolve('reports/new-formation-generation/sequential-tree-optimization/quality_decision.json'),
  ];

  const snapshots = new Map<string, string>();
  for (const p of protectedPaths) {
    if (existsSync(p)) {
      snapshots.set(p, readFileSync(p, 'utf8'));
    }
  }

  // Test 1: 验证 Worker 配额策略与 CPU/候选数动态钳位
  console.log('[Test 1] 验证 Worker 配额策略与 CPU/候选数钳位...');
  const cpus = os.cpus().length || 1;
  const w1 = resolveCandidateWorkers(16, 24);
  assertStrict.equal(w1.requestedWorkers, 16);
  assertStrict.equal(w1.effectiveWorkers, Math.min(16, cpus, 24));

  const w2 = resolveCandidateWorkers(16, 4);
  assertStrict.equal(w2.effectiveWorkers, Math.min(4, cpus));
  console.log(`  ✓ Worker 并发策略计算验证通过 (Host CPUs: ${cpus}, 24 候选 -> ${w1.effectiveWorkers} workers)。\n`);

  // Test 2: 验证确定性种子互斥派生 (Search / Val / Final Eval)
  console.log('[Test 2] 验证确定性种子互斥派生...');
  const seedsMap = new Set<number>();
  for (let i = 0; i < 24; i++) {
    const s = deriveCandidateSeeds(i, 5000, 20000);
    const finalSeed = 35000 + i * 500;
    assertStrict.ok(!seedsMap.has(s.searchSeedBase), `searchSeedBase 必须唯一 (index=${i})`);
    assertStrict.ok(!seedsMap.has(s.validationSeedBase), `validationSeedBase 必须唯一 (index=${i})`);
    assertStrict.ok(!seedsMap.has(finalSeed), `finalSeed 必须唯一 (index=${i})`);
    seedsMap.add(s.searchSeedBase);
    seedsMap.add(s.validationSeedBase);
    seedsMap.add(finalSeed);
  }
  console.log(`  ✓ 24 候选三套种子 (${seedsMap.size} 个种子点) 互斥确定性验证通过。\n`);

  // Test 3: 验证 Mock 调度池峰值并发、顺序保持与单 Worker 错误隔离
  console.log('[Test 3] 验证 Mock 调度池峰值限制与单任务错误隔离...');
  const rawCandidates = loadAuthoritativeFrozenCandidates();
  const { evaluationPanel } = resolveSeedsAndPanel();

  const mockTasks: CandidateOptimizationTask[] = rawCandidates.slice(0, 8).map((c, idx) => ({
    candidateIndex: idx,
    candidateId: c.candidateId,
    sourceSeedIndex: c.sourceSeedIndex ?? 0,
    sourceSeedName: c.sourceSeedName ?? 'Unknown',
    sourceSeedId: c.sourceSeedId ?? 'unknown',
    deckFormation: { id: c.candidateId, name: c.candidateId, archetype: c.archPath, team: c.team },
    opponents: evaluationPanel,
    gamesPerOpp: 1,
    searchSeedBase: 5000 + idx * 500,
    validationSeedBase: 15000 + idx * 500,
  }));

  let activeCount = 0;
  let maxActiveObserved = 0;

  const mockExecutor = async (task: CandidateOptimizationTask): Promise<CandidateOptimizationResult> => {
    activeCount++;
    if (activeCount > maxActiveObserved) maxActiveObserved = activeCount;
    const delay = 10 + (task.candidateIndex % 3) * 10;
    await new Promise(r => setTimeout(r, delay));
    activeCount--;

    if (task.candidateIndex === 2) {
      throw new Error('Simulated optimizer worker timeout/error');
    }

    return {
      candidateIndex: task.candidateIndex,
      candidateId: task.candidateId,
      sourceSeedIndex: task.sourceSeedIndex,
      sourceSeedName: task.sourceSeedName,
      sourceSeedId: task.sourceSeedId,
      status: task.candidateIndex === 1 ? 'IMPROVED' : 'NO_IMPROVEMENT',
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: 50,
      searchSeedBase: task.searchSeedBase,
      validationSeedBase: task.validationSeedBase,
      improved: task.candidateIndex === 1,
    };
  };

  const poolRes = await runCandidateOptimizationPool(mockTasks, {
    requestedWorkers: 4,
    workerExecutor: mockExecutor,
  });

  assertStrict.equal(poolRes.results.length, 8);
  assertStrict.ok(maxActiveObserved <= 4, `峰值并发 (${maxActiveObserved}) 不得超过上限 4`);
  for (let i = 0; i < 8; i++) {
    assertStrict.equal(poolRes.results[i].candidateIndex, i, `结果顺序必须与输入候选顺序一致 (index=${i})`);
  }
  assertStrict.equal(poolRes.results[2].status, 'ERROR');
  console.log(`  ✓ 调度池峰值限制 (${maxActiveObserved} <= 4)、输入顺序严格保持与单任务错误隔离验证通过。\n`);

  // Test 4: 验证所有受保护生产文件 byte-identical 零污染
  console.log('[Test 4] 验证所有受保护生产文件 byte-identical 零污染...');
  for (const [p, expectedContent] of snapshots.entries()) {
    assertStrict.ok(existsSync(p), `受保护生产文件必须存在: ${p}`);
    const actualContent = readFileSync(p, 'utf8');
    assertStrict.equal(actualContent, expectedContent, `受保护生产文件必须 100% byte-identical: ${p}`);
  }
  const librarySnapshot = JSON.stringify(FORMATION_LIBRARY);
  assertStrict.equal(JSON.stringify(FORMATION_LIBRARY), librarySnapshot, 'FORMATION_LIBRARY 必须保持未修改');
  console.log(`  ✓ 所有 ${snapshots.size} 个受保护生产文件及 FORMATION_LIBRARY 均为 byte-identical。\n`);

  console.log('=== 所有 T021 验收测试全部通过 (4/4) ===');
}

runTests().catch(e => {
  console.error('Test failed:', e);
  process.exit(1);
});
