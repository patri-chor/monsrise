import '../src/engine/env';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CounterfactualBattleEngine,
  type CounterfactualRoundInput,
} from '../src/engine/tree/product_training/generation2/counterfactual_battle_engine';
import { FormationSnapshotResolver } from '../src/engine/tree/product_training/snapshot_resolver';
import { treeStrategyFor } from '../src/engine/tree/product_tree_strategy';
import { ProductGameSession } from '../src/engine/tree/round_engine/product_round_session';
import { EvidenceWriter } from '../src/engine/tree/product_training/generation2/evidence_writer';

test('T112: Single-Round Counterfactual Battle Engine & Product Equivalence Gate', async () => {
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

  const equivalenceRecords: any[] = [];
  const proposals: any[] = [];
  const trials: any[] = [];
  const budgetComparison: any[] = [];
  const localSolutions: any[] = [];
  const branchAssessments: any[] = [];

  // 1. Broad Product Equivalence Gate across Formations, Sides, Seeds, Reachable Rounds
  for (let i = 0; i < snapshots.length; i++) {
    for (let j = 0; j < snapshots.length; j++) {
      if (i === j) continue;
      const snapA = snapshots[i];
      const snapB = snapshots[j];
      const stratA = treeStrategyFor(snapA.evol);
      const stratB = treeStrategyFor(snapB.evol);

      for (const seed of seeds.slice(0, 2)) {
        const session = ProductGameSession.create(snapA.team, snapB.team, {
          seed,
          strategyIdentityA: snapA.displayName,
          strategyIdentityB: snapB.displayName,
        });

        while (session.currentRound <= 5) {
          if (session.p1Score >= 3 || session.p2Score >= 3) break;
          const r = session.currentRound;
          const cp = session.captureCheckpointBeforeRound(r);

          const ctxA = session.buildRoundContext(1);
          const ctxB = session.buildRoundContext(2);
          const intentsA = stratA(ctxA);
          const intentsB = stratB(ctxB);

          // Counterfactual round input with NO overrides
          const cfInput: CounterfactualRoundInput = {
            round: r,
            seed,
            p1Score: session.p1Score,
            p2Score: session.p2Score,
            p1Budget: cp.p1RemainingBudget,
            p2Budget: cp.p2RemainingBudget,
            teamA: snapA.team,
            teamB: snapB.team,
            strategyIdentityA: snapA.displayName,
            strategyIdentityB: snapB.displayName,
            preRoundCheckpoint: cp,
            intentsA: intentsA.map(i => ({ ...i })),
            intentsB: intentsB.map(i => ({ ...i })),
          };

          // 1. Single round executed via normal ProductGameSession
          const seqSession = ProductGameSession.restore(cp, {
            strategyIdentityA: snapA.displayName,
            strategyIdentityB: snapB.displayName,
          });
          const seqRes = seqSession.playRound(intentsA.map(i => ({ ...i })), intentsB.map(i => ({ ...i })));

          // 2. Single round executed via CounterfactualBattleEngine
          const cfRes = CounterfactualBattleEngine.runCounterfactualRound(cfInput);

          // 3. Advance the main session loop
          session.playRound(intentsA, intentsB);

          totalRoundsCompared++;
          if (
            cfRes.roundWinner === seqRes.roundWinner &&
            cfRes.p1ScoreDelta === seqRes.p1ScoreDelta &&
            cfRes.p2ScoreDelta === seqRes.p2ScoreDelta &&
            cfRes.p1Score === seqRes.p1Score &&
            cfRes.p2Score === seqRes.p2Score
          ) {
            matchingRounds++;
          }

          equivalenceRecords.push({
            snapA: snapA.formationId,
            snapB: snapB.formationId,
            seed,
            round: r,
            cfWinner: cfRes.roundWinner,
            seqWinner: seqRes.roundWinner,
            match: cfRes.roundWinner === seqRes.roundWinner,
          });

          if (seqRes.isGameOver) break;
        }
      }
    }
  }

  assert.strictEqual(matchingRounds, totalRoundsCompared, `Single-round counterfactual engine must 100% match playRound (${matchingRounds}/${totalRoundsCompared})`);
  EvidenceWriter.writeJsonl('all2rush_g2_t112_round_equivalence.jsonl', equivalenceRecords);

  // 2. All2Rush Adverse Round Counterfactual Backtrack Search (Budgets 16 vs 32)
  const lossMatchSession = ProductGameSession.create(boomSnap.team, rushSnap.team, {
    seed: 1,
    strategyIdentityA: boomSnap.displayName,
    strategyIdentityB: rushSnap.displayName,
  });

  const boomStrat = treeStrategyFor(boomSnap.evol);
  const rushStrat = treeStrategyFor(rushSnap.evol);

  // Advance to adverse round (e.g. Round 2)
  const r1CtxA = lossMatchSession.buildRoundContext(1);
  const r1CtxB = lossMatchSession.buildRoundContext(2);
  lossMatchSession.playRound(boomStrat(r1CtxA), rushStrat(r1CtxB));

  const r2Cp = lossMatchSession.captureCheckpointBeforeRound(2);
  const r2CtxA = lossMatchSession.buildRoundContext(1);
  const r2CtxB = lossMatchSession.buildRoundContext(2);
  const baseIntentsA = boomStrat(r2CtxA);
  const baseIntentsB = rushStrat(r2CtxB);

  // Generate Counterfactual Proposals for R2 (Board Overrides + Deployment Shifts)
  const seenFp = new Set<string>();
  let executedCount = 0;
  const existingMonsterDbId = 110; // e.g. Slime on board

  for (let dx = -2; dx <= 2; dx++) {
    for (let dy = -2; dy <= 2; dy++) {
      const proposalInput: CounterfactualRoundInput = {
        round: 2,
        seed: 1,
        p1Score: lossMatchSession.p1Score,
        p2Score: lossMatchSession.p2Score,
        p1Budget: r2Cp.p1RemainingBudget,
        p2Budget: r2Cp.p2RemainingBudget,
        teamA: boomSnap.team,
        teamB: rushSnap.team,
        strategyIdentityA: boomSnap.displayName,
        strategyIdentityB: rushSnap.displayName,
        preRoundCheckpoint: r2Cp,
        intentsA: baseIntentsA,
        intentsB: baseIntentsB.map(i => ({ ...i, plannedX: Math.max(6, Math.min(10, i.plannedX + dx)), plannedY: Math.max(0, Math.min(4, i.plannedY + dy)) })),
        targetSideExistingBoardOverrides: [
          { monsterId: existingMonsterDbId, overrideX: Math.max(6, Math.min(10, 8 + dx)), overrideY: Math.max(0, Math.min(4, 2 + dy)) }
        ],
      };

      const fp = CounterfactualBattleEngine.computeInputFingerprint(proposalInput);
      const isDup = seenFp.has(fp);
      seenFp.add(fp);

      proposals.push({
        proposalId: `prop_${dx}_${dy}`,
        fingerprint: fp,
        isDuplicate: isDup,
      });

      if (!isDup && executedCount < 32) {
        executedCount++;
        const res = CounterfactualBattleEngine.runCounterfactualRound(proposalInput);
        const trialRec = {
          trialId: `trial_${executedCount}`,
          fingerprint: fp,
          dx,
          dy,
          roundWinner: res.roundWinner,
          p2ScoreDelta: res.p2ScoreDelta,
          survivors: res.observableOutput.p2Survivors.length,
          improved: res.roundWinner === 2 || res.p2ScoreDelta > 0,
        };
        trials.push(trialRec);

        if (trialRec.improved) {
          localSolutions.push({
            solutionId: `SOL_R2_${fp}`,
            round: 2,
            dx,
            dy,
            fingerprint: fp,
            targetSideExistingBoardOverrides: proposalInput.targetSideExistingBoardOverrides,
            outcome: res.roundWinner === 2 ? 'W' : 'D',
          });
        }
      }
    }
  }

  // 3. Compare Budget 16 vs 32
  const b16Trials = trials.slice(0, 16);
  const b32Trials = trials.slice(0, 32);
  const b16Best = b16Trials.filter(t => t.improved).length;
  const b32Best = b32Trials.filter(t => t.improved).length;

  budgetComparison.push({
    case: 'LOSSC_R2_ALL2RUSH_VS_GOLDEN_BOOM',
    budget16Improvements: b16Best,
    budget32Improvements: b32Best,
    newImprovementsFrom17To32: Math.max(0, b32Best - b16Best),
  });

  // 4. Branch Assessment (Distinguish Local Tactical Finding vs Forward Runtime Branch)
  for (const sol of localSolutions) {
    branchAssessments.push({
      solutionId: sol.solutionId,
      hasExistingBoardOverride: (sol.targetSideExistingBoardOverrides ?? []).length > 0,
      decisionLegallyVisibleAtFork: false, // Relies on earlier R1 layout choice
      runtimeBranchStatus: 'WARM_START_TACTICAL_EVIDENCE_ONLY', // Not auto-promoted as narrow branch
    });
  }

  EvidenceWriter.writeJsonl('all2rush_g2_t112_round_proposals.jsonl', proposals);
  EvidenceWriter.writeJsonl('all2rush_g2_t112_round_trials.jsonl', trials);
  EvidenceWriter.writeJsonl('all2rush_g2_t112_budget_16_vs_32.jsonl', budgetComparison);
  EvidenceWriter.writeJsonl('all2rush_g2_t112_local_solutions.jsonl', localSolutions);
  EvidenceWriter.writeJsonl('all2rush_g2_t112_forward_branch_assessment.jsonl', branchAssessments);
  EvidenceWriter.writeJson('all2rush_g2_t112_summary.json', {
    status: 'OK',
    totalEquivalenceRounds: totalRoundsCompared,
    matchingEquivalenceRounds: matchingRounds,
    uniqueProposalsExecuted: executedCount,
    budget16BestImprovements: b16Best,
    budget32BestImprovements: b32Best,
    localSolutionsCount: localSolutions.length,
  });
});
