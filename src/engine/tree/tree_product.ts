import { ProductMatchRunner } from '../product_match_runner';
import { treeStrategyFor } from './product_tree_strategy';
import type { EvolFormation } from './evol_gene';

export class TreeProduct {
  public static runProductMatch(params: {
    teamA: any[];
    teamB: any[];
    seed: number;
    nameA: string;
    nameB: string;
    evolA: EvolFormation;
    evolB: EvolFormation;
    collectStrategyTrace?: boolean;
  }) {
    return ProductMatchRunner.runFullMatch({
      teamA: params.teamA,
      teamB: params.teamB,
      seed: params.seed,
      nameA: params.nameA,
      nameB: params.nameB,
      strategyA: treeStrategyFor(params.evolA),
      strategyB: treeStrategyFor(params.evolB),
      collectStrategyTrace: params.collectStrategyTrace,
    });
  }
}
