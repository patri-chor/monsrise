import * as path from 'node:path';
import { FormationSnapshotResolver, type ResolvedFormationSnapshot } from '../../snapshot_resolver';
import type { IterativePilotOptimizerConfig } from './iterative_config';
import { DEFAULT_ITERATIVE_PILOT_CONFIG } from './iterative_config';
import { AdverseCaseMiner, type AdverseCaseRecord } from './adverse_case_miner';
import { SolutionArchive, type ArchiveEntry } from './solution_archive';
import { EvolutionarySearch } from './evolutionary_search';
import { ForwardCompiler, type CompiledForwardCandidate } from './forward_compiler';
import { ProductMatchRunner } from '../product_match_runner';
import { treeStrategyFor } from '../../../product_tree_strategy';
import { BranchLibrary, type ExecutableBranch } from '../branch_library';
import { Persistence } from './persistence';

export interface IterationReport {
  iterationNumber: number;
  searchSeed: number;
  initialPilotBranchesCount: number;
  adverseCasesMined: number;
  uniqueCandidatesEvaluated: number;
  forwardExpressibleCount: number;
  localOnlyCount: number;
  acceptedPilotBranchesCount: number;
  neutralPilotBranchesCount: number;
  rejectedPilotBranchesCount: number;
  baselineScore70Average: number;
  finalScore70Average: number;
  newAcceptedBranches: ExecutableBranch[];
}

export interface IterativePilotOptimizerReport {
  runId: string;
  config: IterativePilotOptimizerConfig;
  totalIterationsExecuted: number;
  stopReason: 'MAX_ITERATIONS_REACHED' | 'CONSECUTIVE_NO_IMPROVEMENTS' | 'NO_ADVERSE_CASES_REMAINING';
  pilotLibrary: ExecutableBranch[];
  iterations: IterationReport[];
  summary: {
    runId: string;
    totalIterations: number;
    initialPilotBranchesCount: number;
    finalPilotBranchesCount: number;
    totalAdverseCasesMined: number;
    totalUniqueCandidatesEvaluated: number;
    totalAcceptedBranches: number;
    totalRejectedBranches: number;
    stopReason: string;
  };
}

