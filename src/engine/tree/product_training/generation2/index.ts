import { FormationSnapshotResolver, type ResolvedFormationSnapshot } from '../snapshot_resolver';
import { LossCaseService, type LossCaseItem } from './loss_case_service';
import { LocalSearchService, type LocalTrialResult, type LocalCandidate } from './local_search_service';
import { BranchLibrary, type ExecutableBranch } from './branch_library';
import { EvidenceWriter } from './evidence_writer';
import { treeStrategyFor } from '../../product_tree_strategy';
import { RoundCheckpointService } from './round_checkpoint_service';

export * from './product_match_runner';
export * from './round_checkpoint_service';
export * from './loss_case_service';
export * from './local_search_service';
export * from './branch_library';
export * from './evidence_writer';
export * from './counterfactual_battle_engine';
export * from './round_board_state';
export * from './round_board_state_factory';
export * from './single_round_engine';

export interface PilotOrchestrationOptions {
  targetFormationId?: string;
  opponentFormationIds?: string[];
  maxOpponents?: number;
  maxCasesPerOpponent?: number;
  maxCandidatesPerCase?: number;
  outPrefix?: string;
}

export interface PilotOrchestrationResult {
  manifest: {
    target: { id: string; canonicalFp: string; policyFp: string };
    opponents: Array<{ id: string; canonicalFp: string; policyFp: string }>;
  };
  lossQueue: LossCaseItem[];
  allTrials: LocalTrialResult[];
  exactBranches: ExecutableBranch[];
  confirmations: Array<{ branchId: string; sourceCaseId: string; confirmed: boolean }>;
  sourceHoldoutEval: Array<{
    branchId: string;
    caseId: string;
    isSourceCase: boolean;
    branchSelected: boolean;
  }>;
  summary: {
    targetFormationId: string;
    totalCasesQueued: number;
    totalTrialsExecuted: number;
    improvementsFound: number;
    exactBranchesCreated: number;
    exactBranchesConfirmed: number;
    outcome: 'EXACT_BRANCHES_CREATED' | 'NO_LOCAL_IMPROVEMENT_FOUND';
  };
}

