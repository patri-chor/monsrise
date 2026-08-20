import '../src/engine/env';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FormationSnapshotResolver,
  type ResolvedFormationSnapshot,
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

test('T107: Bulk Observable Round Parity and All2Rush Search', async () => {
  const resolver = FormationSnapshotResolver.getInstance();
  resolver.init();

  const outDir = resolve('reports/tree-cycle');
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  // 1. Resolve Available Exact Formation Snapshots
  const candidateFormationIds = [
    't0:all2rush',
    't0:golden_boom',
    't0:all2prayer',
    't0:gift_jungle',
    't0:burst_assassin',
    't0:shield_guard',
    't0:voodoo_curse',
    't0:ice_control',
  ];

  const resolvedSnapshots: ResolvedFormationSnapshot[] = [];
  for (const id of candidateFormationIds) {
    try {
      const snap = resolver.resolveFormationSnapshot({ formationId: id });
      resolvedSnapshots.push(snap);
    } catch {
      // Record only valid snapshots available in corpus
    }
  }

  assert.ok(resolvedSnapshots.length >= 3, 'Must have at least 3 distinct exact formation snapshots');

  const formationManifest = {
    schemaVersion: 'ALL2RUSH_G2_T107_FORMATION_MANIFEST_V1',
    timestamp: new Date().toISOString(),
    formations: resolvedSnapshots.map(s => ({
      formationId: s.formationId,
      canonicalFingerprint: s.canonicalFingerprint,
      calculatorPolicyFingerprint: s.calculatorPolicyFingerprint,
    })),
  };
  writeFileSync(resolve(outDir, 'all2rush_g2_t107_formation_manifest.json'), JSON.stringify(formationManifest, null, 2), 'utf8');

  // 2. Broad Actual-Battle Observable Parity Matrix (Both sides x Multiple Seeds)
  const seeds = [1, 7, 42, 100, 555, 999, 1337, 2024];
  let matrixTotal = 0;
  let matrixPassed = 0;

  const parityRecords: any[] = [];
  const diagnostics: any[] = [];

  const rushSnap = resolvedSnapshots.find(s => s.formationId.includes('all2rush'))!;
  const rushStrat = treeStrategyFor(rushSnap.evol);

  for (const oppSnap of resolvedSnapshots) {
    if (oppSnap.formationId === rushSnap.formationId) continue;
    const oppStrat = treeStrategyFor(oppSnap.evol);

    for (const seed of seeds) {
      // Mode A vs B vs C on Side 1
      const resSide1 = runFidelityComparison(rushSnap.team, oppSnap.team, {
        seed,
        nameA: rushSnap.displayName,
        nameB: oppSnap.displayName,
        strategyA: rushStrat,
        strategyB: oppStrat,
        testCheckpointReplayAtRound: 2,
      });

      matrixTotal++;
      if (resSide1.match && resSide1.checkpointReplayMatch) {
        matrixPassed++;
      } else {
        diagnostics.push({ side: 1, target: rushSnap.formationId, opp: oppSnap.formationId, seed, diffs: resSide1.diffs });
      }

      // Mode A vs B vs C on Side 2
      const resSide2 = runFidelityComparison(oppSnap.team, rushSnap.team, {
        seed,
        nameA: oppSnap.displayName,
        nameB: rushSnap.displayName,
        strategyA: oppStrat,
        strategyB: rushStrat,
        testCheckpointReplayAtRound: 2,
      });

      matrixTotal++;
      if (resSide2.match && resSide2.checkpointReplayMatch) {
        matrixPassed++;
      } else {
        diagnostics.push({ side: 2, target: rushSnap.formationId, opp: oppSnap.formationId, seed, diffs: resSide2.diffs });
      }

      parityRecords.push({
        seed,
        target: rushSnap.formationId,
        opponent: oppSnap.formationId,
        side1: resSide1.gameSummary,
        side2: resSide2.gameSummary,
        match: resSide1.match && resSide2.match,
      });
    }
  }

  writeFileSync(resolve(outDir, 'all2rush_g2_t107_round_parity.jsonl'), parityRecords.map(r => JSON.stringify(r)).join('\n') + '\n', 'utf8');
  writeFileSync(resolve(outDir, 'all2rush_g2_t107_mismatch_diagnostics.jsonl'), diagnostics.map(d => JSON.stringify(d)).join('\n') + '\n', 'utf8');

  assert.strictEqual(matrixPassed, matrixTotal, `Every actual-battle observable parity case must pass (${matrixPassed}/${matrixTotal})`);

  // 3. Cross-Worker Observable Stability
  const pool = new PersistentSimPool({ workerCount: 4, enableCpuMonitor: false });
  await pool.init();

  const opp1 = resolvedSnapshots.find(s => s.formationId !== rushSnap.formationId)!;
  const sampleStabilityTask: SimTaskMessage = {
    taskId: 't107_stab_task_1',
    candidateIdx: 0,
    candidateFp: rushSnap.canonicalFingerprint,
    targetPayloadFp: rushSnap.canonicalFingerprint,
    targetPolicyFp: rushSnap.calculatorPolicyFingerprint,
    formationA: rushSnap.evol as any,
    opponentNameOrId: opp1.displayName,
    opponentFormation: opp1.evol as any,
    opponentPayloadFp: opp1.canonicalFingerprint,
    opponentPolicyFp: opp1.calculatorPolicyFingerprint,
    games: 1,
    seed: 2024,
    side: 1,
    executionMode: 'product_path',
    collectDeploymentTraces: true,
  };

  // 10 times on single worker
  const w0Runs = [];
  for (let i = 0; i < 10; i++) {
    const res = await pool.dispatchTasks([sampleStabilityTask], undefined, { targetWorkerIndex: 0 });
    w0Runs.push(res[0]);
  }
  for (let i = 1; i < 10; i++) {
    assert.strictEqual(w0Runs[i].w, w0Runs[0].w);
    assert.strictEqual(w0Runs[i].l, w0Runs[0].l);
    assert.deepStrictEqual(w0Runs[i].roundResults, w0Runs[0].roundResults);
    assert.strictEqual(w0Runs[i].traceDigest, w0Runs[0].traceDigest);
  }

  // Cross worker
  const w1Run = await pool.dispatchTasks([sampleStabilityTask], undefined, { targetWorkerIndex: 1 });
  assert.strictEqual(w1Run[0].w, w0Runs[0].w);
  assert.strictEqual(w1Run[0].l, w0Runs[0].l);
  assert.deepStrictEqual(w1Run[0].roundResults, w0Runs[0].roundResults);

  // Pool destroy / recreate
  pool.destroy();
  const pool2 = new PersistentSimPool({ workerCount: 4, enableCpuMonitor: false });
  await pool2.init();
  const p2Run = await pool2.dispatchTasks([sampleStabilityTask], undefined, { targetWorkerIndex: 0 });
  pool2.destroy();

  assert.strictEqual(p2Run[0].w, w0Runs[0].w);
  assert.strictEqual(p2Run[0].l, w0Runs[0].l);
  assert.deepStrictEqual(p2Run[0].roundResults, w0Runs[0].roundResults);

  writeFileSync(
    resolve(outDir, 'all2rush_g2_t107_worker_stability.jsonl'),
    JSON.stringify({ task: sampleStabilityTask.taskId, singleWorker10x: true, crossWorker: true, poolRecreate: true }) + '\n',
    'utf8'
  );

  // 4. All2Rush Focused Search on Actual Loss Cases
  const lossCases = buildAll2RushLossCaseInventory(
    rushSnap,
    resolvedSnapshots.filter(s => s.formationId !== rushSnap.formationId).map(s => ({ formationId: s.formationId }))
  );
  assert.ok(lossCases.length > 0, 'Must inventory actual loss cases');
  writeFileSync(resolve(outDir, 'all2rush_g2_t107_loss_cases.jsonl'), lossCases.map(c => JSON.stringify(c)).join('\n') + '\n', 'utf8');

  const primaryLossCase = lossCases[0];
  const candidates = generateFocusedCandidatesForCase(primaryLossCase, rushSnap.evol, 48);
  const searchResult = runFocusedSearchOnLossCase(primaryLossCase, rushSnap.evol, candidates);
  assert.strictEqual(searchResult.allTrials.length, candidates.length);

  writeFileSync(resolve(outDir, 'all2rush_g2_t107_local_trials.jsonl'), searchResult.allTrials.map(t => JSON.stringify(t)).join('\n') + '\n', 'utf8');

  // 5. Branch Semantics and Observable Outcome
  if (searchResult.improvedBranches.length > 0) {
    const branch = searchResult.improvedBranches[0];
    const branchedEvol = attachExecutableBranchesToEvol(rushSnap.evol, [branch]);
    const branchedStrat = treeStrategyFor(branchedEvol);

    const session = ProductGameSession.restore(primaryLossCase.preRCheckpoint, {
      strategyIdentityA: primaryLossCase.side === 1 ? 'all2rush_branched' : primaryLossCase.opponentId,
      strategyIdentityB: primaryLossCase.side === 1 ? primaryLossCase.opponentId : 'all2rush_branched',
    });

    const targetCtx = session.buildRoundContext(primaryLossCase.side);
    const targetIntents = branchedStrat(targetCtx);
    assert.ok(targetIntents.length > 0);
    assert.strictEqual(targetIntents[0].branch?.branchId, `${branch.branchId}_r${branch.forkRound}`);

    // Verify similar observation does not trigger branch
    const similarCtx = {
      ...targetCtx,
      enemyRevealedHand: targetCtx.enemyRevealedHand.map(s => ({ ...s, monsterId: s.monsterId === 116 ? 101 : s.monsterId })),
    };
    const similarIntents = branchedStrat(similarCtx);
    assert.notStrictEqual(similarIntents[0]?.branch?.branchId, `${branch.branchId}_r${branch.forkRound}`);

    writeFileSync(
      resolve(outDir, 'all2rush_g2_t107_branch_results.jsonl'),
      JSON.stringify({ outcome: 'EXACT_CASE_BRANCH_CREATED', branchId: branch.branchId, forkRound: branch.forkRound }) + '\n',
      'utf8'
    );
  } else {
    writeFileSync(
      resolve(outDir, 'all2rush_g2_t107_branch_results.jsonl'),
      JSON.stringify({ outcome: 'NO_LOCAL_IMPROVEMENT_FOUND' }) + '\n',
      'utf8'
    );
  }
});
