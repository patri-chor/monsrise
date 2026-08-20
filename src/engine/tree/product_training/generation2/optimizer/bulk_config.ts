export interface BulkOptimizerConfig {
  targetFormationId: string;
  opponentFormationIds: string[];
  sides: (1 | 2)[];
  baselineSeeds: number[]; // e.g. at least 12 seeds
  holdoutSeeds: number[]; // e.g. at least 24 seeds
  maxAdverseCasesPerOpponent: number;
  uniqueCandidatesPerCase: number;
  maxGenerations: number;
  populationSize: number;
  searchSeeds: number[]; // multiple independent search runs
  outputBaseDirectory?: string;
}

export const DEFAULT_BULK_CONFIG: BulkOptimizerConfig = {
  targetFormationId: 't0:all2rush',
  opponentFormationIds: ['t0:golden_boom', 't0:all2prayer', 't0:gift_jungle'],
  sides: [1, 2],
  baselineSeeds: [1, 2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31],
  holdoutSeeds: [
    41, 42, 43, 47, 53, 59, 61, 67, 71, 73, 79, 83,
    89, 97, 101, 103, 107, 109, 113, 127, 131, 137, 139, 149,
  ],
  maxAdverseCasesPerOpponent: 2,
  uniqueCandidatesPerCase: 32,
  maxGenerations: 3,
  populationSize: 16,
  searchSeeds: [121001, 121002, 121003],
};
