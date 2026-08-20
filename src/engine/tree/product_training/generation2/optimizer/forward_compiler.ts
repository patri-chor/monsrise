import type { ArchiveEntry } from './solution_archive';
import type { AdverseCaseRecord } from './adverse_case_miner';
import type { ResolvedFormationSnapshot } from '../../snapshot_resolver';
import type { ExecutableBranch } from '../branch_library';
import { recognizeArchetype, type FeatureMask } from '../../../evol_gene';

export interface CompiledForwardCandidate {
  candidateId: string;
  caseId: string;
  isForwardExpressible: boolean;
  classification: 'PILOT_ACTIVE' | 'FORWARD_REJECTED' | 'LOCAL_ONLY';
  executableBranch?: ExecutableBranch;
  rejectionReason?: string;
}

export class ForwardCompiler {
  public static compileRepresentative(
    rep: ArchiveEntry,
    adverseCase: AdverseCaseRecord,
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
      .filter(u => u.side !== adverseCase.targetSide)
      .map(u => u.monsterId);

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
      .filter(a => a.side === adverseCase.targetSide)
      .map(a => {
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
      classification: 'PILOT_ACTIVE',
      executableBranch: execBranch,
    };
  }
}
