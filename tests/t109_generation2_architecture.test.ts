import '../src/engine/env';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ProductMatchRunner,
  RoundCheckpointService,
  LossCaseService,
  LocalSearchService,
  BranchLibrary,
  EvidenceWriter,
} from '../src/engine/tree/product_training/generation2';
import { FormationSnapshotResolver } from '../src/engine/tree/product_training/snapshot_resolver';
import { treeStrategyFor } from '../src/engine/tree/product_tree_strategy';

test('T109: Generation 2 Architecture Consolidation & Service Orchestration', async () => {
  const resolver = FormationSnapshotResolver.getInstance();
  resolver.init();

  const rushSnap = resolver.resolveFormationSnapshot({ formationId: 't0:all2rush' });
  const boomSnap = resolver.resolveFormationSnapshot({ formationId: 't0:golden_boom' });
  const prayerSnap = resolver.resolveFormationSnapshot({ formationId: 't0:all2prayer' });

  // 1. Test ProductMatchRunner full match and observable output
  const matchRes = ProductMatchRunner.runFullMatch({
    teamA: rushSnap.team,
    teamB: boomSnap.team,
    seed: 1,
    nameA: rushSnap.displayName,
    nameB: boomSnap.displayName,
    strategyA: treeStrategyFor(rushSnap.evol),
    strategyB: treeStrategyFor(boomSnap.evol),
    collectDiagnostics: true,
  });

  assert.ok(matchRes.roundOutputs.length > 0);
  assert.ok(typeof matchRes.winner === 'number');

  // 2. Test LossCaseService queue building & ranking
  const lossQueue = LossCaseService.buildLossQueue(rushSnap, [boomSnap, prayerSnap], 4);
  assert.ok(lossQueue.length > 0 && lossQueue.length <= 4);

  // 3. Test LocalSearchService sampling & evaluation
  const targetCase = lossQueue[0];
  const candidates = LocalSearchService.sampleCandidates(targetCase, rushSnap.evol, 20);
  assert.ok(candidates.length > 0);

  const trialResults = LocalSearchService.evaluateCase(targetCase, boomSnap, candidates);
  assert.strictEqual(trialResults.length, candidates.length);

  // 4. Test BranchLibrary creation, confirmation & attachment
  const cand0 = candidates[0];
  const exactBranch = BranchLibrary.createExactCaseBranch(targetCase, cand0);
  assert.strictEqual(exactBranch.sourceLossCaseIds[0], targetCase.caseId);

  const confirmed = await BranchLibrary.confirmExactCaseBranch(exactBranch, targetCase, rushSnap.evol, boomSnap);
  assert.ok(confirmed);

  const branchedEvol = BranchLibrary.attachExecutableBranchesToEvol(rushSnap.evol, [exactBranch]);
  assert.ok(branchedEvol.root.children.length > 0);

  const { activeLibrary } = BranchLibrary.mergeAndPruneBranches([exactBranch]);
  assert.strictEqual(activeLibrary.length, 1);

  // 5. Test EvidenceWriter writes without throwing
  EvidenceWriter.writeJson('all2rush_g2_t109_arch_test.json', { status: 'OK', target: rushSnap.formationId });
  EvidenceWriter.writeJsonl('all2rush_g2_t109_arch_trials.jsonl', trialResults);
});
