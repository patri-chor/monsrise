import '../src/engine/env';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FormationSnapshotResolver,
} from '../src/engine/tree/product_training/snapshot_resolver';
import { treeStrategyFor } from '../src/engine/tree/product_tree_strategy';
import { runFidelityComparison } from '../src/engine/tree/round_engine/fidelity_gate';
import { buildAll2RushLossCaseInventory } from '../src/engine/tree/round_engine/loss_case_inventory';
import {
  generateFocusedCandidatesForCase,
  runFocusedSearchOnLossCase,
  mergeAndPruneBranches,
  attachExecutableBranchesToEvol,
} from '../src/engine/tree/round_engine/branch_first_optimizer';
import { ProductGameSession } from '../src/engine/tree/round_engine/product_round_session';
import { PersistentSimPool } from '../src/engine/tree/persistent_pool';
import type { SimTaskMessage } from '../src/engine/tree/fine_grained_worker';
import { writeFileSync, appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

test('T104: Complete Generation 2 Active Snapshot Pilot, Parity Matrix & Worker Determinism', async () => {
  const resolver = FormationSnapshotResolver.getInstance();
  resolver.init();

  const outDir = resolve('reports/tree-cycle');
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  // 1. Pin Current Active Snapshots
  const rushSnapshot = resolver.resolveFormationSnapshot({ formationId: 't0:all2rush' });
  const boomSnapshot = resolver.resolveFormationSnapshot({ formationId: 't0:golden_boom' });
  const prayerSnapshot = resolver.resolveFormationSnapshot({ formationId: 't0:all2prayer' });

  const pilotManifest = {
    schemaVersion: 'ALL2RUSH_G2_T104_PILOT_MANIFEST_V1',
    target: {
      formationId: rushSnapshot.formationId,
      expectedFingerprint: rushSnapshot.canonicalFingerprint,
      policyFingerprint: rushSnapshot.calculatorPolicyFingerprint,
    },
    opponents: [
      {
        formationId: boomSnapshot.formationId,
        expectedFingerprint: boomSnapshot.canonicalFingerprint,
        policyFingerprint: boomSnapshot.calculatorPolicyFingerprint,
      },
      {
        formationId: prayerSnapshot.formationId,
        expectedFingerprint: prayerSnapshot.canonicalFingerprint,
        policyFingerprint: prayerSnapshot.calculatorPolicyFingerprint,
      },
    ],
    timestamp: new Date().toISOString(),
  };
  writeFileSync(resolve(outDir, 'all2rush_g2_t104_pilot_manifest.json'), JSON.stringify(pilotManifest, null, 2), 'utf8');

  // 2. Full Both-Side 16-Case Parity Matrix (2 opponents x 2 sides x 4 seeds)
  const rushStrat = treeStrategyFor(rushSnapshot.evol);
  const boomStrat = treeStrategyFor(boomSnapshot.evol);
  const prayerStrat = treeStrategyFor(prayerSnapshot.evol);

  const opponents = [
    { id: boomSnapshot.formationId, name: boomSnapshot.displayName, team: boomSnapshot.team, strat: boomStrat },
    { id: prayerSnapshot.formationId, name: prayerSnapshot.displayName, team: prayerSnapshot.team, strat: prayerStrat },
  ];
  const seeds = [1, 42, 100, 2024];
  let matrixPassed = 0;

  for (const opp of opponents) {
    for (const seed of seeds) {
      // Side 1 (Rush = p1)
      const resP1 = runFidelityComparison(rushSnapshot.team, opp.team, {
        seed,
        nameA: 'all2rush',
        nameB: opp.name,
        strategyA: rushStrat,
        strategyB: opp.strat,
        testCheckpointReplayAtRound: 2,
      });
      assert.strictEqual(resP1.match, true, `Side 1 parity failed for ${opp.name} on seed ${seed}`);
      assert.strictEqual(resP1.checkpointReplayMatch, true, `Side 1 checkpoint replay failed for ${opp.name} on seed ${seed}`);
      matrixPassed++;

      // Side 2 (Rush = p2)
      const resP2 = runFidelityComparison(opp.team, rushSnapshot.team, {
        seed,
        nameA: opp.name,
        nameB: 'all2rush',
        strategyA: opp.strat,
        strategyB: rushStrat,
        testCheckpointReplayAtRound: 2,
      });
      assert.strictEqual(resP2.match, true, `Side 2 parity failed for ${opp.name} on seed ${seed}`);
      assert.strictEqual(resP2.checkpointReplayMatch, true, `Side 2 checkpoint replay failed for ${opp.name} on seed ${seed}`);
      matrixPassed++;

      appendFileSync(
        resolve(outDir, 'all2rush_g2_t104_round_fidelity.jsonl'),
        JSON.stringify({ seed, opp: opp.id, side1: resP1.gameSummary, side2: resP2.gameSummary }) + '\n'
      );
    }
  }
  assert.strictEqual(matrixPassed, 16, 'Full 16-case both-side matrix must pass');

  // 3. Worker Determinism Tests (Same worker repeated, cross worker, pool destroy/recreate)
  const pool = new PersistentSimPool({ workerCount: 4, enableCpuMonitor: false });
  await pool.init();

  const taskSeed = 2024;
  const sampleTask: SimTaskMessage = {
    taskId: 't104_det_test_task_1',
    candidateIdx: 0,
    candidateFp: rushSnapshot.canonicalFingerprint,
    formationA: rushSnapshot.evol as any,
    opponentNameOrId: boomSnapshot.displayName,
    opponentFormation: boomSnapshot.evol as any,
    games: 1,
    seed: taskSeed,
    side: 1,
    executionMode: 'product_path',
  };

  const run1 = await pool.dispatchTasks([sampleTask]);
  const run2 = await pool.dispatchTasks([sampleTask]);
  assert.strictEqual(run1[0].w, run2[0].w, 'Repeated worker execution must produce identical win count');
  assert.strictEqual(run1[0].d, run2[0].d, 'Repeated worker execution must produce identical draw count');
  assert.strictEqual(run1[0].l, run2[0].l, 'Repeated worker execution must produce identical loss count');

  // Recreated pool determinism
  pool.destroy();
  const pool2 = new PersistentSimPool({ workerCount: 4, enableCpuMonitor: false });
  await pool2.init();
  const run3 = await pool2.dispatchTasks([sampleTask]);
  pool2.destroy();

  assert.strictEqual(run1[0].w, run3[0].w, 'Recreated pool execution must produce identical win count');
  assert.strictEqual(run1[0].l, run3[0].l, 'Recreated pool execution must produce identical loss count');
  appendFileSync(
    resolve(outDir, 'all2rush_g2_t104_worker_determinism.jsonl'),
    JSON.stringify({ task: sampleTask.taskId, r1: run1[0], r2: run2[0], r3: run3[0], deterministic: true }) + '\n'
  );

  // 4. Exact Snapshot Loss Cases & Focused Pilot Search
  const lossCases = buildAll2RushLossCaseInventory(rushSnapshot, [
    { formationId: boomSnapshot.formationId },
    { formationId: prayerSnapshot.formationId },
  ]);
  assert.ok(lossCases.length > 0, 'Must inventory exact active loss cases');
  writeFileSync(resolve(outDir, 'all2rush_g2_t104_loss_cases.jsonl'), lossCases.map(c => JSON.stringify(c)).join('\n') + '\n');

  const primaryLossCase = lossCases[0];
  const candidates = generateFocusedCandidatesForCase(primaryLossCase, rushSnapshot.evol, 48);
  const searchResult = runFocusedSearchOnLossCase(primaryLossCase, rushSnapshot.evol, candidates);
  assert.strictEqual(searchResult.allTrials.length, candidates.length);
  writeFileSync(resolve(outDir, 'all2rush_g2_t104_local_trials.jsonl'), searchResult.allTrials.map(t => JSON.stringify(t)).join('\n') + '\n');

  // 5. Exact Branch Runtime, Reuse vs Similar Warm Start Separation
  if (searchResult.improvedBranches.length > 0) {
    const branch = searchResult.improvedBranches[0];
    const branchedEvol = attachExecutableBranchesToEvol(rushSnapshot.evol, [branch]);
    const branchedStrat = treeStrategyFor(branchedEvol);

    // a. Exact source observation match
    const session = ProductGameSession.restore(primaryLossCase.preRCheckpoint, {
      strategyIdentityA: 'all2rush_branched',
      strategyIdentityB: primaryLossCase.opponentId,
    });
    const ctx = session.buildRoundContext(1);
    const intents = branchedStrat(ctx);
    assert.ok(intents.length > 0);
    assert.strictEqual(intents[0].branch?.branchId, `${branch.branchId}_r${branch.forkRound}`);

    // b. Similar observation (different side or missing key badge/monster) -> narrow branch NOT selected
    const nonMatchingCtx = {
      ...ctx,
      side: (ctx.side === 1 ? 2 : 1) as (1 | 2), // side mismatch
    };
    const nonMatchingIntents = branchedStrat(nonMatchingCtx);
    const selectedBranch = nonMatchingIntents[0]?.branch?.branchId;
    assert.notStrictEqual(selectedBranch, `${branch.branchId}_r${branch.forkRound}`, 'Narrow branch must NOT auto-execute on similar/non-matching observation');
  }

  // 6. Safe Merge and Prune (no empty mask)
  const { merged, pruned, activeLibrary } = mergeAndPruneBranches(searchResult.improvedBranches);
  writeFileSync(
    resolve(outDir, 'all2rush_g2_t104_merge_prune.jsonl'),
    JSON.stringify({ mergedCount: merged.length, prunedCount: pruned.length, activeCount: activeLibrary.length }) + '\n'
  );
  writeFileSync(resolve(outDir, 'all2rush_g2_t104_quarantine.jsonl'), '');
});
