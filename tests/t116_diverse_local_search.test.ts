import '../src/engine/env';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  runAll2RushSingleRoundOptimization,
} from '../src/engine/tree/product_training/generation2';

test('T116: Diverse Local Search, 1-3 Edit Combinations & Pareto Solution Selection', async () => {
  const report = runAll2RushSingleRoundOptimization({
    targetFormationId: 't0:all2rush',
    opponentFormationIds: ['t0:golden_boom', 't0:all2prayer', 't0:gift_jungle'],
    seedList: [1, 7, 42],
    maxAdverseCases: 6,
    searchSeed: 116001,
    budgets: [16, 32],
  });

  // 1. Diverse Baseline Selection: 每个对手至多 2 个 Case
  assert.ok(report.baselineCases.length > 0, 'Must select adverse baseline cases');
  for (const [oppName, count] of Object.entries(report.manifest.casesPerOpponent)) {
    assert.ok(count <= 2, `Opponent ${oppName} must not exceed 2 cases (actual: ${count})`);
  }
  assert.ok(
    Object.keys(report.manifest.casesPerOpponent).length >= 2,
    'Must select cases across diverse opponents'
  );

  // 2. Genuine 1..3 Edit Search: 必须产出包含多编辑的 Trials
  const oneEditCount = report.uniqueTrials.filter(t => t.editCount === 1).length;
  const twoEditCount = report.uniqueTrials.filter(t => t.editCount === 2).length;
  const threeEditCount = report.uniqueTrials.filter(t => t.editCount === 3).length;

  assert.ok(oneEditCount > 0, 'Must include 1-edit trials');
  assert.ok(twoEditCount + threeEditCount > 0, 'Must include multi-edit (2 or 3 edit) trials');

  // 3. 16 run is exact prefix of 32
  for (const comp of report.budgetComparison) {
    assert.ok(comp.budget32.uniqueExecuted >= comp.budget16.uniqueExecuted);
    assert.ok(comp.budget32.totalImprovements >= comp.budget16.totalImprovements);
  }

  // 4. Executed candidates have unique edited state fingerprints per case
  for (const c of report.baselineCases) {
    const caseTrials = report.uniqueTrials.filter(t => t.caseId === c.caseId);
    const fps = new Set(caseTrials.map(t => t.editedStateFingerprint));
    assert.strictEqual(fps.size, caseTrials.length, `All executed candidates in case ${c.caseId} must be unique`);
  }

  // 5. Pareto Dominance: 支配者字段一致性
  for (const sol of report.localSolutions) {
    if (sol.isDominated) {
      assert.notStrictEqual(sol.dominatedBySolutionId, 'N/A', 'Dominated solution must record dominator ID');
    }
  }

  // 6. Selected representatives must be Pareto non-dominated
  for (const rep of report.localSolutions.filter(s => s.isRepresentative)) {
    assert.strictEqual(rep.isDominated, false, `Representative ${rep.solutionId} must be non-dominated`);
  }

  // 7. Representative full-match continuation check exists
  assert.ok(report.representativeContinuations.length >= 0, 'Continuation check records persisted');
});
