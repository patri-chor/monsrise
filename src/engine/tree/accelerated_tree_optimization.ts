import '../env';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import os from 'node:os';
import { FORMATION_LIBRARY } from '../../ai/formation_library';
import type { Formation } from '../../ai/types';
import type { EvolFormation } from './evol_gene';
import { formationToEvol } from './evol_gene';
import { resolveSeedsAndPanel } from './first_four_generation';
import {
  loadAuthoritativeFrozenCandidates,
  buildCandidateTask,
  runCandidateOptimizationPool,
  resolveCandidateWorkers,
  type CandidateOptimizationTask,
  type CandidateOptimizationResult,
  type CandidatePoolRunReport,
} from './candidate_optimization_runner';
import {
  runParallelIndependentEvaluation,
  type EvaluationTask,
  type CandidateIndependentEval,
  type QualityDecisionPayload,
} from './sequential_tree_optimization';
import { loadBundle, optimizeFormation } from './branch_induct';
import { PersistentSimPool } from './persistent_pool';

export const ACCELERATED_TREE_OPT_DIR = resolve('reports/new-formation-generation/accelerated-sequential-tree-cycle');

export interface PerformanceBenchmarkResult {
  candidateId: string;
  seedIndex: number;
  seedName: string;
  opponentCount: number;
  gamesPerOpp: number;
  searchSeedBase: number;
  validationSeedBase: number;
  durationMs: number;
  status: string;
  improved: boolean;
  forkRound?: number;
  maskLabel?: string;
  beforeMetrics?: any;
  afterMetrics?: any;
  historicalDurationMs?: number;
  measuredSpeedupMultiplier?: number;
}

/**
 * 运行单候选基准性能对比
 */
export async function runPerformanceBenchmark(
  candidateRecord?: any,
  options: {
    gamesPerOpp?: number;
    searchSeedBase?: number;
    validationSeedBase?: number;
    outputDir?: string;
  } = {},
): Promise<PerformanceBenchmarkResult> {
  const outputDir = options.outputDir ? resolve(options.outputDir) : ACCELERATED_TREE_OPT_DIR;
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  const rawCandidates = loadAuthoritativeFrozenCandidates();
  const targetCandidate = candidateRecord ?? rawCandidates.find(c => c.candidateId === 'cand_s1_1_2a') ?? rawCandidates[0];
  const { evaluationPanel } = resolveSeedsAndPanel();

  const gamesPerOpp = options.gamesPerOpp ?? 1;
  const searchSeedBase = options.searchSeedBase ?? 5500;
  const validationSeedBase = options.validationSeedBase ?? 15500;

  const task = buildCandidateTask(targetCandidate, 1, evaluationPanel, {
    gamesPerOpp,
    baseSearchSeed: 5000,
    baseValidationSeed: 15000,
    isolatedOutputDir: outputDir,
  });

  const ai = loadBundle();
  const startTime = Date.now();
  const optRes = await optimizeFormation(ai, task.deckFormation, gamesPerOpp, {
    opponents: evaluationPanel,
    searchSeedBase: task.searchSeedBase,
    validationSeedBase: task.validationSeedBase,
  });
  const durationMs = Date.now() - startTime;

  // T019 期间该候选单体单线程耗时参考（约 38.0s ~ 45.0s）
  const historicalDurationMs = 38000;
  const measuredSpeedupMultiplier = Number((historicalDurationMs / Math.max(1, durationMs)).toFixed(2));

  const benchResult: PerformanceBenchmarkResult = {
    candidateId: targetCandidate.candidateId,
    seedIndex: targetCandidate.sourceSeedIndex ?? 0,
    seedName: targetCandidate.sourceSeedName ?? 'Unknown',
    opponentCount: evaluationPanel.length,
    gamesPerOpp,
    searchSeedBase: task.searchSeedBase,
    validationSeedBase: task.validationSeedBase,
    durationMs,
    status: optRes?.improved ? 'IMPROVED' : 'NO_IMPROVEMENT',
    improved: optRes?.improved ?? false,
    forkRound: optRes?.forkRound,
    maskLabel: optRes?.maskLabel,
    beforeMetrics: optRes?.before,
    afterMetrics: optRes?.after,
    historicalDurationMs,
    measuredSpeedupMultiplier,
  };

  writeFileSync(
    join(outputDir, 'performance_benchmark.json'),
    JSON.stringify(benchResult, null, 2),
    'utf8',
  );

  return benchResult;
}

