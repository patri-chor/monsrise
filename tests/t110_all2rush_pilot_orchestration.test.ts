import '../src/engine/env';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Generation2PilotOrchestrator } from '../src/engine/tree/product_training/generation2';

test('T110: Generation 2 All2Rush Pilot Orchestration Entry & Artifact Verification', async () => {
  const result = await Generation2PilotOrchestrator.runAll2RushPilot({
    targetFormationId: 't0:all2rush',
    opponentFormationIds: ['t0:golden_boom', 't0:all2prayer', 't0:gift_jungle'],
    maxCandidatesPerCase: 48,
    outPrefix: 'all2rush_g2_t110',
  });

  // 1. Verify Manifest
  assert.strictEqual(result.manifest.target.id, 't0:all2rush');
  assert.ok(result.manifest.opponents.length >= 3);

  // 2. Verify Loss Queue
  assert.ok(result.lossQueue.length > 0 && result.lossQueue.length <= 6);
  assert.ok(result.lossQueue[0].finalGameOutcome === 'L' || result.lossQueue[0].finalGameOutcome === 'D');

  // 3. Verify Candidate Trials
  assert.ok(result.allTrials.length > 0);
  for (const trial of result.allTrials) {
    assert.ok(trial.lossCaseId);
    assert.ok(trial.candidateId);
    assert.ok(trial.hpOutputDigest);
    assert.ok(Array.isArray(trial.roundHpOutputs));
  }

  // 4. Verify Branch Confirmations & Summary
  assert.strictEqual(result.confirmations.length, result.exactBranches.length);
  assert.ok(result.summary.totalTrialsExecuted > 0);
  assert.ok(result.summary.outcome === 'EXACT_BRANCHES_CREATED' || result.summary.outcome === 'NO_LOCAL_IMPROVEMENT_FOUND');
});
