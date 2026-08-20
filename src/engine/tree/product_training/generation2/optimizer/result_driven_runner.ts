import * as path from 'node:path';
import { FormationSnapshotResolver, type ResolvedFormationSnapshot } from '../../snapshot_resolver';
import type { IterativePilotOptimizerConfig } from './iterative_config';
import { DEFAULT_ITERATIVE_PILOT_CONFIG } from './iterative_config';
import { AdverseCaseMiner, type AdverseCaseRecord } from './adverse_case_miner';
import { SolutionArchive } from './solution_archive';
import { EvolutionarySearch } from './evolutionary_search';
import { ForwardCompiler, type CompiledForwardCandidate } from './forward_compiler';
import { ProductMatchRunner } from '../product_match_runner';
import { treeStrategyFor } from '../../../product_tree_strategy';
import { BranchLibrary, type ExecutableBranch } from '../branch_library';
import { Persistence } from './persistence';
import {
  type ProductOutcome,
  computeProductOutcomeFromMatch,
  compareProductOutcome,
  aggregateProductOutcomes,
} from './product_outcome';

export interface IterationReport {
  iterationNumber: number;
  searchSeed: number;
  initialPilotBranchesCount: number;
  baselineBenchmark: {
    targetW: number;
    targetD: number;
    targetL: number;
    count: number;
    targetScore70Average: number;
  };
  postDecisionBenchmark: {
    targetW: number;
    targetD: number;
    targetL: number;
    count: number;
    targetScore70Average: number;
  };
  score70Delta: number;
  adverseCasesMined: number;
  uniqueCandidatesEvaluated: number;
  forwardExpressibleCount: number;
  localOnlyCount: number;
  acceptedPilotBranchesCount: number;
  neutralPilotBranchesCount: number;
  rejectedPilotBranchesCount: number;
  newAcceptedBranches: ExecutableBranch[];
}

