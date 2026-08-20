import type { EvolFormation, EvolNode, FeatureMask } from '../../evol_gene';
import { cloneEvolFormation, cloneEvolNode, emptyMask, walkEvolNodes, recognizeArchetype } from '../../evol_gene';
import type { LossCaseItem } from './loss_case_service';
import type { LocalCandidate, LocalTrialResult } from './local_search_service';
import type { ResolvedFormationSnapshot } from '../snapshot_resolver';
import { PersistentSimPool } from '../../persistent_pool';
import type { SimTaskMessage } from '../../fine_grained_worker';

export interface ExecutableBranch {
  branchId: string;
  sourceLossCaseIds: string[];
  forkRound: number;
  featureMask: FeatureMask;
  actionSubtreeDelta: Array<{
    round: number;
    placements: Array<{ monsterId: number; x: number; y: number }>;
  }>;
  solutionBehaviorFingerprint: string;
  confirmationCount: number;
  confirmedAcrossFreshWorker?: boolean;
}

export class BranchLibrary {
  public static createExactCaseBranch(
    lossCase: LossCaseItem,
    candidate: LocalCandidate
  ): ExecutableBranch {
    const rNodes = walkEvolNodes(candidate.mutatedEvol.root).filter(n => n.round >= lossCase.forkRound);
    const actionSubtreeDelta = rNodes.map(n => ({
      round: n.round,
      placements: n.placements.map(p => ({ monsterId: p.monsterId, x: p.x, y: p.y })),
    }));

    const rec = recognizeArchetype({
      handIds: new Set(lossCase.preRObservation.revealedEnemyHandIds),
      handBadges: new Set(lossCase.preRObservation.revealedEnemyHandBadges),
      boardIds: new Set(lossCase.preRObservation.revealedEnemyBoardIds),
    });

    const branchMask: FeatureMask = {
      requiredArchetype: rec.archetype !== 'unknown' ? rec.archetype : undefined,
      requiredEnemyUnits: lossCase.preRObservation.revealedEnemyHandIds.slice(0, 2),
    };

    return {
      branchId: `BR_${lossCase.caseId}_${candidate.candidateId}`,
      sourceLossCaseIds: [lossCase.caseId],
      forkRound: lossCase.forkRound,
      featureMask: branchMask,
      actionSubtreeDelta,
      solutionBehaviorFingerprint: candidate.behaviorFingerprint,
      confirmationCount: 1,
      confirmedAcrossFreshWorker: false,
    };
  }

  public static async confirmExactCaseBranch(
    branch: ExecutableBranch,
    sourceCase: LossCaseItem,
    baseEvol: EvolFormation,
    oppSnap: ResolvedFormationSnapshot
  ): Promise<boolean> {
    const pool = new PersistentSimPool({ workerCount: 2, enableCpuMonitor: false });
    await pool.init();

    const branchedEvol = this.attachExecutableBranchesToEvol(baseEvol, [branch]);

    const task: SimTaskMessage = {
      taskId: `confirm_${branch.branchId}`,
      candidateIdx: 0,
      candidateFp: branch.solutionBehaviorFingerprint,
      targetPayloadFp: sourceCase.targetPayloadFingerprint,
      targetPolicyFp: sourceCase.targetCalculatorPolicyFingerprint,
      formationA: branchedEvol as any,
      opponentNameOrId: oppSnap.displayName,
      opponentFormation: oppSnap.evol as any,
      opponentPayloadFp: oppSnap.canonicalFingerprint,
      opponentPolicyFp: oppSnap.calculatorPolicyFingerprint,
      games: 1,
      seed: sourceCase.seed,
      side: sourceCase.side,
      executionMode: 'product_path',
      collectDeploymentTraces: true,
    };

    const res = await pool.dispatchTasks([task], undefined, { targetWorkerIndex: 0 });
    pool.destroy();

    const ok = res.length > 0;
    if (ok) branch.confirmedAcrossFreshWorker = true;
    return ok;
  }

  public static attachExecutableBranchesToEvol(
    baseEvol: EvolFormation,
    branches: ExecutableBranch[]
  ): EvolFormation {
    const evol = cloneEvolFormation(baseEvol);

    for (const b of branches) {
      const parentRound = b.forkRound - 1;
      const parentNode = walkEvolNodes(evol.root).find(n => n.round === parentRound) || evol.root;

      if (b.actionSubtreeDelta.length > 0) {
        const rootDelta = b.actionSubtreeDelta[0];
        const branchNode: EvolNode = {
          id: `${b.branchId}_r${b.forkRound}`,
          round: b.forkRound,
          placements: rootDelta.placements.map(p => ({
            monsterId: p.monsterId,
            x: p.x,
            y: p.y,
            tags: ['exact_case_branch'],
          })),
          featureMask: b.featureMask,
          children: [],
        };

        let curr = branchNode;
        for (let i = 1; i < b.actionSubtreeDelta.length; i++) {
          const d = b.actionSubtreeDelta[i];
          const childNode: EvolNode = {
            id: `${b.branchId}_r${d.round}`,
            round: d.round,
            placements: d.placements.map(p => ({
              monsterId: p.monsterId,
              x: p.x,
              y: p.y,
              tags: ['exact_case_branch_child'],
            })),
            featureMask: emptyMask(),
            children: [],
          };
          curr.children.push(childNode);
          curr = childNode;
        }

        parentNode.children.push(branchNode);
      }
    }

    return evol;
  }

  public static mergeAndPruneBranches(branches: ExecutableBranch[]): {
    merged: ExecutableBranch[];
    pruned: string[];
    activeLibrary: ExecutableBranch[];
  } {
    const merged: ExecutableBranch[] = [];
    const pruned: string[] = [];
    const activeLibrary: ExecutableBranch[] = [];

    const seenFp = new Set<string>();
    for (const b of branches) {
      if (seenFp.has(b.solutionBehaviorFingerprint)) {
        pruned.push(b.branchId);
      } else {
        seenFp.add(b.solutionBehaviorFingerprint);
        activeLibrary.push(b);
      }
    }

    return {
      merged,
      pruned,
      activeLibrary,
    };
  }
}
