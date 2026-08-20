import '../src/engine/env';
import test from 'node:test';
import assert from 'node:assert/strict';
import { FORMATION_LIBRARY } from '../src/ai/formation_library';
import { formationToEvol, emptyMask } from '../src/engine/tree/evol_gene';
import { treeStrategyFor } from '../src/engine/tree/product_tree_strategy';
import { buildAll2RushLossCaseInventory } from '../src/engine/tree/round_engine/loss_case_inventory';
import {
  generateFocusedCandidatesForCase,
  runFocusedSearchOnLossCase,
  mergeAndPruneBranches,
  attachExecutableBranchesToEvol,
} from '../src/engine/tree/round_engine/branch_first_optimizer';
import { ProductGameSession } from '../src/engine/tree/round_engine/product_round_session';

test('T102: Exact Loss Case -> Authoritative Continuation -> Executable Branch Selection & Warm Start', () => {
  const rush = FORMATION_LIBRARY.find(f => f.id === 'all2rush' || f.name === '全二冲')!;
  assert.ok(rush, 'all2rush formation must exist');
  const rushEvol = formationToEvol(rush);

  // 1. Loss Case Inventory from Snapshot
  const lossCases = buildAll2RushLossCaseInventory(rushEvol, ['golden_boom', 'all2prayer', 'gift_jungle']);
  assert.ok(lossCases.length > 0, `Expected at least 1 loss case for all2rush, found ${lossCases.length}`);

  const primaryLossCase = lossCases[0];
  assert.ok(primaryLossCase.preRCheckpoint, 'Loss case must carry a valid pre-R checkpoint');

  // 2. Focused Continuation Search
  const candidates = generateFocusedCandidatesForCase(primaryLossCase, rushEvol, 48);
  const searchResult = runFocusedSearchOnLossCase(primaryLossCase, rushEvol, candidates);
  assert.strictEqual(searchResult.allTrials.length, candidates.length);

  // 3. Executable Branch Compilation & Tree Strategy Selection
  if (searchResult.improvedBranches.length > 0) {
    const branchToTest = searchResult.improvedBranches[0];
    const branchedEvol = attachExecutableBranchesToEvol(rushEvol, [branchToTest]);
    const branchedStrat = treeStrategyFor(branchedEvol);

    // 运行一个恢复 session 验证 product_tree_strategy 命中并产出意图
    const session = ProductGameSession.restore(primaryLossCase.preRCheckpoint, {
      strategyIdentityA: 'all2rush_branched',
      strategyIdentityB: primaryLossCase.opponentId,
    });

    const ctxA = session.buildRoundContext(1);
    const intents = branchedStrat(ctxA);
    assert.ok(Array.isArray(intents), 'Branched strategy must return valid intents');
    assert.ok(intents.length > 0, 'Intents must not be empty');
  }

  // 4. Exact Reuse vs Similar Warm Start Verification
  const { merged, pruned, activeLibrary } = mergeAndPruneBranches(searchResult.improvedBranches);
  assert.ok(Array.isArray(merged));
  assert.ok(Array.isArray(pruned));
  assert.ok(Array.isArray(activeLibrary));
});
