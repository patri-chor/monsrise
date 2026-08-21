import type { ObservableMatchResult } from '../product_match_runner';
import { ProductMatchRunner } from '../product_match_runner';
import { treeStrategyFor } from './product_tree_strategy';
import type { EvolFormation } from '../evol_gene';

export interface ProductOutcome {
  targetSide: 1 | 2;
  winner: 1 | 2 | 0;
  targetW: number;
  targetD: number;
  targetL: number;
  targetScore70: number; // (W + 0.70 * D) / N
  targetRoundResults: Array<1 | 2 | 0>;
  perRoundObservable: Array<{
    round: number;
    winner: 1 | 2 | 0;
    targetScore: number;
    opponentScore: number;
    targetSurvivorIds: string[];
    targetHp: number;
    targetSurvivorCount: number;
    opponentSurvivorIds: string[];
    opponentHp: number;
    opponentSurvivorCount: number;
  }>;
  observableDigest: string;
}

export function computeProductOutcomeFromMatch(
  matchRes: ObservableMatchResult,
  targetSide: 1 | 2
): ProductOutcome {
  const isP1 = targetSide === 1;
  const isTargetWin = (isP1 && matchRes.winner === 1) || (!isP1 && matchRes.winner === 2);
  const isDraw = matchRes.winner === 0;
  const isTargetLoss = (isP1 && matchRes.winner === 2) || (!isP1 && matchRes.winner === 1);

  const targetW = isTargetWin ? 1 : 0;
  const targetD = isDraw ? 1 : 0;
  const targetL = isTargetLoss ? 1 : 0;
  const targetScore70 = targetW + 0.70 * targetD;

  const perRoundObservable = matchRes.roundOutputs.map(ro => ({
    round: ro.round,
    winner: ro.winner,
    targetScore: isP1 ? ro.p1Score : ro.p2Score,
    opponentScore: isP1 ? ro.p2Score : ro.p1Score,
    targetSurvivorIds: isP1 ? ro.p1Survivors.map(s => s.instanceId) : ro.p2Survivors.map(s => s.instanceId),
    targetHp: isP1 ? ro.p1TotalHp : ro.p2TotalHp,
    targetSurvivorCount: isP1 ? ro.p1Survivors.length : ro.p2Survivors.length,
    opponentSurvivorIds: isP1 ? ro.p2Survivors.map(s => s.instanceId) : ro.p1Survivors.map(s => s.instanceId),
    opponentHp: isP1 ? ro.p2TotalHp : ro.p1TotalHp,
    opponentSurvivorCount: isP1 ? ro.p2Survivors.length : ro.p1Survivors.length,
  }));

  const targetRoundResults = matchRes.roundOutputs.map(ro => {
    if (ro.winner === 0) return 0 as const;
    return ((isP1 && ro.winner === 1) || (!isP1 && ro.winner === 2)) ? (1 as const) : (2 as const);
  });

  const observableDigest = matchRes.roundOutputs.map(ro => ro.observableDigest).join(';');

  return {
    targetSide,
    winner: matchRes.winner,
    targetW,
    targetD,
    targetL,
    targetScore70,
    targetRoundResults,
    perRoundObservable,
    observableDigest,
  };
}

export function compareProductOutcome(a: ProductOutcome, b: ProductOutcome): number {
  if (Math.abs(a.targetScore70 - b.targetScore70) > 1e-6) {
    return a.targetScore70 - b.targetScore70;
  }
  if (a.targetW !== b.targetW) return a.targetW - b.targetW;
  if (a.targetD !== b.targetD) return a.targetD - b.targetD;
  if (a.targetL !== b.targetL) return b.targetL - a.targetL;

  const aRoundWins = a.targetRoundResults.filter(r => r === 1).length;
  const bRoundWins = b.targetRoundResults.filter(r => r === 1).length;
  if (aRoundWins !== bRoundWins) return aRoundWins - bRoundWins;

  const aTargetHp = a.perRoundObservable.reduce((s, r) => s + r.targetHp, 0);
  const bTargetHp = b.perRoundObservable.reduce((s, r) => s + r.targetHp, 0);
  if (aTargetHp !== bTargetHp) return aTargetHp - bTargetHp;

  const aOppHp = a.perRoundObservable.reduce((s, r) => s + r.opponentHp, 0);
  const bOppHp = b.perRoundObservable.reduce((s, r) => s + r.opponentHp, 0);
  return bOppHp - aOppHp;
}

export function aggregateProductOutcomes(outcomes: ProductOutcome[]): {
  targetW: number;
  targetD: number;
  targetL: number;
  count: number;
  targetScore70Average: number;
} {
  const count = outcomes.length;
  if (count === 0) {
    return { targetW: 0, targetD: 0, targetL: 0, count: 0, targetScore70Average: 0 };
  }
  const targetW = outcomes.reduce((s, o) => s + o.targetW, 0);
  const targetD = outcomes.reduce((s, o) => s + o.targetD, 0);
  const targetL = outcomes.reduce((s, o) => s + o.targetL, 0);
  const targetScore70Average = (targetW + 0.70 * targetD) / count;

  return { targetW, targetD, targetL, count, targetScore70Average };
}

export class TreeProduct {
  public static runProductMatch(params: {
    teamA: any[];
    teamB: any[];
    seed: number;
    nameA: string;
    nameB: string;
    evolA: EvolFormation;
    evolB: EvolFormation;
    collectStrategyTrace?: boolean;
  }) {
    return ProductMatchRunner.runFullMatch({
      teamA: params.teamA,
      teamB: params.teamB,
      seed: params.seed,
      nameA: params.nameA,
      nameB: params.nameB,
      strategyA: treeStrategyFor(params.evolA),
      strategyB: treeStrategyFor(params.evolB),
      collectStrategyTrace: params.collectStrategyTrace,
    });
  }
}
