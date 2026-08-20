import '../src/engine/env';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FormationSnapshotResolver,
} from '../src/engine/tree/product_training/snapshot_resolver';
import { treeStrategyFor } from '../src/engine/tree/product_tree_strategy';
import { runFidelityComparison, appendFidelityEvidence } from '../src/engine/tree/round_engine/fidelity_gate';
import { buildAll2RushLossCaseInventory } from '../src/engine/tree/round_engine/loss_case_inventory';
import {
  generateFocusedCandidatesForCase,
  runFocusedSearchOnLossCase,
  mergeAndPruneBranches,
  attachExecutableBranchesToEvol,
} from '../src/engine/tree/round_engine/branch_first_optimizer';
import { ProductGameSession } from '../src/engine/tree/round_engine/product_round_session';

test('T103: Comprehensive Generation 2 Verified State & Real Branch Runtime', () => {
  const resolver = FormationSnapshotResolver.getInstance();
  resolver.init();

  // 1. Exact Snapshot Resolution via T053R chain
  const rushSnapshot = resolver.resolveFormationSnapshot({ formationId: 't0:all2rush' });
  const boomSnapshot = resolver.resolveFormationSnapshot({ formationId: 't0:golden_boom' });
  const prayerSnapshot = resolver.resolveFormationSnapshot({ formationId: 't0:all2prayer' });

  assert.ok(rushSnapshot, 'all2rush exact snapshot must be resolved');
  assert.ok(boomSnapshot, 'golden_boom exact snapshot must be resolved');
  assert.ok(prayerSnapshot, 'all2prayer exact snapshot must be resolved');

  const rushStrat = treeStrategyFor(rushSnapshot.evol);
  const boomStrat = treeStrategyFor(boomSnapshot.evol);
  const prayerStrat = treeStrategyFor(prayerSnapshot.evol);

  // 2. Full Round-State Fidelity & Checkpoint Replay Parity (16 games matrix)
  const opponents = [
    { name: boomSnapshot.displayName, team: boomSnapshot.team, strat: boomStrat },
    { name: prayerSnapshot.displayName, team: prayerSnapshot.team, strat: prayerStrat },
  ];
  const seeds = [1, 42, 100, 2024];

  for (const opp of opponents) {
    for (const seed of seeds) {
      const res = runFidelityComparison(
        rushSnapshot.team,
        opp.team,
        {
          seed,
          nameA: 'all2rush',
          nameB: opp.name,
          strategyA: rushStrat,
          strategyB: opp.strat,
          testCheckpointReplayAtRound: 2,
        }
      );
      assert.strictEqual(res.match, true, `Fidelity failed for seed ${seed} vs ${opp.name}: ${res.diffs.join('; ')}`);
      assert.strictEqual(res.checkpointReplayMatch, true, `Checkpoint replay failed for seed ${seed}`);
      appendFidelityEvidence({ side: 1, target: 'all2rush', opponent: opp.name, seed, result: res.gameSummary });
    }
  }

  // 3. Loss Inventory using exact snapshots
  const lossCases = buildAll2RushLossCaseInventory(rushSnapshot, [
    { formationId: 't0:golden_boom' },
    { formationId: 't0:all2prayer' },
  ]);
  assert.ok(lossCases.length > 0, 'Must identify exact loss cases');

  const primaryLossCase = lossCases[0];
  assert.ok(typeof primaryLossCase.preRCheckpoint.checkpointFingerprint === 'string' && primaryLossCase.preRCheckpoint.checkpointFingerprint.length > 0, 'Checkpoint must carry full semantic fingerprint');

  // 4. Multi-variable Focused Continuation Search
  const candidates = generateFocusedCandidatesForCase(primaryLossCase, rushSnapshot.evol, 48);
  const searchResult = runFocusedSearchOnLossCase(primaryLossCase, rushSnapshot.evol, candidates);
  assert.strictEqual(searchResult.allTrials.length, candidates.length);

  // 5. Executable Branch Compilation, Runtime Selection & Exact Reuse
  if (searchResult.improvedBranches.length > 0) {
    const branch = searchResult.improvedBranches[0];
    assert.notStrictEqual(branch.condition.main, null, 'Branch mask must be legally derived from observed archetype, not empty');

    const branchedEvol = attachExecutableBranchesToEvol(rushSnapshot.evol, [branch]);
    const branchedStrat = treeStrategyFor(branchedEvol);

    const session = ProductGameSession.restore(primaryLossCase.preRCheckpoint, {
      strategyIdentityA: 'all2rush_branched',
      strategyIdentityB: primaryLossCase.opponentId,
    });

    const ctx = session.buildRoundContext(1);
    const intents = branchedStrat(ctx);
    assert.ok(intents.length > 0, 'Strategy must select and return deployment intents');
    assert.ok(intents[0].branch !== null, 'Intents must carry branch provenance');
    assert.strictEqual(intents[0].branch?.branchId, `${branch.branchId}_r${branch.forkRound}`, 'Chosen branchId must match stored branch ID');
  }

  // 6. Safe Merge and Prune: verify no emptyMask creation on merge
  const { merged, pruned, activeLibrary } = mergeAndPruneBranches(searchResult.improvedBranches);
  for (const m of merged) {
    assert.ok(
      m.condition.main !== null || m.condition.side !== null || m.condition.subs.length > 0 || m.condition.keys.length > 0,
      'Merged branch condition must NEVER be an empty/default mask'
    );
  }
});
