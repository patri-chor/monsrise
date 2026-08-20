import '../src/engine/env';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  runIterativePilotOptimizer,
} from '../src/engine/tree/product_training/generation2';

test('T124: Result-Driven Iterative Pilot Optimizer & Product Outcome Audit', async () => {
  const report = await runIterativePilotOptimizer({
    targetFormationId: 't0:all2rush',
    opponentFormationIds: ['t0:golden_boom', 't0:all2prayer', 't0:gift_jungle'],
    baselineSeeds: [1, 7],
    validationSeeds: [1, 42],
    searchSeeds: [124001, 124002],
    maxIterations: 2,
    maxOpponents: 3,
    maxAdverseCasesPerOpponent: 2,
    uniqueCandidatesPerCase: 8,
    populationSize: 4,
    maxGenerations: 2,
    maxNewPilotBranchesPerIteration: 2,
    maxConsecutiveNoImprovementIterations: 2,
  });

  // 1. Report structure check
  assert.ok(report.runId.startsWith('RES_ITER_RUN_'));
  assert.ok(report.totalIterationsExecuted >= 1);
  assert.ok(report.iterations.length === report.totalIterationsExecuted);

  // 2. Score70 values must be genuine computed numbers, not 0 placeholders
  for (const iter of report.iterations) {
    assert.ok(typeof iter.baselineBenchmark.targetScore70Average === 'number');
    assert.ok(typeof iter.postDecisionBenchmark.targetScore70Average === 'number');
    assert.strictEqual(
      iter.baselineBenchmark.targetScore70Average,
      (iter.baselineBenchmark.targetW + 0.70 * iter.baselineBenchmark.targetD) / iter.baselineBenchmark.count,
      'Score70 must be exactly computed as (W + 0.7*D)/N'
    );
  }

  // 3. Output files check
  const runDir = path.join(process.cwd(), 'reports', 'tree-cycle', 'generation2-result-iterative', report.runId);
  assert.ok(fs.existsSync(path.join(runDir, 'config.json')));
  assert.ok(fs.existsSync(path.join(runDir, 'pilot_library.json')));
  assert.ok(fs.existsSync(path.join(runDir, 'iterations.jsonl')));
  assert.ok(fs.existsSync(path.join(runDir, 'summary.json')));

  for (let i = 1; i <= report.totalIterationsExecuted; i++) {
    const iterDir = path.join(runDir, `iteration-${String(i).padStart(3, '0')}`);
    assert.ok(fs.existsSync(path.join(iterDir, 'baseline_benchmark.json')));
    assert.ok(fs.existsSync(path.join(iterDir, 'baseline_cases.jsonl')));
    assert.ok(fs.existsSync(path.join(iterDir, 'local_trials.jsonl')));
    assert.ok(fs.existsSync(path.join(iterDir, 'local_archive.jsonl')));
    assert.ok(fs.existsSync(path.join(iterDir, 'forward_candidates.jsonl')));
    assert.ok(fs.existsSync(path.join(iterDir, 'paired_validations.jsonl')));
    assert.ok(fs.existsSync(path.join(iterDir, 'candidate_decisions.jsonl')));
    assert.ok(fs.existsSync(path.join(iterDir, 'summary.json')));
  }
});
