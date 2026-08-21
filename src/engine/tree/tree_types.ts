import type { TeamSlot } from '../../game/GameEngine';
import type { EvolFormation } from './evol_gene';

export interface CycleSnapshotInput {
  formationId: string;
  displayName: string;
  canonicalFingerprint: string;
  rootSourceId: string;
  team: TeamSlot[];
  evol: EvolFormation;
}

export interface TreeCycleConfig {
  targetFormationId: string;
  targetSnapshot?: CycleSnapshotInput;
  opponentFormationIds: string[];
  opponentSnapshots?: CycleSnapshotInput[];
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
  parallelBackend?: 'single' | 'worker_threads';
  workerCount?: number;
  workerTimeoutMs?: number;
  outputBaseDirectory?: string;
}

export const DEFAULT_TREE_CYCLE_CONFIG: TreeCycleConfig = {
  targetFormationId: 't0:all2rush',
  opponentFormationIds: ['t0:golden_boom', 't0:all2prayer', 't0:gift_jungle'],
  baselineSeeds: [1, 7, 42],
  validationSeeds: [1, 42, 100, 2024],
  searchSeeds: [125001, 125002, 125003],
  maxIterations: 3,
  maxOpponents: 3,
  maxAdverseCasesPerOpponent: 2,
  uniqueCandidatesPerCase: 32,
  populationSize: 8,
  maxGenerations: 2,
  maxNewPilotBranchesPerIteration: 2,
  maxConsecutiveNoImprovementIterations: 2,
  dryRun: false,
  parallelBackend: 'single',
  workerTimeoutMs: 30000,
};

export interface TreeCycleReport {
  runId: string;
  config: TreeCycleConfig;
  totalIterationsExecuted: number;
  stopReason: string;
  pilotLibrary: any[];
  iterations: any[];
  summary: any;
}
