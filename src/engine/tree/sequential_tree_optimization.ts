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
import { playSpecVsSpec, type SideSpec } from './arena';
import { loadBundle } from './branch_induct';

export const SEQUENTIAL_TREE_OPT_DIR = resolve('reports/new-formation-generation/sequential-tree-optimization');

export interface CellEvaluation {
  opponentIndex: number;
  opponentName: string;
  side: 1 | 2;
  w: number;
  d: number;
  l: number;
  total: number;
  undefeated: number;
}

export interface CandidateIndependentEval {
  candidateIndex: number;
  candidateId: string;
  sourceSeedIndex: number;
  sourceSeedName: string;
  sourceSeedId: string;
  archPath: string;
  modulePath: string;
  noveltyScore: number;
  noveltyBucket: string;
  classification: 'tree_optimized_candidate' | 'deck_only_candidate' | 'archive';
  failureDiagnosis?: string;
  optimizerResult: {
    status: 'IMPROVED' | 'NO_IMPROVEMENT' | 'ERROR';
    improved: boolean;
    durationMs: number;
    forkRound?: number;
    maskLabel?: string;
    searchSeedBase: number;
    validationSeedBase: number;
    error?: string;
  };
  baselineEval: {
    w: number;
    d: number;
    l: number;
    total: number;
    undefeated: number;
    weakestCell: number;
    cells: CellEvaluation[];
  };
  finalEval: {
    w: number;
    d: number;
    l: number;
    total: number;
    undefeated: number;
    weakestCell: number;
    cells: CellEvaluation[];
  };
  deltas: {
    undefeatedDelta: number;
    weakestCellDelta: number;
  };
  qualifiesQualityGate: boolean;
}

export interface QualityDecisionPayload {
  decision: 'CONTINUE_VARIANT_PRODUCTION' | 'ALGORITHM_IMPROVEMENT_REQUIRED';
  timestamp: string;
  candidateCount: number;
  breakdown: {
    treeOptimizedCount: number;
    deckOnlyCount: number;
    archiveCount: number;
    qualifyingCandidatesCount: number;
  };
  qualifyingCandidates: any[];
  failureDiagnosesSummary: Record<string, number>;
  dominantFailureMode?: string;
  proposedNextDirection?: string;
}

/**
 * 在固定 8 对手双侧（共 16 cells）上独立评估一个阵型
 */
export function evaluateFormationOnPanel(
  BundleAI: any,
  form: EvolFormation,
  panel: Formation[],
  seedBase: number,
  gamesPerCell: number = 1,
): {
  w: number;
  d: number;
  l: number;
  total: number;
  undefeated: number;
  weakestCell: number;
  cells: CellEvaluation[];
} {
  let totalW = 0, totalD = 0, totalL = 0;
  const cells: CellEvaluation[] = [];
  let weakest = 1.0;

  for (let oppIdx = 0; oppIdx < panel.length; oppIdx++) {
    const opp = panel[oppIdx];
    const specB: SideSpec = { kind: 'native', f: opp };
    for (const side of [1, 2] as (1 | 2)[]) {
      let cw = 0, cd = 0, cl = 0;
      for (let g = 0; g < gamesPerCell; g++) {
        const seed = seedBase + oppIdx * 50 + (side - 1) * 20 + g;
        const specA: SideSpec = { kind: 'evol', f: form };
        const res = playSpecVsSpec(BundleAI, specA, specB, side, seed);
        cw += res.w;
        cd += res.d;
        cl += res.l;
      }
      const cellTotal = cw + cd + cl;
      const cellUndef = cellTotal > 0 ? (cw + cd) / cellTotal : 0;
      if (cellUndef < weakest) {
        weakest = cellUndef;
      }
      totalW += cw;
      totalD += cd;
      totalL += cl;
      cells.push({
        opponentIndex: oppIdx,
        opponentName: opp.name,
        side,
        w: cw,
        d: cd,
        l: cl,
        total: cellTotal,
        undefeated: cellUndef,
      });
    }
  }

  const grandTotal = totalW + totalD + totalL;
  const aggUndef = grandTotal > 0 ? (totalW + totalD) / grandTotal : 0;

  return {
    w: totalW,
    d: totalD,
    l: totalL,
    total: grandTotal,
    undefeated: aggUndef,
    weakestCell: grandTotal > 0 ? weakest : 0,
    cells,
  };
}

/**
 * 运行完整的 T019 树优化与独立质量决策流水线
 */
