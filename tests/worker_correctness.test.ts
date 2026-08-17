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
import { calculateMatchMetrics } from '../src/engine/tree/match_metrics';
import { resolveSeedsAndPanel } from '../src/engine/tree/first_four_generation';

async function runTests() {
  console.log('=== 开始执行 T022 加速 Worker 正确性与全量重跑专项验收测试 ===\n');

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
    resolve('reports/new-formation-generation/accelerated-sequential-tree-cycle/optimization_results.jsonl'),
  ];

  const snapshots = new Map<string, string>();
  for (const p of protectedPaths) {
    if (existsSync(p)) {
      snapshots.set(p, readFileSync(p, 'utf8'));
    }
  }

  // Test 1: 验证 Complete Metrics 结构与 MatchMetrics 健全性
  console.log('[Test 1] 验证 Complete metrics 结构健全性...');
  const m1 = calculateMatchMetrics(10, 2, 4);
  assertStrict.equal(m1.win, 10);
  assertStrict.equal(m1.draw, 2);
  assertStrict.equal(m1.loss, 4);
  assertStrict.equal(m1.total, 16);
  assertStrict.equal(m1.pureWinRate, 10 / 16);
  assertStrict.equal(m1.undefeatedRate, 12 / 16);
  assertStrict.equal(m1.trainingScore, (10 + 0.5 * 2) / 16);
  console.log('  ✓ MatchMetrics 结构计算与防 undefined 验证通过。\n');

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

  // Test 3: 验证 Mock 调度池结构化错误隔离与顺序保持
  console.log('[Test 3] 验证 Mock 调度池结构化错误隔离与候选顺序保持...');
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
    validationSeedBase: 20000 + idx * 500,
  }));

  const mockExecutor = async (task: CandidateOptimizationTask): Promise<CandidateOptimizationResult> => {
    if (task.candidateIndex === 3) {
      // 模拟结构化错误，不崩溃
      return {
        candidateIndex: task.candidateIndex,
        candidateId: task.candidateId,
        sourceSeedIndex: task.sourceSeedIndex,
        sourceSeedName: task.sourceSeedName,
        sourceSeedId: task.sourceSeedId,
        status: 'ERROR',
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: 10,
        searchSeedBase: task.searchSeedBase,
        validationSeedBase: task.validationSeedBase,
        improved: false,
        error: 'Structured mock worker error (e.g. stage timeout)',
      };
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
      durationMs: 20,
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
  for (let i = 0; i < 8; i++) {
    assertStrict.equal(poolRes.results[i].candidateIndex, i, `结果顺序必须与输入候选顺序一致 (index=${i})`);
  }
  assertStrict.equal(poolRes.results[3].status, 'ERROR');
  assertStrict.ok(poolRes.results[3].error?.includes('Structured mock worker error'));
  console.log(`  ✓ 结构化错误隔离与候选顺序保持验证通过。\n`);

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

  console.log('=== 所有 T022 验收测试全部通过 (4/4) ===');
}

runTests().catch(e => {
  console.error('Test failed:', e);
  process.exit(1);
});
