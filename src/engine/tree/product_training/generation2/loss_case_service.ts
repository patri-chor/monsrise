import type { ResolvedFormationSnapshot } from '../snapshot_resolver';
import { treeStrategyFor } from '../../product_tree_strategy';
import { ProductGameSession, type ProductRoundCheckpoint, type LegalObservationRecord } from '../../round_engine/product_round_session';
import { computeCalculatorPolicyFingerprint, DEFAULT_CALCULATOR_POLICY } from '../../calculator_policy';

export interface LossCaseItem {
  caseId: string;
  targetId: string;
  targetPayloadFingerprint: string;
  targetCalculatorPolicyFingerprint: string;
  opponentId: string;
  opponentPayloadFingerprint: string;
  opponentCalculatorPolicyFingerprint: string;
  side: 1 | 2;
  seed: number;
  forkRound: number;
  preRCheckpoint: ProductRoundCheckpoint;
  preRObservation: LegalObservationRecord;
  roundResultsThroughR: (1 | 2 | 0)[];
  finalGameOutcome: 'L' | 'D';
  scoreDeficit: number;
  reason: string;
}

export class LossCaseService {
  public static buildLossQueue(
    targetSnap: ResolvedFormationSnapshot,
    opponentSnaps: ResolvedFormationSnapshot[],
    maxCases = 6
  ): LossCaseItem[] {
    const rushEvol = targetSnap.evol;
    const rushStrat = treeStrategyFor(rushEvol);
    const rushFp = targetSnap.canonicalFingerprint;
    const rushPolicyFp = targetSnap.calculatorPolicyFingerprint;

    const lossCases: LossCaseItem[] = [];

    for (const oppSnap of opponentSnaps) {
      if (oppSnap.formationId === targetSnap.formationId) continue;
      const oppEvol = oppSnap.evol;
      const oppStrat = treeStrategyFor(oppEvol);
      const oppPolicyFp = oppEvol.calculatorPolicy
        ? computeCalculatorPolicyFingerprint(oppEvol.calculatorPolicy)
        : computeCalculatorPolicyFingerprint(DEFAULT_CALCULATOR_POLICY);

      let casesForOpp = 0;

      for (let seed = 1; seed <= 50; seed++) {
        if (casesForOpp >= 2) break;

        for (const side of [1, 2] as const) {
          if (casesForOpp >= 2) break;

          const isRushP1 = side === 1;
          const teamA = isRushP1 ? (rushEvol.team as any) : (oppEvol.team as any);
          const teamB = isRushP1 ? (oppEvol.team as any) : (rushEvol.team as any);

          const session = ProductGameSession.create(teamA, teamB, {
            seed,
            strategyIdentityA: isRushP1 ? 'all2rush' : oppSnap.displayName,
            strategyIdentityB: isRushP1 ? oppSnap.displayName : 'all2rush',
          });

          const checkpoints: ProductRoundCheckpoint[] = [];
          const observations: LegalObservationRecord[] = [];

          while (session.currentRound <= 5) {
            if (session.p1Score >= 3 || session.p2Score >= 3) break;
            const r = session.currentRound;
            const cp = session.captureCheckpointBeforeRound(r);
            checkpoints.push(cp);

            const ctxA = session.buildRoundContext(1);
            const ctxB = session.buildRoundContext(2);

            const rushCtx = isRushP1 ? ctxA : ctxB;
            observations.push({
              round: r,
              revealedEnemyHandIds: [...rushCtx.enemyRevealedHand.map(s => s.monsterId)].sort((a, b) => a - b),
              revealedEnemyHandBadges: [...rushCtx.enemyRevealedHand.flatMap(s => s.badgeIds ?? [])].sort((a, b) => a - b),
              revealedEnemyBoardIds: [...rushCtx.enemyMonsters.map(m => m.dbId)].sort((a, b) => a - b),
            });

            const intentsA = isRushP1 ? rushStrat(ctxA) : oppStrat(ctxA);
            const intentsB = isRushP1 ? oppStrat(ctxB) : rushStrat(ctxB);

            const rRes = session.playRound(intentsA, intentsB);
            if (rRes.isGameOver) break;
          }

          const matchWinner: 1 | 2 | 0 =
            session.p1Score === session.p2Score ? 0 : session.p1Score > session.p2Score ? 1 : 2;

          const rushWon = (isRushP1 && matchWinner === 1) || (!isRushP1 && matchWinner === 2);
          const rushDraw = matchWinner === 0;
          const rushLost = (isRushP1 && matchWinner === 2) || (!isRushP1 && matchWinner === 1);

          if (rushLost || rushDraw) {
            let forkRound = 1;
            for (let idx = 0; idx < session.roundResults.length; idx++) {
              const rw = session.roundResults[idx];
              const lostRound = (isRushP1 && rw === 2) || (!isRushP1 && rw === 1);
              if (lostRound) {
                forkRound = idx + 1;
                break;
              }
            }

            const deficit = isRushP1 ? session.p2Score - session.p1Score : session.p1Score - session.p2Score;

            const caseItem: LossCaseItem = {
              caseId: `LOSSC_ALL2RUSH_${oppSnap.displayName.toUpperCase()}_S${side}_SEED${seed}_R${forkRound}`,
              targetId: 'all2rush',
              targetPayloadFingerprint: rushFp,
              targetCalculatorPolicyFingerprint: rushPolicyFp,
              opponentId: oppSnap.formationId,
              opponentPayloadFingerprint: oppSnap.canonicalFingerprint,
              opponentCalculatorPolicyFingerprint: oppPolicyFp,
              side,
              seed,
              forkRound,
              preRCheckpoint: checkpoints[forkRound - 1],
              preRObservation: observations[forkRound - 1],
              roundResultsThroughR: session.roundResults.slice(0, forkRound),
              finalGameOutcome: rushLost ? 'L' : 'D',
              scoreDeficit: deficit,
              reason: `Earliest loss round R${forkRound} vs ${oppSnap.displayName} on side ${side} (seed=${seed}, deficit=${deficit})`,
            };

            lossCases.push(caseItem);
            casesForOpp++;
          }
        }
      }
    }

    return this.rankLossCases(lossCases).slice(0, maxCases);
  }

  public static rankLossCases(cases: LossCaseItem[]): LossCaseItem[] {
    return [...cases].sort((a, b) => {
      if (a.finalGameOutcome !== b.finalGameOutcome) {
        return a.finalGameOutcome === 'L' ? -1 : 1;
      }
      if (a.scoreDeficit !== b.scoreDeficit) {
        return b.scoreDeficit - a.scoreDeficit;
      }
      if (a.forkRound !== b.forkRound) {
        return a.forkRound - b.forkRound;
      }
      return a.seed - b.seed;
    });
  }
}
