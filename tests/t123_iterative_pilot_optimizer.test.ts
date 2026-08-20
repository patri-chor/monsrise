import '../src/engine/env';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  runIterativePilotOptimizer,
} from '../src/engine/tree/product_training/generation2';

test('T123: Generation 2 Iterative Pilot Optimizer Loop & Feedback Audit', async () => {
  const report = await runIterativePilotOptimizer({
    targetFormationId: 't0:all2rush',
    opponentFormationIds: ['t0:golden_boom', 't0:all2prayer', 't0:gift_jungle'],
    baselineSeeds: [1, 7],
    validationSeeds: [1, 42],
    searchSeeds: [123001, 123002],
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
  assert.ok(report.runId.startsWith('ITER_RUN_'));
  assert.ok(report.totalIterationsExecuted >= 1);
  assert.ok(report.iterations.length === report.totalIterationsExecuted);

  // 2. Output files check
  const runDir = path.join(process.cwd(), 'reports', 'tree-cycle', 'generation2-iterative-pilot', report.runId);
  assert.ok(fs.existsSync(path.join(runDir, 'config.json')));
  assert.ok(fs.existsSync(path.join(runDir, 'pilot_library.json')));
  assert.ok(fs.existsSync(path.join(runDir, 'iterations.jsonl')));
  assert.ok(fs.existsSync(path.join(runDir, 'summary.json')));

  for (let i = 1; i <= report.totalIterationsExecuted; i++) {
    const iterDir = path.join(runDir, `iteration-${String(i).padStart(3, '0')}`);
    assert.ok(fs.existsSync(path.join(iterDir, 'baseline_cases.jsonl')));
    assert.ok(fs.existsSync(path.join(iterDir, 'local_trials.jsonl')));
    assert.ok(fs.existsSync(path.join(iterDir, 'local_archive.jsonl')));
    assert.ok(fs.existsSync(path.join(iterDir, 'forward_candidates.jsonl')));
    assert.ok(fs.existsSync(path.join(iterDir, 'paired_validations.jsonl')));
    assert.ok(fs.existsSync(path.join(iterDir, 'pilot_decisions.jsonl')));
    assert.ok(fs.existsSync(path.join(iterDir, 'summary.json')));
  }

  // 3. Pilot library feedback check: iteration 2 starts with iteration 1's accepted pilots
  if (report.iterations.length >= 2) {
    const iter1Accepted = report.iterations[0].acceptedPilotBranchesCount;
    const iter2Initial = report.iterations[1].initialPilotBranchesCount;
    assert.strictEqual(iter2Initial, iter1Accepted, 'Iteration 2 initial pilots must equal iteration 1 accepted pilots');
  }
});