export interface ResultDrivenOptimizerReport {
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

export class ResultDrivenIterativeRunner {
  public static async run(
    config: Partial<IterativePilotOptimizerConfig> = {}
  ): Promise<ResultDrivenOptimizerReport> {
    const fullConfig: IterativePilotOptimizerConfig = { ...DEFAULT_ITERATIVE_PILOT_CONFIG, ...config };
    const runId = `RES_ITER_RUN_${Date.now()}`;
    const runDir = fullConfig.outputBaseDirectory ?? path.join(process.cwd(), 'reports', 'tree-cycle', 'generation2-result-iterative', runId);
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
    let stopReason: ResultDrivenOptimizerReport['stopReason'] = 'MAX_ITERATIONS_REACHED';

    for (let iter = 1; iter <= fullConfig.maxIterations; iter++) {
      const iterDir = path.join(runDir, `iteration-${String(iter).padStart(3, '0')}`);
      Persistence.ensureDir(iterDir);

      const sSeed = fullConfig.searchSeeds[(iter - 1) % fullConfig.searchSeeds.length] ?? (124000 + iter);

      // A. 当前 Pilot 基准策略 (Current Pilot Baseline)
      const currentTargetEvol = BranchLibrary.attachExecutableBranchesToEvol(targetSnap.evol, currentPilotLibrary);
      const currentTargetSnap: ResolvedFormationSnapshot = {
        ...targetSnap,
        evol: currentTargetEvol,
      };

      // 1. 运行当前 Pilot 基线 benchmark 并记录真实 ProductOutcome
      const baselineBenchmarkOutcomes: ProductOutcome[] = [];
      for (const oppSnap of oppSnaps) {
        for (const side of [1, 2] as const) {
          for (const bSeed of fullConfig.baselineSeeds) {
            const isP1 = side === 1;
            const matchRes = ProductMatchRunner.runFullMatch({
              teamA: isP1 ? targetSnap.team : oppSnap.team,
              teamB: isP1 ? oppSnap.team : targetSnap.team,
              seed: bSeed,
              nameA: isP1 ? targetSnap.displayName : oppSnap.displayName,
              nameB: isP1 ? oppSnap.displayName : targetSnap.displayName,
              strategyA: treeStrategyFor(isP1 ? currentTargetEvol : oppSnap.evol),
              strategyB: treeStrategyFor(isP1 ? oppSnap.evol : currentTargetEvol),
            });
            baselineBenchmarkOutcomes.push(computeProductOutcomeFromMatch(matchRes, side));
          }
        }
      }

      const baselineBenchmark = aggregateProductOutcomes(baselineBenchmarkOutcomes);
      Persistence.writeJson(path.join(iterDir, 'baseline_benchmark.json'), {
        iteration: iter,
        ...baselineBenchmark,
      });

      // 2. 从当前 Pilot 策略中挖掘实际剩余不良回合 (Mine remaining adverse cases)
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

      // 3. 局部搜索与代表解推举
      const archive = new SolutionArchive();
      const searchRes = EvolutionarySearch.runEvolutionarySearch(adverseCases, archive, minerConfig);

      Persistence.writeJsonl(path.join(iterDir, 'local_trials.jsonl'), searchRes.allEvaluations);
      Persistence.writeJsonl(path.join(iterDir, 'local_archive.jsonl'), archive.getEntries());

      // 4. 前向编译
      const representatives = archive.getEntries().filter(e => e.isRepresentative);
      const forwardCandidates: CompiledForwardCandidate[] = [];

      for (const rep of representatives) {
        const adverseCase = adverseCases.find(c => c.caseId === rep.caseId)!;
        const oppSnap = oppSnaps.find(o => o.displayName === adverseCase.opponentDisplayName)!;
        const comp = ForwardCompiler.compileRepresentative(rep, adverseCase, oppSnap);
        forwardCandidates.push(comp);
      }

      Persistence.writeJsonl(path.join(iterDir, 'forward_candidates.jsonl'), forwardCandidates);

      // 5. 候选级独立配对 ProductOutcome / Score70 判定
      const pairedValidations: any[] = [];
      const candidateDecisions: Array<{
        candidateId: string;
        decision: 'PILOT_ACCEPTED' | 'PILOT_NEUTRAL' | 'PILOT_REJECTED' | 'LOCAL_ONLY';
        reason: string;
        selectedPairCount: number;
        candidateScore70Delta: number;
        branch?: ExecutableBranch;
      }> = [];

      let acceptedThisIter: ExecutableBranch[] = [];

      for (const cand of forwardCandidates) {
        if (!cand.isForwardExpressible || !cand.executableBranch) {
          candidateDecisions.push({
            candidateId: cand.candidateId,
            decision: 'LOCAL_ONLY',
            reason: cand.rejectionReason ?? 'Not legally forward-expressible',
            selectedPairCount: 0,
            candidateScore70Delta: 0,
          });
          continue;
        }

        const baseCase = adverseCases.find(c => c.caseId === cand.caseId)!;
        const srcOppSnap = oppSnaps.find(o => o.displayName === baseCase.opponentDisplayName)!;

        // 挂载候选分支
        const candEvol = BranchLibrary.attachExecutableBranchesToEvol(currentTargetEvol, [cand.executableBranch]);

        const selectedBaselineOutcomes: ProductOutcome[] = [];
        const selectedCandOutcomes: ProductOutcome[] = [];

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

            const baseOutcome = computeProductOutcomeFromMatch(baseRes, side);
            const candOutcome = computeProductOutcomeFromMatch(candRes, side);

            const pairComp = compareProductOutcome(candOutcome, baseOutcome);
            const isBranchSelected = candOutcome.observableDigest !== baseOutcome.observableDigest || (cand.executableBranch.forkRound <= 5);

            if (isBranchSelected) {
              selectedBaselineOutcomes.push(baseOutcome);
              selectedCandOutcomes.push(candOutcome);
            }

            pairedValidations.push({
              iteration: iter,
              candidateId: cand.candidateId,
              opponentDisplayName: srcOppSnap.displayName,
              side,
              seed: vSeed,
              baselineScore70: baseOutcome.targetScore70,
              candidateScore70: candOutcome.targetScore70,
              branchSelected: isBranchSelected,
              classification: pairComp > 0 ? 'IMPROVES' : pairComp < 0 ? 'REGRESSES' : 'NEUTRAL',
            });
          }
        }

        const aggBase = aggregateProductOutcomes(selectedBaselineOutcomes);
        const aggCand = aggregateProductOutcomes(selectedCandOutcomes);
        const score70Delta = aggCand.targetScore70Average - aggBase.targetScore70Average;

        const anyPairRegressed = selectedCandOutcomes.some((co, idx) => compareProductOutcome(co, selectedBaselineOutcomes[idx]) < 0);
        const strictlyBeats = score70Delta > 0 && !anyPairRegressed;

        if (anyPairRegressed || score70Delta < 0) {
          candidateDecisions.push({
            candidateId: cand.candidateId,
            decision: 'PILOT_REJECTED',
            reason: `Regressed on selected validation pairs or negative Score70 delta (${score70Delta})`,
            selectedPairCount: selectedCandOutcomes.length,
            candidateScore70Delta: score70Delta,
          });
        } else if (strictlyBeats) {
          candidateDecisions.push({
            candidateId: cand.candidateId,
            decision: 'PILOT_ACCEPTED',
            reason: `Strictly improved Score70 (+${score70Delta}) with 0 regressions`,
            selectedPairCount: selectedCandOutcomes.length,
            candidateScore70Delta: score70Delta,
            branch: cand.executableBranch,
          });
          acceptedThisIter.push(cand.executableBranch);
        } else {
          candidateDecisions.push({
            candidateId: cand.candidateId,
            decision: 'PILOT_NEUTRAL',
            reason: `Equal Score70 delta and 0 regressions`,
            selectedPairCount: selectedCandOutcomes.length,
            candidateScore70Delta: score70Delta,
          });
        }
      }

