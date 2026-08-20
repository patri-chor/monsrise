export interface OptimizerConfig {
  targetFormationId: string;
  opponentFormationIds?: string[];
  baselineSeeds: number[];
  validationSeeds: number[];
  maxOpponents: number;
  maxAdverseCasesPerOpponent: number;
  populationSize: number;
  uniqueCandidatesPerCase: number;
  maxGenerations: number;
  searchSeed: number;
  allowForwardCompilation: boolean;
  dryRun: boolean;
  outputDirectory?: string;
}

export const DEFAULT_OPTIMIZER_CONFIG: OptimizerConfig = {
  targetFormationId: 't0:all2rush',
  opponentFormationIds: ['t0:golden_boom', 't0:all2prayer', 't0:gift_jungle'],
  baselineSeeds: [1, 7, 42],
  validationSeeds: [1, 7, 42, 100, 2024],
  maxOpponents: 3,
  maxAdverseCasesPerOpponent: 2,
  populationSize: 16,
  uniqueCandidatesPerCase: 32,
  maxGenerations: 2,
  searchSeed: 118001,
  allowForwardCompilation: true,
  dryRun: false,
};
