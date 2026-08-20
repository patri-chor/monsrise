// ============================================================
// src/engine/tree/round_engine/loss_case_inventory.ts
// T101: B. Fixed Loss-Case Inventory for All2Rush
// ============================================================

import '../../env';
import { FORMATION_LIBRARY } from '../../../ai/formation_library';
import { formationToEvol, type EvolFormation } from '../evol_gene';
import { treeStrategyFor } from '../product_tree_strategy';
import { ProductGameSession, type ProductRoundCheckpoint } from './product_round_session';
import { computeCandidateFingerprint } from '../product_training/02_candidates';
import { computeCalculatorPolicyFingerprint, DEFAULT_CALCULATOR_POLICY } from '../calculator_policy';
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface LegalObservationRecord {
  round: number;
  revealedEnemyHandIds: number[];
  revealedEnemyHandBadges: number[];
  revealedEnemyBoardIds: number[];
}

export interface LossCase {
  caseId: string;
  targetId: string;
  targetPayloadFingerprint: string;
  targetCalculatorPolicyFingerprint: string;
  opponentId: string;
  opponentPayloadFingerprint: string;
  opponentCalculatorPolicyFingerprint: string;
  side: 1 | 2;
  seed: number;
  forkRound: number; // Earliest meaningful loss round R
  preRCheckpoint: ProductRoundCheckpoint;
  preRObservation: LegalObservationRecord;
  roundResultsThroughR: (1 | 2 | 0)[];
  finalGameOutcome: 'L' | 'D';
  reason: string;
}

export const EVIDENCE_LOSS_CASE_PATH = resolve('reports/tree-cycle/all2rush_g2_loss_case_inventory.jsonl');

export function appendLossCaseEvidence(record: LossCase): void {
  const line = JSON.stringify({
    recordKind: 'ALL2RUSH_G2_LOSS_CASE_INVENTORY_V1',
    timestamp: new Date().toISOString(),
    ...record,
  }) + '\n';
  appendFileSync(EVIDENCE_LOSS_CASE_PATH, line, 'utf8');
}

/**
 * 挖掘针对 all2rush 的典型 LossCase
 */
export function buildAll2RushLossCaseInventory(
  rushEvol: EvolFormation,
  opponentNames: string[] = ['golden_boom', 'all2prayer', 'gift_jungle']
): LossCase[] {
  const lossCases: LossCase[] = [];
  const rushStrat = treeStrategyFor(rushEvol);
  const rushFp = computeCandidateFingerprint(rushEvol);
  const rushPolicyFp = rushEvol.calculatorPolicy
    ? computeCalculatorPolicyFingerprint(rushEvol.calculatorPolicy)
    : computeCalculatorPolicyFingerprint(DEFAULT_CALCULATOR_POLICY);

  const candidateOpponents = opponentNames.map(name => {
    const opp = FORMATION_LIBRARY.find(f => f.id === name || f.name === name);
    if (!opp) return null;
    const oppEvol = (opp as any).evol ? (opp as any).evol : formationToEvol(opp);
    const oppStrat = treeStrategyFor(oppEvol);
    const oppFp = computeCandidateFingerprint(oppEvol);
    const oppPolicyFp = oppEvol.calculatorPolicy
      ? computeCalculatorPolicyFingerprint(oppEvol.calculatorPolicy)
      : computeCalculatorPolicyFingerprint(DEFAULT_CALCULATOR_POLICY);
    return { name, opp, oppEvol, oppStrat, oppFp, oppPolicyFp };
  }).filter(Boolean);

  let caseCounter = 1;

  for (const oppData of candidateOpponents) {
    if (!oppData) continue;
    let casesForThisOpp = 0;

    for (let seed = 1; seed <= 50; seed++) {
      if (casesForThisOpp >= 2) break;

      for (const side of [1, 2] as const) {
        if (casesForThisOpp >= 2) break;

        const isRushP1 = side === 1;
        const teamA = isRushP1 ? (rushEvol.team as any) : (oppData.oppEvol.team as any);
        const teamB = isRushP1 ? (oppData.oppEvol.team as any) : (rushEvol.team as any);

        const session = ProductGameSession.create(teamA, teamB, {
          seed,
          strategyIdentityA: isRushP1 ? 'all2rush' : oppData.name,
          strategyIdentityB: isRushP1 ? oppData.name : 'all2rush',
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

          const intentsA = isRushP1 ? rushStrat(ctxA) : oppData.oppStrat(ctxA);
          const intentsB = isRushP1 ? oppData.oppStrat(ctxB) : rushStrat(ctxB);

          const rRes = session.playRound(intentsA, intentsB);
          if (rRes.isGameOver) break;
        }

        const matchWinner: 1 | 2 | 0 =
          session.p1Score === session.p2Score ? 0 : session.p1Score > session.p2Score ? 1 : 2;

        const rushWon = (isRushP1 && matchWinner === 1) || (!isRushP1 && matchWinner === 2);
        const rushDraw = matchWinner === 0;
        const rushLost = (isRushP1 && matchWinner === 2) || (!isRushP1 && matchWinner === 1);

        if (rushLost || rushDraw) {
          // 找到 earliest meaningful loss round R (从第 1 回合起，第一个对手得分或双方打平导致失势的回合)
          let forkRound = 1;
          for (let idx = 0; idx < session.roundResults.length; idx++) {
            const rw = session.roundResults[idx];
            const rushLostRound = (isRushP1 && rw === 2) || (!isRushP1 && rw === 1);
            if (rushLostRound) {
              forkRound = idx + 1;
              break;
            }
          }

          const lossCase: LossCase = {
            caseId: `LOSSC_ALL2RUSH_${oppData.name.toUpperCase()}_S${side}_SEED${seed}_R${forkRound}`,
            targetId: 'all2rush',
            targetPayloadFingerprint: rushFp,
            targetCalculatorPolicyFingerprint: rushPolicyFp,
            opponentId: oppData.name,
            opponentPayloadFingerprint: oppData.oppFp,
            opponentCalculatorPolicyFingerprint: oppData.oppPolicyFp,
            side,
            seed,
            forkRound,
            preRCheckpoint: checkpoints[forkRound - 1],
            preRObservation: observations[forkRound - 1],
            roundResultsThroughR: session.roundResults.slice(0, forkRound),
            finalGameOutcome: rushLost ? 'L' : 'D',
            reason: `Earliest loss round R${forkRound} vs ${oppData.name} on side ${side} (seed=${seed})`,
          };

          lossCases.push(lossCase);
          appendLossCaseEvidence(lossCase);
          casesForThisOpp++;
        }
      }
    }
  }

  return lossCases;
}
