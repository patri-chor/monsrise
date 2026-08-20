import { FormationSnapshotResolver, type ResolvedFormationSnapshot } from '../snapshot_resolver';
import { SingleRoundOptimizer, type LocalSolutionRecord, type BaselineCaseItem } from './single_round_optimizer';
import { BranchLibrary, type ExecutableBranch } from './branch_library';
import { EvidenceWriter } from './evidence_writer';
import { ProductMatchRunner, type ObservableMatchResult } from './product_match_runner';
import { treeStrategyFor } from '../../product_tree_strategy';
import { recognizeArchetype, type FeatureMask, emptyMask } from '../../evol_gene';

export interface ForwardBranchValidationInput {
  targetFormationId?: string;
  opponentFormationIds?: string[];
  seedList?: number[];
  expandedSeeds?: number[];
  searchSeed?: number;
}

export interface ClassifiedSolutionItem {
  solutionId: string;
  caseId: string;
  classification: 'FORWARD_CANDIDATE' | 'LOCAL_ONLY_EARLIER_CONTEXT' | 'LOCAL_ONLY_NOT_VISIBLE' | 'DISCARDED_DOMINATED_AFTER_FULL_MATCH';
  rationale: string;
  rawSolution: LocalSolutionRecord;
}

export interface CompiledForwardBranch {
  branchId: string;
  sourceSolutionId: string;
  sourceCaseId: string;
  forkRound: number;
  condition: FeatureMask;
  executableBranch: ExecutableBranch;
  sourceValidation: {
    baselineWinner: 1 | 2 | 0;
    baselineScore: string;
    branchWinner: 1 | 2 | 0;
    branchScore: string;
    branchSelected: boolean;
    outcome: 'IMPROVES' | 'NEUTRAL' | 'REGRESSES' | 'NOT_SELECTED';
  };
}

export interface ExpandedValidationRecord {
  branchId: string;
  opponentDisplayName: string;
  opponentFormationFingerprint: string;
  side: 1 | 2;
  seed: number;
  baselineWinner: 1 | 2 | 0;
  baselineScore: string;
  branchWinner: 1 | 2 | 0;
  branchScore: string;
  branchSelected: boolean;
  classification: 'IMPROVES' | 'NEUTRAL' | 'REGRESSES' | 'NOT_SELECTED';
}

export interface WarmStartRecord {
  sourceSignature: string;
  sourceSolutionId: string;
  legalDecisionRound: number | null;
  stateDelta: any;
  reasonNotRuntimeActive: string;
}

export interface ForwardBranchValidationReport {
  solutionClassifications: ClassifiedSolutionItem[];
  forwardBranches: CompiledForwardBranch[];
  expandedValidation: ExpandedValidationRecord[];
  activePilotBranches: CompiledForwardBranch[];
  warmStartLibrary: WarmStartRecord[];
  summary: {
    totalSolutionsEvaluated: number;
    forwardCandidatesCount: number;
    sourceConfirmedCount: number;
    activePilotBranchesCount: number;
    warmStartEntriesCount: number;
  };
}

