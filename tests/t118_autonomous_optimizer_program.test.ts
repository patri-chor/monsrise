import '../src/engine/env';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  runGeneration2Optimizer,
  resumeGeneration2Optimizer,
} from '../src/engine/tree/product_training/generation2';

test('T118: Autonomous Generation 2 Optimizer Program Audit Suite', async () => {
  const report = await runGeneration2Optimizer({
    targetFormationId: 't0:all2rush',
    opponentFormationIds: ['t0:golden_boom', 't0:all2prayer', 't0:gift_jungle'],
    baselineSeeds: [1, 7, 42],
    validationSeeds: [1, 42],
    maxOpponents: 3,
    maxAdverseCasesPerOpponent: 2,
    populationSize: 8,
    uniqueCandidatesPerCase: 16,
    maxGenerations: 2,
    searchSeed: 118001,
    allowForwardCompilation: true,
  });

  // 1. Structural audit
  assert.ok(report.runId.startsWith('RUN_'), 'Run ID must start with RUN_');
  assert.ok(report.baselineCases.length > 0, 'Must mine adverse baseline cases');
  assert.ok(report.baselineCases.length <= 6, 'Must respect maxOpponents * maxAdverseCasesPerOpponent');
  assert.ok(report.generationEvents.length > 0, 'Generation events recorded');
  assert.ok(report.archiveEntries.length > 0, 'Archive populated');

  // 2. Dominance and representative audit
  const reps = report.archiveEntries.filter(e => e.isRepresentative);
  assert.ok(reps.length > 0, 'Representatives must be selected');
  for (const rep of reps) {
    assert.strictEqual(rep.isDominated, false, `Representative ${rep.candidateId} must be non-dominated`);
  }

  // 3. Unique candidate budgeting
  for (const c of report.baselineCases) {
    const caseEntries = report.archiveEntries.filter(e => e.caseId === c.caseId);
    const fps = new Set(caseEntries.map(e => e.editedStateFingerprint));
    assert.strictEqual(fps.size, caseEntries.length, `All evaluated candidates for case ${c.caseId} must be unique`);
  }

  // 4. Resume audit
  const resumed = await resumeGeneration2Optimizer(report.runId);
  assert.strictEqual(resumed.summary.totalCasesMined, report.summary.totalCasesMined);
  assert.strictEqual(resumed.summary.totalUniqueEvaluations, report.summary.totalUniqueEvaluations);
});
