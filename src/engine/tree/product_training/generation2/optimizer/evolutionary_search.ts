import type { AdverseCaseRecord } from './adverse_case_miner';
import type { ArchiveEntry } from './solution_archive';
import { SolutionArchive } from './solution_archive';
import { CandidateSpace } from './candidate_space';
import { RoundBoardStateFactory } from '../round_board_state_factory';
import { SingleRoundEngine } from '../single_round_engine';
import { evaluateObjectiveVector } from './objective';
import { mulberry32 } from '../../../../play_full_game';
import type { OptimizerConfig } from './config';

export interface GenerationEvent {
  generation: number;
  caseId: string;
  proposalsCount: number;
  invalidCount: number;
  duplicateCount: number;
  uniqueEvaluatedCount: number;
  bestObjectiveRank: number;
  archiveSizeForCase: number;
}

export class EvolutionarySearch {
  public static runEvolutionarySearch(
    cases: AdverseCaseRecord[],
    archive: SolutionArchive,
    config: OptimizerConfig
  ): { events: GenerationEvent[]; allEvaluatedFingerprints: Set<string> } {
    const events: GenerationEvent[] = [];
    const allEvaluatedFingerprints = new Set<string>();

    let caseIdx = 0;
    for (const c of cases) {
      caseIdx++;
      const rng = mulberry32((config.searchSeed * 104729 + caseIdx * 7919 + c.round * 15485863) >>> 0);

      const seenFpForCase = new Set<string>();
      seenFpForCase.add(c.baseState.stateFingerprint);

      for (let gen = 1; gen <= config.maxGenerations; gen++) {
        let proposalsCount = 0;
        let invalidCount = 0;
        let duplicateCount = 0;
        let uniqueEvaluatedCount = 0;

        const maxCandidatesThisGen = Math.floor(config.uniqueCandidatesPerCase / config.maxGenerations);
        const existingEntries = archive.getCaseEntries(c.caseId);

        while (uniqueEvaluatedCount < maxCandidatesThisGen && proposalsCount < maxCandidatesThisGen * 20) {
          proposalsCount++;

          let edits = [];
          if (existingEntries.length > 0 && rng() < 0.4) {
            // 从高分解变异 (Mutation)
            const parent = existingEntries[Math.floor(rng() * existingEntries.length)];
            edits = CandidateSpace.mutateEdits(parent.edits, c.baseState, rng);
          } else {
            // 新增随机探索 (Random Exploration)
            edits = CandidateSpace.sampleCompatibleEdits(c.baseState, rng);
          }

          if (edits.length === 0) {
            invalidCount++;
            continue;
          }

          const candidateState = RoundBoardStateFactory.cloneWithEdits(c.baseState, edits);
          const fp = candidateState.stateFingerprint;

          if (seenFpForCase.has(fp)) {
            duplicateCount++;
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
            continue;
          }

          seenFpForCase.add(fp);
          allEvaluatedFingerprints.add(fp);
          uniqueEvaluatedCount++;

          // 仅运行单回合权威战斗
          const res = SingleRoundEngine.runSingleRound(candidateState);
          const obj = evaluateObjectiveVector(res, c.targetSide, edits.length);

          const entry: ArchiveEntry = {
            entryKey: `${c.caseId}_${fp}_${res.observableOutput.observableDigest}`,
            candidateId: `CAND_${c.caseId}_g${gen}_u${uniqueEvaluatedCount}`,
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

        events.push({
          generation: gen,
          caseId: c.caseId,
          proposalsCount,
          invalidCount,
          duplicateCount,
          uniqueEvaluatedCount,
          bestObjectiveRank: bestObj,
          archiveSizeForCase: caseEntries.length,
        });
      }
    }

    archive.selectRepresentatives();
    return { events, allEvaluatedFingerprints };
  }
}
