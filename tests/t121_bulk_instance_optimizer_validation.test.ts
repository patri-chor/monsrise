import '../src/engine/env';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  runBulkOptimizerValidation,
} from '../src/engine/tree/product_training/generation2';

test('T121: Bulk Instance Optimizer Validation & Holdout Evaluation', async () => {
  const report = await runBulkOptimizerValidation({
    targetFormationId: 't0:all2rush',
    opponentFormationIds: ['t0:golden_boom', 't0:all2prayer', 't0:gift_jungle'],
    sides: [1, 2],
    baselineSeeds: [1, 2, 3, 5, 7, 11], // 6 baseline seeds
    holdoutSeeds: [41, 42, 43, 47, 53, 59], // 6 holdout seeds
    maxAdverseCasesPerOpponent: 2,
    uniqueCandidatesPerCase: 16,
    maxGenerations: 2,
    populationSize: 8,
    searchSeeds: [121001, 121002],
  });

  // 1. Structure and aggregate metrics validation
  assert.strictEqual(report.runs.length, 2, 'Must execute 2 independent search seeds');
  assert.ok(report.aggregate.totalBaselineInstances > 0);
  assert.strictEqual(report.aggregate.totalParityMismatches, 0, 'No parity mismatch on baseline cases');
  assert.ok(report.aggregate.totalUniqueCandidatesEvaluated > 0);

  // 2. Paired validation metrics
  assert.ok(report.aggregate.totalPairedValidations > 0);
  assert.ok(report.byOpponent.length === 3, 'Must have aggregate for 3 opponents');
  assert.ok(report.bySide.length === 2, 'Must have aggregate for both sides');

  // 3. Output files check
  const baseDir = path.join(process.cwd(), 'reports', 'tree-cycle', 'generation2-bulk');
  assert.ok(fs.existsSync(path.join(baseDir, 'all2rush_g2_t121_bulk_aggregate.json')));
  assert.ok(fs.existsSync(path.join(baseDir, 'all2rush_g2_t121_bulk_by_opponent.jsonl')));
  assert.ok(fs.existsSync(path.join(baseDir, 'all2rush_g2_t121_bulk_by_side.jsonl')));

  // 4. Per run directories check
  for (const r of report.runs) {
    const runDir = path.join(baseDir, r.runId);
    assert.ok(fs.existsSync(path.join(runDir, 'config.json')));
    assert.ok(fs.existsSync(path.join(runDir, 'baseline_cases.jsonl')));
    assert.ok(fs.existsSync(path.join(runDir, 'local_trials.jsonl')));
    assert.ok(fs.existsSync(path.join(runDir, 'local_solutions.jsonl')));
    assert.ok(fs.existsSync(path.join(runDir, 'paired_validations.jsonl')));
    assert.ok(fs.existsSync(path.join(runDir, 'summary.json')));
  }
});
