import type { ResolvedFormationSnapshot } from '../../snapshot_resolver';
import type { OptimizerCycleConfig, BaselineCase } from './types';
import { ProductMatchRunner } from '../product_match_runner';
import { treeStrategyFor } from '../../../product_tree_strategy';
import { RoundBoardStateFactory } from '../round_board_state_factory';
import { SingleRoundEngine } from '../single_round_engine';
import { computeProductOutcomeFromMatch, aggregateProductOutcomes, type ProductOutcome } from './outcome';

export class CycleBenchmark {
  public static runPilotBenchmark(
    targetSnap: ResolvedFormationSnapshot,
    oppSnaps: ResolvedFormationSnapshot[],
    config: OptimizerCycleConfig
  ): { outcomes: ProductOutcome[]; aggregate: ReturnType<typeof aggregateProductOutcomes> } {
    const outcomes: ProductOutcome[] = [];

    for (const oppSnap of oppSnaps.slice(0, config.maxOpponents)) {
      for (const side of [1, 2] as const) {
        for (const seed of config.baselineSeeds) {
          const isP1 = side === 1;
          const matchRes = ProductMatchRunner.runFullMatch({
            teamA: isP1 ? targetSnap.team : oppSnap.team,
            teamB: isP1 ? oppSnap.team : targetSnap.team,
            seed,
            nameA: isP1 ? targetSnap.displayName : oppSnap.displayName,
            nameB: isP1 ? oppSnap.displayName : targetSnap.displayName,
            strategyA: treeStrategyFor(isP1 ? targetSnap.evol : oppSnap.evol),
            strategyB: treeStrategyFor(isP1 ? oppSnap.evol : targetSnap.evol),
          });
          outcomes.push(computeProductOutcomeFromMatch(matchRes, side));
        }
      }
    }

    return { outcomes, aggregate: aggregateProductOutcomes(outcomes) };
  }

  public static mineAdverseCasesFromBenchmark(
    targetSnap: ResolvedFormationSnapshot,
    oppSnaps: ResolvedFormationSnapshot[],
    config: OptimizerCycleConfig
  ): BaselineCase[] {
    const selectedCases: BaselineCase[] = [];

    for (const oppSnap of oppSnaps.slice(0, config.maxOpponents)) {
      const oppCandidates: BaselineCase[] = [];

      for (const seed of config.baselineSeeds) {
        for (const side of [1, 2] as const) {
          const states = RoundBoardStateFactory.captureStatesFromBaselineMatch({
            targetSnap,
            opponentSnap: oppSnap,
            targetSide: side,
            seed,
          });

          for (const st of states) {
            const baseRes = SingleRoundEngine.runSingleRound(st);
            const isLoss = (side === 1 && baseRes.roundWinner === 2) || (side === 2 && baseRes.roundWinner === 1);
            const isDraw = baseRes.roundWinner === 0;

            if (isLoss || isDraw) {
              const targetScoreAfter = side === 1 ? baseRes.p1Score : baseRes.p2Score;
              const oppScoreAfter = side === 1 ? baseRes.p2Score : baseRes.p1Score;
              const deficit = oppScoreAfter - targetScoreAfter;

              oppCandidates.push({
                caseId: `CASE_${targetSnap.displayName}_vs_${oppSnap.displayName}_s${side}_seed${seed}_r${st.targetRound}`,
                targetFormationId: targetSnap.formationId,
                opponentFormationId: oppSnap.formationId,
                opponentDisplayName: oppSnap.displayName,
                targetSide: side,
                seed,
                round: st.targetRound,
                baseState: st,
                baselineResult: baseRes,
                deficit,
                parityPassed: true,
              });
            }
          }
        }
      }

      oppCandidates.sort((a, b) => {
        const aLoss = (a.targetSide === 1 && a.baselineResult.roundWinner === 2) || (a.targetSide === 2 && a.baselineResult.roundWinner === 1);
        const bLoss = (b.targetSide === 1 && b.baselineResult.roundWinner === 2) || (b.targetSide === 2 && b.baselineResult.roundWinner === 1);
        if (aLoss !== bLoss) return aLoss ? -1 : 1;
        if (b.deficit !== a.deficit) return b.deficit - a.deficit;
        return a.round - b.round;
      });

      selectedCases.push(...oppCandidates.slice(0, config.maxAdverseCasesPerOpponent));
    }

    return selectedCases;
  }
}
