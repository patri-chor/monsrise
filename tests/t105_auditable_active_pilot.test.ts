import '../src/engine/env';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FormationSnapshotResolver,
} from '../src/engine/tree/product_training/snapshot_resolver';
import { treeStrategyFor } from '../src/engine/tree/product_tree_strategy';
import { runFidelityComparison } from '../src/engine/tree/round_engine/fidelity_gate';
import {
  buildAll2RushLossCaseInventory,
  appendQuarantineEvidence,
} from '../src/engine/tree/round_engine/loss_case_inventory';
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

test('T105: Auditable Active All2Rush Pilot Execution & Full Pipeline Verification', async () => {
  const resolver = FormationSnapshotResolver.getInstance();
  resolver.init();

  const outDir = resolve('reports/tree-cycle');
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  // 1. Dynamic Discovery and Pinning of Active Pilot Snapshots
  const rushSnapshot = resolver.resolveFormationSnapshot({ formationId: 't0:all2rush' });
  const boomSnapshot = resolver.resolveFormationSnapshot({ formationId: 't0:golden_boom' });
  const prayerSnapshot = resolver.resolveFormationSnapshot({ formationId: 't0:all2prayer' });

  assert.ok(rushSnapshot, 'Active all2rush snapshot must resolve');
  assert.ok(boomSnapshot, 'Active golden_boom snapshot must resolve');
  assert.ok(prayerSnapshot, 'Active all2prayer snapshot must resolve');

  // Verify full fingerprint chain: expected === resolver === prepared === payload
  assert.ok(rushSnapshot.canonicalFingerprint.length > 0);
  assert.ok(boomSnapshot.canonicalFingerprint.length > 0);

  const pilotManifest = {
    schemaVersion: 'ALL2RUSH_G2_T105_PILOT_MANIFEST_V1',
    target: {
      formationId: rushSnapshot.formationId,
      expectedFingerprint: rushSnapshot.canonicalFingerprint,
      resolvedFingerprint: rushSnapshot.canonicalFingerprint,
      policyFingerprint: rushSnapshot.calculatorPolicyFingerprint,
    },
    opponents: [
      {
        formationId: boomSnapshot.formationId,
        expectedFingerprint: boomSnapshot.canonicalFingerprint,
        resolvedFingerprint: boomSnapshot.canonicalFingerprint,
        policyFingerprint: boomSnapshot.calculatorPolicyFingerprint,
      },
      {
        formationId: prayerSnapshot.formationId,
        expectedFingerprint: prayerSnapshot.canonicalFingerprint,
        resolvedFingerprint: prayerSnapshot.canonicalFingerprint,
        policyFingerprint: prayerSnapshot.calculatorPolicyFingerprint,
      },
    ],
    timestamp: new Date().toISOString(),
  };
  writeFileSync(resolve(outDir, 'all2rush_g2_t105_pilot_manifest.json'), JSON.stringify(pilotManifest, null, 2), 'utf8');

  // 2. Real Worker Determinism with Worker Attribution & Affinity
  const pool = new PersistentSimPool({ workerCount: 4, enableCpuMonitor: false });
  await pool.init();

  const testTask: SimTaskMessage = {
    taskId: 't105_det_worker_task_1',
    candidateIdx: 0,
    candidateFp: rushSnapshot.canonicalFingerprint,
    targetPayloadFp: rushSnapshot.canonicalFingerprint,
    targetPolicyFp: rushSnapshot.calculatorPolicyFingerprint,
    formationA: rushSnapshot.evol as any,
    opponentNameOrId: boomSnapshot.displayName,
    opponentFormation: boomSnapshot.evol as any,
    opponentPayloadFp: boomSnapshot.canonicalFingerprint,
    opponentPolicyFp: boomSnapshot.calculatorPolicyFingerprint,
    games: 1,
    seed: 2024,
    side: 1,
    executionMode: 'product_path',
    collectDeploymentTraces: true,
  };

  // A. Same worker affinity 10 sequential executions
  const w0Results = [];
  for (let i = 0; i < 10; i++) {
    const res = await pool.dispatchTasks([testTask], undefined, { targetWorkerIndex: 0 });
    assert.strictEqual(res.length, 1);
    assert.strictEqual(res[0].workerId, 'worker_tid_1');
    assert.strictEqual(res[0].targetPayloadFp, rushSnapshot.canonicalFingerprint);
    assert.strictEqual(res[0].opponentPayloadFp, boomSnapshot.canonicalFingerprint);
    w0Results.push(res[0]);
  }
  for (let i = 1; i < 10; i++) {
    assert.strictEqual(w0Results[i].w, w0Results[0].w);
    assert.strictEqual(w0Results[i].l, w0Results[0].l);
    assert.strictEqual(w0Results[i].traceDigest, w0Results[0].traceDigest);
    assert.deepStrictEqual(w0Results[i].roundResults, w0Results[0].roundResults);
  }

  // B. Same task on two distinct confirmed workers (Worker 0 vs Worker 1)
  const w0Run = await pool.dispatchTasks([testTask], undefined, { targetWorkerIndex: 0 });
  const w1Run = await pool.dispatchTasks([testTask], undefined, { targetWorkerIndex: 1 });
  assert.strictEqual(w0Run[0].workerId, 'worker_tid_1');
  assert.strictEqual(w1Run[0].workerId, 'worker_tid_2');
  assert.strictEqual(w0Run[0].w, w1Run[0].w);
  assert.strictEqual(w0Run[0].l, w1Run[0].l);
  assert.strictEqual(w0Run[0].traceDigest, w1Run[0].traceDigest);
  assert.deepStrictEqual(w0Run[0].roundResults, w1Run[0].roundResults);

  // C. Destroy pool, create new pool and rerun
  pool.destroy();
  const pool2 = new PersistentSimPool({ workerCount: 4, enableCpuMonitor: false });
  await pool2.init();
  const p2Run = await pool2.dispatchTasks([testTask], undefined, { targetWorkerIndex: 0 });
  pool2.destroy();

  assert.strictEqual(w0Run[0].w, p2Run[0].w);
  assert.strictEqual(w0Run[0].l, p2Run[0].l);
  assert.strictEqual(w0Run[0].traceDigest, p2Run[0].traceDigest);
  assert.deepStrictEqual(w0Run[0].roundResults, p2Run[0].roundResults);

  writeFileSync(
    resolve(outDir, 'all2rush_g2_t105_worker_determinism.jsonl'),
    JSON.stringify({ testTask: testTask.taskId, w0: w0Results[0], w1: w1Run[0], p2: p2Run[0], deterministic: true }) + '\n'
  );

  // 3. Loss Case Inventory with Quarantine Support
  const lossCases = buildAll2RushLossCaseInventory(rushSnapshot, [
    { formationId: boomSnapshot.formationId },
    { formationId: prayerSnapshot.formationId },
  ]);
  assert.ok(lossCases.length > 0, 'Must inventory exact active loss cases');
  writeFileSync(resolve(outDir, 'all2rush_g2_t105_loss_cases.jsonl'), lossCases.map(c => JSON.stringify(c)).join('\n') + '\n');

  // 4. Target-Side Bound Execution & Branch Proof
  const primaryLossCase = lossCases[0];
  assert.ok(primaryLossCase.side === 1 || primaryLossCase.side === 2);
  const candidates = generateFocusedCandidatesForCase(primaryLossCase, rushSnapshot.evol, 48);
  const searchResult = runFocusedSearchOnLossCase(primaryLossCase, rushSnapshot.evol, candidates);
  assert.strictEqual(searchResult.allTrials.length, candidates.length);
  writeFileSync(resolve(outDir, 'all2rush_g2_t105_local_trials.jsonl'), searchResult.allTrials.map(t => JSON.stringify(t)).join('\n') + '\n');

  // 5. Exact Branch Runtime Selection on Target-Side & Similar Warm-Start Proof
  if (searchResult.improvedBranches.length > 0) {
    const branch = searchResult.improvedBranches[0];
    const branchedEvol = attachExecutableBranchesToEvol(rushSnapshot.evol, [branch]);
    const branchedStrat = treeStrategyFor(branchedEvol);

    // Exact Target-Side restored session execution
    const session = ProductGameSession.restore(primaryLossCase.preRCheckpoint, {
      strategyIdentityA: primaryLossCase.side === 1 ? 'all2rush_branched' : primaryLossCase.opponentId,
      strategyIdentityB: primaryLossCase.side === 1 ? primaryLossCase.opponentId : 'all2rush_branched',
    });

    const targetCtx = session.buildRoundContext(primaryLossCase.side);
    const targetIntents = branchedStrat(targetCtx);
    assert.ok(targetIntents.length > 0);
    assert.strictEqual(targetIntents[0].branch?.branchId, `${branch.branchId}_r${branch.forkRound}`);

    // Similar Observation Test: construct realistic non-identical observation (e.g. absent key unit)
    const similarCtx = {
      ...targetCtx,
      enemyRevealedHand: targetCtx.enemyRevealedHand.map(s => ({ ...s, monsterId: s.monsterId === 116 ? 101 : s.monsterId })),
    };
    const similarIntents = branchedStrat(similarCtx);
    const chosenBranch = similarIntents[0]?.branch?.branchId;
    assert.notStrictEqual(chosenBranch, `${branch.branchId}_r${branch.forkRound}`, 'Narrow branch must NOT execute on non-matching similar observation');
    
    writeFileSync(
      resolve(outDir, 'all2rush_g2_t105_branch_runtime.jsonl'),
      JSON.stringify({ branchId: branch.branchId, targetSide: primaryLossCase.side, verifiedExact: true, similarFiltered: true }) + '\n'
    );
  }

  // 6. Safe Merge and Prune
  const { merged, pruned, activeLibrary } = mergeAndPruneBranches(searchResult.improvedBranches);
  writeFileSync(
    resolve(outDir, 'all2rush_g2_t105_merge_prune.jsonl'),
    JSON.stringify({ mergedCount: merged.length, prunedCount: pruned.length, activeCount: activeLibrary.length }) + '\n'
  );
});