export async function runSequentialTreeOptimizationCycle(options: {
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
  panelManifest: any;
  poolReport: CandidatePoolRunReport;
  evaluations: CandidateIndependentEval[];
  qualityDecision: QualityDecisionPayload;
  outputDir: string;
}> {
  const outputDir = options.outputDir ? resolve(options.outputDir) : SEQUENTIAL_TREE_OPT_DIR;
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  const startedAt = new Date().toISOString();
  const rawCandidates = loadAuthoritativeFrozenCandidates(options.frozenCandidatesPath);
  const { evaluationPanel } = resolveSeedsAndPanel();

  const gamesPerOpp = options.gamesPerOpp ?? 1;
  const gamesPerCellFinal = options.gamesPerCellFinal ?? 1;
  const baseSearchSeed = options.baseSearchSeed ?? 5000;
  const baseValidationSeed = options.baseValidationSeed ?? 15000;
  const baseFinalEvalSeed = options.baseFinalEvalSeed ?? 25000;

  const panelManifest = {
    cycleType: 'sequential_frozen_tree_optimization',
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
  };
  writeFileSync(join(outputDir, 'panel_manifest.json'), JSON.stringify(panelManifest, null, 2), 'utf8');

  // 1. 构建外层 Candidate 并发任务
  const tasks: CandidateOptimizationTask[] = rawCandidates.map((c, idx) =>
    buildCandidateTask(c, idx, evaluationPanel, {
      gamesPerOpp,
      baseSearchSeed,
      baseValidationSeed,
      isolatedOutputDir: outputDir,
    }),
  );

  options.onProgress?.('OPTIMIZATION_DISPATCH_START', { taskCount: tasks.length });

  // 2. 并行调度树优化
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

  // 3. 独立最终评估与质量决策判定
  const BundleAI = loadBundle();
  const evaluations: CandidateIndependentEval[] = [];
  const failureDiagnosesCount: Record<string, number> = {
    'deck_weakness (<25% undefeated)': 0,
    'optimizer_no_op (no valid split/ig)': 0,
    'validation_rejection (<5% gain or loss increased)': 0,
    'independent_regression (final < baseline)': 0,
    'weakest_cell_weakness (<40% weakest)': 0,
    'worker_error': 0,
  };

  const qualifyingCandidates: any[] = [];

  for (let i = 0; i < rawCandidates.length; i++) {
    const raw = rawCandidates[i];
    const optRes = poolReport.results[i];
    const candFinalSeed = baseFinalEvalSeed + i * 500;

    // 构造 baseline tree
    const baselineForm: EvolFormation = {
      name: raw.candidateId,
      archetype: raw.archPath || 'prayer',
      team: raw.team,
      root: raw.tree,
    };

    // 独立评估 baseline
    const baseEval = evaluateFormationOnPanel(BundleAI, baselineForm, evaluationPanel, candFinalSeed, gamesPerCellFinal);

    // 构造 final tree (若 improved 则使用 optRes.resultTree，否则使用 baseline)
    const finalForm: EvolFormation = {
      name: raw.candidateId,
      archetype: raw.archPath || 'prayer',
      team: raw.team,
      root: (optRes?.status === 'IMPROVED' && optRes.resultTree) ? optRes.resultTree : raw.tree,
    };

    // 独立评估 final
    const finalEval = evaluateFormationOnPanel(BundleAI, finalForm, evaluationPanel, candFinalSeed, gamesPerCellFinal);

    const undefeatedDelta = finalEval.undefeated - baseEval.undefeated;
    const weakestCellDelta = finalEval.weakestCell - baseEval.weakestCell;

    // 分类判定
    let classification: 'tree_optimized_candidate' | 'deck_only_candidate' | 'archive' = 'deck_only_candidate';
    let diagnosis = '';

    if (optRes.status === 'ERROR') {
      classification = 'archive';
      diagnosis = 'worker_error';
      failureDiagnosesCount['worker_error']++;
    } else if (finalEval.undefeated < 0.25) {
      classification = 'archive';
      diagnosis = 'deck_weakness (<25% undefeated)';
      failureDiagnosesCount['deck_weakness (<25% undefeated)']++;
    } else if (optRes.status === 'IMPROVED' && undefeatedDelta >= -1e-6 && weakestCellDelta >= -1e-6) {
      classification = 'tree_optimized_candidate';
    } else {
      classification = 'deck_only_candidate';
      if (optRes.status === 'NO_IMPROVEMENT') {
        diagnosis = 'optimizer_no_op (no valid split/ig)';
        failureDiagnosesCount['optimizer_no_op (no valid split/ig)']++;
      } else if (undefeatedDelta < -1e-6 || weakestCellDelta < -1e-6) {
        diagnosis = 'independent_regression (final < baseline)';
        failureDiagnosesCount['independent_regression (final < baseline)']++;
      } else {
        diagnosis = 'validation_rejection (<5% gain or loss increased)';
        failureDiagnosesCount['validation_rejection (<5% gain or loss increased)']++;
      }
    }

    // 质量门禁判定: aggregate >= 0.60 且 weakest >= 0.40 且 (medium/heavy novelty)
    const noveltyScore = raw.mutationVector?.noveltyScore ?? 0;
    const noveltyBucket = raw.mutationVector?.direction?.mutationBucket ?? 'low';
    const isHighNovelty = noveltyBucket === 'medium' || noveltyBucket === 'heavy' || noveltyScore >= 0.4;
    const qualifiesQualityGate = (classification === 'tree_optimized_candidate')
      && (finalEval.undefeated >= 0.60)
      && (finalEval.weakestCell >= 0.40)
      && isHighNovelty;

    if (qualifiesQualityGate) {
      qualifyingCandidates.push({
        candidateId: raw.candidateId,
        sourceSeedIndex: raw.sourceSeedIndex,
        sourceSeedName: raw.sourceSeedName,
        modulePath: raw.modulePath,
        noveltyScore,
        noveltyBucket,
        finalUndefeated: finalEval.undefeated,
        weakestCell: finalEval.weakestCell,
        undefeatedDelta,
        forkRound: optRes.forkRound,
        maskLabel: optRes.maskLabel,
      });
    } else if (classification === 'tree_optimized_candidate' && finalEval.weakestCell < 0.40) {
      failureDiagnosesCount['weakest_cell_weakness (<40% weakest)']++;
    }

    evaluations.push({
      candidateIndex: i,
      candidateId: raw.candidateId,
      sourceSeedIndex: raw.sourceSeedIndex ?? 0,
      sourceSeedName: raw.sourceSeedName ?? 'Unknown',
      sourceSeedId: raw.sourceSeedId ?? 'unknown',
      archPath: raw.archPath,
      modulePath: raw.modulePath,
      noveltyScore,
      noveltyBucket,
      classification,
      failureDiagnosis: diagnosis || undefined,
      optimizerResult: {
        status: optRes.status,
        improved: optRes.improved,
        durationMs: optRes.durationMs,
        forkRound: optRes.forkRound,
        maskLabel: optRes.maskLabel,
        searchSeedBase: optRes.searchSeedBase,
        validationSeedBase: optRes.validationSeedBase,
        error: optRes.error,
      },
      baselineEval: baseEval,
      finalEval: finalEval,
      deltas: {
        undefeatedDelta,
        weakestCellDelta,
      },
      qualifiesQualityGate,
    });
  }

  // 写入 independent_final_evaluation.jsonl
  writeFileSync(
    join(outputDir, 'independent_final_evaluation.jsonl'),
    evaluations.map(e => JSON.stringify(e)).join('\n') + (evaluations.length ? '\n' : ''),
    'utf8',
  );

  // 4. 汇总质量决策
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

  // 5. 写入 summary.md
  let summaryMd = `# Sequential Frozen Candidate Tree Optimization Summary (T019)\n\n`;
  summaryMd += `## 1. Quality Decision Overview\n`;
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

  summaryMd += `\n## 2. Resource & Worker Evidence\n`;
  summaryMd += `- **Requested Workers**: ${panelManifest.workerConfig.requestedWorkers}\n`;
  summaryMd += `- **Effective Workers**: ${panelManifest.workerConfig.effectiveWorkers} (Host CPUs: ${panelManifest.workerConfig.availableLogicalCpus})\n`;
  summaryMd += `- **Peak Active Workers**: ${poolReport.peakActiveWorkers}\n`;
  summaryMd += `- **Total Duration**: ${(poolReport.totalDurationMs / 1000).toFixed(1)}s\n`;

  writeFileSync(join(outputDir, 'summary.md'), summaryMd, 'utf8');

  return {
    panelManifest,
    poolReport,
    evaluations,
    qualityDecision,
    outputDir,
  };
}
