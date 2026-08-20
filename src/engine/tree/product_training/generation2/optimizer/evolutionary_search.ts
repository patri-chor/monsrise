import type { AdverseCaseRecord } from './adverse_case_miner';
import type { ArchiveEntry } from './solution_archive';
import { SolutionArchive } from './solution_archive';
import { CandidateSpace } from './candidate_space';
import { RoundBoardStateFactory, type RoundBoardEdit } from '../round_board_state_factory';
import { SingleRoundEngine, type SingleRoundResult } from '../single_round_engine';
import { evaluateObjectiveVector } from './objective';
import { mulberry32 } from '../../../../play_full_game';
import type { OptimizerConfig } from './config';

export interface CandidateRecord {
  candidateId: string;
  caseId: string;
  generation: number;
  editedStateFingerprint: string;
  edits: RoundBoardEdit[];
  status: 'VALID' | 'INVALID' | 'DUPLICATE';
  reason?: string;
}

export interface EvaluationRecord {
  candidateId: string;
  caseId: string;
  generation: number;
  editedStateFingerprint: string;
  result: SingleRoundResult;
  targetSurvivingHp: number;
  opponentSurvivingHp: number;
  roundWinner: 1 | 2 | 0;
  observableDigest: string;
}

export interface GenerationEvent {
  generation: number;
  caseId: string;
  selectedParentCount: number;
  proposalsCount: number;
  invalidCount: number;
  duplicateCount: number;
  uniqueEvaluatedCount: number;
  cumulativeUniqueForCase: number;
  bestObjectiveRank: number;
  archiveSizeForCase: number;
}