export class IterativePilotOptimizerRunner {
  public static async run(
    config: Partial<IterativePilotOptimizerConfig> = {}
  ): Promise<IterativePilotOptimizerReport> {
    const fullConfig: IterativePilotOptimizerConfig = { ...DEFAULT_ITERATIVE_PILOT_CONFIG, ...config };
    const runId = `ITER_RUN_${Date.now()}`;
    const runDir = fullConfig.outputBaseDirectory ?? path.join(process.cwd(), 'reports', 'tree-cycle', 'generation2-iterative-pilot', runId);
    Persistence.ensureDir(runDir);
    Persistence.writeJson(path.join(runDir, 'config.json'), fullConfig);

    const resolver = FormationSnapshotResolver.getInstance();
    resolver.init();

    const targetSnap = resolver.resolveFormationSnapshot({ formationId: fullConfig.targetFormationId });
    const oppSnaps = (fullConfig.opponentFormationIds ?? [
      't0:golden_boom',
      't0:all2prayer',
      't0:gift_jungle',
    ]).map(fid => resolver.resolveFormationSnapshot({ formationId: fid }));

    let currentPilotLibrary: ExecutableBranch[] = [];
    const iterationReports: IterationReport[] = [];
    let consecutiveNoImprovements = 0;
    let stopReason: IterativePilotOptimizerReport['stopReason'] = 'MAX_ITERATIONS_REACHED';

    for (let iter = 1; iter <= fullConfig.maxIterations; iter++) {
      const iterDir = path.join(runDir, `iteration-${String(iter).padStart(3, '0')}`);
      Persistence.ensureDir(iterDir);

      const sSeed = fullConfig.searchSeeds[(iter - 1) % fullConfig.searchSeeds.length] ?? (123000 + iter);

      // A. 构造带有当前积累 Pilot Library 的当前演化树快照 (Current Baseline)
      const currentTargetEvol = BranchLibrary.attachExecutableBranchesToEvol(targetSnap.evol, currentPilotLibrary);
      const currentTargetSnap: ResolvedFormationSnapshot = {
        ...targetSnap,
        evol: currentTargetEvol,
      };

      // B. 基于当前 Pilot 基线挖掘剩余问题 (Mine Remaining Adverse Cases)
      const minerConfig = {
        targetFormationId: fullConfig.targetFormationId,
        opponentFormationIds: fullConfig.opponentFormationIds,
        baselineSeeds: fullConfig.baselineSeeds,
        validationSeeds: fullConfig.validationSeeds,
        maxOpponents: fullConfig.maxOpponents,
        maxAdverseCasesPerOpponent: fullConfig.maxAdverseCasesPerOpponent,
        populationSize: fullConfig.populationSize,
        uniqueCandidatesPerCase: fullConfig.uniqueCandidatesPerCase,
        maxGenerations: fullConfig.maxGenerations,
        searchSeed: sSeed,
        allowForwardCompilation: true,
        dryRun: false,
      };

      const { selectedCases: adverseCases } = AdverseCaseMiner.mineAdverseCases(currentTargetSnap, oppSnaps, minerConfig);
      Persistence.writeJsonl(path.join(iterDir, 'baseline_cases.jsonl'), adverseCases);

      if (adverseCases.length === 0) {
        stopReason = 'NO_ADVERSE_CASES_REMAINING';
        break;
      }

      // C. 局部单回合搜索 (Cached RoundBoardState Local Search)
      const archive = new SolutionArchive();
      const searchRes = EvolutionarySearch.runEvolutionarySearch(adverseCases, archive, minerConfig);

      Persistence.writeJsonl(path.join(iterDir, 'local_trials.jsonl'), searchRes.allEvaluations);
      Persistence.writeJsonl(path.join(iterDir, 'local_archive.jsonl'), archive.getEntries());

      // D. 前向代表解编译与候选独立配对校验 (Candidate-Local Paired Decision)
      const representatives = archive.getEntries().filter(e => e.isRepresentative);
      const forwardCandidates: CompiledForwardCandidate[] = [];

      for (const rep of representatives) {
        const adverseCase = adverseCases.find(c => c.caseId === rep.caseId)!;
        const oppSnap = oppSnaps.find(o => o.displayName === adverseCase.opponentDisplayName)!;
        const comp = ForwardCompiler.compileRepresentative(rep, adverseCase, oppSnap);
        forwardCandidates.push(comp);
      }

      Persistence.writeJsonl(path.join(iterDir, 'forward_candidates.jsonl'), forwardCandidates);

      const pairedValidations: any[] = [];
      const candidateDecisions: Array<{
        candidateId: string;
        decision: 'PILOT_ACCEPTED' | 'PILOT_NEUTRAL' | 'PILOT_REJECTED' | 'LOCAL_ONLY';
        reason: string;
        branch?: ExecutableBranch;
      }> = [];

      let acceptedThisIter: ExecutableBranch[] = [];

      for (const cand of forwardCandidates) {
        if (!cand.isForwardExpressible || !cand.executableBranch) {
          candidateDecisions.push({
            candidateId: cand.candidateId,
            decision: 'LOCAL_ONLY',
            reason: cand.rejectionReason ?? 'Not legally forward-expressible',
          });
          continue;
        }

        const baseCase = adverseCases.find(c => c.caseId === cand.caseId)!;
        const srcOppSnap = oppSnaps.find(o => o.displayName === baseCase.opponentDisplayName)!;

        // 对当前基线挂载该候选分支
        const candEvol = BranchLibrary.attachExecutableBranchesToEvol(currentTargetEvol, [cand.executableBranch]);

        let improvesCount = 0;
        let regressesCount = 0;

        for (const vSeed of fullConfig.validationSeeds) {
          for (const side of [1, 2] as const) {
            const isP1 = side === 1;

            const baseRes = ProductMatchRunner.runFullMatch({
              teamA: isP1 ? targetSnap.team : srcOppSnap.team,
              teamB: isP1 ? srcOppSnap.team : targetSnap.team,
              seed: vSeed,
              nameA: isP1 ? targetSnap.displayName : srcOppSnap.displayName,
              nameB: isP1 ? srcOppSnap.displayName : targetSnap.displayName,
              strategyA: treeStrategyFor(isP1 ? currentTargetEvol : srcOppSnap.evol),
              strategyB: treeStrategyFor(isP1 ? srcOppSnap.evol : currentTargetEvol),
            });

            const candRes = ProductMatchRunner.runFullMatch({
              teamA: isP1 ? targetSnap.team : srcOppSnap.team,
              teamB: isP1 ? srcOppSnap.team : targetSnap.team,
              seed: vSeed,
              nameA: isP1 ? 'branched' : srcOppSnap.displayName,
              nameB: isP1 ? srcOppSnap.displayName : 'branched',
              strategyA: treeStrategyFor(isP1 ? candEvol : srcOppSnap.evol),
              strategyB: treeStrategyFor(isP1 ? srcOppSnap.evol : candEvol),
            });

            const bScore = isP1 ? baseRes.p1Score : baseRes.p2Score;
            const cScore = isP1 ? candRes.p1Score : candRes.p2Score;
            const delta = cScore - bScore;

            if (delta > 0) improvesCount++;
            else if (delta < 0) regressesCount++;

            pairedValidations.push({
              iteration: iter,
              candidateId: cand.candidateId,
              opponentDisplayName: srcOppSnap.displayName,
              side,
              seed: vSeed,
              baselineScore: `${baseRes.p1Score}:${baseRes.p2Score}`,
              candidateScore: `${candRes.p1Score}:${candRes.p2Score}`,
              scoreDelta: delta,
              classification: delta > 0 ? 'IMPROVES' : delta < 0 ? 'REGRESSES' : 'NEUTRAL',
            });
          }
        }

        if (regressesCount > 0) {
          candidateDecisions.push({
            candidateId: cand.candidateId,
            decision: 'PILOT_REJECTED',
            reason: `Regressed in ${regressesCount} paired validation instances`,
          });
        } else if (improvesCount > 0) {
          candidateDecisions.push({
            candidateId: cand.candidateId,
            decision: 'PILOT_ACCEPTED',
            reason: `Improved in ${improvesCount} paired validation instances with 0 regressions`,
            branch: cand.executableBranch,
          });
          acceptedThisIter.push(cand.executableBranch);
        } else {
          candidateDecisions.push({
            candidateId: cand.candidateId,
            decision: 'PILOT_NEUTRAL',
            reason: `Neutral on all paired validation instances`,
          });
        }
      }

      // 控制每轮最多接纳分支上限
      if (acceptedThisIter.length > fullConfig.maxNewPilotBranchesPerIteration) {
        acceptedThisIter = acceptedThisIter.slice(0, fullConfig.maxNewPilotBranchesPerIteration);
      }

      Persistence.writeJsonl(path.join(iterDir, 'paired_validations.jsonl'), pairedValidations);
      Persistence.writeJsonl(path.join(iterDir, 'pilot_decisions.jsonl'), candidateDecisions);

      // E. 更新累积 Pilot Library
      const initialCount = currentPilotLibrary.length;
      currentPilotLibrary.push(...acceptedThisIter);

      const iterSummary: IterationReport = {
        iterationNumber: iter,
        searchSeed: sSeed,
        initialPilotBranchesCount: initialCount,
        adverseCasesMined: adverseCases.length,
        uniqueCandidatesEvaluated: searchRes.allEvaluations.length,
        forwardExpressibleCount: forwardCandidates.filter(c => c.isForwardExpressible).length,
        localOnlyCount: forwardCandidates.filter(c => !c.isForwardExpressible).length,
        acceptedPilotBranchesCount: acceptedThisIter.length,
        neutralPilotBranchesCount: candidateDecisions.filter(d => d.decision === 'PILOT_NEUTRAL').length,
        rejectedPilotBranchesCount: candidateDecisions.filter(d => d.decision === 'PILOT_REJECTED').length,
        baselineScore70Average: 0,
        finalScore70Average: 0,
        newAcceptedBranches: acceptedThisIter,
      };

      Persistence.writeJson(path.join(iterDir, 'summary.json'), iterSummary);
      iterationReports.push(iterSummary);

      if (acceptedThisIter.length === 0) {
        consecutiveNoImprovements++;
        if (consecutiveNoImprovements >= fullConfig.maxConsecutiveNoImprovementIterations) {
          stopReason = 'CONSECUTIVE_NO_IMPROVEMENTS';
          break;
        }
      } else {
        consecutiveNoImprovements = 0;
      }
    }

    // 持久化最终 Pilot Library 与总报告
    Persistence.writeJson(path.join(runDir, 'pilot_library.json'), currentPilotLibrary);
    Persistence.writeJsonl(path.join(runDir, 'iterations.jsonl'), iterationReports);

    const summary = {
      runId,
      totalIterations: iterationReports.length,
      initialPilotBranchesCount: 0,
      finalPilotBranchesCount: currentPilotLibrary.length,
      totalAdverseCasesMined: iterationReports.reduce((s, r) => s + r.adverseCasesMined, 0),
      totalUniqueCandidatesEvaluated: iterationReports.reduce((s, r) => s + r.uniqueCandidatesEvaluated, 0),
      totalAcceptedBranches: currentPilotLibrary.length,
      totalRejectedBranches: iterationReports.reduce((s, r) => s + r.rejectedPilotBranchesCount, 0),
      stopReason,
    };

    Persistence.writeJson(path.join(runDir, 'summary.json'), summary);

    return {
      runId,
      config: fullConfig,
      totalIterationsExecuted: iterationReports.length,
      stopReason,
      pilotLibrary: currentPilotLibrary,
      iterations: iterationReports,
      summary,
    };
  }
}
