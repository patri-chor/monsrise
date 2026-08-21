import type { DynamicPoolEntry, PoolMetrics } from './types';
import { ProductMatchRunner } from '../product_match_runner';
import { treeStrategyFor } from '../../../product_tree_strategy';
import { computeProductOutcomeFromMatch, type ProductOutcome } from '../cycle/outcome';
import { FormationSnapshotResolver } from '../../snapshot_resolver';

export class L2BenchmarkEvaluator {
  public static evaluateL2(
    targetEntry: DynamicPoolEntry,
    benchmarkEntries: DynamicPoolEntry[],
    seeds: number[]
  ): { metrics: PoolMetrics; outcomes: ProductOutcome[] } {
    const resolver = FormationSnapshotResolver.getInstance();
    const targetSnap = resolver.resolveFormationSnapshot({ formationId: targetEntry.formationId });
    const opponents = benchmarkEntries.filter(e => e.formationId !== targetEntry.formationId && e.status === 'ACTIVE');

    const outcomes: ProductOutcome[] = [];

    for (const opp of opponents) {
      const oppSnap = resolver.resolveFormationSnapshot({ formationId: opp.formationId });

      for (const side of [1, 2] as const) {
        for (const seed of seeds) {
          const isP1 = side === 1;
          const matchRes = ProductMatchRunner.runFullMatch({
            teamA: isP1 ? targetSnap.team : oppSnap.team,
            teamB: isP1 ? oppSnap.team : targetSnap.team,
            seed,
            nameA: isP1 ? targetSnap.displayName : oppSnap.displayName,
            nameB: isP1 ? oppSnap.displayName : targetSnap.displayName,
            strategyA: treeStrategyFor(isP1 ? targetEntry.currentEvol : opp.currentEvol),
            strategyB: treeStrategyFor(isP1 ? opp.currentEvol : targetEntry.currentEvol),
          });
          outcomes.push(computeProductOutcomeFromMatch(matchRes, side));
        }
      }
    }

    const count = outcomes.length;
    const targetW = outcomes.reduce((s, o) => s + o.targetW, 0);
    const targetD = outcomes.reduce((s, o) => s + o.targetD, 0);
    const targetL = outcomes.reduce((s, o) => s + o.targetL, 0);
    const roundWins = outcomes.reduce((s, o) => s + o.targetRoundResults.filter(r => r === 1).length, 0);
    const targetHpAverage = count > 0 ? outcomes.reduce((s, o) => s + o.perRoundObservable.reduce((hp, r) => hp + r.targetHp, 0), 0) / count : 0;
    const targetScore70Average = count > 0 ? (targetW + 0.70 * targetD) / count : 0;

    const metrics: PoolMetrics = {
      targetW,
      targetD,
      targetL,
      count,
      targetScore70Average,
      roundWins,
      targetHpAverage,
    };

    return { metrics, outcomes };
  }
}
