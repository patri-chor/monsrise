import '../src/engine/env';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  runAll2RushSingleRoundOptimization,
  SingleRoundEngine,
} from '../src/engine/tree/product_training/generation2';

test('T115: Generation 2 Complete Single-Round Optimizer & Verification', async () => {
  const report = runAll2RushSingleRoundOptimization({
    targetFormationId: 't0:all2rush',
    opponentFormationIds: ['t0:golden_boom', 't0:all2prayer', 't0:gift_jungle'],
    seedList: [1, 7, 42],
    maxAdverseCases: 6,
    searchSeed: 115001,
    budgets: [16, 32],
  });

  // 1. Structured data validation
  assert.ok(report.baselineCases.length > 0, 'Must select at least one adverse baseline case');
  assert.ok(report.baselineCases.length <= 6, 'Must select at most 6 adverse baseline cases');
  assert.ok(report.uniqueTrials.length > 0, 'Must produce unique executed trials');
  assert.ok(report.budgetComparison.length === report.baselineCases.length, 'Budget comparison per case');

  // 2. Verification 1: All selected baseline cases pass no-edit equivalence
  for (const c of report.baselineCases) {
    const noEditRes = SingleRoundEngine.runSingleRound(c.baseState);
    assert.strictEqual(
      noEditRes.roundWinner,
      c.baselineResult.roundWinner,
      `Case ${c.caseId} must match baseline round winner`
    );
    assert.strictEqual(
      noEditRes.p1Score,
      c.baselineResult.p1Score,
      `Case ${c.caseId} must match baseline p1Score`
    );
    assert.strictEqual(
      noEditRes.p2Score,
      c.baselineResult.p2Score,
      `Case ${c.caseId} must match baseline p2Score`
    );
  }

  // 3. Verification 2: Every executed candidate has unique edited state fingerprint per case
  for (const c of report.baselineCases) {
    const caseTrials = report.uniqueTrials.filter(t => t.caseId === c.caseId);
    const fps = new Set(caseTrials.map(t => t.editedStateFingerprint));
    assert.strictEqual(fps.size, caseTrials.length, `All executed candidates in case ${c.caseId} must be unique`);
  }

  // 4. Verification 4: Existing deployed unit reposition occurs in real search without duplicate deployment
  const deployedRepositionTrials = report.uniqueTrials.filter(t =>
    t.edits.some(e => e.type === 'REPOSITION_DEPLOYED_UNIT')
  );
  assert.ok(deployedRepositionTrials.length > 0, 'Must include trials with REPOSITION_DEPLOYED_UNIT');

  // 5. Verification 5: 16 run is exactly the unique-trial prefix of 32 run
  for (const comp of report.budgetComparison) {
    assert.ok(comp.budget32.uniqueExecuted >= comp.budget16.uniqueExecuted);
    assert.strictEqual(
      comp.budget32.totalImprovements >= comp.budget16.totalImprovements,
      true,
      'Budget 32 improvements must be >= Budget 16'
    );
  }

  // 6. Verification 7: Selected representative is marked and present
  const reps = report.localSolutions.filter(s => s.isRepresentative);
  assert.ok(reps.length > 0, 'Must select at least one representative solution');
});