export class Generation2PilotOrchestrator {
  public static async runAll2RushPilot(
    opts: PilotOrchestrationOptions = {}
  ): Promise<PilotOrchestrationResult> {
    const resolver = FormationSnapshotResolver.getInstance();
    resolver.init();

    const targetId = opts.targetFormationId ?? 't0:all2rush';
    const oppIds = opts.opponentFormationIds ?? ['t0:golden_boom', 't0:all2prayer', 't0:gift_jungle'];
    const maxCandidates = opts.maxCandidatesPerCase ?? 48;
    const prefix = opts.outPrefix ?? 'all2rush_g2_t110';

    // 1. Resolve snapshots
    const targetSnap = resolver.resolveFormationSnapshot({ formationId: targetId });
    const oppSnaps: ResolvedFormationSnapshot[] = [];
    for (const id of oppIds) {
      try {
        const snap = resolver.resolveFormationSnapshot({ formationId: id });
        oppSnaps.push(snap);
      } catch {}
    }

    const manifest = {
      target: {
        id: targetSnap.formationId,
        canonicalFp: targetSnap.canonicalFingerprint,
        policyFp: targetSnap.calculatorPolicyFingerprint,
      },
      opponents: oppSnaps.map(s => ({
        id: s.formationId,
        canonicalFp: s.canonicalFingerprint,
        policyFp: s.calculatorPolicyFingerprint,
      })),
    };
    EvidenceWriter.writeJson(`${prefix}_pilot_manifest.json`, manifest);

    // 2. Build ranked loss queue
    const lossQueue = LossCaseService.buildLossQueue(targetSnap, oppSnaps, 6);
    EvidenceWriter.writeJsonl(`${prefix}_loss_queue.jsonl`, lossQueue);

    // 3. For each loss case: sample and evaluate local candidates
    const allTrials: LocalTrialResult[] = [];
    const exactBranches: ExecutableBranch[] = [];

    for (const lossCase of lossQueue) {
      const candidates = LocalSearchService.sampleCandidates(lossCase, targetSnap.evol, maxCandidates);
      const oppSnap = oppSnaps.find(s => s.formationId === lossCase.opponentId) ?? oppSnaps[0];
      const trials = LocalSearchService.evaluateCase(lossCase, oppSnap, candidates);
      allTrials.push(...trials);

      for (let i = 0; i < trials.length; i++) {
        if (trials[i].improved) {
          const improvedBranch = BranchLibrary.createExactCaseBranch(lossCase, candidates[i]);
          exactBranches.push(improvedBranch);
          break; // Retain first verified narrow exact branch for this case
        }
      }
    }
    EvidenceWriter.writeJsonl(`${prefix}_trials.jsonl`, allTrials);
    EvidenceWriter.writeJsonl(`${prefix}_branch_library.jsonl`, exactBranches);

    // 4. Confirm exact branches across fresh worker boundary
    const confirmations: Array<{ branchId: string; sourceCaseId: string; confirmed: boolean }> = [];
    for (const branch of exactBranches) {
      const sourceCase = lossQueue.find(c => branch.sourceLossCaseIds.includes(c.caseId));
      if (sourceCase) {
        const oppSnap = oppSnaps.find(s => s.formationId === sourceCase.opponentId) ?? oppSnaps[0];
        const ok = await BranchLibrary.confirmExactCaseBranch(branch, sourceCase, targetSnap.evol, oppSnap);
        confirmations.push({
          branchId: branch.branchId,
          sourceCaseId: sourceCase.caseId,
          confirmed: ok,
        });
      }
    }

    // 5. Source and Holdout Evaluation
    const sourceHoldoutEval: Array<{
      branchId: string;
      caseId: string;
      isSourceCase: boolean;
      branchSelected: boolean;
    }> = [];

    for (const branch of exactBranches) {
      const branchedEvol = BranchLibrary.attachExecutableBranchesToEvol(targetSnap.evol, [branch]);
      const branchedStrat = treeStrategyFor(branchedEvol);

      for (const lossCase of lossQueue) {
        const session = RoundCheckpointService.restore(lossCase.preRCheckpoint, {
          strategyIdentityA: lossCase.side === 1 ? 'all2rush_branched' : lossCase.opponentId,
          strategyIdentityB: lossCase.side === 1 ? lossCase.opponentId : 'all2rush_branched',
        });

        const ctx = session.buildRoundContext(lossCase.side);
        const intents = branchedStrat(ctx);
        const branchSelected = intents[0]?.branch?.branchId === `${branch.branchId}_r${branch.forkRound}`;

        sourceHoldoutEval.push({
          branchId: branch.branchId,
          caseId: lossCase.caseId,
          isSourceCase: branch.sourceLossCaseIds.includes(lossCase.caseId),
          branchSelected,
        });
      }
    }
    EvidenceWriter.writeJsonl(`${prefix}_source_holdout_eval.jsonl`, sourceHoldoutEval);

    // 6. Summary Output
    const improvementsCount = allTrials.filter(t => t.improved).length;
    const summary = {
      targetFormationId: targetId,
      totalCasesQueued: lossQueue.length,
      totalTrialsExecuted: allTrials.length,
      improvementsFound: improvementsCount,
      exactBranchesCreated: exactBranches.length,
      exactBranchesConfirmed: confirmations.filter(c => c.confirmed).length,
      outcome: exactBranches.length > 0 ? ('EXACT_BRANCHES_CREATED' as const) : ('NO_LOCAL_IMPROVEMENT_FOUND' as const),
    };
    EvidenceWriter.writeJson(`${prefix}_summary.json`, summary);

    return {
      manifest,
      lossQueue,
      allTrials,
      exactBranches,
      confirmations,
      sourceHoldoutEval,
      summary,
    };
  }
}
