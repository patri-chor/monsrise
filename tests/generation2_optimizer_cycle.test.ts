import '../src/engine/env';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  runGeneration2OptimizerCycle,
} from '../src/engine/tree/product_training/generation2/cycle';

test('T125: Generation 2 Consolidated Optimizer Cycle Audit', async () => {
  const report = await runGeneration2OptimizerCycle({
    targetFormationId: 't0:all2rush',
    opponentFormationIds: ['t0:golden_boom', 't0:all2prayer', 't0:gift_jungle'],
    baselineSeeds: [1, 7],
    validationSeeds: [1, 42],
    searchSeeds: [125001, 125002],
    maxIterations: 2,
    maxOpponents: 3,
    maxAdverseCasesPerOpponent: 2,
    uniqueCandidatesPerCase: 8,
    populationSize: 4,
    maxGenerations: 2,
    maxNewPilotBranchesPerIteration: 2,
    maxConsecutiveNoImprovementIterations: 2,
  });

  // 1. Structure check
  assert.ok(report.runId.startsWith('CYCLE_RUN_'));
  assert.ok(report.totalIterationsExecuted >= 1);
  assert.ok(report.iterations.length === report.totalIterationsExecuted);

  // 2. Score70 must be real computed numbers
  for (const iter of report.iterations) {
    assert.ok(typeof iter.baselineScore70Average === 'number');
    assert.ok(typeof iter.postDecisionScore70Average === 'number');
  }

  // 3. Output files check
  const runDir = path.join(process.cwd(), 'reports', 'tree-cycle', 'generation2-optimizer-cycle', report.runId);
  assert.ok(fs.existsSync(path.join(runDir, 'config.json')));
  assert.ok(fs.existsSync(path.join(runDir, 'pilot_library.json')));
  assert.ok(fs.existsSync(path.join(runDir, 'iterations.jsonl')));
  assert.ok(fs.existsSync(path.join(runDir, 'summary.json')));

  for (let i = 1; i <= report.totalIterationsExecuted; i++) {
    const iterDir = path.join(runDir, `iteration-${String(i).padStart(3, '0')}`);
    assert.ok(fs.existsSync(path.join(iterDir, 'benchmark.json')));
    assert.ok(fs.existsSync(path.join(iterDir, 'adverse_cases.jsonl')));
    assert.ok(fs.existsSync(path.join(iterDir, 'candidate_trials.jsonl')));
    assert.ok(fs.existsSync(path.join(iterDir, 'candidate_archive.jsonl')));
    assert.ok(fs.existsSync(path.join(iterDir, 'strategy_traces.jsonl')));
    assert.ok(fs.existsSync(path.join(iterDir, 'paired_validations.jsonl')));
    assert.ok(fs.existsSync(path.join(iterDir, 'pilot_decisions.jsonl')));
  }
});
