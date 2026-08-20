import type { RoundBoardEdit } from '../round_board_state_factory';
import type { SingleRoundResult } from '../single_round_engine';
import type { ObjectiveVector } from './objective';

export type OptimizerPhase = 'NEW' | 'BASELINE' | 'SEARCH' | 'COMPILE' | 'VALIDATE' | 'COMPLETE';

export type EventType =
  | 'RUN_CREATED'
  | 'BASELINE_CASE_CAPTURED'
  | 'BASELINE_PARITY_CHECKED'
  | 'DIAGNOSTIC_RECORDED'
  | 'CANDIDATE_PROPOSED'
  | 'CANDIDATE_REJECTED'
  | 'CANDIDATE_EVALUATED'
  | 'ARCHIVE_ENTRY_ADDED'
  | 'ARCHIVE_DOMINANCE_UPDATED'
  | 'GENERATION_COMPLETED'
  | 'FORWARD_CANDIDATE_COMPILED'
  | 'FORWARD_STATUS_CHANGED'
  | 'VALIDATION_COMPLETED'
  | 'PHASE_COMPLETED'
  | 'RUN_COMPLETED';

export interface OptimizerEvent<T = any> {
  eventId: string;
  schemaVersion: 'G2_OPTIMIZER_EVENT_V1';
  runId: string;
  sequence: number;
  type: EventType;
  timestamp: string;
  payload: T;
}

export interface RunCreatedPayload {
  config: any;
  targetFormationId: string;
  searchSeed: number;
}

export interface BaselineCaseCapturedPayload {
  caseId: string;
  targetFormationId: string;
  opponentFormationId: string;
  opponentDisplayName: string;
  targetSide: 1 | 2;
  seed: number;
  round: number;
  baseState: any;
  baselineResult: any;
  deficit: number;
}

export interface BaselineParityCheckedPayload {
  caseId: string;
  passed: boolean;
  parityFields: {
    roundWinner: 1 | 2 | 0;
    p1ScoreDelta: number;
    p2ScoreDelta: number;
    p1TotalHp: number;
    p2TotalHp: number;
    p1SurvivorsCount: number;
    p2SurvivorsCount: number;
    observableDigest: string;
  };
}

export interface CandidateProposedPayload {
  candidateId: string;
  caseId: string;
  generation: number;
  sourceType: 'RANDOM' | 'MUTATION' | 'CROSSOVER';
  parentCandidateIds?: string[];
  edits: RoundBoardEdit[];
  editedStateFingerprint: string;
}

export interface CandidateRejectedPayload {
  candidateId: string;
  caseId: string;
  generation: number;
  reason: string;
}

export interface CandidateEvaluatedPayload {
  candidateId: string;
  caseId: string;
  generation: number;
  editedStateFingerprint: string;
  result: SingleRoundResult;
  objective: ObjectiveVector;
}

export interface ArchiveEntryAddedPayload {
  candidateId: string;
  caseId: string;
  entryKey: string;
  editedStateFingerprint: string;
  edits: RoundBoardEdit[];
  objective: ObjectiveVector;
  observableDigest: string;
}

export interface ArchiveDominanceUpdatedPayload {
  caseId: string;
  dominatedCandidateIds: string[];
  representativeCandidateId?: string;
  representativeReason?: string;
}

export interface GenerationCompletedPayload {
  generation: number;
  caseId: string;
  requestedPopulation: number;
  remainingBefore: number;
  remainingAfter: number;
  randomProposalCount: number;
  mutationProposalCount: number;
  crossoverProposalCount: number;
  selectedParentIds: string[];
  validCount: number;
  invalidCount: number;
  duplicateCount: number;
  uniqueEvaluationsThisGen: number;
  cumulativeUniqueForCase: number;
  archiveFrontierCount: number;
  exhaustionReason: string;
}

export interface ForwardCandidateCompiledPayload {
  candidateId: string;
  caseId: string;
  isForwardExpressible: boolean;
  classification: 'COMPILED' | 'LOCAL_ONLY';
  executableBranch?: any;
  rejectionReason?: string;
}

export interface ForwardStatusChangedPayload {
  candidateId: string;
  fromStatus: string;
  toStatus: 'PILOT_ACTIVE' | 'FORWARD_REJECTED';
  reason?: string;
}

export interface ValidationCompletedPayload {
  candidateId: string;
  opponentDisplayName: string;
  side: 1 | 2;
  seed: number;
  baselineWinner: 1 | 2 | 0;
  baselineScore: string;
  branchWinner: 1 | 2 | 0;
  branchScore: string;
  branchSelected: boolean;
  classification: 'IMPROVES' | 'NEUTRAL' | 'REGRESSES' | 'NOT_SELECTED';
}

export interface PhaseCompletedPayload {
  phase: OptimizerPhase;
}

export interface RunCompletedPayload {
  summary: any;
}
