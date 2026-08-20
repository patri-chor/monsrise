import type { CandidateTrial, BaselineCase, CandidateDecision, PairedValidation, OptimizerCycleConfig } from './types';
import type { ResolvedFormationSnapshot } from '../../snapshot_resolver';
import type { ExecutableBranch } from '../branch_library';
import { BranchLibrary } from '../branch_library';
import { ProductMatchRunner, type ProductDeploymentTrace } from '../product_match_runner';
import { treeStrategyFor } from '../../../product_tree_strategy';
import { recognizeArchetype, type FeatureMask, type EvolFormation } from '../../../evol_gene';
import { computeProductOutcomeFromMatch, compareProductOutcome, aggregateProductOutcomes, type ProductOutcome } from './outcome';

export interface CompiledForwardCandidate {
  candidateId: string;
  caseId: string;
  isForwardExpressible: boolean;
  classification: 'PILOT_ACCEPTED' | 'PILOT_NEUTRAL' | 'PILOT_REJECTED' | 'LOCAL_ONLY';
  executableBranch?: ExecutableBranch;
  rejectionReason?: string;
}

export class CyclePilot {
  public static compileForwardCandidate(
    rep: CandidateTrial,
    adverseCase: BaselineCase,
    oppSnap: ResolvedFormationSnapshot
  ): CompiledForwardCandidate {
    const hasReposition = rep.edits.some(e => e.type === 'REPOSITION_DEPLOYED_UNIT');

    if (hasReposition) {
      return {
        candidateId: rep.candidateId,
        caseId: rep.caseId,
        isForwardExpressible: false,
        classification: 'LOCAL_ONLY',
        rejectionReason: 'Requires earlier layout decision context',
      };
    }

    const revealedHand = oppSnap.team.slice(0, 4).map(s => s.monsterId);
    const revealedBadges = oppSnap.team.slice(0, 4).flatMap(s => s.badgeIds ?? []);
    const boardEnemyIds = adverseCase.baseState.deployedUnits
      .filter((u: any) => u.side !== adverseCase.targetSide)
      .map((u: any) => u.monsterId);

    const rec = recognizeArchetype({
      handIds: new Set(revealedHand),
      handBadges: new Set(revealedBadges),
      boardIds: new Set(boardEnemyIds),
    });

    const condition: FeatureMask = {
      side: adverseCase.targetSide,
      main: rec.main,
      subs: rec.subs,
      keys: rec.keys,
    };

    const targetPlacements = adverseCase.baseState.pendingActions
      .filter((a: any) => a.side === adverseCase.targetSide)
      .map((a: any) => {
        const edit = rep.edits.find(e => e.type === 'CHANGE_PENDING_PLACEMENT' && e.actionOrder === a.order);
        return {
          monsterId: a.monsterId,
          x: edit && typeof edit.newX === 'number' ? edit.newX : a.x,
          y: edit && typeof edit.newY === 'number' ? edit.newY : a.y,
        };
      });

    const execBranch: ExecutableBranch = {
      branchId: `FBR_${rep.candidateId}`,
      sourceLossCaseIds: [rep.caseId],
      forkRound: adverseCase.round,
      condition,
      actionSubtreeDelta: [
        {
          round: adverseCase.round,
          placements: targetPlacements,
        },
      ],
      solutionBehaviorFingerprint: rep.editedStateFingerprint,
      confirmationCount: 1,
      confirmedAcrossFreshWorker: true,
    };

    return {
      candidateId: rep.candidateId,
      caseId: rep.caseId,
      isForwardExpressible: true,
      classification: 'PILOT_NEUTRAL',
      executableBranch: execBranch,
    };
  }

