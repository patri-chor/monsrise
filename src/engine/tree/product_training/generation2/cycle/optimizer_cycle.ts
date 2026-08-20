import * as path from 'node:path';
import { FormationSnapshotResolver } from '../../snapshot_resolver';
import type { OptimizerCycleConfig, OptimizerCycleReport, IterationSummary } from './types';
import { DEFAULT_CYCLE_CONFIG } from './types';
import { CycleBenchmark } from './benchmark';
import { CycleSearch } from './search';
import { CyclePilot, type CompiledForwardCandidate } from './pilot';
import { CycleEvidence } from './evidence';
import { BranchLibrary, type ExecutableBranch } from '../branch_library';

export class OptimizerCycleOrchestrator {
  public static async runCycle(
    config: Partial<OptimizerCycleConfig> = {}
  ): Promise<OptimizerCycleReport> {
    const fullConfig: OptimizerCycleConfig = { ...DEFAULT_CYCLE_CONFIG, ...config };
    const runId = `CYCLE_RUN_${Date.now()}`;
    const outBaseDir = fullConfig.outputBaseDirectory ?? path.join(process.cwd(), 'reports', 'tree-cycle', 'generation2-optimizer-cycle', runId);
    CycleEvidence.ensureDir(outBaseDir);

    CycleEvidence.writeJson(path.join(outBaseDir, 'config.json'), fullConfig);

    const resolver = FormationSnapshotResolver.getInstance();
    resolver.init();

    const targetSnap = resolver.resolveFormationSnapshot({ formationId: fullConfig.targetFormationId });
    const oppSnaps = fullConfig.opponentFormationIds.map(fid => resolver.resolveFormationSnapshot({ formationId: fid }));

    let currentPilotLibrary: ExecutableBranch[] = [];
    const iterationSummaries: IterationSummary[] = [];
    let consecutiveNoImprovements = 0;
    let stopReason: OptimizerCycleReport['stopReason'] = 'MAX_ITERATIONS_REACHED';

    for (let iter = 1; iter <= fullConfig.maxIterations; iter++) {
      const iterDir = path.join(outBaseDir, `iteration-${String(iter).padStart(3, '0')}`);
      CycleEvidence.ensureDir(iterDir);

      const sSeed = fullConfig.searchSeeds[(iter - 1) % fullConfig.searchSeeds.length] ?? (125000 + iter);

      // A. 当前 Pilot 基线
      const currentTargetEvol = BranchLibrary.attachExecutableBranchesToEvol(targetSnap.evol, currentPilotLibrary);
      const currentTargetSnap = { ...targetSnap, evol: currentTargetEvol };

      // 1. 基线 Benchmark
      const { aggregate: baselineBenchmark } = CycleBenchmark.runPilotBenchmark(currentTargetSnap, oppSnaps, fullConfig);
      CycleEvidence.writeJson(path.join(iterDir, 'benchmark.json'), baselineBenchmark);

      // 2. 挖掘不利局
      const adverseCases = CycleBenchmark.mineAdverseCasesFromBenchmark(currentTargetSnap, oppSnaps, fullConfig);
      CycleEvidence.writeJsonl(path.join(iterDir, 'adverse_cases.jsonl'), adverseCases);

      if (adverseCases.length === 0) {
        stopReason = 'NO_ADVERSE_CASES_REMAINING';
        break;
      }

      // 3. 局部搜索与代表解
      const { trials, representatives } = CycleSearch.runLocalSearch(adverseCases, fullConfig, sSeed);
      CycleEvidence.writeJsonl(path.join(iterDir, 'candidate_trials.jsonl'), trials);
      CycleEvidence.writeJsonl(path.join(iterDir, 'candidate_archive.jsonl'), representatives);

      // 4. 前向编译与验证
      const forwardCandidates: CompiledForwardCandidate[] = [];
      for (const rep of representatives) {
        const baseCase = adverseCases.find(c => c.caseId === rep.caseId)!;
        const oppSnap = oppSnaps.find(o => o.displayName === baseCase.opponentDisplayName)!;
        forwardCandidates.push(CyclePilot.compileForwardCandidate(rep, baseCase, oppSnap));
      }

      const allPairedValidations = [];
      const allCandidateDecisions = [];
      let acceptedThisIter: ExecutableBranch[] = [];

      for (const cand of forwardCandidates) {
        const baseCase = adverseCases.find(c => c.caseId === cand.caseId)!;
        const oppSnap = oppSnaps.find(o => o.displayName === baseCase.opponentDisplayName)!;

        const { decision, pairedValidations } = CyclePilot.validateCandidateAgainstCurrentPilot(
          cand,
          baseCase,
          targetSnap,
          oppSnap,
          currentTargetEvol,
          fullConfig,
          iter
        );

        allPairedValidations.push(...pairedValidations);
        allCandidateDecisions.push(decision);

        if (decision.decision === 'PILOT_ACCEPTED' && decision.branch) {
          acceptedThisIter.push(decision.branch);
        }
      }

      if (acceptedThisIter.length > fullConfig.maxNewPilotBranchesPerIteration) {
        acceptedThisIter = acceptedThisIter.slice(0, fullConfig.maxNewPilotBranchesPerIteration);
      }

      CycleEvidence.writeJsonl(path.join(iterDir, 'paired_validations.jsonl'), allPairedValidations);
      CycleEvidence.writeJsonl(path.join(iterDir, 'pilot_decisions.jsonl'), allCandidateDecisions);

      // 5. 更新 Pilot 库并运行 Post-Benchmark
      const initialCount = currentPilotLibrary.length;
      currentPilotLibrary.push(...acceptedThisIter);

      const postEvol = BranchLibrary.attachExecutableBranchesToEvol(targetSnap.evol, currentPilotLibrary);
      const { aggregate: postBenchmark } = CycleBenchmark.runPilotBenchmark({ ...targetSnap, evol: postEvol }, oppSnaps, fullConfig);

      const iterSum: IterationSummary = {
        iterationNumber: iter,
        searchSeed: sSeed,
        initialPilotBranchesCount: initialCount,
        baselineScore70Average: baselineBenchmark.targetScore70Average,
        postDecisionScore70Average: postBenchmark.targetScore70Average,
        score70Delta: postBenchmark.targetScore70Average - baselineBenchmark.targetScore70Average,
        adverseCasesMined: adverseCases.length,
        uniqueCandidatesEvaluated: trials.length,
        forwardExpressibleCount: forwardCandidates.filter(c => c.isForwardExpressible).length,
        localOnlyCount: forwardCandidates.filter(c => !c.isForwardExpressible).length,
        acceptedPilotBranchesCount: acceptedThisIter.length,
        neutralPilotBranchesCount: allCandidateDecisions.filter(d => d.decision === 'PILOT_NEUTRAL').length,
        rejectedPilotBranchesCount: allCandidateDecisions.filter(d => d.decision === 'PILOT_REJECTED').length,
        newAcceptedBranches: acceptedThisIter,
      };

      iterationSummaries.push(iterSum);

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

    CycleEvidence.writeJson(path.join(outBaseDir, 'pilot_library.json'), currentPilotLibrary);
    CycleEvidence.writeJsonl(path.join(outBaseDir, 'iterations.jsonl'), iterationSummaries);

    const summary = {
      runId,
      totalIterations: iterationSummaries.length,
      initialPilotBranchesCount: 0,
      finalPilotBranchesCount: currentPilotLibrary.length,
      totalAdverseCasesMined: iterationSummaries.reduce((s, r) => s + r.adverseCasesMined, 0),
      totalUniqueCandidatesEvaluated: iterationSummaries.reduce((s, r) => s + r.uniqueCandidatesEvaluated, 0),
      totalAcceptedBranches: currentPilotLibrary.length,
      totalRejectedBranches: iterationSummaries.reduce((s, r) => s + r.rejectedPilotBranchesCount, 0),
      stopReason,
    };

    CycleEvidence.writeJson(path.join(outBaseDir, 'summary.json'), summary);

    return {
      runId,
      config: fullConfig,
      totalIterationsExecuted: iterationSummaries.length,
      stopReason,
      pilotLibrary: currentPilotLibrary,
      iterations: iterationSummaries,
      summary,
    };
  }
}
