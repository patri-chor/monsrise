import type { OptimizerEvent, OptimizerPhase } from './run_events';
import type { OptimizerConfig } from './config';

export interface DerivedRuntimeState {
  runId: string;
  config: OptimizerConfig;
  currentPhase: OptimizerPhase;
  eventSequence: number;
  seenEventIds: Set<string>;
  baselineCases: any[];
  diagnostics: any[];
  candidates: any[];
  evaluations: any[];
  archiveEntries: any[];
  generations: any[];
  forwardCandidates: any[];
  validations: any[];
  activePilotBranches: any[];
  completedGenerationsByCase: Record<string, number>;
  completedFingerprintsByCase: Record<string, string[]>;
  evaluatorCounters: {
    baselineProductMatches: number;
    oneRoundCandidateEvaluations: number;
    fullMatchSourceValidationEvaluations: number;
    fullMatchBenchmarkValidationEvaluations: number;
  };
  summary?: any;
}

export function createInitialRuntimeState(runId: string, config: OptimizerConfig): DerivedRuntimeState {
  return {
    runId,
    config,
    currentPhase: 'NEW',
    eventSequence: 0,
    seenEventIds: new Set<string>(),
    baselineCases: [],
    diagnostics: [],
    candidates: [],
    evaluations: [],
    archiveEntries: [],
    generations: [],
    forwardCandidates: [],
    validations: [],
    activePilotBranches: [],
    completedGenerationsByCase: {},
    completedFingerprintsByCase: {},
    evaluatorCounters: {
      baselineProductMatches: 0,
      oneRoundCandidateEvaluations: 0,
      fullMatchSourceValidationEvaluations: 0,
      fullMatchBenchmarkValidationEvaluations: 0,
    },
  };
}

export function reduceOptimizerEvent(state: DerivedRuntimeState, event: OptimizerEvent): DerivedRuntimeState {
  state.eventSequence = event.sequence;
  state.seenEventIds.add(event.eventId);

  switch (event.type) {
    case 'RUN_CREATED':
      state.currentPhase = 'BASELINE';
      break;

    case 'BASELINE_CASE_CAPTURED':
      state.baselineCases.push(event.payload);
      state.evaluatorCounters.baselineProductMatches++;
      if (!state.completedFingerprintsByCase[event.payload.caseId]) {
        state.completedFingerprintsByCase[event.payload.caseId] = [event.payload.baseState.stateFingerprint];
      }
      break;

    case 'BASELINE_PARITY_CHECKED':
      // Parity check record
      break;

    case 'DIAGNOSTIC_RECORDED':
      state.diagnostics.push(event.payload);
      break;

    case 'CANDIDATE_PROPOSED':
      state.candidates.push({
        candidateId: event.payload.candidateId,
        caseId: event.payload.caseId,
        generation: event.payload.generation,
        editedStateFingerprint: event.payload.editedStateFingerprint,
        edits: event.payload.edits,
        status: 'VALID',
      });
      break;

    case 'CANDIDATE_REJECTED':
      state.candidates.push({
        candidateId: event.payload.candidateId,
        caseId: event.payload.caseId,
        generation: event.payload.generation,
        editedStateFingerprint: 'INVALID',
        status: 'INVALID',
        reason: event.payload.reason,
      });
      break;

    case 'CANDIDATE_EVALUATED':
      state.evaluations.push(event.payload);
      state.evaluatorCounters.oneRoundCandidateEvaluations++;
      if (!state.completedFingerprintsByCase[event.payload.caseId]) {
        state.completedFingerprintsByCase[event.payload.caseId] = [];
      }
      if (!state.completedFingerprintsByCase[event.payload.caseId].includes(event.payload.editedStateFingerprint)) {
        state.completedFingerprintsByCase[event.payload.caseId].push(event.payload.editedStateFingerprint);
      }
      break;

    case 'ARCHIVE_ENTRY_ADDED':
      state.archiveEntries.push({
        entryKey: event.payload.entryKey,
        candidateId: event.payload.candidateId,
        caseId: event.payload.caseId,
        editedStateFingerprint: event.payload.editedStateFingerprint,
        edits: event.payload.edits,
        objective: event.payload.objective,
        isDominated: false,
        isRepresentative: false,
      });
      break;

    case 'ARCHIVE_DOMINANCE_UPDATED':
      for (const ent of state.archiveEntries.filter(e => e.caseId === event.payload.caseId)) {
        ent.isDominated = event.payload.dominatedCandidateIds.includes(ent.candidateId);
        ent.isRepresentative = ent.candidateId === event.payload.representativeCandidateId;
        if (ent.isRepresentative) {
          ent.representativeReason = event.payload.representativeReason;
        }
      }
      break;

    case 'GENERATION_COMPLETED':
      state.generations.push(event.payload);
      state.completedGenerationsByCase[event.payload.caseId] = event.payload.generation;
      break;

    case 'FORWARD_CANDIDATE_COMPILED':
      state.forwardCandidates.push({ ...event.payload });
      break;

    case 'FORWARD_STATUS_CHANGED':
      for (const fc of state.forwardCandidates) {
        if (fc.candidateId === event.payload.candidateId) {
          fc.classification = event.payload.toStatus;
          if (event.payload.reason) fc.rejectionReason = event.payload.reason;
        }
      }
      break;

    case 'VALIDATION_COMPLETED':
      state.validations.push(event.payload);
      state.evaluatorCounters.fullMatchBenchmarkValidationEvaluations++;
      break;

    case 'PHASE_COMPLETED':
      if (event.payload.phase === 'BASELINE') state.currentPhase = 'SEARCH';
      else if (event.payload.phase === 'SEARCH') state.currentPhase = 'COMPILE';
      else if (event.payload.phase === 'COMPILE') state.currentPhase = 'VALIDATE';
      else if (event.payload.phase === 'VALIDATE') state.currentPhase = 'COMPLETE';
      break;

    case 'RUN_COMPLETED':
      state.currentPhase = 'COMPLETE';
      state.summary = event.payload.summary;
      state.activePilotBranches = state.forwardCandidates.filter(fc => fc.classification === 'PILOT_ACTIVE');
      break;
  }

  return state;
}

export function reconstructStateFromEvents(events: OptimizerEvent[], initialConfig: OptimizerConfig): DerivedRuntimeState {
  if (events.length === 0) {
    throw new Error('Cannot reconstruct state from empty events list');
  }
  const first = events[0];
  let state = createInitialRuntimeState(first.runId, first.payload.config ?? initialConfig);
  for (const ev of events) {
    state = reduceOptimizerEvent(state, ev);
  }
  return state;
}
