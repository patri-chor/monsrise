import * as path from 'node:path';
import type { DynamicT0PilotConfig, DynamicPoolEntry } from './types';
import { DEFAULT_DYNAMIC_T0_CONFIG } from './types';
import { DynamicPoolManager } from './dynamic_pool';
import { L1MeleeEvaluator } from './l1_melee';
import { L2BenchmarkEvaluator } from './l2_benchmark';
import { runGeneration2OptimizerCycle } from '../cycle';
import { CycleEvidence } from '../cycle/evidence';
import { BranchLibrary } from '../branch_library';
import { walkEvolNodes } from '../../../evol_gene';

export interface PilotFormationResult {
  formationId: string;
  l1Before: any;
  l2Before: any;
  l1Candidate: any;
  l2Candidate: any;
  cycleReport: any;
  searchMetrics: any;
  decision: {
    accepted: boolean;
    reason: string;
    combinedScore70Before: number;
    combinedScore70Candidate: number;
  };
}

export interface DynamicT0PilotReport {
  runId: string;
  config: DynamicT0PilotConfig;
  poolBefore: DynamicPoolEntry[];
  poolAfter: DynamicPoolEntry[];
  selection: {
    selectedFormations: string[];
    reason: string;
  };
  results: PilotFormationResult[];
  aggregate: {
    totalPilotFormations: number;
    replacedFormationsCount: number;
    retainedFormationsCount: number;
    totalSearchTrials: number;
    totalValidationMatches: number;
  };
}

