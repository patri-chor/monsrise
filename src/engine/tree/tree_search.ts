import type { RoundBoardState, RoundBoardEdit } from '../round_board';
import { SingleRoundEngine, type SingleRoundResult } from '../single_round_engine';
import { RoundBoardStateFactory } from '../round_board_factory';
import { mulberry32, PRODUCT_ZONES } from '../play_full_game';
import type { TreeCycleConfig } from './tree_types';

export interface ObjectiveVector {
  roundWinnerRank: number; // 3 for win, 2 for draw, 1 for loss
  targetScoreDelta: number;
  opponentScoreDelta: number;
  targetSurvivingUnits: number;
  targetSurvivingHp: number;
  opponentSurvivingUnits: number;
  opponentSurvivingHp: number;
  editCount: number;
}

export function evaluateObjectiveVector(
  result: SingleRoundResult,
  targetSide: 1 | 2,
  editCount: number
): ObjectiveVector {
  const isTargetP1 = targetSide === 1;
  const targetWon = (isTargetP1 && result.roundWinner === 1) || (!isTargetP1 && result.roundWinner === 2);
  const isDraw = result.roundWinner === 0;
  const roundWinnerRank = targetWon ? 3 : isDraw ? 2 : 1;

  const targetScoreDelta = isTargetP1 ? result.p1ScoreDelta : result.p2ScoreDelta;
  const opponentScoreDelta = isTargetP1 ? result.p2ScoreDelta : result.p1ScoreDelta;

  const targetSurvivingUnits = isTargetP1 ? result.observableOutput.p1Survivors.length : result.observableOutput.p2Survivors.length;
  const targetSurvivingHp = isTargetP1 ? result.observableOutput.p1TotalHp : result.observableOutput.p2TotalHp;

  const opponentSurvivingUnits = isTargetP1 ? result.observableOutput.p2Survivors.length : result.observableOutput.p1Survivors.length;
  const opponentSurvivingHp = isTargetP1 ? result.observableOutput.p2TotalHp : result.observableOutput.p1TotalHp;

  return {
    roundWinnerRank,
    targetScoreDelta,
    opponentScoreDelta,
    targetSurvivingUnits,
    targetSurvivingHp,
    opponentSurvivingUnits,
    opponentSurvivingHp,
    editCount,
  };
}

export function compareObjective(a: ObjectiveVector, b: ObjectiveVector): number {
  if (a.roundWinnerRank !== b.roundWinnerRank) return a.roundWinnerRank - b.roundWinnerRank;
  if (a.targetScoreDelta !== b.targetScoreDelta) return a.targetScoreDelta - b.targetScoreDelta;
  if (a.opponentScoreDelta !== b.opponentScoreDelta) return b.opponentScoreDelta - a.opponentScoreDelta;
  if (a.targetSurvivingUnits !== b.targetSurvivingUnits) return a.targetSurvivingUnits - b.targetSurvivingUnits;
  if (a.targetSurvivingHp !== b.targetSurvivingHp) return a.targetSurvivingHp - b.targetSurvivingHp;
  if (a.opponentSurvivingUnits !== b.opponentSurvivingUnits) return b.opponentSurvivingUnits - a.opponentSurvivingUnits;
  if (a.opponentSurvivingHp !== b.opponentSurvivingHp) return b.opponentSurvivingHp - a.opponentSurvivingHp;
  return b.editCount - a.editCount;
}

export function dominates(a: ObjectiveVector, b: ObjectiveVector): boolean {
  const noWorse =
    a.roundWinnerRank >= b.roundWinnerRank &&
    a.targetScoreDelta >= b.targetScoreDelta &&
    a.opponentScoreDelta <= b.opponentScoreDelta &&
    a.targetSurvivingUnits >= b.targetSurvivingUnits &&
    a.targetSurvivingHp >= b.targetSurvivingHp &&
    a.opponentSurvivingUnits <= b.opponentSurvivingUnits &&
    a.opponentSurvivingHp <= b.opponentSurvivingHp &&
    a.editCount <= b.editCount;

  const strictlyBetter =
    a.roundWinnerRank > b.roundWinnerRank ||
    a.targetScoreDelta > b.targetScoreDelta ||
    a.opponentScoreDelta < b.opponentScoreDelta ||
    a.targetSurvivingUnits > b.targetSurvivingUnits ||
    a.targetSurvivingHp > b.targetSurvivingHp ||
    a.opponentSurvivingUnits < b.opponentSurvivingUnits ||
    a.opponentSurvivingHp < b.opponentSurvivingHp ||
    a.editCount < b.editCount;

  return noWorse && strictlyBetter;
}

export class CandidateSpace {
  public static sampleCompatibleEdits(
    baseState: RoundBoardState,
    rng: () => number
  ): RoundBoardEdit[] {
    const targetSide = baseState.targetSide;
    const zone = PRODUCT_ZONES[targetSide];
    const baseUnits = baseState.deployedUnits.filter(u => u.side === targetSide);
    const basePending = baseState.pendingActions.filter(a => a.side === targetSide);

    const totalAvail = baseUnits.length + basePending.length;
    if (totalAvail === 0) return [];

    const maxDesired = totalAvail >= 3 ? 3 : totalAvail >= 2 ? 2 : 1;
    const desiredCount = 1 + Math.floor(rng() * maxDesired);

    const edits: RoundBoardEdit[] = [];
    const usedDeployedIds = new Set<string>();
    const usedActionOrders = new Set<number>();

    for (let i = 0; i < desiredCount; i++) {
      const r = rng();
      if (baseUnits.length > 0 && r < 0.5) {
        const avail = baseUnits.filter(u => !usedDeployedIds.has(u.instanceId));
        if (avail.length > 0) {
          const u = avail[Math.floor(rng() * avail.length)];
          usedDeployedIds.add(u.instanceId);
          edits.push({
            type: 'REPOSITION_DEPLOYED_UNIT',
            instanceId: u.instanceId,
            newX: zone.min + Math.floor(rng() * (zone.max - zone.min + 1)),
            newY: Math.floor(rng() * 5),
          });
        }
      } else if (basePending.length > 0) {
        const avail = basePending.filter(a => !usedActionOrders.has(a.order));
        if (avail.length > 0) {
          const a = avail[Math.floor(rng() * avail.length)];
          usedActionOrders.add(a.order);
          edits.push({
            type: 'CHANGE_PENDING_PLACEMENT',
            actionOrder: a.order,
            newX: zone.min + Math.floor(rng() * (zone.max - zone.min + 1)),
            newY: Math.floor(rng() * 5),
          });
        }
      }
    }

    return edits;
  }

  public static mutateEdits(
    edits: RoundBoardEdit[],
    baseState: RoundBoardState,
    rng: () => number
  ): RoundBoardEdit[] {
    const targetSide = baseState.targetSide;
    const zone = PRODUCT_ZONES[targetSide];
    const cloned = edits.map(e => ({ ...e }));

    if (cloned.length > 0) {
      const idx = Math.floor(rng() * cloned.length);
      cloned[idx].newX = zone.min + Math.floor(rng() * (zone.max - zone.min + 1));
      cloned[idx].newY = Math.floor(rng() * 5);
    }

    return cloned;
  }
}

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
