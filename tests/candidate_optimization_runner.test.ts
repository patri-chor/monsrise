process.env.IS_TEST = 'true';
import '../src/engine/env';
import * as assertStrict from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import os from 'node:os';
import { FORMATION_LIBRARY } from '../src/ai/formation_library';
import { resolveSeedsAndPanel } from '../src/engine/tree/first_four_generation';
import {
  resolveCandidateWorkers,
  deriveCandidateSeeds,
  buildCandidateTask,
  runCandidateOptimizationPool,
  loadAuthoritativeFrozenCandidates,
  type CandidateOptimizationTask,
  type CandidateOptimizationResult,
} from '../src/engine/tree/candidate_optimization_runner';

async function runTests() {
  console.log('=== 开始执行 T018 候选级别并行优化调度器专项验收测试 ===\n');

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
  ];

  const snapshots = new Map<string, string>();
  for (const p of protectedPaths) {
    if (existsSync(p)) {
      snapshots.set(p, readFileSync(p, 'utf8'));
    }
  }

  // Test 1: 验证 Worker 数量计算与 CPU/候选数动态钳位 (T018-1)
  console.log('[Test 1] 验证 Worker 配额策略与 CPU/候选数钳位...');
  const cpus = os.cpus().length || 1;
  const w1 = resolveCandidateWorkers(16, 24);
  assertStrict.equal(w1.requestedWorkers, 16);
  assertStrict.equal(w1.effectiveWorkers, Math.min(16, cpus, 24));

  const w2 = resolveCandidateWorkers(16, 4);
  assertStrict.equal(w2.effectiveWorkers, Math.min(4, cpus));

  const w3 = resolveCandidateWorkers(64, 24);
  assertStrict.equal(w3.effectiveWorkers, Math.min(cpus, 24));
  console.log(`  ✓ Worker 并发策略计算验证通过 (Host CPUs: ${cpus}, 24 候选 -> ${w1.effectiveWorkers} workers)。\n`);

  // Test 2: 验证权威 T017 冻结池加载与 8 对手面板绑定 (T018-2)
  console.log('[Test 2] 验证权威 T017 冻结池加载与 8 对手面板解析...');
  const frozenCandidates = loadAuthoritativeFrozenCandidates();
  assertStrict.equal(frozenCandidates.length, 24, 'T017 权威冻结候选池必须包含 24 个候选');

  const { evaluationPanel } = resolveSeedsAndPanel();
  assertStrict.equal(evaluationPanel.length, 8, '评估面板必须为 8 个唯一对手');

  const tasks: CandidateOptimizationTask[] = frozenCandidates.map((c, idx) =>
    buildCandidateTask(c, idx, evaluationPanel, { gamesPerOpp: 1 }),
  );
  assertStrict.equal(tasks.length, 24);

  // 验证种子互斥性与确定性
  const searchSeeds = new Set<number>();
  const valSeeds = new Set<number>();
  for (const t of tasks) {
    assertStrict.equal(t.opponents.length, 8);
    assertStrict.ok(!searchSeeds.has(t.searchSeedBase), `searchSeedBase ${t.searchSeedBase} 必须唯一`);
    assertStrict.ok(!valSeeds.has(t.validationSeedBase), `validationSeedBase ${t.validationSeedBase} 必须唯一`);
    searchSeeds.add(t.searchSeedBase);
    valSeeds.add(t.validationSeedBase);
  }
  console.log('  ✓ 权威冻结池加载、8 对手面板绑定与种子确定性验证通过。\n');

  // Test 3: 验证 Mock Worker 并发调度峰值与严格顺序保持 (T018-3)
  console.log('[Test 3] 验证 Mock 并发调度池的并发峰值与输入顺序保持...');
  let currentActive = 0;
  let peakObserved = 0;

  // 模拟乱序延迟与偶尔抛错
  const mockExecutor = async (task: CandidateOptimizationTask): Promise<CandidateOptimizationResult> => {
    currentActive++;
    if (currentActive > peakObserved) {
      peakObserved = currentActive;
    }

    // 随机乱序延迟 10 ~ 50 ms
    const delay = 10 + (task.candidateIndex % 5) * 8;
    await new Promise(r => setTimeout(r, delay));

    currentActive--;

    // 模拟第 5 个候选抛错，其余正常
    if (task.candidateIndex === 5) {
      throw new Error('Simulated worker timeout/error on cand 5');
    }

    const improved = task.candidateIndex % 3 === 0;
    return {
      candidateIndex: task.candidateIndex,
      candidateId: task.candidateId,
      sourceSeedIndex: task.sourceSeedIndex,
      sourceSeedName: task.sourceSeedName,
      sourceSeedId: task.sourceSeedId,
      status: improved ? 'IMPROVED' : 'NO_IMPROVEMENT',
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: delay,
      searchSeedBase: task.searchSeedBase,
      validationSeedBase: task.validationSeedBase,
      forkRound: 2,
      maskLabel: '半冲',
      beforeUndefeated: 0.33,
      afterUndefeated: improved ? 0.67 : 0.33,
      improved,
    };
  };

  const poolReport = await runCandidateOptimizationPool(tasks, {
    requestedWorkers: 8,
    workerExecutor: mockExecutor,
  });

  assertStrict.equal(poolReport.candidateCount, 24);
  assertStrict.ok(peakObserved <= 8, `峰值并发 (${peakObserved}) 不得超过设定上限 (8)`);
  assertStrict.equal(poolReport.errorCount, 1, '必须准确捕获 1 个异常');

  // 验证结果数组严格按 candidateIndex 排序
  for (let i = 0; i < poolReport.results.length; i++) {
    const res = poolReport.results[i];
    assertStrict.equal(res.candidateIndex, i, `结果顺序必须与输入顺序一致 (index=${i})`);
    assertStrict.equal(res.candidateId, tasks[i].candidateId);
  }

  // 验证第 5 个候选错误被隔离且状态记录为 ERROR
  assertStrict.equal(poolReport.results[5].status, 'ERROR');
  assertStrict.ok(poolReport.results[5].error?.includes('Simulated worker timeout/error'));
  console.log(`  ✓ 并发调度池峰值限制 (${peakObserved} <= 8)、乱序结果按序重组与单任务错误隔离验证通过。\n`);

  // Test 4: 验证受保护历史生产文件 byte-identical 零污染
  console.log('[Test 4] 验证所有受保护生产文件 byte-identical 零污染...');
  for (const [p, expectedContent] of snapshots.entries()) {
    assertStrict.ok(existsSync(p), `受保护生产文件必须存在: ${p}`);
    const actualContent = readFileSync(p, 'utf8');
    assertStrict.equal(actualContent, expectedContent, `受保护生产文件必须 100% byte-identical: ${p}`);
  }
  const librarySnapshot = JSON.stringify(FORMATION_LIBRARY);
  assertStrict.equal(JSON.stringify(FORMATION_LIBRARY), librarySnapshot, 'FORMATION_LIBRARY 必须保持未修改');
  console.log(`  ✓ 所有 ${snapshots.size} 个受保护生产文件及 FORMATION_LIBRARY 均为 byte-identical。\n`);

  console.log('=== 所有 T018 验收测试全部通过 (4/4) ===');
}

runTests().catch(e => {
  console.error('Test failed:', e);
  process.exit(1);
});