export class DynamicT0PilotCoordinator {
  public static async runPilot(
    config: Partial<DynamicT0PilotConfig> = {}
  ): Promise<DynamicT0PilotReport> {
    const fullConfig: DynamicT0PilotConfig = { ...DEFAULT_DYNAMIC_T0_CONFIG, ...config };
    const runId = `T0_PILOT_RUN_${Date.now()}`;
    const outBaseDir = fullConfig.outputBaseDirectory ?? path.join(process.cwd(), 'reports', 'tree-cycle', 'dynamic-t0-l1-l2-pilot', runId);
    CycleEvidence.ensureDir(outBaseDir);

    CycleEvidence.writeJson(path.join(outBaseDir, 'config.json'), fullConfig);

    const poolManager = new DynamicPoolManager(fullConfig.poolFilePath);
    poolManager.initOrLoad();

    const poolBefore = JSON.parse(JSON.stringify(poolManager.getEntries()));
    CycleEvidence.writeJson(path.join(outBaseDir, 'pool_before.json'), poolBefore);

    const { selected: pilotEntries, reason: selectionReason } = poolManager.selectPilotCandidates(fullConfig.maxPilotFormations);

    CycleEvidence.writeJson(path.join(outBaseDir, 'pilot_selection.json'), {
      selectedFormations: pilotEntries.map(e => e.formationId),
      reason: selectionReason,
    });

    CycleEvidence.writeJson(path.join(outBaseDir, 'selection_diagnostics.json'), {
      totalPoolEntries: poolBefore.length,
      activeEntriesCount: poolBefore.filter((e: any) => e.status === 'ACTIVE').length,
      selectedFormations: pilotEntries.map(e => ({
        formationId: e.formationId,
        rootSourceId: e.rootSourceId,
        currentSnapshotFingerprint: e.currentSnapshotFingerprint,
        optimizationCycles: e.optimizationCycles,
        score70Aggregate: e.score70Aggregate,
      })),
      selectionReason,
    });

    const formationResults: PilotFormationResult[] = [];
    const pendingReplacements: Array<{ entry: DynamicPoolEntry; newEvol: any; newFp: string; l1: any; l2: any; combinedScore70: number }> = [];

    let totalSearchTrials = 0;
    let totalValidationMatches = 0;

    for (const targetEntry of pilotEntries) {
      const formDir = path.join(outBaseDir, `formation-${targetEntry.formationId.replace(/[^a-zA-Z0-9_]/g, '_')}`);
      CycleEvidence.ensureDir(formDir);

      // A. L1/L2 Baseline
      const { metrics: l1Before } = L1MeleeEvaluator.evaluateL1(targetEntry, poolBefore, fullConfig.l1Seeds);
      const { metrics: l2Before } = L2BenchmarkEvaluator.evaluateL2(targetEntry, poolBefore, fullConfig.l2Seeds);

      CycleEvidence.writeJson(path.join(formDir, 'l1_before.json'), l1Before);
      CycleEvidence.writeJson(path.join(formDir, 'l2_before.json'), l2Before);

      // B. 调用单一主导 7 模块周期优化器 (Per-Formation Optimizer Cycle)
      const otherOpponents = poolBefore
        .filter(e => e.formationId !== targetEntry.formationId && e.status === 'ACTIVE')
        .slice(0, fullConfig.maxOpponentsPerCycle)
        .map(e => e.formationId);

      const cycleOutDir = path.join(formDir, 'cycle');
      const cycleReport = await runGeneration2OptimizerCycle({
        targetFormationId: targetEntry.formationId,
        opponentFormationIds: otherOpponents,
        maxIterations: fullConfig.optimizerIterations,
        uniqueCandidatesPerCase: fullConfig.uniqueCandidatesPerCase,
        populationSize: fullConfig.populationSize,
        maxGenerations: fullConfig.maxGenerations,
        maxNewPilotBranchesPerIteration: fullConfig.maxNewPilotBranchesPerIteration,
        maxConsecutiveNoImprovementIterations: fullConfig.maxConsecutiveNoImprovementIterations,
        outputBaseDirectory: cycleOutDir,
      });

      const uniqueEvaluated = cycleReport.summary.totalUniqueCandidatesEvaluated;
      totalSearchTrials += uniqueEvaluated;
      totalValidationMatches += cycleReport.iterations.reduce((s, it) => s + it.acceptedPilotBranchesCount + it.rejectedPilotBranchesCount + it.neutralPilotBranchesCount, 0) * fullConfig.l1Seeds.length;

      const candidateEvol = BranchLibrary.attachExecutableBranchesToEvol(targetEntry.currentEvol, cycleReport.pilotLibrary);
      const candidateEntry: DynamicPoolEntry = {
        ...targetEntry,
        currentEvol: candidateEvol,
      };

      // C. L1/L2 Candidate Evaluation
      const { metrics: l1Candidate } = L1MeleeEvaluator.evaluateL1(candidateEntry, poolBefore, fullConfig.l1Seeds);
      const { metrics: l2Candidate } = L2BenchmarkEvaluator.evaluateL2(candidateEntry, poolBefore, fullConfig.l2Seeds);

      CycleEvidence.writeJson(path.join(formDir, 'l1_candidate.json'), l1Candidate);
      CycleEvidence.writeJson(path.join(formDir, 'l2_candidate.json'), l2Candidate);

      // D. Combined Objective Evaluation & Replacement Rule
      const combScore70Before = (l1Before.targetScore70Average + l2Before.targetScore70Average) / 2;
      const combScore70Candidate = (l1Candidate.targetScore70Average + l2Candidate.targetScore70Average) / 2;

      const l1NoRegression = l1Candidate.targetScore70Average >= l1Before.targetScore70Average && l1Candidate.targetL <= l1Before.targetL;
      const l2NoRegression = l2Candidate.targetScore70Average >= l2Before.targetScore70Average && l2Candidate.targetL <= l2Before.targetL;
      const strictlyImproves = combScore70Candidate > combScore70Before && l1NoRegression && l2NoRegression;

      let decisionAccepted = false;
      let decisionReason = `Retained: candidate combined Score70 (${combScore70Candidate.toFixed(4)}) did not strictly exceed baseline (${combScore70Before.toFixed(4)}) without regression.`;

      if (strictlyImproves && cycleReport.pilotLibrary.length > 0) {
        decisionAccepted = true;
        decisionReason = `Accepted: candidate strictly improved combined Score70 (${combScore70Before.toFixed(4)} -> ${combScore70Candidate.toFixed(4)}) with 0 L1/L2 regressions.`;

        const newFp = `SNAP_${targetEntry.formationId}_c${targetEntry.optimizationCycles + 1}_${Date.now()}`;
        pendingReplacements.push({
          entry: targetEntry,
          newEvol: candidateEvol,
          newFp,
          l1: l1Candidate,
          l2: l2Candidate,
          combinedScore70: combScore70Candidate,
        });
      }

      const decision = {
        accepted: decisionAccepted,
        reason: decisionReason,
        combinedScore70Before: combScore70Before,
        combinedScore70Candidate: combScore70Candidate,
      };

      const searchMetrics = {
        uniqueCandidatesEvaluated: uniqueEvaluated,
        pilotBranchesCount: cycleReport.pilotLibrary.length,
        iterationsExecuted: cycleReport.totalIterationsExecuted,
        stopReason: cycleReport.stopReason,
      };

      const performanceMetrics = {
        formationId: targetEntry.formationId,
        uniqueCandidatesEvaluated: uniqueEvaluated,
        iterations: cycleReport.iterations.map((it: any) => ({
          iteration: it.iterationNumber,
          adverseCases: it.adverseCasesMined,
          uniqueEvaluations: it.uniqueCandidatesEvaluated,
          searchMetrics: it.searchMetrics,
          acceptedPilots: it.acceptedPilotBranchesCount,
          rejectedPilots: it.rejectedPilotBranchesCount,
          neutralPilots: it.neutralPilotBranchesCount,
          baselineScore70: it.baselineScore70Average,
          postDecisionScore70: it.postDecisionScore70Average,
        })),
        l1Before,
        l1Candidate,
        l2Before,
        l2Candidate,
        decision,
      };

      CycleEvidence.writeJson(path.join(formDir, 'search_metrics.json'), searchMetrics);
      CycleEvidence.writeJson(path.join(formDir, 'performance_metrics.json'), performanceMetrics);
      CycleEvidence.writeJson(path.join(formDir, 'decision.json'), decision);

      formationResults.push({
        formationId: targetEntry.formationId,
        l1Before,
        l2Before,
        l1Candidate,
        l2Candidate,
        cycleReport,
        searchMetrics,
        decision,
      });
    }

    // E. 批量评估完成后应用替换 (Apply Pending Replacements to Dynamic Pool)
    pendingReplacements.sort((a, b) => b.combinedScore70 - a.combinedScore70);

    for (const rep of pendingReplacements) {
      const liveEntry = poolManager.getEntries().find(e => e.formationId === rep.entry.formationId);
      if (liveEntry) {
        liveEntry.previousSnapshotFingerprint = liveEntry.currentSnapshotFingerprint;
        liveEntry.currentSnapshotFingerprint = rep.newFp;
        liveEntry.currentEvol = rep.newEvol;
        liveEntry.l1Metrics = rep.l1;
        liveEntry.l2Metrics = rep.l2;
        liveEntry.score70Aggregate = rep.combinedScore70;
        liveEntry.optimizationCycles++;
        liveEntry.status = 'ACTIVE';
        liveEntry.lineage.push(rep.newFp);
      }
    }

    poolManager.save();

    const poolAfter = JSON.parse(JSON.stringify(poolManager.getEntries()));
    CycleEvidence.writeJson(path.join(outBaseDir, 'pool_after.json'), poolAfter);

    const aggregate = {
      totalPilotFormations: pilotEntries.length,
      replacedFormationsCount: pendingReplacements.length,
      retainedFormationsCount: pilotEntries.length - pendingReplacements.length,
      totalSearchTrials,
      totalValidationMatches,
    };

    CycleEvidence.writeJson(path.join(outBaseDir, 'aggregate.json'), aggregate);
    CycleEvidence.writeJsonl(path.join(outBaseDir, 'by_formation.jsonl'), formationResults);

    const report: DynamicT0PilotReport = {
      runId,
      config: fullConfig,
      poolBefore,
      poolAfter,
      selection: {
        selectedFormations: pilotEntries.map(e => e.formationId),
        reason: selectionReason,
      },
      results: formationResults,
      aggregate,
    };

    CycleEvidence.writeJson(path.join(outBaseDir, 'summary.json'), report);

    return report;
  }
}