  public static validateCandidateAgainstCurrentPilot(
    cand: CompiledForwardCandidate,
    adverseCase: BaselineCase,
    targetSnap: ResolvedFormationSnapshot,
    oppSnap: ResolvedFormationSnapshot,
    currentPilotEvol: EvolFormation,
    config: OptimizerCycleConfig,
    iteration: number
  ): {
    decision: CandidateDecision;
    pairedValidations: PairedValidation[];
    selectedCandOutcomes: ProductOutcome[];
    selectedBaseOutcomes: ProductOutcome[];
  } {
    if (!cand.isForwardExpressible || !cand.executableBranch) {
      return {
        decision: {
          candidateId: cand.candidateId,
          caseId: cand.caseId,
          decision: 'LOCAL_ONLY',
          reason: cand.rejectionReason ?? 'Not legally forward-expressible',
          selectedPairCount: 0,
          score70Delta: 0,
        },
        pairedValidations: [],
        selectedCandOutcomes: [],
        selectedBaseOutcomes: [],
      };
    }

    const candEvol = BranchLibrary.attachExecutableBranchesToEvol(currentPilotEvol, [cand.executableBranch]);

    const pairedValidations: PairedValidation[] = [];
    const selectedCandOutcomes: ProductOutcome[] = [];
    const selectedBaseOutcomes: ProductOutcome[] = [];
    const candTracesAll: Array<import('../../../play_full_game').ProductStrategyDecisionTrace & { candidateId: string; opponentDisplayName: string; seed: number }> = [];

    for (const vSeed of config.validationSeeds) {
      for (const side of [1, 2] as const) {
        const isP1 = side === 1;
        const candidateTraces: ProductDeploymentTrace[] = [];

        const baseMatch = ProductMatchRunner.runFullMatch({
          teamA: isP1 ? targetSnap.team : oppSnap.team,
          teamB: isP1 ? oppSnap.team : targetSnap.team,
          seed: vSeed,
          nameA: isP1 ? targetSnap.displayName : oppSnap.displayName,
          nameB: isP1 ? oppSnap.displayName : targetSnap.displayName,
          strategyA: treeStrategyFor(isP1 ? currentPilotEvol : oppSnap.evol),
          strategyB: treeStrategyFor(isP1 ? oppSnap.evol : currentPilotEvol),
        });

        const candMatch = ProductMatchRunner.runFullMatch({
          teamA: isP1 ? targetSnap.team : oppSnap.team,
          teamB: isP1 ? oppSnap.team : targetSnap.team,
          seed: vSeed,
          nameA: isP1 ? 'branched' : oppSnap.displayName,
          nameB: isP1 ? oppSnap.displayName : 'branched',
          strategyA: treeStrategyFor(isP1 ? candEvol : oppSnap.evol),
          strategyB: treeStrategyFor(isP1 ? oppSnap.evol : candEvol),
          collectDiagnostics: true,
          collectStrategyTrace: true,
        });

        // 真实依据策略决策轨迹判定：
        // trace.side == target side AND trace.round == candidate executableBranch.forkRound AND trace.selectedBranchId == candidate executableBranch.branchId
        const targetBranchId = cand.executableBranch.branchId;
        const forkRound = cand.executableBranch.forkRound;
        const traces = candMatch.strategyDecisionTraces ?? candMatch.diagnostics?.strategyDecisionTraces ?? [];
        for (const t of traces) {
          candTracesAll.push({
            ...t,
            candidateId: cand.candidateId,
            opponentDisplayName: oppSnap.displayName,
            seed: vSeed,
          });
        }

        const matchingTrace = traces.find(t => {
          const isTargetSide = t.side === side;
          const isForkRound = t.round === forkRound;
          const matchesBranch = t.selectedBranchId?.startsWith(targetBranchId) || t.selectedNodeId?.startsWith(targetBranchId);
          return isTargetSide && isForkRound && matchesBranch;
        });

        const isBranchSelected = !!matchingTrace;

        const baseOutcome = computeProductOutcomeFromMatch(baseMatch, side);
        const candOutcome = computeProductOutcomeFromMatch(candMatch, side);

        const comp = compareProductOutcome(candOutcome, baseOutcome);

        if (isBranchSelected) {
          selectedBaseOutcomes.push(baseOutcome);
          selectedCandOutcomes.push(candOutcome);
        }

        pairedValidations.push({
          iteration,
          candidateId: cand.candidateId,
          opponentDisplayName: oppSnap.displayName,
          targetSide: side,
          seed: vSeed,
          baselineScore70: baseOutcome.targetScore70,
          candidateScore70: candOutcome.targetScore70,
          scoreDelta: candOutcome.targetScore70 - baseOutcome.targetScore70,
          branchSelected: isBranchSelected,
          classification: !isBranchSelected ? 'NOT_SELECTED' : comp > 0 ? 'IMPROVES' : comp < 0 ? 'REGRESSES' : 'NEUTRAL',
        });
      }
    }

    const aggBase = aggregateProductOutcomes(selectedBaseOutcomes);
    const aggCand = aggregateProductOutcomes(selectedCandOutcomes);
    const score70Delta = aggCand.targetScore70Average - aggBase.targetScore70Average;

    const anyRegressed = selectedCandOutcomes.some((co, idx) => compareProductOutcome(co, selectedBaseOutcomes[idx]) < 0);
    const strictlyBeats = score70Delta > 0 && !anyRegressed;

    let decisionType: CandidateDecision['decision'] = 'PILOT_NEUTRAL';
    let reason = `Equal Score70 delta (${score70Delta}) and 0 regressions`;

    if (anyRegressed || score70Delta < 0) {
      decisionType = 'PILOT_REJECTED';
      reason = `Regressed on selected validation pairs or negative Score70 delta (${score70Delta})`;
    } else if (strictlyBeats) {
      decisionType = 'PILOT_ACCEPTED';
      reason = `Strictly improved Score70 (+${score70Delta}) with 0 regressions`;
    }

    const decision: CandidateDecision = {
      candidateId: cand.candidateId,
      caseId: cand.caseId,
      decision: decisionType,
      reason,
      selectedPairCount: selectedCandOutcomes.length,
      score70Delta,
      branch: decisionType === 'PILOT_ACCEPTED' ? cand.executableBranch : undefined,
    };

    return { decision, pairedValidations, selectedCandOutcomes, selectedBaseOutcomes, strategyTraces: candTracesAll };
  }
}
