import type { RoundBoardState, RoundBoardUnit, RoundDeploymentAction } from './round_board_state';
import { computeRoundBoardStateFingerprint } from './round_board_state';
import type { ResolvedFormationSnapshot } from '../snapshot_resolver';
import { treeStrategyFor } from '../../product_tree_strategy';
import { ProductGameSession, type ProductDeploymentTrace } from '../../round_engine/product_round_session';

export interface RoundBoardEdit {
  type: 'REPOSITION_DEPLOYED_UNIT' | 'CHANGE_PENDING_PLACEMENT' | 'REORDER_PENDING_ACTIONS';
  instanceId?: string;
  actionOrder?: number;
  newX?: number;
  newY?: number;
  newActionOrders?: number[];
}

export class RoundBoardStateFactory {
  public static captureStatesFromBaselineMatch(input: {
    targetSnap: ResolvedFormationSnapshot;
    opponentSnap: ResolvedFormationSnapshot;
    targetSide: 1 | 2;
    seed: number;
  }): RoundBoardState[] {
    const isRushP1 = input.targetSide === 1;
    const snapA = isRushP1 ? input.targetSnap : input.opponentSnap;
    const snapB = isRushP1 ? input.opponentSnap : input.targetSnap;
    const stratA = treeStrategyFor(snapA.evol);
    const stratB = treeStrategyFor(snapB.evol);

    const session = ProductGameSession.create(snapA.team, snapB.team, {
      seed: input.seed,
      strategyIdentityA: snapA.displayName,
      strategyIdentityB: snapB.displayName,
    });

    const states: RoundBoardState[] = [];
    const allAcceptedTraces: ProductDeploymentTrace[] = [];

    while (session.currentRound <= 5) {
      if (session.p1Score >= 3 || session.p2Score >= 3) break;
      const r = session.currentRound;

      const p1ScoreBefore = session.p1Score;
      const p2ScoreBefore = session.p2Score;
      const p1BudgetBefore = (session as any).gameEngine?.p1RemainingBudget ?? 4;
      const p2BudgetBefore = (session as any).gameEngine?.p2RemainingBudget ?? 4;
      const rngBefore = session.currentRngSeed;

      const ctxA = session.buildRoundContext(1);
      const ctxB = session.buildRoundContext(2);
      const intentsA = stratA(ctxA);
      const intentsB = stratB(ctxB);

      const rRes = session.playRound(intentsA, intentsB);

      // Deployed units are accepted traces from rounds 1..r-1
      const deployedUnits: RoundBoardUnit[] = allAcceptedTraces.map(t => ({
        instanceId: `p${t.side}_r${t.round}_o${t.attemptOrder}`,
        side: t.side as 1 | 2,
        monsterId: t.monsterId,
        badgeIds: (t.side === 1 ? snapA.team : snapB.team).find(s => s.monsterId === t.monsterId)?.badgeIds ?? [],
        deployedRound: t.round,
        deploymentOrder: t.attemptOrder,
        originalX: t.actualX!,
        originalY: t.actualY!,
      }));

      // Current round pending actions from round r deployment traces
      const pendingActions: RoundDeploymentAction[] = rRes.deploymentTraces.map(t => ({
        side: t.side as 1 | 2,
        round: t.round,
        order: t.attemptOrder,
        monsterId: t.monsterId,
        badgeIds: (t.side === 1 ? snapA.team : snapB.team).find(s => s.monsterId === t.monsterId)?.badgeIds ?? [],
        x: t.actualX ?? t.plannedX,
        y: t.actualY ?? t.plannedY,
        accepted: t.accepted,
        rejectionReason: t.rejectionReason,
      }));

      const rawState = {
        schemaVersion: 'GENERATION2_ROUND_BOARD_STATE_V1' as const,
        targetRound: r,
        seed: input.seed,
        rngStateBeforeRound: rngBefore,
        p1ScoreBeforeRound: p1ScoreBefore,
        p2ScoreBeforeRound: p2ScoreBefore,
        p1BudgetBeforeRound: p1BudgetBefore,
        p2BudgetBeforeRound: p2BudgetBefore,
        teamA: snapA.team.map(s => ({ monsterId: s.monsterId, badgeIds: [...(s.badgeIds ?? [])] })),
        teamB: snapB.team.map(s => ({ monsterId: s.monsterId, badgeIds: [...(s.badgeIds ?? [])] })),
        deployedUnits,
        pendingActions,
        targetSide: input.targetSide,
        targetFormationFingerprint: input.targetSnap.canonicalFingerprint,
        opponentFormationFingerprint: input.opponentSnap.canonicalFingerprint,
        targetPolicyFingerprint: input.targetSnap.calculatorPolicyFingerprint,
        opponentPolicyFingerprint: input.opponentSnap.calculatorPolicyFingerprint,
        selectedBranchIdsThroughRound: [],
      };

      const state: RoundBoardState = {
        ...rawState,
        stateFingerprint: computeRoundBoardStateFingerprint(rawState),
      };
      states.push(state);

      // Accumulate accepted traces for future rounds
      for (const t of rRes.deploymentTraces) {
        if (t.accepted && t.actualX !== null && t.actualY !== null) {
          allAcceptedTraces.push(t);
        }
      }

      if (rRes.isGameOver) break;
    }

    return states;
  }

