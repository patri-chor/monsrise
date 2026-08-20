import type { CompiledForwardCandidate } from './forward_compiler';
import type { AdverseCaseRecord } from './adverse_case_miner';
import type { ResolvedFormationSnapshot } from '../../snapshot_resolver';
import { ProductMatchRunner } from '../product_match_runner';
import { treeStrategyFor } from '../../../product_tree_strategy';
import { BranchLibrary } from '../branch_library';
import type { OptimizerConfig } from './config';

export interface ValidationRecord {
  candidateId: string;
  opponentDisplayName: string;
  side: 1 | 2;
  seed: number;
  baselineWinner: 1 | 2 | 0;
  baselineScore: string;
  branchWinner: 1 | 2 | 0;
  branchScore: string;
  branchSelected: boolean;
  classification: 'IMPROVES' | 'NEUTRAL' | 'REGRESSES' | 'NOT_SELECTED';
}

export class Validator {
  public static runValidation(
    candidates: CompiledForwardCandidate[],
    adverseCases: AdverseCaseRecord[],
    targetSnap: ResolvedFormationSnapshot,
    oppSnaps: ResolvedFormationSnapshot[],
    config: OptimizerConfig
  ): {
    validations: ValidationRecord[];
    activeBranches: CompiledForwardCandidate[];
    fullMatchEvaluationsCount: number;
  } {
    const validations: ValidationRecord[] = [];
    const activeBranches: CompiledForwardCandidate[] = [];
    let fullMatchEvaluationsCount = 0;

    for (const cand of candidates) {
      if (!cand.isForwardExpressible || !cand.executableBranch) continue;

      const baseCase = adverseCases.find(c => c.caseId === cand.caseId)!;
      const srcOppSnap = oppSnaps.find(o => o.displayName === baseCase.opponentDisplayName)!;
      const branchedEvol = BranchLibrary.attachExecutableBranchesToEvol(targetSnap.evol, [cand.executableBranch]);

      let hasRegression = false;

      // 验证源对手同侧 (validationSeeds)
      for (const s of config.validationSeeds) {
        const isP1 = baseCase.targetSide === 1;
        const baseRes = ProductMatchRunner.runFullMatch({
          teamA: isP1 ? targetSnap.team : srcOppSnap.team,
          teamB: isP1 ? srcOppSnap.team : targetSnap.team,
          seed: s,
          nameA: isP1 ? targetSnap.displayName : srcOppSnap.displayName,
          nameB: isP1 ? srcOppSnap.displayName : targetSnap.displayName,
          strategyA: treeStrategyFor(isP1 ? targetSnap.evol : srcOppSnap.evol),
          strategyB: treeStrategyFor(isP1 ? srcOppSnap.evol : targetSnap.evol),
        });
        fullMatchEvaluationsCount++;

        const branchRes = ProductMatchRunner.runFullMatch({
          teamA: isP1 ? targetSnap.team : srcOppSnap.team,
          teamB: isP1 ? srcOppSnap.team : targetSnap.team,
          seed: s,
          nameA: isP1 ? 'branched' : srcOppSnap.displayName,
          nameB: isP1 ? srcOppSnap.displayName : 'branched',
          strategyA: treeStrategyFor(isP1 ? branchedEvol : srcOppSnap.evol),
          strategyB: treeStrategyFor(isP1 ? srcOppSnap.evol : branchedEvol),
        });
        fullMatchEvaluationsCount++;

        const bScore = isP1 ? baseRes.p1Score : baseRes.p2Score;
        const brScore = isP1 ? branchRes.p1Score : branchRes.p2Score;

        const classification = brScore > bScore ? 'IMPROVES' : brScore < bScore ? 'REGRESSES' : 'NEUTRAL';
        if (classification === 'REGRESSES') hasRegression = true;

        validations.push({
          candidateId: cand.candidateId,
          opponentDisplayName: srcOppSnap.displayName,
          side: baseCase.targetSide,
          seed: s,
          baselineWinner: baseRes.winner,
          baselineScore: `${baseRes.p1Score}:${baseRes.p2Score}`,
          branchWinner: branchRes.winner,
          branchScore: `${branchRes.p1Score}:${branchRes.p2Score}`,
          branchSelected: true,
          classification,
        });
      }

      if (hasRegression) {
        cand.classification = 'FORWARD_REJECTED';
        cand.rejectionReason = 'Regressed on validation benchmark';
      } else {
        cand.classification = 'PILOT_ACTIVE';
        activeBranches.push(cand);
      }
    }

    return { validations, activeBranches, fullMatchEvaluationsCount };
  }
}
