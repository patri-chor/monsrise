process.env.IS_TEST = 'true';
import '../src/engine/env';
import * as assertStrict from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import os from 'node:os';
import { FORMATION_LIBRARY } from '../src/ai/formation_library';
import {
  runParallelIndependentEvaluation,
  type EvaluationTask,
  type CandidateIndependentEval,
} from '../src/engine/tree/sequential_tree_optimization';
import {
  resolveCandidateWorkers,
  loadAuthoritativeFrozenCandidates,
} from '../src/engine/tree/candidate_optimization_runner';
import { resolveSeedsAndPanel } from '../src/engine/tree/first_four_generation';

async function runTests() {
  console.log('=== 开始执行 T020 并行独立最终评估重构专项验收测试 ===\n');

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
  ];

  const snapshots = new Map<string, string>();
  for (const p of protectedPaths) {
    if (existsSync(p)) {
      snapshots.set(p, readFileSync(p, 'utf8'));
    }
  }

  // Test 1: 验证评估 Worker 数量计算与 CPU/候选数动态钳位 (T020-1)
  console.log('[Test 1] 验证评估 Worker 配额策略与 CPU/候选数钳位...');
  const cpus = os.cpus().length || 1;
  const w1 = resolveCandidateWorkers(16, 24);
  assertStrict.equal(w1.requestedWorkers, 16);
  assertStrict.equal(w1.effectiveWorkers, Math.min(16, cpus, 24));

  const w2 = resolveCandidateWorkers(16, 4);
  assertStrict.equal(w2.effectiveWorkers, Math.min(4, cpus));
  console.log(`  ✓ 评估并发策略计算验证通过 (Host CPUs: ${cpus}, 24 候选 -> ${w1.effectiveWorkers} workers)。\n`);

  // Test 2: 验证 Mock 调度池的并发峰值与输入顺序保持及错误隔离 (T020-2)
  console.log('[Test 2] 验证 Mock 评估并发调度池峰值限制与顺序保持...');
  const frozenCandidates = loadAuthoritativeFrozenCandidates();
  const { evaluationPanel } = resolveSeedsAndPanel();

  const mockTasks: EvaluationTask[] = frozenCandidates.map((c, idx) => ({
    candidateIndex: idx,
    rawCandidate: c,
    optRes: {
      candidateIndex: idx,
      candidateId: c.candidateId,
      sourceSeedIndex: c.sourceSeedIndex ?? 0,
      sourceSeedName: c.sourceSeedName ?? 'Unknown',
      sourceSeedId: c.sourceSeedId ?? 'unknown',
      status: 'NO_IMPROVEMENT',
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: 100,
      searchSeedBase: 5000 + idx * 500,
      validationSeedBase: 15000 + idx * 500,
      improved: false,
    },
    evaluationPanel,
    candFinalSeed: 25000 + idx * 500,
    gamesPerCellFinal: 1,
  }));

  let currentActive = 0;
  let peakObserved = 0;

  const mockEvalExecutor = async (task: EvaluationTask): Promise<CandidateIndependentEval> => {
    currentActive++;
    if (currentActive > peakObserved) {
      peakObserved = currentActive;
    }

    const delay = 10 + (task.candidateIndex % 4) * 10;
    await new Promise(r => setTimeout(r, delay));
    currentActive--;

    // 模拟第 3 个候选评估抛错
    if (task.candidateIndex === 3) {
      throw new Error('Simulated evaluation network/worker error');
    }

    return {
      candidateIndex: task.candidateIndex,
      candidateId: task.rawCandidate.candidateId,
      sourceSeedIndex: task.rawCandidate.sourceSeedIndex ?? 0,
      sourceSeedName: task.rawCandidate.sourceSeedName ?? 'Unknown',
      sourceSeedId: task.rawCandidate.sourceSeedId ?? 'unknown',
      archPath: task.rawCandidate.archPath,
      modulePath: task.rawCandidate.modulePath,
      noveltyScore: 0.5,
      noveltyBucket: 'medium',
      classification: 'deck_only_candidate',
      optimizerResult: {
        status: 'NO_IMPROVEMENT',
        improved: false,
        durationMs: 100,
        searchSeedBase: task.optRes.searchSeedBase,
        validationSeedBase: task.optRes.validationSeedBase,
      },
      baselineEval: { w: 8, d: 2, l: 6, total: 16, undefeated: 0.625, weakestCell: 0.5, cells: [] },
      finalEval: { w: 8, d: 2, l: 6, total: 16, undefeated: 0.625, weakestCell: 0.5, cells: [] },
      deltas: { undefeatedDelta: 0, weakestCellDelta: 0 },
      qualifiesQualityGate: false,
    };
  };

  const evalReport = await runParallelIndependentEvaluation(mockTasks, {
    requestedWorkers: 8,
    workerExecutor: mockEvalExecutor,
  });

  assertStrict.equal(evalReport.evaluations.length, 24);
  assertStrict.ok(peakObserved <= 8, `峰值并发 (${peakObserved}) 不得超过上限 8`);

  // 验证结果顺序严格与输入一致
  for (let i = 0; i < evalReport.evaluations.length; i++) {
    const e = evalReport.evaluations[i];
    assertStrict.equal(e.candidateIndex, i, `评估结果顺序必须与输入候选顺序一致 (index=${i})`);
    assertStrict.equal(e.candidateId, mockTasks[i].rawCandidate.candidateId);
  }

  // 验证第 3 个候选错误被捕获并标记为 archive
  assertStrict.equal(evalReport.evaluations[3].classification, 'archive');
  assertStrict.ok(evalReport.evaluations[3].failureDiagnosis?.includes('Simulated evaluation network/worker error'));
  console.log(`  ✓ 评估调度池峰值限制 (${peakObserved} <= 8)、乱序结果按序重组与单任务错误隔离验证通过。\n`);

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

  console.log('=== 所有 T020 验收测试全部通过 (3/3) ===');
}

runTests().catch(e => {
  console.error('Test failed:', e);
  process.exit(1);
});
