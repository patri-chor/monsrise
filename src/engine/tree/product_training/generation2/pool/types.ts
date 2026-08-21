import type { EvolFormation } from '../../../evol_gene';

export interface PoolMetrics {
  targetW: number;
  targetD: number;
  targetL: number;
  count: number;
  targetScore70Average: number;
  roundWins: number;
  targetHpAverage: number;
}

export interface DynamicPoolEntry {
  formationId: string;
  rootSourceId: string;
  currentSnapshotFingerprint: string;
  previousSnapshotFingerprint: string | null;
  behaviorFingerprint: string;
  currentEvol: EvolFormation;
  l1Metrics?: PoolMetrics;
  l2Metrics?: PoolMetrics;
  score70Aggregate?: number;
  optimizationCycles: number;
  status: 'ACTIVE' | 'REPLACED' | 'RETAINED' | 'ARCHIVED_DUPLICATE';
  lineage: string[];
}

export interface DynamicT0PilotConfig {
  l1Seeds: number[];
  l2Seeds: number[];
  maxPilotFormations: number;
  optimizerIterations: number;
  maxOpponentsPerCycle: number;
  uniqueCandidatesPerCase: number;
  populationSize: number;
  maxGenerations: number;
  maxNewPilotBranchesPerIteration: number;
  maxConsecutiveNoImprovementIterations: number;
  outputBaseDirectory?: string;
  poolFilePath?: string;
}

export const DEFAULT_DYNAMIC_T0_CONFIG: DynamicT0PilotConfig = {
  l1Seeds: [101, 107],
  l2Seeds: [201, 207],
  maxPilotFormations: 3,
  optimizerIterations: 2,
  maxOpponentsPerCycle: 2,
  uniqueCandidatesPerCase: 8,
  populationSize: 4,
  maxGenerations: 2,
  maxNewPilotBranchesPerIteration: 2,
  maxConsecutiveNoImprovementIterations: 2,
};
