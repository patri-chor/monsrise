import type { RoundBoardState, RoundBoardUnit, RoundDeploymentAction, RoundBoardEdit } from './round_board';
import { computeRoundBoardStateFingerprint } from './round_board';
import { treeStrategyFor } from './tree/product_tree_strategy';
import { ProductGameSession, type ProductDeploymentTrace } from './tree/round_engine/product_round_session';

export class RoundBoardStateFactory {
  public static captureStatesFromBaselineMatch(input: {
    targetSnap: any;
    opponentSnap: any;
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
        originalX: t.x,
        originalY: t.y,
      }));

      // Current round pending actions from rRes
      const currentTraces = rRes.deploymentTraces.filter(t => t.round === r);
      const pendingActions: RoundDeploymentAction[] = currentTraces.map(t => ({
        side: t.side as 1 | 2,
        round: t.round,
        order: t.attemptOrder,
        monsterId: t.monsterId,
        badgeIds: (t.side === 1 ? snapA.team : snapB.team).find(s => s.monsterId === t.monsterId)?.badgeIds ?? [],
        x: t.x,
        y: t.y,
        accepted: t.accepted,
        rejectionReason: t.rejectionReason ?? null,
      }));

      const stateData: Omit<RoundBoardState, 'stateFingerprint'> = {
        schemaVersion: 'GENERATION2_ROUND_BOARD_STATE_V1',
        targetRound: r,
        seed: input.seed,
        rngStateBeforeRound: rngBefore,
        p1ScoreBeforeRound: p1ScoreBefore,
        p2ScoreBeforeRound: p2ScoreBefore,
        p1BudgetBeforeRound: p1BudgetBefore,
        p2BudgetBeforeRound: p2BudgetBefore,
        teamA: snapA.team.map((s: any) => ({ monsterId: s.monsterId, badgeIds: [...s.badgeIds] })),
        teamB: snapB.team.map((s: any) => ({ monsterId: s.monsterId, badgeIds: [...s.badgeIds] })),
        deployedUnits,
        pendingActions,
        targetSide: input.targetSide,
        targetFormationFingerprint: snapA.canonicalFingerprint,
        opponentFormationFingerprint: snapB.canonicalFingerprint,
        targetPolicyFingerprint: snapA.canonicalFingerprint,
        opponentPolicyFingerprint: snapB.canonicalFingerprint,
        selectedBranchIdsThroughRound: [],
      };

      states.push({
        ...stateData,
        stateFingerprint: computeRoundBoardStateFingerprint(stateData),
      });

      // Accumulate accepted traces for future rounds
      allAcceptedTraces.push(...currentTraces.filter(t => t.accepted));
    }

    return states;
  }

  public static cloneWithEdits(
    base: RoundBoardState,
    edits: RoundBoardEdit[]
  ): RoundBoardState {
    const deployedUnits: RoundBoardUnit[] = base.deployedUnits.map(u => ({
      ...u,
      badgeIds: [...u.badgeIds],
    }));

    let pendingActions: RoundDeploymentAction[] = base.pendingActions.map(a => ({
      ...a,
      badgeIds: [...a.badgeIds],
    }));

    for (const edit of edits) {
      if (edit.type === 'REPOSITION_DEPLOYED_UNIT' && edit.instanceId) {
        const u = deployedUnits.find(unit => unit.instanceId === edit.instanceId && unit.side === base.targetSide);
        if (u && edit.newX !== undefined && edit.newY !== undefined) {
          u.originalX = edit.newX;
          u.originalY = edit.newY;
        }
      } else if (edit.type === 'CHANGE_PENDING_PLACEMENT' && edit.actionOrder !== undefined) {
        const a = pendingActions.find(act => act.order === edit.actionOrder && act.side === base.targetSide);
        if (a && edit.newX !== undefined && edit.newY !== undefined) {
          a.x = edit.newX;
          a.y = edit.newY;
        }
      } else if (edit.type === 'REORDER_PENDING_ACTIONS' && edit.newActionOrders) {
        const targetActs = pendingActions.filter(act => act.side === base.targetSide);
        const otherActs = pendingActions.filter(act => act.side !== base.targetSide);

        const reordered: RoundDeploymentAction[] = [];
        for (let i = 0; i < edit.newActionOrders.length; i++) {
          const oldOrder = edit.newActionOrders[i];
          const act = targetActs.find(a => a.order === oldOrder);
          if (act) {
            reordered.push({ ...act, order: i + 1 });
          }
        }
        pendingActions = [...otherActs, ...reordered].sort((a, b) => a.side - b.side || a.order - b.order);
      }
    }

    const stateData: Omit<RoundBoardState, 'stateFingerprint'> = {
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
      ...stateData,
      stateFingerprint: computeRoundBoardStateFingerprint(stateData),
    };
  }
}
