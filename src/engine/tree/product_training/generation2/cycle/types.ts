import type { ExecutableBranch } from '../branch_library';
import type { RoundBoardEdit } from '../round_board_state_factory';
import type { SingleRoundResult } from '../single_round_engine';

export interface OptimizerCycleConfig {
  targetFormationId: string;
  opponentFormationIds: string[];
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

export const DEFAULT_CYCLE_CONFIG: OptimizerCycleConfig = {
  targetFormationId: 't0:all2rush',
  opponentFormationIds: ['t0:golden_boom', 't0:all2prayer', 't0:gift_jungle'],
  baselineSeeds: [1, 7, 42],
  validationSeeds: [1, 42, 100, 2024],
  searchSeeds: [125001, 125002, 125003],
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

export interface BaselineCase {
  caseId: string;
  targetFormationId: string;
  opponentFormationId: string;
  opponentDisplayName: string;
  targetSide: 1 | 2;
  seed: number;
  round: number;
  baseState: any;
  baselineResult: SingleRoundResult;
  deficit: number;
  parityPassed: boolean;
}

export interface CandidateTrial {
  candidateId: string;
  caseId: string;
  generation: number;
  editedStateFingerprint: string;
  edits: RoundBoardEdit[];
  result: SingleRoundResult;
  objective: any;
  isDominated: boolean;
  isRepresentative: boolean;
  representativeReason?: string;
}

export interface CandidateDecision {
  candidateId: string;
  caseId: string;
  decision: 'PILOT_ACCEPTED' | 'PILOT_NEUTRAL' | 'PILOT_REJECTED' | 'LOCAL_ONLY';
  reason: string;
  selectedPairCount: number;
  score70Delta: number;
  branch?: ExecutableBranch;
}

export interface PairedValidation {
  iteration: number;
  candidateId: string;
  opponentDisplayName: string;
  targetSide: 1 | 2;
  seed: number;
  baselineScore70: number;
  candidateScore70: number;
  scoreDelta: number;
  branchSelected: boolean;
  classification: 'IMPROVES' | 'NEUTRAL' | 'REGRESSES' | 'NOT_SELECTED';
}

export interface IterationSummary {
  iterationNumber: number;
  searchSeed: number;
  initialPilotBranchesCount: number;
  baselineScore70Average: number;
  postDecisionScore70Average: number;
  score70Delta: number;
  adverseCasesMined: number;
  uniqueCandidatesEvaluated: number;
  forwardExpressibleCount: number;
  localOnlyCount: number;
  acceptedPilotBranchesCount: number;
  neutralPilotBranchesCount: number;
  rejectedPilotBranchesCount: number;
  newAcceptedBranches: ExecutableBranch[];
}

export interface OptimizerCycleReport {
  runId: string;
  config: OptimizerCycleConfig;
  totalIterationsExecuted: number;
  stopReason: 'MAX_ITERATIONS_REACHED' | 'CONSECUTIVE_NO_IMPROVEMENTS' | 'NO_ADVERSE_CASES_REMAINING';
  pilotLibrary: ExecutableBranch[];
  iterations: IterationSummary[];
  summary: {
    runId: string;
    totalIterations: number;
    initialPilotBranchesCount: number;
    finalPilotBranchesCount: number;
    totalAdverseCasesMined: number;
    totalUniqueCandidatesEvaluated: number;
    totalAcceptedBranches: number;
    totalRejectedBranches: number;
    stopReason: string;
  };
}
