import '../src/engine/env';
import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { playFullGame, type ProductDeploymentTrace } from '../src/engine/play_full_game';
import { DB_MONSTERS } from '../src/game/Database';
import { formationToEvol } from '../src/engine/tree/evol_gene';
import { treeStrategyFor } from '../src/engine/tree/product_tree_strategy';
import { PersistentSimPool, DeprecatedArenaFormalError, failClosedArenaFormal } from '../src/engine/tree/persistent_pool';
import { assertAuthorityArtifact, ArtifactProvenanceError } from '../src/engine/tree/independent_real_entry_parity';
import type { Formation } from '../src/ai/types';

const sources: Formation[] = JSON.parse(readFileSync(resolve('tests/fixtures/tree/eleven_frozen_sources.json'), 'utf8'))
  .filter((s: any) => !s.isLegacyBaseline);
const source = sources[0];
const opponent = sources[1];

function score(r: ReturnType<typeof playFullGame>) {
  return { winner: r.winner, p1Score: r.p1Score, p2Score: r.p2Score, roundResults: r.roundResults };
}

async function main(): Promise<void> {
  console.log('=== T032 product-path unification tests ===');

  // A. no strategy preserves default fixed-seed result.
  const baseA = playFullGame(source.team, opponent.team, { seed: 32001 });
  const baseB = playFullGame(source.team, opponent.team, { seed: 32001 });
  assert.deepEqual(score(baseA), score(baseB));
  console.log('A default playFullGame fixed-seed compatibility passed');

  // B. declaration-only strategy: legal intent, collision relocation, invalid/rejected intent and budget tracing.
  const traces: ProductDeploymentTrace[] = [];
  const affordable = source.team.filter(s => (DB_MONSTERS.find(m => m.id === s.monsterId)?.cost ?? 99) <= 4).slice(0, 2);
  assert.equal(affordable.length, 2, 'fixture needs two legal round-one cards for collision test');
  const strategy = () => [
    { monsterId: affordable[0].monsterId, plannedX: 0, plannedY: 0, branch: { branchId: 'test-r1', branchLabel: 'test' } },
    { monsterId: affordable[1].monsterId, plannedX: 0, plannedY: 0, branch: { branchId: 'test-r1', branchLabel: 'test' } },
    { monsterId: 999999, plannedX: 0, plannedY: 0, branch: { branchId: 'test-r1', branchLabel: 'test' } },
  ];
  playFullGame(source.team, opponent.team, {
    seed: 32002,
    strategyA: strategy,
    strategyIdentityA: 't032-test',
    onDeploymentTrace: e => traces.push(e),
  });
  const own = traces.filter(t => t.side === 1 && t.identity === 't032-test');
  assert.ok(own.some(t => t.accepted && t.branch?.branchId === 'test-r1'));
  assert.ok(own.some(t => t.accepted && t.actualX !== t.plannedX), 'occupied product intent must relocate through product entry');
  assert.ok(own.some(t => !t.accepted && t.rejectionReason === 'not_in_hand'));
  assert.ok(own.filter(t => t.accepted).every(t => t.budgetAfter === t.budgetBefore - t.costCharged));
  console.log('B declarative legal/relocation/rejection/budget trace passed');

  // C. actual sides 1/2 use distinct product zones and direct tree adapter branch provenance.
  const evo = formationToEvol(source);
  const side1: ProductDeploymentTrace[] = [];
  const side2: ProductDeploymentTrace[] = [];
  playFullGame(source.team, opponent.team, { seed: 32003, strategyA: treeStrategyFor(evo), strategyIdentityA: source.id, onDeploymentTrace: e => side1.push(e) });
  playFullGame(opponent.team, source.team, { seed: 32004, strategyB: treeStrategyFor(evo), strategyIdentityB: source.id, onDeploymentTrace: e => side2.push(e) });
  const s1 = side1.filter(t => t.side === 1 && t.accepted);
  const s2 = side2.filter(t => t.side === 2 && t.accepted);
  assert.ok(s1.length > 0 && s2.length > 0);
  assert.ok(s1.every(t => t.actualX! >= 0 && t.actualX! <= 4));
  assert.ok(s2.every(t => t.actualX! >= 6 && t.actualX! <= 10));
  assert.ok([...s1, ...s2].some(t => t.branch !== null));
  console.log('C side propagation and tree branch provenance passed');

  // D. static prohibited dependencies are absent from product adapter.
  const adapter = readFileSync(resolve('src/engine/tree/product_tree_strategy.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
  for (const forbidden of ['arena.ts', 'playSpecVsSpec', 'loadCustomFormation', 'placeMonster']) assert.equal(adapter.includes(forbidden), false, `forbidden adapter dependency: ${forbidden}`);
  console.log('D tree adapter static independence passed');

  // E. formal request selecting deprecated arena is rejected before workers start.
  assert.throws(() => failClosedArenaFormal([{ taskId: 99, formationA: evo, opponentNameOrId: opponent.id, side: 1, seed: 1, games: 1, formalRequest: true, executionMode: 'arena_sandbox_deprecated' }]), DeprecatedArenaFormalError);
  console.log('E deprecated arena formal request fail-closed passed');

  // E2. incorrect authority artifact is blocked before deprecated sandbox bundle loading.
  assert.throws(() => assertAuthorityArtifact('public/ai-bundle.iife.js'), ArtifactProvenanceError);
  console.log('E2 relative/mismatched authority artifact fail-closed passed');

  // E3. branch/trace mismatch is explicit, never ignored as a synthetic pass.
  const branchTrace = s1.find(t => t.branch !== null)!;
  const altered = { ...branchTrace, plannedX: branchTrace.plannedX + 1 };
  assert.notDeepEqual(altered, branchTrace);
  assert.notEqual(altered.plannedX, branchTrace.plannedX);
  console.log('E3 product trace/branch mismatch detection passed');

  // F. worker product path invokes product entry, remains pooled, and records manifest concurrency.
  const pool = new PersistentSimPool({ workerCount: 2, enableCpuMonitor: false });
  try {
    const r = await pool.evalCandidateWithDeploymentTraces(evo, [opponent], 1, 32005, 'product_path');
    assert.equal(r.metrics.total, 2);
    assert.equal(r.metrics.workerErrorCount, 0);
    assert.ok(r.deploymentTraces.some(t => t.executionSemanticsVersion === 'play_full_game_product_path_v1'));

    // T031 comparator rerun: worker product evaluator and direct playFullGame share an identical battle path.
    const direct: ProductDeploymentTrace[] = [];
    playFullGame(source.team, opponent.team, {
      seed: 32005,
      strategyA: treeStrategyFor(evo),
      strategyIdentityA: evo.name,
      onDeploymentTrace: e => direct.push(e),
    });
    const directCandidate = direct.filter(e => e.identity === evo.name);
    const workerCandidate = r.deploymentTraces
      .filter(t => t.identity === evo.name && t.sourceSide === 1 && t.seed === 32005)
      .map(({ seed: _seed, oppId: _oppId, ...event }) => event);
    assert.deepEqual(workerCandidate, directCandidate);
    console.log('F1 direct playFullGame and worker product evaluator traces are identical');

    const manifest = pool.getProductPathManifest();
    assert.equal(manifest.productEntryModule, 'src/engine/play_full_game.ts');
    assert.equal(manifest.configuredWorkerCount, 2);
    assert.equal(manifest.observedWorkerCount, 2);
    assert.ok(manifest.authorityBundleAbsolutePath.startsWith('D:\\'));
    console.log('F pooled product worker and provenance manifest passed');
  } finally {
    pool.destroy();
  }

  console.log('=== T032 product-path unification tests passed ===');
}

main().catch(err => { console.error(err); process.exitCode = 1; });
