export interface IterativePilotOptimizerConfig {
  targetFormationId: string;
  opponentFormationIds?: string[];
  baselineSeeds: number[];
  validationSeeds: number[];
  searchSeeds: number[];
  maxIterations: number;
  maxOpponents: number;
  maxAdverseCasesPerOpponent: number;
  uniqueCandidatesPerCase: number;
  populationSize: number;
  maxGenerations: number;
  maxNewPilotBranchesPerIteration: number;
  maxConsecutiveNoImprovementIterations: number;
  dryRun: boolean;
  outputBaseDirectory?: string;
}

export const DEFAULT_ITERATIVE_PILOT_CONFIG: IterativePilotOptimizerConfig = {
  targetFormationId: 't0:all2rush',
  opponentFormationIds: ['t0:golden_boom', 't0:all2prayer', 't0:gift_jungle'],
  baselineSeeds: [1, 7, 42],
  validationSeeds: [1, 42, 100, 2024],
  searchSeeds: [123001, 123002, 123003],
  maxIterations: 3,
  maxOpponents: 3,
  maxAdverseCasesPerOpponent: 2,
  uniqueCandidatesPerCase: 16,
  populationSize: 8,
  maxGenerations: 2,
  maxNewPilotBranchesPerIteration: 2,
  maxConsecutiveNoImprovementIterations: 2,
  dryRun: false,
};
