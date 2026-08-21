import type { ResolvedFormationSnapshot } from './product_training/snapshot_resolver';
import type { TreeCycleConfig } from './tree_types';
import { ProductMatchRunner } from '../product_match_runner';
import { treeStrategyFor } from './product_tree_strategy';
import { RoundBoardStateFactory } from '../round_board_factory';
import { SingleRoundEngine } from '../single_round_engine';
import { computeProductOutcomeFromMatch, aggregateProductOutcomes } from './product_training/generation2/cycle/outcome';

export class TreeBenchmark {
  public static runPilotBenchmark(
    targetSnap: ResolvedFormationSnapshot,
    oppSnaps: ResolvedFormationSnapshot[],
    config: TreeCycleConfig
  ) {
    const outcomes: any[] = [];

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
    config: TreeCycleConfig
  ) {
    const selectedCases: any[] = [];

    for (const oppSnap of oppSnaps.slice(0, config.maxOpponents)) {
      const oppCandidates: any[] = [];

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
              const targetHp = (side === 1 ? baseRes.observableOutput.p1TotalHp : baseRes.observableOutput.p2TotalHp) ?? 0;
              const oppHp = (side === 1 ? baseRes.observableOutput.p2TotalHp : baseRes.observableOutput.p1TotalHp) ?? 0;
              const deficit = Math.max(0, oppHp - targetHp) + (isLoss ? 1000 : 500);

              oppCandidates.push({
                caseId: `CASE_${oppSnap.formationId.replace(/[^a-zA-Z0-9_]/g, '_')}_s${seed}_side${side}_r${st.targetRound}`,
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

      oppCandidates.sort((a, b) => b.deficit - a.deficit);
      selectedCases.push(...oppCandidates.slice(0, config.maxAdverseCasesPerOpponent));
    }

    return selectedCases;
  }
}
