import type { AdverseCaseRecord } from './adverse_case_miner';
import type { ObjectiveVector } from './objective';
import { evaluateObjectiveVector, dominates, compareObjective } from './objective';
import type { SingleRoundResult } from '../single_round_engine';
import { SingleRoundEngine } from '../single_round_engine';
import { RoundBoardStateFactory, type RoundBoardEdit } from '../round_board_state_factory';
import { CandidateSpace, type EvaluatedCandidate } from './candidate_space';
import { mulberry32 } from '../../../play_full_game';
import type { OptimizerConfig } from './config';

export interface ArchiveEntry {
  entryKey: string; // caseId + fp + digest
  candidateId: string;
  caseId: string;
  generation: number;
  editedStateFingerprint: string;
  edits: RoundBoardEdit[];
  result: SingleRoundResult;
  objective: ObjectiveVector;
  isDominated: boolean;
  dominatedByCandidateId?: string;
  isRepresentative: boolean;
  representativeReason?: string;
}

export class SolutionArchive {
  private entries: Map<string, ArchiveEntry> = new Map();

  public addEntry(entry: ArchiveEntry): void {
    this.entries.set(entry.entryKey, entry);
  }

  public getEntries(): ArchiveEntry[] {
    return Array.from(this.entries.values());
  }

  public getCaseEntries(caseId: string): ArchiveEntry[] {
    return this.getEntries().filter(e => e.caseId === caseId);
  }

  public updateDominanceForCase(caseId: string): void {
    const caseEntries = this.getCaseEntries(caseId);

    for (let i = 0; i < caseEntries.length; i++) {
      caseEntries[i].isDominated = false;
      caseEntries[i].dominatedByCandidateId = undefined;

      for (let j = 0; j < caseEntries.length; j++) {
        if (i === j) continue;
        if (dominates(caseEntries[j].objective, caseEntries[i].objective)) {
          caseEntries[i].isDominated = true;
          caseEntries[i].dominatedByCandidateId = caseEntries[j].candidateId;
          break;
        }
      }
    }
  }

  public selectRepresentatives(): void {
    const caseIds = Array.from(new Set(this.getEntries().map(e => e.caseId)));

    for (const cid of caseIds) {
      this.updateDominanceForCase(cid);
      const caseEntries = this.getCaseEntries(cid);

      for (const e of caseEntries) e.isRepresentative = false;

      const nonDom = caseEntries.filter(e => !e.isDominated);
      const pool = nonDom.length > 0 ? nonDom : caseEntries;

      pool.sort((a, b) => compareObjective(b.objective, a.objective));
      if (pool.length > 0) {
        pool[0].isRepresentative = true;
        pool[0].representativeReason = `Rank ${pool[0].objective.roundWinnerRank}, Target HP ${pool[0].objective.targetSurvivingHp}, Edits ${pool[0].objective.editCount}`;
      }
    }
  }
}