export class EvolutionarySearch {
  public static runEvolutionarySearch(
    cases: AdverseCaseRecord[],
    archive: SolutionArchive,
    config: OptimizerConfig,
    resumedState?: {
      completedGenerationsByCase: Record<string, number>;
      completedFingerprintsByCase: Record<string, string[]>;
    },
    onCandidateGenerated?: (c: CandidateRecord) => void,
    onCandidateEvaluated?: (e: EvaluationRecord) => void,
    onGenerationCompleted?: (g: GenerationEvent) => void
  ): {
    events: GenerationEvent[];
    allCandidates: CandidateRecord[];
    allEvaluations: EvaluationRecord[];
    completedFingerprintsByCase: Record<string, string[]>;
    completedGenerationsByCase: Record<string, number>;
    oneRoundEvaluationsCount: number;
  } {
    const events: GenerationEvent[] = [];
    const allCandidates: CandidateRecord[] = [];
    const allEvaluations: EvaluationRecord[] = [];
    let oneRoundEvaluationsCount = 0;

    const completedFingerprintsByCase: Record<string, string[]> = resumedState?.completedFingerprintsByCase ?? {};
    const completedGenerationsByCase: Record<string, number> = resumedState?.completedGenerationsByCase ?? {};

    let caseIdx = 0;
    for (const c of cases) {
      caseIdx++;

      if (!completedFingerprintsByCase[c.caseId]) {
        completedFingerprintsByCase[c.caseId] = [c.baseState.stateFingerprint];
      }
      const seenFpForCase = new Set<string>(completedFingerprintsByCase[c.caseId]);

      const startGen = (completedGenerationsByCase[c.caseId] ?? 0) + 1;
      const targetPerGen = Math.max(1, Math.floor(config.uniqueCandidatesPerCase / config.maxGenerations));

      for (let gen = startGen; gen <= config.maxGenerations; gen++) {
        if (config.stopAfterGeneration && gen > config.stopAfterGeneration) {
          break;
        }

        const rng = mulberry32((config.searchSeed * 104729 + caseIdx * 7919 + gen * 32452843 + c.round * 15485863) >>> 0);

        let proposalsCount = 0;
        let invalidCount = 0;
        let duplicateCount = 0;
        let uniqueThisGen = 0;

        const existingEntries = archive.getCaseEntries(c.caseId);
        const nonDomParents = existingEntries.filter(e => !e.isDominated);
        const parentPool = nonDomParents.length > 0 ? nonDomParents : existingEntries;
        let selectedParents = 0;

        // 计算当前 generation 目标配额（含最后一代余数）
        const isLastGen = gen === config.maxGenerations;
        const currentCumulativeTarget = isLastGen ? config.uniqueCandidatesPerCase : gen * targetPerGen;
        const currentCumulative = seenFpForCase.size - 1; // 去除 baseState
        const neededUnique = Math.max(0, currentCumulativeTarget - currentCumulative);

        while (uniqueThisGen < neededUnique && proposalsCount < neededUnique * 25) {
          proposalsCount++;

          let edits: RoundBoardEdit[] = [];
          if (gen > 1 && parentPool.length > 0 && rng() < 0.5) {
            selectedParents++;
            const parent = parentPool[Math.floor(rng() * parentPool.length)];
            edits = CandidateSpace.mutateEdits(parent.edits, c.baseState, rng);
          } else {
            edits = CandidateSpace.sampleCompatibleEdits(c.baseState, rng);
          }

          if (edits.length === 0) {
            invalidCount++;
            const candRec: CandidateRecord = {
              candidateId: `PROP_${c.caseId}_g${gen}_p${proposalsCount}`,
              caseId: c.caseId,
              generation: gen,
              editedStateFingerprint: 'INVALID',
              edits,
              status: 'INVALID',
              reason: 'no_legal_edits',
            };
            allCandidates.push(candRec);
            onCandidateGenerated?.(candRec);
            continue;
          }

          const candidateState = RoundBoardStateFactory.cloneWithEdits(c.baseState, edits);
          const fp = candidateState.stateFingerprint;

          if (seenFpForCase.has(fp)) {
            duplicateCount++;
            const candRec: CandidateRecord = {
              candidateId: `PROP_${c.caseId}_g${gen}_p${proposalsCount}`,
              caseId: c.caseId,
              generation: gen,
              editedStateFingerprint: fp,
              edits,
              status: 'DUPLICATE',
            };
            allCandidates.push(candRec);
            onCandidateGenerated?.(candRec);
            continue;
          }

          // 校验部署单位坐标碰撞
          const occupied = new Set<string>();
          let collision = false;
          for (const u of candidateState.deployedUnits) {
            const key = `${u.originalX},${u.originalY}`;
            if (occupied.has(key)) {
              collision = true;
              break;
            }
            occupied.add(key);
          }

          if (collision) {
            invalidCount++;
            const candRec: CandidateRecord = {
              candidateId: `PROP_${c.caseId}_g${gen}_p${proposalsCount}`,
              caseId: c.caseId,
              generation: gen,
              editedStateFingerprint: fp,
              edits,
              status: 'INVALID',
              reason: 'collision_deployed_unit',
            };
            allCandidates.push(candRec);
            onCandidateGenerated?.(candRec);
            continue;
          }

          seenFpForCase.add(fp);
          completedFingerprintsByCase[c.caseId].push(fp);
          uniqueThisGen++;
          oneRoundEvaluationsCount++;

          const candRec: CandidateRecord = {
            candidateId: `CAND_${c.caseId}_g${gen}_u${uniqueThisGen}`,
            caseId: c.caseId,
            generation: gen,
            editedStateFingerprint: fp,
            edits,
            status: 'VALID',
          };
          allCandidates.push(candRec);
          onCandidateGenerated?.(candRec);

          // 仅运行单回合权威战斗
          const res = SingleRoundEngine.runSingleRound(candidateState);
          const obj = evaluateObjectiveVector(res, c.targetSide, edits.length);

          const targetSurvHp = c.targetSide === 1 ? res.observableOutput.p1TotalHp : res.observableOutput.p2TotalHp;
          const oppSurvHp = c.targetSide === 1 ? res.observableOutput.p2TotalHp : res.observableOutput.p1TotalHp;

          const evalRec: EvaluationRecord = {
            candidateId: candRec.candidateId,
            caseId: c.caseId,
            generation: gen,
            editedStateFingerprint: fp,
            result: res,
            targetSurvivingHp: targetSurvHp,
            opponentSurvivingHp: oppSurvHp,
            roundWinner: res.roundWinner,
            observableDigest: res.observableOutput.observableDigest,
          };
          allEvaluations.push(evalRec);
          onCandidateEvaluated?.(evalRec);

          const entry: ArchiveEntry = {
            entryKey: `${c.caseId}_${fp}_${res.observableOutput.observableDigest}`,
            candidateId: candRec.candidateId,
            caseId: c.caseId,
            generation: gen,
            editedStateFingerprint: fp,
            edits,
            result: res,
            objective: obj,
            isDominated: false,
            isRepresentative: false,
          };

          archive.addEntry(entry);
        }

        archive.updateDominanceForCase(c.caseId);
        const caseEntries = archive.getCaseEntries(c.caseId);
        const bestObj = caseEntries.reduce((max, e) => Math.max(max, e.objective.roundWinnerRank), 1);

        completedGenerationsByCase[c.caseId] = gen;

        const genEvent: GenerationEvent = {
          generation: gen,
          caseId: c.caseId,
          selectedParentCount: selectedParents,
          proposalsCount,
          invalidCount,
          duplicateCount,
          uniqueEvaluatedCount: uniqueThisGen,
          cumulativeUniqueForCase: seenFpForCase.size - 1,
          bestObjectiveRank: bestObj,
          archiveSizeForCase: caseEntries.length,
        };
        events.push(genEvent);
        onGenerationCompleted?.(genEvent);
      }
    }

    archive.selectRepresentatives();
    return {
      events,
      allCandidates,
      allEvaluations,
      completedFingerprintsByCase,
      completedGenerationsByCase,
      oneRoundEvaluationsCount,
    };
  }
}