  public static cloneWithEdits(
    base: RoundBoardState,
    edits: RoundBoardEdit[]
  ): RoundBoardState {
    const deployedUnits: RoundBoardUnit[] = base.deployedUnits.map(u => ({ ...u, badgeIds: [...u.badgeIds] }));
    let pendingActions: RoundDeploymentAction[] = base.pendingActions.map(a => ({ ...a, badgeIds: [...a.badgeIds] }));

    for (const edit of edits) {
      if (edit.type === 'REPOSITION_DEPLOYED_UNIT' && edit.instanceId && typeof edit.newX === 'number' && typeof edit.newY === 'number') {
        const u = deployedUnits.find(unit => unit.instanceId === edit.instanceId && unit.side === base.targetSide);
        if (u) {
          u.originalX = edit.newX;
          u.originalY = edit.newY;
        }
      } else if (edit.type === 'CHANGE_PENDING_PLACEMENT' && typeof edit.actionOrder === 'number' && typeof edit.newX === 'number' && typeof edit.newY === 'number') {
        const a = pendingActions.find(act => act.order === edit.actionOrder && act.side === base.targetSide);
        if (a) {
          a.x = edit.newX;
          a.y = edit.newY;
        }
      } else if (edit.type === 'REORDER_PENDING_ACTIONS' && Array.isArray(edit.newActionOrders)) {
        const targetActions = pendingActions.filter(a => a.side === base.targetSide);
        const otherActions = pendingActions.filter(a => a.side !== base.targetSide);
        const reordered = edit.newActionOrders
          .map(order => targetActions.find(a => a.order === order))
          .filter((a): a is RoundDeploymentAction => !!a);
        pendingActions = [...reordered, ...otherActions];
      }
    }

    const rawState = {
      schemaVersion: base.schemaVersion,
      targetRound: base.targetRound,
      seed: base.seed,
      rngStateBeforeRound: base.rngStateBeforeRound,
      p1ScoreBeforeRound: base.p1ScoreBeforeRound,
      p2ScoreBeforeRound: base.p2ScoreBeforeRound,
      p1BudgetBeforeRound: base.p1BudgetBeforeRound,
      p2BudgetBeforeRound: base.p2BudgetBeforeRound,
      teamA: base.teamA.map(s => ({ monsterId: s.monsterId, badgeIds: [...s.badgeIds] })),
      teamB: base.teamB.map(s => ({ monsterId: s.monsterId, badgeIds: [...s.badgeIds] })),
      deployedUnits,
      pendingActions,
      targetSide: base.targetSide,
      targetFormationFingerprint: base.targetFormationFingerprint,
      opponentFormationFingerprint: base.opponentFormationFingerprint,
      targetPolicyFingerprint: base.targetPolicyFingerprint,
      opponentPolicyFingerprint: base.opponentPolicyFingerprint,
      selectedBranchIdsThroughRound: [...base.selectedBranchIdsThroughRound],
    };

    return {
      ...rawState,
      stateFingerprint: computeRoundBoardStateFingerprint(rawState),
    };
  }
}
