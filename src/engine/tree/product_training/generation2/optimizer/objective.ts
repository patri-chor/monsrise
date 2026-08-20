import type { SingleRoundResult } from '../single_round_engine';
import type { ObservableRoundOutput } from '../product_match_runner';

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
  if (a.opponentScoreDelta !== b.opponentScoreDelta) return b.opponentScoreDelta - a.opponentScoreDelta; // lower opponent delta better
  if (a.targetSurvivingUnits !== b.targetSurvivingUnits) return a.targetSurvivingUnits - b.targetSurvivingUnits;
  if (a.targetSurvivingHp !== b.targetSurvivingHp) return a.targetSurvivingHp - b.targetSurvivingHp;
  if (a.opponentSurvivingUnits !== b.opponentSurvivingUnits) return b.opponentSurvivingUnits - a.opponentSurvivingUnits; // lower opponent units better
  if (a.opponentSurvivingHp !== b.opponentSurvivingHp) return b.opponentSurvivingHp - a.opponentSurvivingHp; // lower opponent hp better
  return b.editCount - a.editCount; // fewer edits better
}

export function dominates(a: ObjectiveVector, b: ObjectiveVector): boolean {
  // Returns true if a dominates b (a is no worse on all and strictly better on at least one)
  const noWorse =
    a.roundWinnerRank >= b.roundWinnerRank &&
    a.targetScoreDelta >= b.targetScoreDelta &&
    a.opponentScoreDelta <= b.opponentScoreDelta &&
    a.targetSurvivingUnits >= b.targetSurvivingUnits &&
    a.targetSurvivingHp >= b.targetSurvivingHp &&
    a.opponentSurvivingUnits <= b.opponentSurvivingUnits &&
    a.opponentSurvivingHp <= b.opponentSurvivingHp;

  const strictlyBetter =
    a.roundWinnerRank > b.roundWinnerRank ||
    a.targetScoreDelta > b.targetScoreDelta ||
    a.opponentScoreDelta < b.opponentScoreDelta ||
    a.targetSurvivingUnits > b.targetSurvivingUnits ||
    a.targetSurvivingHp > b.targetSurvivingHp ||
    a.opponentSurvivingUnits < b.opponentSurvivingUnits ||
    a.opponentSurvivingHp < b.opponentSurvivingHp;

  return noWorse && strictlyBetter;
}
