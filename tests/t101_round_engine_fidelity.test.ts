import '../src/engine/env';
import test from 'node:test';
import assert from 'node:assert/strict';
import { FORMATION_LIBRARY } from '../src/ai/formation_library';
import { formationToEvol } from '../src/engine/tree/evol_gene';
import { treeStrategyFor } from '../src/engine/tree/product_tree_strategy';
import { runFidelityComparison, appendFidelityEvidence } from '../src/engine/tree/round_engine/fidelity_gate';

test('T101 A: Round Engine Fidelity Gate across multiple seeds, sides, and product opponents', () => {
  const rush = FORMATION_LIBRARY.find(f => f.id === 'all2rush' || f.name === '全二冲')!;
  const boom = FORMATION_LIBRARY.find(f => f.id === 'golden_boom' || f.name === '金蛋轰炸')!;
  const prayer = FORMATION_LIBRARY.find(f => f.id === 'all2prayer' || f.name === '双祈祷')!;

  assert.ok(rush, 'all2rush formation must exist');
  assert.ok(boom, 'golden_boom formation must exist');
  assert.ok(prayer, 'all2prayer formation must exist');

  const rushEvol = formationToEvol(rush);
  const boomEvol = formationToEvol(boom);
  const prayerEvol = formationToEvol(prayer);

  const rushStrat = treeStrategyFor(rushEvol);
  const boomStrat = treeStrategyFor(boomEvol);
  const prayerStrat = treeStrategyFor(prayerEvol);

  const seeds = [1, 42, 100, 2024];
  const opponents = [
    { name: 'golden_boom', team: (boom as any).team, strat: boomStrat },
    { name: 'all2prayer', team: (prayer as any).team, strat: prayerStrat },
  ];

  let verifiedGames = 0;

  for (const opp of opponents) {
    for (const seed of seeds) {
      // 1. rush on Side 1 (p1), opp on Side 2 (p2)
      const resP1 = runFidelityComparison(
        (rush as any).team,
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
      assert.strictEqual(resP1.match, true, `Fidelity mismatch on seed ${seed} (rush as p1 vs ${opp.name}): ${resP1.diffs.join('; ')}`);
      assert.strictEqual(resP1.checkpointReplayMatch, true, `Checkpoint replay mismatch on seed ${seed} (rush as p1 vs ${opp.name})`);
      appendFidelityEvidence({ side: 1, target: 'all2rush', opponent: opp.name, seed, result: resP1.gameSummary });
      verifiedGames++;

      // 2. opp on Side 1 (p1), rush on Side 2 (p2)
      const resP2 = runFidelityComparison(
        opp.team,
        (rush as any).team,
        {
          seed,
          nameA: opp.name,
          nameB: 'all2rush',
          strategyA: opp.strat,
          strategyB: rushStrat,
          testCheckpointReplayAtRound: 2,
        }
      );
      assert.strictEqual(resP2.match, true, `Fidelity mismatch on seed ${seed} (${opp.name} as p1 vs rush as p2): ${resP2.diffs.join('; ')}`);
      assert.strictEqual(resP2.checkpointReplayMatch, true, `Checkpoint replay mismatch on seed ${seed} (${opp.name} as p1 vs rush as p2)`);
      appendFidelityEvidence({ side: 2, target: 'all2rush', opponent: opp.name, seed, result: resP2.gameSummary });
      verifiedGames++;
    }
  }

  assert.strictEqual(verifiedGames, 16, 'Expected 16 verified test cases');
});
