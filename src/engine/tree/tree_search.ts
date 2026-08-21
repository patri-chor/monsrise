import type { RoundBoardState, RoundBoardEdit } from '../round_board';
import { SingleRoundEngine, type SingleRoundResult } from '../single_round_engine';
import { RoundBoardStateFactory } from '../round_board_factory';
import { evaluateObjectiveVector, dominates, compareObjective } from './product_training/generation2/optimizer/objective';
import { CandidateSpace } from './product_training/generation2/optimizer/candidate_space';
import { mulberry32 } from '../play_full_game';
import type { TreeCycleConfig } from './tree_types';

export interface SearchExecutionMetrics {
  totalProposals: number;
  totalInvalid: number;
  totalDuplicate: number;
  uniqueEvaluated: number;
  wallTimeMs: number;
  cpuTimeUserMs: number;
  cpuTimeSystemMs: number;
}

export class TreeSearch {
  public static runLocalSearch(
    cases: any[],
    config: TreeCycleConfig,
    searchSeed: number,
    caseIndexOffset = 0
  ): { trials: any[]; representatives: any[]; metrics: SearchExecutionMetrics } {
    const searchStartTime = Date.now();
    const searchStartCpu = process.cpuUsage();

    let totalProposals = 0;
    let totalInvalid = 0;
    let totalDuplicate = 0;

    const trials: any[] = [];
    const representatives: any[] = [];

    let caseIdx = caseIndexOffset;
    for (const c of cases) {
      caseIdx++;
      const rng = mulberry32((searchSeed * 104729 + caseIdx * 7919 + c.round * 15485863) >>> 0);

      const seenFp = new Set<string>();
      seenFp.add(c.baseState.stateFingerprint);

      const caseTrials: any[] = [];
      const targetPerGen = Math.min(
        config.populationSize,
        Math.max(1, Math.floor(config.uniqueCandidatesPerCase / config.maxGenerations))
      );

      for (let gen = 1; gen <= config.maxGenerations; gen++) {
        let uniqueThisGen = 0;

        const nonDomParents = caseTrials.filter(t => !t.isDominated);
        const parentPool = nonDomParents.length > 0 ? nonDomParents : caseTrials;

        const isLastGen = gen === config.maxGenerations;
        const remainingCap = Math.max(0, config.uniqueCandidatesPerCase - (seenFp.size - 1));
        const neededUnique = isLastGen ? remainingCap : Math.min(targetPerGen, remainingCap);

        while (uniqueThisGen < neededUnique && caseTrials.length < neededUnique * 25) {
          totalProposals++;

          let edits: RoundBoardEdit[] = [];
          if (gen > 1 && parentPool.length > 0 && rng() < 0.5) {
            const parent = parentPool[Math.floor(rng() * parentPool.length)];
            edits = CandidateSpace.mutateEdits(parent.edits, c.baseState, rng);
          } else {
            edits = CandidateSpace.sampleCompatibleEdits(c.baseState, rng);
          }

          if (edits.length === 0) {
            totalInvalid++;
            continue;
          }

          const candidateState = RoundBoardStateFactory.cloneWithEdits(c.baseState, edits);
          const fp = candidateState.stateFingerprint;

          if (seenFp.has(fp)) {
            totalDuplicate++;
            continue;
          }

          seenFp.add(fp);
          uniqueThisGen++;

          const res = SingleRoundEngine.runSingleRound(candidateState);
          const obj = evaluateObjectiveVector(res, c.targetSide, edits.length);

          const trial = {
            candidateId: `CAND_${c.caseId}_g${gen}_u${uniqueThisGen}`,
            caseId: c.caseId,
            generation: gen,
            editedStateFingerprint: fp,
            edits,
            result: res,
            objective: obj,
            isDominated: false,
            isRepresentative: false,
          };

          caseTrials.push(trial);
          trials.push(trial);
        }

        // 更新 Pareto 支配性
        for (let i = 0; i < caseTrials.length; i++) {
          caseTrials[i].isDominated = false;
          for (let j = 0; j < caseTrials.length; j++) {
            if (i === j) continue;
            if (dominates(caseTrials[j].objective, caseTrials[i].objective)) {
              caseTrials[i].isDominated = true;
              break;
            }
          }
        }
      }

      // 选拔本 Case 最佳非支配代表解
      const nonDom = caseTrials.filter(t => !t.isDominated);
      const repPool = nonDom.length > 0 ? nonDom : caseTrials;
      repPool.sort((a, b) => compareObjective(b.objective, a.objective));

      if (repPool.length > 0) {
        repPool[0].isRepresentative = true;
        repPool[0].representativeReason = `Rank ${repPool[0].objective.roundWinnerRank}, Target HP ${repPool[0].objective.targetSurvivingHp}, Edits ${repPool[0].objective.editCount}`;
        representatives.push(repPool[0]);
      }
    }

    const cpuDiff = process.cpuUsage(searchStartCpu);
    return {
      trials,
      representatives,
      metrics: {
        totalProposals,
        totalInvalid,
        totalDuplicate,
        uniqueEvaluated: trials.length,
        wallTimeMs: Date.now() - searchStartTime,
        cpuTimeUserMs: Math.round(cpuDiff.user / 1000),
        cpuTimeSystemMs: Math.round(cpuDiff.system / 1000),
      },
    };
  }
}
