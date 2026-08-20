import '../src/engine/env';
import test from 'node:test';
import assert from 'node:assert/strict';
import { FORMATION_LIBRARY } from '../src/ai/formation_library';
import { formationToEvol } from '../src/engine/tree/evol_gene';
import { buildAll2RushLossCaseInventory } from '../src/engine/tree/round_engine/loss_case_inventory';
import {
  generateFocusedCandidatesForCase,
  runFocusedSearchOnLossCase,
  mergeAndPruneBranches,
} from '../src/engine/tree/round_engine/branch_first_optimizer';

test('T101 B, C, D, E: Loss Case Inventory, Multi-Variable Focused Search & Branch-First Lifecycle', () => {
  const rush = FORMATION_LIBRARY.find(f => f.id === 'all2rush' || f.name === '全二冲')!;
  assert.ok(rush, 'all2rush formation must exist');
  const rushEvol = formationToEvol(rush);

  // 1. Loss Case Inventory
  const lossCases = buildAll2RushLossCaseInventory(rushEvol, ['golden_boom', 'all2prayer', 'gift_jungle']);
  assert.ok(lossCases.length > 0, `Expected at least 1 loss case for all2rush, found ${lossCases.length}`);

  const primaryLossCase = lossCases[0];
  assert.ok(primaryLossCase.caseId, 'Loss case must have a valid case ID');
  assert.ok(primaryLossCase.preRCheckpoint, 'Loss case must carry a valid pre-R checkpoint');
  assert.strictEqual(primaryLossCase.preRCheckpoint.round, primaryLossCase.forkRound, 'Checkpoint round must match fork round');

  // 2. Focused Candidates Generation (1-3 variables, <= 48 distinct combinations)
  const candidates = generateFocusedCandidatesForCase(primaryLossCase, rushEvol, 48);
  assert.ok(candidates.length > 0 && candidates.length <= 48, `Candidate count (${candidates.length}) must be in range 1..48`);

  const variableDist = { 1: 0, 2: 0, 3: 0 };
  for (const c of candidates) {
    const vc = c.modifiedVariablesCount as 1 | 2 | 3;
    if (variableDist[vc] !== undefined) variableDist[vc]++;
  }
  assert.ok(variableDist[1] > 0, 'Must have 1-variable candidates');

  // 3. Focused Continuation Search from pre-R Checkpoint
  const searchResult = runFocusedSearchOnLossCase(primaryLossCase, rushEvol, candidates);
  assert.strictEqual(searchResult.allTrials.length, candidates.length, 'Every candidate must execute exactly one continuation trial');

  // 4. Branch First Library Storage & State Transitions
  for (const br of searchResult.improvedBranches) {
    assert.strictEqual(br.state, 'EXACT_CASE_BRANCH', 'All local answers must initially be stored as EXACT_CASE_BRANCH');
    assert.ok(br.actionSubtreeDelta.length > 0, 'Branch must carry executable action subtree delta');
  }

  // 5. Merge & Prune
  const { merged, pruned, activeLibrary } = mergeAndPruneBranches(searchResult.improvedBranches);
  assert.ok(Array.isArray(merged), 'Merged branches list must be valid');
  assert.ok(Array.isArray(pruned), 'Pruned branches list must be valid');
  assert.ok(Array.isArray(activeLibrary), 'Active library list must be valid');
});