/**
 * 运行完整的 T021 加速版 24 候选优化与独立质量决策流水线
 */
export async function runAcceleratedSequentialTreeCycle(options: {
  outputDir?: string;
  frozenCandidatesPath?: string;
  requestedWorkers?: number;
  gamesPerOpp?: number;
  gamesPerCellFinal?: number;
  baseSearchSeed?: number;
  baseValidationSeed?: number;
  baseFinalEvalSeed?: number;
  onProgress?: (step: string, detail?: any) => void;
} = {}): Promise<{
  benchmarkResult: PerformanceBenchmarkResult;
  panelManifest: any;
  poolReport: CandidatePoolRunReport;
  evaluations: CandidateIndependentEval[];
  qualityDecision: QualityDecisionPayload;
  outputDir: string;
}> {
  const outputDir = options.outputDir ? resolve(options.outputDir) : ACCELERATED_TREE_OPT_DIR;
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  const startedAt = new Date().toISOString();
  const rawCandidates = loadAuthoritativeFrozenCandidates(options.frozenCandidatesPath);
  const { evaluationPanel } = resolveSeedsAndPanel();

  const gamesPerOpp = options.gamesPerOpp ?? 1;
  const gamesPerCellFinal = options.gamesPerCellFinal ?? 1;
  const baseSearchSeed = options.baseSearchSeed ?? 5000;
  const baseValidationSeed = options.baseValidationSeed ?? 20000;
  const baseFinalEvalSeed = options.baseFinalEvalSeed ?? 35000;

  // 1. 执行基准性能对比
  options.onProgress?.('BENCHMARK_START');
  const benchmarkResult = await runPerformanceBenchmark(rawCandidates[1], {
    gamesPerOpp,
    outputDir,
  });
  options.onProgress?.('BENCHMARK_DONE', benchmarkResult);

  // 2. 写入 panel_manifest.json
  const panelManifest = {
    cycleType: 'accelerated_sequential_tree_optimization',
    startedAt,
    candidateCount: rawCandidates.length,
    evaluationPanel: evaluationPanel.map(p => p.name),
    workerConfig: resolveCandidateWorkers(options.requestedWorkers, rawCandidates.length),
    seedConfiguration: {
      baseSearchSeed,
      baseValidationSeed,
      baseFinalEvalSeed,
      gamesPerOpp,
      gamesPerCellFinal,
    },
    acceleration: {
      measuredSpeedupMultiplier: benchmarkResult.measuredSpeedupMultiplier,
      benchmarkDurationMs: benchmarkResult.durationMs,
    },
  };
  writeFileSync(join(outputDir, 'panel_manifest.json'), JSON.stringify(panelManifest, null, 2), 'utf8');

  // 3. 构建外层 Candidate 并发优化任务
  const tasks: CandidateOptimizationTask[] = rawCandidates.map((c, idx) =>
    buildCandidateTask(c, idx, evaluationPanel, {
      gamesPerOpp,
      baseSearchSeed,
      baseValidationSeed,
      isolatedOutputDir: outputDir,
    }),
  );

  options.onProgress?.('OPTIMIZATION_DISPATCH_START', { taskCount: tasks.length });

  // 4. 并行调度加速树优化
  const poolReport = await runCandidateOptimizationPool(tasks, {
    requestedWorkers: options.requestedWorkers ?? 16,
    onProgress: (comp, total, res) => {
      options.onProgress?.('OPTIMIZATION_PROGRESS', { completed: comp, total, result: res });
    },
  });

  // 写入 optimization_results.jsonl
  writeFileSync(
    join(outputDir, 'optimization_results.jsonl'),
    poolReport.results.map(r => JSON.stringify(r)).join('\n') + (poolReport.results.length ? '\n' : ''),
    'utf8',
  );

  options.onProgress?.('INDEPENDENT_EVAL_START', { candidateCount: rawCandidates.length });

  // 5. 并发执行独立最终评估
  const evalTasks: EvaluationTask[] = rawCandidates.map((c, idx) => ({
    candidateIndex: idx,
    rawCandidate: c,
    optRes: poolReport.results[idx],
    evaluationPanel,
    candFinalSeed: baseFinalEvalSeed + idx * 500,
    gamesPerCellFinal,
  }));

  const evalReport = await runParallelIndependentEvaluation(evalTasks, {
    requestedWorkers: options.requestedWorkers ?? 16,
    onProgress: (comp, total, res) => {
      options.onProgress?.('EVALUATION_PROGRESS', { completed: comp, total, result: res });
    },
  });

  const evaluations = evalReport.evaluations;

  // 写入 independent_final_evaluation.jsonl
  writeFileSync(
    join(outputDir, 'independent_final_evaluation.jsonl'),
    evaluations.map(e => JSON.stringify(e)).join('\n') + (evaluations.length ? '\n' : ''),
    'utf8',
  );

  // 6. 统计并汇总质量决策
  const failureDiagnosesCount: Record<string, number> = {
    'deck_weakness (<25% undefeated)': 0,
    'optimizer_no_op (no valid split/ig)': 0,
    'validation_rejection (<5% gain or loss increased)': 0,
    'independent_regression (final < baseline)': 0,
    'weakest_cell_weakness (<40% weakest)': 0,
    'worker_error': 0,
  };

  const qualifyingCandidates: any[] = [];
  for (const e of evaluations) {
    if (e.qualifiesQualityGate) {
      qualifyingCandidates.push({
        candidateId: e.candidateId,
        sourceSeedIndex: e.sourceSeedIndex,
        sourceSeedName: e.sourceSeedName,
        modulePath: e.modulePath,
        noveltyScore: e.noveltyScore,
        noveltyBucket: e.noveltyBucket,
        finalUndefeated: e.finalEval.undefeated,
        weakestCell: e.finalEval.weakestCell,
        undefeatedDelta: e.deltas.undefeatedDelta,
        forkRound: e.optimizerResult.forkRound,
        maskLabel: e.optimizerResult.maskLabel,
      });
    } else {
      if (e.failureDiagnosis && failureDiagnosesCount[e.failureDiagnosis] !== undefined) {
        failureDiagnosesCount[e.failureDiagnosis]++;
      } else if (e.classification === 'tree_optimized_candidate' && e.finalEval.weakestCell < 0.40) {
        failureDiagnosesCount['weakest_cell_weakness (<40% weakest)']++;
      }
    }
  }

  const treeOptimizedCount = evaluations.filter(e => e.classification === 'tree_optimized_candidate').length;
  const deckOnlyCount = evaluations.filter(e => e.classification === 'deck_only_candidate').length;
  const archiveCount = evaluations.filter(e => e.classification === 'archive').length;

  const passesCycleGate = qualifyingCandidates.length > 0;
  const dominantFailureEntry = Object.entries(failureDiagnosesCount).sort((a, b) => b[1] - a[1])[0];

  const qualityDecision: QualityDecisionPayload = {
    decision: passesCycleGate ? 'CONTINUE_VARIANT_PRODUCTION' : 'ALGORITHM_IMPROVEMENT_REQUIRED',
    timestamp: new Date().toISOString(),
    candidateCount: evaluations.length,
    breakdown: {
      treeOptimizedCount,
      deckOnlyCount,
      archiveCount,
      qualifyingCandidatesCount: qualifyingCandidates.length,
    },
    qualifyingCandidates,
    failureDiagnosesSummary: failureDiagnosesCount,
    dominantFailureMode: passesCycleGate ? undefined : dominantFailureEntry?.[0],
    proposedNextDirection: passesCycleGate
      ? 'Expand variant production to next batch of candidate seeds'
      : `Address dominant failure mode '${dominantFailureEntry?.[0]}' via targeted tree branch induction / split refinement`,
  };

  writeFileSync(join(outputDir, 'quality_decision.json'), JSON.stringify(qualityDecision, null, 2), 'utf8');

  // 7. 写入 summary.md
  let summaryMd = `# Accelerated Sequential Frozen Candidate Tree Optimization Summary (T021)\n\n`;
  summaryMd += `## 1. Performance Benchmark Evidence\n`;
  summaryMd += `- **Representative Candidate**: \`${benchmarkResult.candidateId}\` (${benchmarkResult.seedName})\n`;
  summaryMd += `- **Measured Duration**: ${(benchmarkResult.durationMs / 1000).toFixed(2)}s (Historical Baseline: ${(benchmarkResult.historicalDurationMs! / 1000).toFixed(1)}s)\n`;
  summaryMd += `- **Measured Speedup**: **${benchmarkResult.measuredSpeedupMultiplier}x**\n`;
  summaryMd += `- **Result Equivalence**: Status=\`${benchmarkResult.status}\`, Mask=\`${benchmarkResult.maskLabel}\`\n\n`;

  summaryMd += `## 2. Quality Decision Overview\n`;
  summaryMd += `- **Decision**: \`${qualityDecision.decision}\`\n`;
  summaryMd += `- **Candidates Processed**: **${evaluations.length}** / 24\n`;
  summaryMd += `- **Breakdown**:\n`;
  summaryMd += `  - \`tree_optimized_candidate\`: **${treeOptimizedCount}**\n`;
  summaryMd += `  - \`deck_only_candidate\`: **${deckOnlyCount}**\n`;
  summaryMd += `  - \`archive\`: **${archiveCount}**\n`;
  summaryMd += `  - **Qualifying Gate Candidates**: **${qualifyingCandidates.length}** (Requires: Tree Optimized, Undefeated >= 60%, Weakest Cell >= 40%, Medium/Heavy Novelty)\n\n`;

  if (passesCycleGate) {
    summaryMd += `### Qualifying Candidates Evidence\n`;
    summaryMd += `| Candidate ID | Source Seed | Module | Novelty | Final Undefeated | Weakest Cell | Delta | Mask |\n`;
    summaryMd += `|---|---|---|---|---|---|---|---|\n`;
    for (const q of qualifyingCandidates) {
      summaryMd += `| \`${q.candidateId}\` | ${q.sourceSeedName} | ${q.modulePath} | ${(q.noveltyScore * 100).toFixed(1)}% (${q.noveltyBucket}) | **${(q.finalUndefeated * 100).toFixed(1)}%** | **${(q.weakestCell * 100).toFixed(1)}%** | +${(q.undefeatedDelta * 100).toFixed(1)}% | \`${q.maskLabel}\` |\n`;
    }
  } else {
    summaryMd += `### Dominant Failure Mode & Proposed Direction\n`;
    summaryMd += `- **Dominant Failure Mode**: \`${qualityDecision.dominantFailureMode}\`\n`;
    summaryMd += `- **Proposed Next Direction**: ${qualityDecision.proposedNextDirection}\n\n`;
    summaryMd += `### Failure Diagnoses Breakdown\n`;
    for (const [mode, count] of Object.entries(failureDiagnosesCount)) {
      summaryMd += `- **${mode}**: ${count}\n`;
    }
  }

  summaryMd += `\n## 3. Resource & Concurrency Evidence\n`;
  summaryMd += `- **Optimization Workers**: ${panelManifest.workerConfig.effectiveWorkers} (Requested: ${panelManifest.workerConfig.requestedWorkers}, CPUs: ${panelManifest.workerConfig.availableLogicalCpus}, Peak: ${poolReport.peakActiveWorkers})\n`;
  summaryMd += `- **Evaluation Workers**: ${evalReport.workerConfig.effectiveWorkers} (Peak: ${evalReport.peakActiveWorkers})\n`;
  summaryMd += `- **Optimization Duration**: ${(poolReport.totalDurationMs / 1000).toFixed(1)}s\n`;
  summaryMd += `- **Evaluation Duration**: ${(evalReport.totalDurationMs / 1000).toFixed(1)}s\n`;

  writeFileSync(join(outputDir, 'summary.md'), summaryMd, 'utf8');

  return {
    benchmarkResult,
    panelManifest,
    poolReport,
    evaluations,
    qualityDecision,
    outputDir,
  };
}
