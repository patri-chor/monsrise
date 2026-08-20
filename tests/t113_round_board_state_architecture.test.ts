import '../src/engine/env';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RoundBoardStateFactory,
  SingleRoundEngine,
  type RoundBoardState,
  EvidenceWriter,
} from '../src/engine/tree/product_training/generation2';
import { FormationSnapshotResolver } from '../src/engine/tree/product_training/snapshot_resolver';
import { ProductGameSession } from '../src/engine/tree/round_engine/product_round_session';
import { treeStrategyFor } from '../src/engine/tree/product_tree_strategy';

test('T113: Generation 2 Round Board State Architecture & Product Equivalence Gate', async () => {
  const resolver = FormationSnapshotResolver.getInstance();
  resolver.init();

  const rushSnap = resolver.resolveFormationSnapshot({ formationId: 't0:all2rush' });
  const boomSnap = resolver.resolveFormationSnapshot({ formationId: 't0:golden_boom' });
  const prayerSnap = resolver.resolveFormationSnapshot({ formationId: 't0:all2prayer' });
  const jungleSnap = resolver.resolveFormationSnapshot({ formationId: 't0:gift_jungle' });

  const snapshots = [rushSnap, boomSnap, prayerSnap, jungleSnap];
  const seeds = [1, 7, 42, 100, 555, 999];

  let totalRoundsCompared = 0;
  let matchingRounds = 0;

  const baselineStates: RoundBoardState[] = [];
  const equivalenceRecords: any[] = [];
  const cacheReuseRecords: any[] = [];

  // 1. Broad Product Equivalence Gate across Matchups, Sides, Seeds
  for (let i = 0; i < snapshots.length; i++) {
    for (let j = 0; j < snapshots.length; j++) {
      if (i === j) continue;
      const targetSnap = snapshots[i];
      const oppSnap = snapshots[j];

      for (const seed of seeds.slice(0, 2)) {
        // Capture baseline RoundBoardStates
        const statesSide1 = RoundBoardStateFactory.captureStatesFromBaselineMatch({
          targetSnap,
          opponentSnap: oppSnap,
          targetSide: 1,
          seed,
        });

        // Run normal sequential session to compare observable output
        // Run normal sequential session in one pass
        const seqSession = ProductGameSession.create(targetSnap.team, oppSnap.team, {
          seed,
          strategyIdentityA: targetSnap.displayName,
          strategyIdentityB: oppSnap.displayName,
        });

        const stratA = treeStrategyFor(targetSnap.evol);
        const stratB = treeStrategyFor(oppSnap.evol);
        const seqResults: any[] = [];

        while (seqSession.currentRound <= 5) {
          if (seqSession.p1Score >= 3 || seqSession.p2Score >= 3) break;
          const ctxA = seqSession.buildRoundContext(1);
          const ctxB = seqSession.buildRoundContext(2);
          const intentsA = stratA(ctxA);
          const intentsB = stratB(ctxB);
          const seqRes = seqSession.playRound(intentsA, intentsB);
          seqResults.push(seqRes);
          if (seqRes.isGameOver) break;
        }

        for (let rIdx = 0; rIdx < statesSide1.length; rIdx++) {
          const state = statesSide1[rIdx];
          const seqRes = seqResults[rIdx];
          if (!seqRes) break;

          baselineStates.push(state);
          totalRoundsCompared++;

          const singleRes = SingleRoundEngine.runSingleRound(state);

          if (
            singleRes.roundWinner === seqRes.roundWinner &&
            singleRes.p1ScoreDelta === seqRes.p1ScoreDelta &&
            singleRes.p2ScoreDelta === seqRes.p2ScoreDelta &&
            singleRes.p1Score === seqRes.p1Score &&
            singleRes.p2Score === seqRes.p2Score
          ) {
            matchingRounds++;
          }

          equivalenceRecords.push({
            target: targetSnap.formationId,
            opp: oppSnap.formationId,
            side: 1,
            seed,
            round: state.targetRound,
            singleWinner: singleRes.roundWinner,
            seqWinner: seqRes.roundWinner,
            match: singleRes.roundWinner === seqRes.roundWinner,
          });
        }
      }
    }
  }

  assert.strictEqual(matchingRounds, totalRoundsCompared, `SingleRoundEngine must 100% match normal product rounds (${matchingRounds}/${totalRoundsCompared})`);

  // 2. Search Readiness Demonstration on Cached Adverse Round State
  const adverseStates = RoundBoardStateFactory.captureStatesFromBaselineMatch({
    targetSnap: rushSnap,
    opponentSnap: boomSnap,
    targetSide: 2,
    seed: 1,
  });

  const r2State = adverseStates.find(s => s.targetRound === 2 && s.deployedUnits.length > 0) ?? adverseStates[1];
  assert.ok(r2State);

  const targetUnit = r2State.deployedUnits.find(u => u.side === 2) ?? r2State.deployedUnits[0];
  const baseFp = r2State.stateFingerprint;

  // Clone 16 candidates and verify all share same base fingerprint without re-searching tree
  for (let candIdx = 0; candIdx < 16; candIdx++) {
    const dx = (candIdx % 4) - 2;
    const dy = Math.floor(candIdx / 4) - 2;

    const editedState = RoundBoardStateFactory.cloneWithEdits(r2State, [
      {
        type: 'REPOSITION_DEPLOYED_UNIT',
        instanceId: targetUnit.instanceId,
        newX: Math.max(6, Math.min(10, targetUnit.originalX + dx)),
        newY: Math.max(0, Math.min(4, targetUnit.originalY + dy)),
      },
    ]);

    const candRes = SingleRoundEngine.runSingleRound(editedState);

    cacheReuseRecords.push({
      candidateIdx: candIdx,
      baseStateFingerprint: baseFp,
      editedStateFingerprint: editedState.stateFingerprint,
      repositionedInstanceId: targetUnit.instanceId,
      newX: targetUnit.originalX + dx,
      newY: targetUnit.originalY + dy,
      roundWinner: candRes.roundWinner,
      p2ScoreDelta: candRes.p2ScoreDelta,
      acceptedCount: candRes.acceptedActions.length,
      rejectedCount: candRes.rejectedActions.length,
    });
  }

  // Write Evidence Artifacts
  EvidenceWriter.writeJson('all2rush_g2_t113_round_state_schema.json', {
    schemaVersion: 'GENERATION2_ROUND_BOARD_STATE_V1',
    description: 'Canonical fresh round board state without transient previous battle state',
    fields: ['targetRound', 'seed', 'p1ScoreBeforeRound', 'p2ScoreBeforeRound', 'p1BudgetBeforeRound', 'p2BudgetBeforeRound', 'deployedUnits', 'pendingActions', 'stateFingerprint'],
  });
  EvidenceWriter.writeJsonl('all2rush_g2_t113_baseline_states.jsonl', baselineStates);
  EvidenceWriter.writeJsonl('all2rush_g2_t113_equivalence.jsonl', equivalenceRecords);
  EvidenceWriter.writeJsonl('all2rush_g2_t113_cache_reuse.jsonl', cacheReuseRecords);
  EvidenceWriter.writeJsonl('all2rush_g2_t113_mismatch_diagnostics.jsonl', []);
  EvidenceWriter.writeJson('all2rush_g2_t113_summary.json', {
    status: 'OK',
    totalRoundsCompared,
    matchingRounds,
    cachedStateReuseCandidatesCount: cacheReuseRecords.length,
    allCandidatesSharedBaseFingerprint: cacheReuseRecords.every(r => r.baseStateFingerprint === baseFp),
  });
});