      // 控制最大接收数并按 Score70 贡献排序
      if (acceptedThisIter.length > fullConfig.maxNewPilotBranchesPerIteration) {
        acceptedThisIter = acceptedThisIter.slice(0, fullConfig.maxNewPilotBranchesPerIteration);
      }

      Persistence.writeJsonl(path.join(iterDir, 'paired_validations.jsonl'), pairedValidations);
      Persistence.writeJsonl(path.join(iterDir, 'candidate_decisions.jsonl'), candidateDecisions);

      // 更新累积 Pilot Library
      const initialCount = currentPilotLibrary.length;
      currentPilotLibrary.push(...acceptedThisIter);

      // 6. 重新执行 Post-Decision Benchmark 记录真实改进
      const postBenchmarkOutcomes: ProductOutcome[] = [];
      const updatedEvol = BranchLibrary.attachExecutableBranchesToEvol(targetSnap.evol, currentPilotLibrary);

      for (const oppSnap of oppSnaps) {
        for (const side of [1, 2] as const) {
          for (const bSeed of fullConfig.baselineSeeds) {
            const isP1 = side === 1;
            const matchRes = ProductMatchRunner.runFullMatch({
              teamA: isP1 ? targetSnap.team : oppSnap.team,
              teamB: isP1 ? oppSnap.team : targetSnap.team,
              seed: bSeed,
              nameA: isP1 ? targetSnap.displayName : oppSnap.displayName,
              nameB: isP1 ? oppSnap.displayName : targetSnap.displayName,
              strategyA: treeStrategyFor(isP1 ? updatedEvol : oppSnap.evol),
              strategyB: treeStrategyFor(isP1 ? oppSnap.evol : updatedEvol),
            });
            postBenchmarkOutcomes.push(computeProductOutcomeFromMatch(matchRes, side));
          }
        }
      }

      const postDecisionBenchmark = aggregateProductOutcomes(postBenchmarkOutcomes);

      const iterReport: IterationReport = {
        iterationNumber: iter,
        searchSeed: sSeed,
        initialPilotBranchesCount: initialCount,
        baselineBenchmark,
        postDecisionBenchmark,
        score70Delta: postDecisionBenchmark.targetScore70Average - baselineBenchmark.targetScore70Average,
        adverseCasesMined: adverseCases.length,
        uniqueCandidatesEvaluated: searchRes.allEvaluations.length,
        forwardExpressibleCount: forwardCandidates.filter(c => c.isForwardExpressible).length,
        localOnlyCount: forwardCandidates.filter(c => !c.isForwardExpressible).length,
        acceptedPilotBranchesCount: acceptedThisIter.length,
        neutralPilotBranchesCount: candidateDecisions.filter(d => d.decision === 'PILOT_NEUTRAL').length,
        rejectedPilotBranchesCount: candidateDecisions.filter(d => d.decision === 'PILOT_REJECTED').length,
        newAcceptedBranches: acceptedThisIter,
      };

      Persistence.writeJson(path.join(iterDir, 'summary.json'), iterReport);
      iterationReports.push(iterReport);

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
