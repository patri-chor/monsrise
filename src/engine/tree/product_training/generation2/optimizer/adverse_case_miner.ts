import type { ResolvedFormationSnapshot } from '../../snapshot_resolver';
import { RoundBoardStateFactory } from '../round_board_state_factory';
import { SingleRoundEngine, type SingleRoundResult } from '../single_round_engine';
import type { RoundBoardState } from '../round_board_state';
import type { OptimizerConfig } from './config';

export interface AdverseCaseRecord {
  caseId: string;
  targetFormationId: string;
  opponentFormationId: string;
  opponentDisplayName: string;
  targetSide: 1 | 2;
  seed: number;
  round: number;
  baseState: RoundBoardState;
  baselineResult: SingleRoundResult;
  deficit: number;
  parityPassed: boolean;
  parityFields: {
    roundWinner: 1 | 2 | 0;
    p1ScoreDelta: number;
    p2ScoreDelta: number;
    p1TotalHp: number;
    p2TotalHp: number;
    p1SurvivorsCount: number;
    p2SurvivorsCount: number;
    observableDigest: string;
  };
}

export class AdverseCaseMiner {
  public static mineAdverseCases(
    targetSnap: ResolvedFormationSnapshot,
    oppSnaps: ResolvedFormationSnapshot[],
    config: OptimizerConfig
  ): { selectedCases: AdverseCaseRecord[]; diagnostics: any[] } {
    const selectedCases: AdverseCaseRecord[] = [];
    const diagnostics: any[] = [];

    for (const oppSnap of oppSnaps.slice(0, config.maxOpponents)) {
      const oppCandidates: AdverseCaseRecord[] = [];

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

              const parityFields = {
                roundWinner: baseRes.roundWinner,
                p1ScoreDelta: baseRes.p1ScoreDelta,
                p2ScoreDelta: baseRes.p2ScoreDelta,
                p1TotalHp: baseRes.observableOutput.p1TotalHp,
                p2TotalHp: baseRes.observableOutput.p2TotalHp,
                p1SurvivorsCount: baseRes.observableOutput.p1Survivors.length,
                p2SurvivorsCount: baseRes.observableOutput.p2Survivors.length,
                observableDigest: baseRes.observableOutput.observableDigest,
              };

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
                parityFields,
              });
            }
          }
        }
      }

      // 排序严重度：Loss > Draw -> Deficit 降序 -> 早期 Round
      oppCandidates.sort((a, b) => {
        const aLoss = (a.targetSide === 1 && a.baselineResult.roundWinner === 2) || (a.targetSide === 2 && a.baselineResult.roundWinner === 1);
        const bLoss = (b.targetSide === 1 && b.baselineResult.roundWinner === 2) || (b.targetSide === 2 && b.baselineResult.roundWinner === 1);
        if (aLoss !== bLoss) return aLoss ? -1 : 1;
        if (b.deficit !== a.deficit) return b.deficit - a.deficit;
        return a.round - b.round;
      });

      selectedCases.push(...oppCandidates.slice(0, config.maxAdverseCasesPerOpponent));
    }

    return { selectedCases, diagnostics };
  }
}