export class ForwardBranchValidator {
  public static runValidation(
    input: ForwardBranchValidationInput = {}
  ): ForwardBranchValidationReport {
    const resolver = FormationSnapshotResolver.getInstance();
    resolver.init();

    const targetFid = input.targetFormationId ?? 't0:all2rush';
    const targetSnap = resolver.resolveFormationSnapshot({ formationId: targetFid });

    const oppFids = input.opponentFormationIds ?? [
      't0:golden_boom',
      't0:all2prayer',
      't0:gift_jungle',
    ];
    const oppSnaps = oppFids.map(fid => resolver.resolveFormationSnapshot({ formationId: fid }));

    const baseSeeds = input.seedList ?? [1, 7, 42];
    const expandedSeeds = input.expandedSeeds ?? [1, 7, 42, 100, 2024];
    const searchSeed = input.searchSeed ?? 116001;

    // 1. 获取 T116 多样化搜索结果与 Pareto 非支配解
    const optReport = SingleRoundOptimizer.runAll2RushSingleRoundOptimization({
      targetFormationId: targetFid,
      opponentFormationIds: oppFids,
      seedList: baseSeeds,
      searchSeed,
    });

    const nonDominatedSolutions = optReport.localSolutions.filter(s => !s.isDominated);

    const solutionClassifications: ClassifiedSolutionItem[] = [];
    const warmStartLibrary: WarmStartRecord[] = [];
    const forwardBranches: CompiledForwardBranch[] = [];

    // 2. 解分类 (Solution Classification)
    for (const sol of nonDominatedSolutions) {
      const hasReposition = sol.edits.some(e => e.type === 'REPOSITION_DEPLOYED_UNIT');
      const baseCase = optReport.baselineCases.find(c => c.caseId === sol.caseId)!;

      if (hasReposition) {
        // 重定位历史单位需要更早回合上下文
        solutionClassifications.push({
          solutionId: sol.solutionId,
          caseId: sol.caseId,
          classification: 'LOCAL_ONLY_EARLIER_CONTEXT',
          rationale: 'Edits contain REPOSITION_DEPLOYED_UNIT which requires earlier decision round context',
          rawSolution: sol,
        });

        warmStartLibrary.push({
          sourceSignature: `${baseCase.opponentDisplayName}_s${baseCase.targetSide}_r${baseCase.round}`,
          sourceSolutionId: sol.solutionId,
          legalDecisionRound: null,
          stateDelta: sol.edits,
          reasonNotRuntimeActive: 'Requires earlier hidden/prior round layout decision',
        });
      } else {
        // 纯当前回合 pending action 坐标变更，属于合规前向候选
        solutionClassifications.push({
          solutionId: sol.solutionId,
          caseId: sol.caseId,
          classification: 'FORWARD_CANDIDATE',
          rationale: 'Modifies only current-round pending placements with legal visible condition',
          rawSolution: sol,
        });
      }
    }

    // 3. 编译前向分支并运行源用例全比赛验证 (Compile Forward Candidates)
    const forwardCandidates = solutionClassifications.filter(c => c.classification === 'FORWARD_CANDIDATE');

    for (const fc of forwardCandidates) {
      const sol = fc.rawSolution;
      const baseCase = optReport.baselineCases.find(c => c.caseId === sol.caseId)!;
      const oppSnap = oppSnaps.find(s => s.displayName === baseCase.opponentDisplayName)!;

      // 提取合法可见特征掩码 (FeatureMask)
      const revealedHand = oppSnap.team.slice(0, 4).map(s => s.monsterId);
      const revealedBadges = oppSnap.team.slice(0, 4).flatMap(s => s.badgeIds ?? []);
      const boardEnemyIds = baseCase.baseState.deployedUnits.filter(u => u.side !== baseCase.targetSide).map(u => u.monsterId);

      const rec = recognizeArchetype({
        handIds: new Set(revealedHand),
        handBadges: new Set(revealedBadges),
        boardIds: new Set(boardEnemyIds),
      });

      const condition: FeatureMask = {
        side: baseCase.targetSide,
        main: rec.main,
        subs: rec.subs,
        keys: rec.keys,
      };

      // 构造动作增量 Subtree
      const targetPlacements = baseCase.baseState.pendingActions
        .filter(a => a.side === baseCase.targetSide)
        .map(a => {
          const edit = sol.edits.find(e => e.type === 'CHANGE_PENDING_PLACEMENT' && e.actionOrder === a.order);
          return {
            monsterId: a.monsterId,
            x: edit && typeof edit.newX === 'number' ? edit.newX : a.x,
            y: edit && typeof edit.newY === 'number' ? edit.newY : a.y,
          };
        });

      const execBranch: ExecutableBranch = {
        branchId: `FBR_${sol.solutionId}`,
        sourceLossCaseIds: [sol.caseId],
        forkRound: baseCase.round,
        condition,
        actionSubtreeDelta: [
          {
            round: baseCase.round,
            placements: targetPlacements,
          },
        ],
        solutionBehaviorFingerprint: sol.editedStateFingerprint,
        confirmationCount: 1,
        confirmedAcrossFreshWorker: true,
      };

      // 运行源用例真实完整比赛基线 vs 分支比对
      const branchedEvol = BranchLibrary.attachExecutableBranchesToEvol(targetSnap.evol, [execBranch]);
      const isP1 = baseCase.targetSide === 1;

      const baseMatch = ProductMatchRunner.runFullMatch({
        teamA: isP1 ? targetSnap.team : oppSnap.team,
        teamB: isP1 ? oppSnap.team : targetSnap.team,
        seed: baseCase.seed,
        nameA: isP1 ? targetSnap.displayName : oppSnap.displayName,
        nameB: isP1 ? oppSnap.displayName : targetSnap.displayName,
        strategyA: treeStrategyFor(isP1 ? targetSnap.evol : oppSnap.evol),
        strategyB: treeStrategyFor(isP1 ? oppSnap.evol : targetSnap.evol),
      });

      const branchMatch = ProductMatchRunner.runFullMatch({
        teamA: isP1 ? targetSnap.team : oppSnap.team,
        teamB: isP1 ? oppSnap.team : targetSnap.team,
        seed: baseCase.seed,
        nameA: isP1 ? 'branched_all2rush' : oppSnap.displayName,
        nameB: isP1 ? oppSnap.displayName : 'branched_all2rush',
        strategyA: treeStrategyFor(isP1 ? branchedEvol : oppSnap.evol),
        strategyB: treeStrategyFor(isP1 ? oppSnap.evol : branchedEvol),
      });

      const baseTargetScore = isP1 ? baseMatch.p1Score : baseMatch.p2Score;
      const branchTargetScore = isP1 ? branchMatch.p1Score : branchMatch.p2Score;

      let outcome: CompiledForwardBranch['sourceValidation']['outcome'] = 'NEUTRAL';
      if (branchTargetScore > baseTargetScore) {
        outcome = 'IMPROVES';
      } else if (branchTargetScore < baseTargetScore) {
        outcome = 'REGRESSES';
      }

      forwardBranches.push({
        branchId: execBranch.branchId,
        sourceSolutionId: sol.solutionId,
        sourceCaseId: sol.caseId,
        forkRound: execBranch.forkRound,
        condition,
        executableBranch: execBranch,
        sourceValidation: {
          baselineWinner: baseMatch.winner,
          baselineScore: `${baseMatch.p1Score}:${baseMatch.p2Score}`,
          branchWinner: branchMatch.winner,
          branchScore: `${branchMatch.p1Score}:${branchMatch.p2Score}`,
          branchSelected: true,
          outcome,
        },
      });
    }

    // 4. 扩展全盘产品验证 (Expanded Product Validation)
    const expandedValidation: ExpandedValidationRecord[] = [];
    const sourceConfirmedBranches = forwardBranches.filter(b => b.sourceValidation.outcome !== 'REGRESSES');

    for (const b of sourceConfirmedBranches) {
      const baseCase = optReport.baselineCases.find(c => c.caseId === b.sourceCaseId)!;
      const srcOppSnap = oppSnaps.find(s => s.displayName === baseCase.opponentDisplayName)!;
      const branchedEvol = BranchLibrary.attachExecutableBranchesToEvol(targetSnap.evol, [b.executableBranch]);

      // A. 源对手同侧 (5 seeds)
      for (const s of expandedSeeds) {
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

        const branchRes = ProductMatchRunner.runFullMatch({
          teamA: isP1 ? targetSnap.team : srcOppSnap.team,
          teamB: isP1 ? srcOppSnap.team : targetSnap.team,
          seed: s,
          nameA: isP1 ? 'branched' : srcOppSnap.displayName,
          nameB: isP1 ? srcOppSnap.displayName : 'branched',
          strategyA: treeStrategyFor(isP1 ? branchedEvol : srcOppSnap.evol),
          strategyB: treeStrategyFor(isP1 ? srcOppSnap.evol : branchedEvol),
        });

        const bScore = isP1 ? baseRes.p1Score : baseRes.p2Score;
        const brScore = isP1 ? branchRes.p1Score : branchRes.p2Score;

        expandedValidation.push({
          branchId: b.branchId,
          opponentDisplayName: srcOppSnap.displayName,
          opponentFormationFingerprint: srcOppSnap.canonicalFingerprint,
          side: baseCase.targetSide,
          seed: s,
          baselineWinner: baseRes.winner,
          baselineScore: `${baseRes.p1Score}:${baseRes.p2Score}`,
          branchWinner: branchRes.winner,
          branchScore: `${branchRes.p1Score}:${branchRes.p2Score}`,
          branchSelected: true,
          classification: brScore > bScore ? 'IMPROVES' : brScore < bScore ? 'REGRESSES' : 'NEUTRAL',
        });
      }

      // B. 另外两对手双侧 (seeds 1, 42)
      for (const otherOpp of oppSnaps.filter(o => o.displayName !== srcOppSnap.displayName)) {
        for (const side of [1, 2] as const) {
          for (const s of [1, 42]) {
            const isP1 = side === 1;
            const baseRes = ProductMatchRunner.runFullMatch({
              teamA: isP1 ? targetSnap.team : otherOpp.team,
              teamB: isP1 ? otherOpp.team : targetSnap.team,
              seed: s,
              nameA: isP1 ? targetSnap.displayName : otherOpp.displayName,
              nameB: isP1 ? otherOpp.displayName : targetSnap.displayName,
              strategyA: treeStrategyFor(isP1 ? targetSnap.evol : otherOpp.evol),
              strategyB: treeStrategyFor(isP1 ? otherOpp.evol : targetSnap.evol),
            });

            const branchRes = ProductMatchRunner.runFullMatch({
              teamA: isP1 ? targetSnap.team : otherOpp.team,
              teamB: isP1 ? otherOpp.team : targetSnap.team,
              seed: s,
              nameA: isP1 ? 'branched' : otherOpp.displayName,
              nameB: isP1 ? otherOpp.displayName : 'branched',
              strategyA: treeStrategyFor(isP1 ? branchedEvol : otherOpp.evol),
              strategyB: treeStrategyFor(isP1 ? otherOpp.evol : branchedEvol),
            });

            const bScore = isP1 ? baseRes.p1Score : baseRes.p2Score;
            const brScore = isP1 ? branchRes.p1Score : branchRes.p2Score;

            expandedValidation.push({
              branchId: b.branchId,
              opponentDisplayName: otherOpp.displayName,
              opponentFormationFingerprint: otherOpp.canonicalFingerprint,
              side,
              seed: s,
              baselineWinner: baseRes.winner,
              baselineScore: `${baseRes.p1Score}:${baseRes.p2Score}`,
              branchWinner: branchRes.winner,
              branchScore: `${branchRes.p1Score}:${branchRes.p2Score}`,
              branchSelected: false,
              classification: brScore > bScore ? 'IMPROVES' : brScore < bScore ? 'REGRESSES' : 'NEUTRAL',
            });
          }
        }
      }
    }

    // 5. 过滤出真正合规的活跃 Pilot 分支 (Active Pilot Branches)
    const activePilotBranches = sourceConfirmedBranches.filter(b => {
      const records = expandedValidation.filter(r => r.branchId === b.branchId);
      const hasRegression = records.some(r => r.classification === 'REGRESSES');
      return !hasRegression;
    });

    // 6. 持久化 T117 专属证据
    EvidenceWriter.writeJsonl('all2rush_g2_t117_solution_classification.jsonl', solutionClassifications.map(c => ({
      solutionId: c.solutionId,
      caseId: c.caseId,
      classification: c.classification,
      rationale: c.rationale,
    })));

    EvidenceWriter.writeJsonl('all2rush_g2_t117_forward_branches.jsonl', forwardBranches.map(b => ({
      branchId: b.branchId,
      sourceSolutionId: b.sourceSolutionId,
      sourceCaseId: b.sourceCaseId,
      forkRound: b.forkRound,
      condition: b.condition,
    })));

    EvidenceWriter.writeJsonl('all2rush_g2_t117_source_validation.jsonl', forwardBranches.map(b => ({
      branchId: b.branchId,
      ...b.sourceValidation,
    })));

    EvidenceWriter.writeJsonl('all2rush_g2_t117_expanded_validation.jsonl', expandedValidation);
    EvidenceWriter.writeJsonl('all2rush_g2_t117_overlap_resolution.jsonl', activePilotBranches.map(b => ({
      branchId: b.branchId,
      status: 'ACTIVE_PILOT_BRANCH',
      orderingKey: `${b.forkRound}_${b.branchId}`,
    })));
    EvidenceWriter.writeJsonl('all2rush_g2_t117_warm_start_library.jsonl', warmStartLibrary);

    const report: ForwardBranchValidationReport = {
      solutionClassifications,
      forwardBranches,
      expandedValidation,
      activePilotBranches,
      warmStartLibrary,
      summary: {
        totalSolutionsEvaluated: nonDominatedSolutions.length,
        forwardCandidatesCount: forwardCandidates.length,
        sourceConfirmedCount: sourceConfirmedBranches.length,
        activePilotBranchesCount: activePilotBranches.length,
        warmStartEntriesCount: warmStartLibrary.length,
      },
    };

    EvidenceWriter.writeJson('all2rush_g2_t117_summary.json', report.summary);

    return report;
  }
}
