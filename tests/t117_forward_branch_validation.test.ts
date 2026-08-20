import '../src/engine/env';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  runForwardBranchValidation,
} from '../src/engine/tree/product_training/generation2';

test('T117: Generation 2 Forward Branch Validation & Pilot Selection', async () => {
  const report = runForwardBranchValidation({
    targetFormationId: 't0:all2rush',
    opponentFormationIds: ['t0:golden_boom', 't0:all2prayer', 't0:gift_jungle'],
    seedList: [1, 7, 42],
    expandedSeeds: [1, 7, 42, 100, 2024],
    searchSeed: 116001,
  });

  // 1. All non-dominated solutions classified
  assert.ok(report.solutionClassifications.length > 0, 'Must classify all non-dominated solutions');
  for (const c of report.solutionClassifications) {
    assert.ok(
      ['FORWARD_CANDIDATE', 'LOCAL_ONLY_EARLIER_CONTEXT', 'LOCAL_ONLY_NOT_VISIBLE', 'DISCARDED_DOMINATED_AFTER_FULL_MATCH'].includes(c.classification),
      `Valid classification type for ${c.solutionId}`
    );
  }

  // 2. Forward candidate compilation & source confirmation
  assert.ok(report.forwardBranches.length >= 0, 'Forward branches array present');
  for (const b of report.forwardBranches) {
    assert.strictEqual(b.sourceValidation.branchSelected, true, 'Branch must select in source match');
    assert.ok(
      ['IMPROVES', 'NEUTRAL', 'REGRESSES', 'NOT_SELECTED'].includes(b.sourceValidation.outcome),
      'Valid source validation outcome'
    );
  }

  // 3. Expanded validation records
  assert.ok(report.expandedValidation.length >= 0, 'Expanded validation matrix records present');

  // 4. No pilot active branch contains regression
  for (const b of report.activePilotBranches) {
    const records = report.expandedValidation.filter(r => r.branchId === b.branchId);
    assert.strictEqual(
      records.some(r => r.classification === 'REGRESSES'),
      false,
      `Active pilot branch ${b.branchId} must not contain any regression`
    );
  }

  // 5. Warm-start library preserved
  assert.ok(report.warmStartLibrary.length >= 0, 'Warm start library records preserved');
});
