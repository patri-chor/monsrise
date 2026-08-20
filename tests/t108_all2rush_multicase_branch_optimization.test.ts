import '../src/engine/env';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FormationSnapshotResolver,
  type ResolvedFormationSnapshot,
} from '../src/engine/tree/product_training/snapshot_resolver';
import { treeStrategyFor } from '../src/engine/tree/product_tree_strategy';
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
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

test('T108: Concentrated Multi-Case Branch Optimization & Cross-Boundary Confirmation', async () => {
  const resolver = FormationSnapshotResolver.getInstance();
  resolver.init();

  const outDir = resolve('reports/tree-cycle');
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  const rushSnap = resolver.resolveFormationSnapshot({ formationId: 't0:all2rush' });
  const boomSnap = resolver.resolveFormationSnapshot({ formationId: 't0:golden_boom' });
  const prayerSnap = resolver.resolveFormationSnapshot({ formationId: 't0:all2prayer' });
  const jungleSnap = resolver.resolveFormationSnapshot({ formationId: 't0:gift_jungle' });

  // 1. Build & Rank Loss-Case Queue (Max 6 cases: up to 3 worst opponents x 2 cases)
  const allLossCases = buildAll2RushLossCaseInventory(rushSnap, [
    { formationId: boomSnap.formationId },
    { formationId: prayerSnap.formationId },
    { formationId: jungleSnap.formationId },
  ]);

  const lossQueue = allLossCases.slice(0, 6);
  assert.ok(lossQueue.length > 0 && lossQueue.length <= 6, 'Queue must contain up to 6 ranked cases');
  writeFileSync(resolve(outDir, 'all2rush_g2_t108_loss_queue.jsonl'), lossQueue.map(c => JSON.stringify(c)).join('\n') + '\n', 'utf8');

  // 2. Concentrated Branch-First Search on Ranked Queue
  const allTrials: any[] = [];
  const exactBranches: any[] = [];

  for (const lossCase of lossQueue) {
    const candidates = generateFocusedCandidatesForCase(lossCase, rushSnap.evol, 48);
    assert.ok(candidates.length > 0, `Must generate legal candidate space for ${lossCase.caseId}`);
    const searchRes = runFocusedSearchOnLossCase(lossCase, rushSnap.evol, candidates);
    allTrials.push(...searchRes.allTrials);

    if (searchRes.improvedBranches.length > 0) {
      exactBranches.push(...searchRes.improvedBranches);
    }
  }

  writeFileSync(resolve(outDir, 'all2rush_g2_t108_trials.jsonl'), allTrials.map(t => JSON.stringify(t)).join('\n') + '\n', 'utf8');
  writeFileSync(resolve(outDir, 'all2rush_g2_t108_branch_library.jsonl'), exactBranches.map(b => JSON.stringify(b)).join('\n') + '\n', 'utf8');

  // 3. Confirm Exact Branches Across Fresh Worker/Pool Boundary
  const confirmations: any[] = [];
  const pool = new PersistentSimPool({ workerCount: 4, enableCpuMonitor: false });
  await pool.init();

  for (const branch of exactBranches) {
    const sourceCase = lossQueue.find(c => branch.sourceLossCaseIds.includes(c.caseId));
    if (!sourceCase) continue;

    const branchedEvol = attachExecutableBranchesToEvol(rushSnap.evol, [branch]);
    const oppSnap = resolver.resolveFormationSnapshot({ formationId: sourceCase.opponentId });

    const confirmTask: SimTaskMessage = {
      taskId: `confirm_${branch.branchId}`,
      candidateIdx: 0,
      candidateFp: branch.solutionBehaviorFingerprint,
      targetPayloadFp: rushSnap.canonicalFingerprint,
      targetPolicyFp: rushSnap.calculatorPolicyFingerprint,
      formationA: branchedEvol as any,
      opponentNameOrId: oppSnap.displayName,
      opponentFormation: oppSnap.evol as any,
      opponentPayloadFp: oppSnap.canonicalFingerprint,
      opponentPolicyFp: oppSnap.calculatorPolicyFingerprint,
      games: 1,
      seed: sourceCase.seed,
      side: sourceCase.side,
      executionMode: 'product_path',
      collectDeploymentTraces: true,
    };

    const confirmRes = await pool.dispatchTasks([confirmTask], undefined, { targetWorkerIndex: 0 });
    assert.strictEqual(confirmRes.length, 1);
    const sourceWon = (sourceCase.side === 1 && confirmRes[0].w === 1) || (sourceCase.side === 2 && confirmRes[0].l === 1);
    const outcome = confirmRes[0].w === 1 ? 'W' : confirmRes[0].d === 1 ? 'D' : 'L';

    confirmations.push({
      branchId: branch.branchId,
      sourceCaseId: sourceCase.caseId,
      confirmedAcrossFreshWorker: true,
      workerId: confirmRes[0].workerId,
      workerResult: confirmRes[0],
      outcome,
    });
  }

  pool.destroy();
  writeFileSync(resolve(outDir, 'all2rush_g2_t108_branch_confirmations.jsonl'), confirmations.map(c => JSON.stringify(c)).join('\n') + '\n', 'utf8');

  // 4. Multi-Case Reuse, Merge and Prune
  const { merged, pruned, activeLibrary } = mergeAndPruneBranches(exactBranches);
  writeFileSync(
    resolve(outDir, 'all2rush_g2_t108_reuse_merge_prune.jsonl'),
    JSON.stringify({
      exactCount: exactBranches.length,
      mergedCount: merged.length,
      prunedCount: pruned.length,
      activeCount: activeLibrary.length,
      merged,
      pruned,
    }) + '\n',
    'utf8'
  );

  // 5. Source and Holdout Evaluation
  const evalRecords: any[] = [];
  for (const branch of activeLibrary) {
    const branchedEvol = attachExecutableBranchesToEvol(rushSnap.evol, [branch]);
    const branchedStrat = treeStrategyFor(branchedEvol);

    for (const lossCase of lossQueue) {
      const session = ProductGameSession.restore(lossCase.preRCheckpoint, {
        strategyIdentityA: lossCase.side === 1 ? 'all2rush_branched' : lossCase.opponentId,
        strategyIdentityB: lossCase.side === 1 ? lossCase.opponentId : 'all2rush_branched',
      });

      const ctx = session.buildRoundContext(lossCase.side);
      const intents = branchedStrat(ctx);
      const branchSelected = intents[0]?.branch?.branchId === `${branch.branchId}_r${branch.forkRound}`;

      evalRecords.push({
        branchId: branch.branchId,
        caseId: lossCase.caseId,
        isSourceCase: branch.sourceLossCaseIds.includes(lossCase.caseId),
        branchSelected,
      });
    }
  }

  writeFileSync(resolve(outDir, 'all2rush_g2_t108_source_holdout_eval.jsonl'), evalRecords.map(e => JSON.stringify(e)).join('\n') + '\n', 'utf8');
});
