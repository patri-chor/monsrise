import * as path from 'node:path';
import { FormationSnapshotResolver } from '../../snapshot_resolver';
import type { OptimizerCycleConfig, OptimizerCycleReport, IterationSummary } from './types';
import { DEFAULT_CYCLE_CONFIG } from './types';
import { CycleBenchmark } from './benchmark';
import { CycleSearch } from './search';
import { CyclePilot, type CompiledForwardCandidate } from './pilot';
import { CycleEvidence } from './evidence';
import { LineageManager, type LocalLineage, type DCandidateCatalogRecord, type DSTrialRecord } from './lineage';
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

    const targetSnap = fullConfig.targetSnapshot
      ? {
          formationId: fullConfig.targetSnapshot.formationId,
          displayName: fullConfig.targetSnapshot.displayName,
          canonicalFingerprint: fullConfig.targetSnapshot.canonicalFingerprint,
          team: fullConfig.targetSnapshot.team,
          evol: fullConfig.targetSnapshot.evol,
          provenance: 'cycle_target_snapshot_input',
          rootR0SourceId: fullConfig.targetSnapshot.rootSourceId,
        }
      : resolver.resolveFormationSnapshot({ formationId: fullConfig.targetFormationId });

    const oppSnaps = fullConfig.opponentSnapshots
      ? fullConfig.opponentSnapshots.map(s => ({
          formationId: s.formationId,
          displayName: s.displayName,
          canonicalFingerprint: s.canonicalFingerprint,
          team: s.team,
          evol: s.evol,
          provenance: 'cycle_opponent_snapshot_input',
          rootR0SourceId: s.rootSourceId,
        }))
      : fullConfig.opponentFormationIds.map(fid => resolver.resolveFormationSnapshot({ formationId: fid }));

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

      // 3. 局部 S 搜索与代表解
      const searchRes = CycleSearch.runLocalSearch(adverseCases, fullConfig, sSeed);
      const { trials, representatives } = searchRes;
      CycleEvidence.writeJsonl(path.join(iterDir, 's_trials.jsonl'), trials);
      CycleEvidence.writeJsonl(path.join(iterDir, 'candidate_trials.jsonl'), trials);
      CycleEvidence.writeJsonl(path.join(iterDir, 'candidate_archive.jsonl'), representatives);

      const sLineages = LineageManager.buildSLineages(representatives, targetSnap.canonicalFingerprint);

      // 3B. 判定 D+S 触发条件：L2 baseline Score70 < 0.70 且 S 搜索未产生有效局部提升谱系
      const shouldTriggerDS = baselineBenchmark.targetScore70Average < 0.70 && sLineages.length === 0;
      let dCatalog: DCandidateCatalogRecord[] = [];
      let dsTrials: DSTrialRecord[] = [];
      let dsLineages: LocalLineage[] = [];

      if (shouldTriggerDS) {
        dCatalog = LineageManager.generateDCatalog(targetSnap, sSeed);
        const dsRes = await LineageManager.executeDPlusSSearch(dCatalog, adverseCases, sSeed);
        dsTrials = dsRes.dsTrials;
        dsLineages = dsRes.retainedLineages;
      }

      CycleEvidence.writeJsonl(path.join(iterDir, 'd_catalog.jsonl'), dCatalog);
      CycleEvidence.writeJsonl(path.join(iterDir, 'ds_trials.jsonl'), dsTrials);

      // 合并保留谱系 (S + D+S)
      const combinedLineages = [...sLineages, ...dsLineages];
      CycleEvidence.writeJsonl(path.join(iterDir, 'local_lineages.jsonl'), combinedLineages);

      // 4. 前向编译与验证
      const forwardCandidates: CompiledForwardCandidate[] = [];
      for (const rep of representatives) {
        const baseCase = adverseCases.find(c => c.caseId === rep.caseId)!;
        const oppSnap = oppSnaps.find(o => o.displayName === baseCase.opponentDisplayName)!;
        forwardCandidates.push(CyclePilot.compileForwardCandidate(rep, baseCase, oppSnap));
      }

      const allPairedValidations = [];
      const allCandidateDecisions = [];
      const allStrategyTraces = [];
      let acceptedThisIter: ExecutableBranch[] = [];

      for (const cand of forwardCandidates) {
        const baseCase = adverseCases.find(c => c.caseId === cand.caseId)!;
        const oppSnap = oppSnaps.find(o => o.displayName === baseCase.opponentDisplayName)!;

        const { decision, pairedValidations, strategyTraces } = CyclePilot.validateCandidateAgainstCurrentPilot(
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
        if (strategyTraces) allStrategyTraces.push(...strategyTraces);

        if (decision.decision === 'PILOT_ACCEPTED' && decision.branch) {
          acceptedThisIter.push(decision.branch);
        }
      }

      if (acceptedThisIter.length > fullConfig.maxNewPilotBranchesPerIteration) {
        acceptedThisIter = acceptedThisIter.slice(0, fullConfig.maxNewPilotBranchesPerIteration);
      }

      CycleEvidence.writeJsonl(path.join(iterDir, 'strategy_traces.jsonl'), allStrategyTraces);
      CycleEvidence.writeJsonl(path.join(iterDir, 'paired_validations.jsonl'), allPairedValidations);
      CycleEvidence.writeJsonl(path.join(iterDir, 'backprop_validations.jsonl'), allPairedValidations);
      CycleEvidence.writeJsonl(path.join(iterDir, 'pilot_decisions.jsonl'), allCandidateDecisions);

      CycleEvidence.writeJson(path.join(iterDir, 'lineage_selection.json'), {
        iteration: iter,
        retainedLocalLineagesCount: combinedLineages.length,
        sLineagesCount: sLineages.length,
        dsLineagesCount: dsLineages.length,
        acceptedBranchesCount: acceptedThisIter.length,
        decisions: allCandidateDecisions,
      });

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
        searchMetrics: searchRes.metrics,
        dPlusSMetrics: {
          triggered: shouldTriggerDS,
          dCatalogSize: dCatalog.length,
          dsTrialsCount: dsTrials.length,
          retainedDSLineagesCount: dsLineages.length,
        },
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

    const report: OptimizerCycleReport = {
      runId,
      config: fullConfig,
      totalIterationsExecuted: iterationSummaries.length,
      stopReason,
      pilotLibrary: currentPilotLibrary,
      iterations: iterationSummaries,
      summary: {
        runId,
        totalIterations: iterationSummaries.length,
        initialPilotBranchesCount: 0,
        finalPilotBranchesCount: currentPilotLibrary.length,
        totalAdverseCasesMined: iterationSummaries.reduce((s, it) => s + it.adverseCasesMined, 0),
        totalUniqueCandidatesEvaluated: iterationSummaries.reduce((s, it) => s + it.uniqueCandidatesEvaluated, 0),
        totalAcceptedBranches: iterationSummaries.reduce((s, it) => s + it.acceptedPilotBranchesCount, 0),
        totalRejectedBranches: iterationSummaries.reduce((s, it) => s + it.rejectedPilotBranchesCount, 0),
        stopReason,
      },
    };

    CycleEvidence.writeJson(path.join(outBaseDir, 'summary.json'), report);
    CycleEvidence.writeJson(path.join(outBaseDir, 'pilot_library.json'), currentPilotLibrary);
    CycleEvidence.writeJsonl(path.join(outBaseDir, 'iterations.jsonl'), iterationSummaries);

    return report;
  }
}
