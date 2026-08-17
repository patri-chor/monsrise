import '../env';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import os from 'node:os';
import { FORMATION_LIBRARY } from '../../ai/formation_library';
import type { Formation } from '../../ai/types';
import type { EvolFormation } from './evol_gene';
import { formationToEvol } from './evol_gene';
import {
  buildCandidateTask,
  runCandidateOptimizationPool,
  resolveCandidateWorkers,
  resolveEvaluationPanel,
  type CandidateOptimizationTask,
  type CandidateOptimizationResult,
  type CandidatePoolRunReport,
} from './candidate_optimization_runner';
import { playSpecVsSpec, type SideSpec } from './arena';
import {
  loadBundle,
  type BranchInductionOutcome,
  type TargetCellInfo,
  type SearchOperatorStats,
} from './branch_induct';
import { PersistentSimPool } from './persistent_pool';
import type { SimTaskMessage } from './fine_grained_worker';
import { calculateMatchMetrics, formatMatchMetrics, type MatchMetrics } from './match_metrics';

export const SEQUENTIAL_TREE_OPT_DIR = resolve('reports/new-formation-generation/sequential-tree-optimization');

export interface CellEvaluation {
  opponentIndex: number;
  opponentName: string;
  side: 1 | 2;
  w: number;
  d: number;
  l: number;
  total: number;
  trainingScore: number;
  pureWinRate: number;
  undefeatedRate: number;
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
    status: BranchInductionOutcome;
    improved: boolean;
    durationMs: number;
    forkRound?: number;
    maskLabel?: string;
    searchSeedBase: number;
    validationSeedBase: number;
    beforeMetrics?: MatchMetrics;
    afterMetrics?: MatchMetrics;
    targetPoolDiagnostics?: {
      targetPoolCount: number;
      cells: TargetCellInfo[];
    };
    searchOperatorStats?: SearchOperatorStats;
    error?: string;
  };
  baselineEval: {
    w: number;
    d: number;
    l: number;
    total: number;
    trainingScore: number;
    pureWinRate: number;
    undefeatedRate: number;
    weakestCell: number;
    weakestCellInfo?: CellEvaluation;
    cells: CellEvaluation[];
  };
  finalEval: {
    w: number;
    d: number;
    l: number;
    total: number;
    trainingScore: number;
    pureWinRate: number;
    undefeatedRate: number;
    weakestCell: number;
    weakestCellInfo?: CellEvaluation;
    cells: CellEvaluation[];
  };
  deltas: {
    trainingScoreDelta: number;
    weakestCellDelta: number;
    undefeatedDelta: number;
  };
  qualifiesQualityGate: boolean;
}

export interface QualityDecisionPayload {
  decision: 'CONTINUE_VARIANT_PRODUCTION' | 'ALGORITHM_IMPROVEMENT_REQUIRED';
  timestamp: string;
  candidateCount: number;
  seedDistribution: Record<string, number>;
  breakdown: {
    treeOptimizedCount: number;
    deckOnlyCount: number;
    archiveCount: number;
    qualifyingCandidatesCount: number;
  };
  outcomeCounts: Record<BranchInductionOutcome, number>;
  searchOperatorAggregate: {
    totalInDeckCandidates: number;
    totalExternalCandidates: number;
    totalRejectedByConstraints: number;
    totalOpeningCandidates: number;
    totalAcceptedExternalReplacements: number;
  };
  qualifyingCandidates: any[];
  failureDiagnosesSummary: Record<string, number>;
  dominantFailureMode?: string;
  proposedNextDirection: string;
}

export function loadAuthoritativeFrozenCandidates(customPath?: string): any[] {
  const possiblePaths = [
    customPath ? resolve(customPath) : null,
    resolve('tests/fixtures/tree/eight_frozen_candidates.jsonl'),
    resolve('tests/fixtures/tree/four_frozen_candidates.jsonl'),
    resolve('reports/new-formation-generation/first-four-cycle/generated_candidates.jsonl'),
  ].filter(Boolean) as string[];

  for (const targetPath of possiblePaths) {
    if (existsSync(targetPath)) {
      const content = readFileSync(targetPath, 'utf8');
      return content.trim().split('\n').filter(l => l.trim().length > 0).map(l => JSON.parse(l));
    }
  }

  throw new Error(`Authoritative candidates file not found in any of: ${possiblePaths.join(', ')}`);
}

export function evaluateFormationOnPanel(
  BundleAI: any,
  formation: EvolFormation,
  panel: Formation[],
  candFinalSeed: number,
  gamesPerCellFinal: number = 5,
): {
  w: number;
  d: number;
  l: number;
  total: number;
  trainingScore: number;
  pureWinRate: number;
  undefeatedRate: number;
  weakestCell: number;
  weakestCellInfo?: CellEvaluation;
  cells: CellEvaluation[];
} {
  if (gamesPerCellFinal < 3) {
    throw new Error(`[Configuration Error] gamesPerCellFinal (${gamesPerCellFinal}) is less than minimum statistically valid threshold (3). Weakest-cell evidence requires at least 3 games per cell.`);
  }

  const specA: SideSpec = { kind: 'evol', f: formation };
  const cells: CellEvaluation[] = [];

  let totalW = 0, totalD = 0, totalL = 0;
  let weakest = 1.0;
  let weakestCellInfo: CellEvaluation | undefined = undefined;

  for (let oppIdx = 0; oppIdx < panel.length; oppIdx++) {
    const opp = panel[oppIdx];
    const specB: SideSpec = { kind: 'native', f: opp };

    for (const side of [1, 2] as (1 | 2)[]) {
      let cellW = 0, cellD = 0, cellL = 0;
      for (let g = 0; g < gamesPerCellFinal; g++) {
        const seed = candFinalSeed + oppIdx * 20 + side * 10 + g;
        const r = playSpecVsSpec(BundleAI, specA, specB, side, seed);
        cellW += r.w;
        cellD += r.d;
        cellL += r.l;
        totalW += r.w;
        totalD += r.d;
        totalL += r.l;
      }

      const cellTotal = cellW + cellD + cellL;
      const metrics = calculateMatchMetrics(cellW, cellD, cellL);

      const cell: CellEvaluation = {
        opponentIndex: oppIdx,
        opponentName: opp.name,
        side,
        w: cellW,
        d: cellD,
        l: cellL,
        total: cellTotal,
        trainingScore: metrics.trainingScore,
        pureWinRate: metrics.pureWinRate,
        undefeatedRate: metrics.undefeatedRate,
      };

      if (metrics.trainingScore < weakest || !weakestCellInfo) {
        weakest = metrics.trainingScore;
        weakestCellInfo = cell;
      }

      cells.push(cell);
    }
  }

  const grandMetrics = calculateMatchMetrics(totalW, totalD, totalL);

  return {
    w: totalW,
    d: totalD,
    l: totalL,
    total: grandMetrics.total,
    trainingScore: grandMetrics.trainingScore,
    pureWinRate: grandMetrics.pureWinRate,
    undefeatedRate: grandMetrics.undefeatedRate,
    weakestCell: grandMetrics.total > 0 ? weakest : 0,
    weakestCellInfo,
    cells,
  };
}

export interface EvaluationTask {
  candidateIndex: number;
  rawCandidate: any;
  optRes: CandidateOptimizationResult;
  evaluationPanel: Formation[];
  candFinalSeed: number;
  gamesPerCellFinal: number;
}

export async function executeSingleCandidateIndependentEval(
  task: EvaluationTask,
  BundleAI?: any,
): Promise<CandidateIndependentEval> {
  const ai = BundleAI ?? loadBundle();
  const raw = task.rawCandidate;
  const optRes = task.optRes;
  const evaluationPanel = task.evaluationPanel;
  const candFinalSeed = task.candFinalSeed;
  const gamesPerCellFinal = task.gamesPerCellFinal;

  if (gamesPerCellFinal < 3) {
    throw new Error(`[Configuration Error] gamesPerCellFinal (${gamesPerCellFinal}) is less than minimum statistically valid threshold (3).`);
  }

  const baselineForm: EvolFormation = {
    name: raw.candidateId,
    archetype: raw.archPath || 'prayer',
    team: raw.team,
    root: raw.tree,
  };

  const baseEval = evaluateFormationOnPanel(ai, baselineForm, evaluationPanel, candFinalSeed, gamesPerCellFinal);

  const finalForm: EvolFormation = {
    name: raw.candidateId,
    archetype: raw.archPath || 'prayer',
    team: raw.team,
    root: (optRes?.status === 'IMPROVED' && optRes.resultTree) ? optRes.resultTree : raw.tree,
  };

  const finalEval = evaluateFormationOnPanel(ai, finalForm, evaluationPanel, candFinalSeed, gamesPerCellFinal);

  const trainingScoreDelta = finalEval.trainingScore - baseEval.trainingScore;
  const weakestCellDelta = finalEval.weakestCell - baseEval.weakestCell;
  const undefeatedDelta = finalEval.undefeatedRate - baseEval.undefeatedRate;

  let classification: 'tree_optimized_candidate' | 'deck_only_candidate' | 'archive' = 'deck_only_candidate';
  let diagnosis = '';

  if (optRes.status === 'ERROR') {
    classification = 'archive';
    diagnosis = `worker_error: ${optRes.error || 'Unknown error'}`;
  } else if (finalEval.trainingScore < 0.25) {
    classification = 'archive';
    diagnosis = 'deck_weakness (<25% training score)';
  } else if (optRes.status === 'IMPROVED' && trainingScoreDelta >= -1e-6 && weakestCellDelta >= -1e-6) {
    classification = 'tree_optimized_candidate';
  } else {
    classification = 'deck_only_candidate';
    if (optRes.status === 'NO_INFORMATIVE_SPLIT') {
      diagnosis = 'optimizer_no_informative_split (IG=0)';
    } else if (optRes.status === 'NO_OBSERVED_TRIGGER_AT_FORK') {
      diagnosis = 'optimizer_no_trigger_at_fork';
    } else if (optRes.status === 'BRANCH_SEARCH_NO_TRAINING_GAIN') {
      diagnosis = 'branch_search_no_training_gain';
    } else if (optRes.status === 'VALIDATION_TRAINING_REJECTED') {
      diagnosis = 'validation_training_rejected (<5% gain or loss increased)';
    } else if (trainingScoreDelta < -1e-6 || weakestCellDelta < -1e-6) {
      diagnosis = 'independent_regression (final < baseline)';
    } else {
      diagnosis = 'validation_training_rejected';
    }
  }

  const noveltyScore = raw.mutationVector?.noveltyScore ?? 0;
  const noveltyBucket = raw.mutationVector?.direction?.mutationBucket ?? 'low';
  const isHighNovelty = noveltyBucket === 'medium' || noveltyBucket === 'heavy' || noveltyScore >= 0.4;
  const qualifiesQualityGate = (classification === 'tree_optimized_candidate')
    && (finalEval.trainingScore >= 0.60)
    && (finalEval.weakestCell >= 0.40)
    && isHighNovelty;

  return {
    candidateIndex: task.candidateIndex,
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
      beforeMetrics: optRes.beforeMetrics,
      afterMetrics: optRes.afterMetrics,
      targetPoolDiagnostics: optRes.targetPoolDiagnostics,
      searchOperatorStats: optRes.searchOperatorStats,
      error: optRes.error,
    },
    baselineEval: baseEval,
    finalEval: finalEval,
    deltas: {
      trainingScoreDelta,
      weakestCellDelta,
      undefeatedDelta,
    },
    qualifiesQualityGate,
  };
}

export async function runParallelIndependentEvaluation(
  tasks: EvaluationTask[],
  options: {
    requestedWorkers?: number;
    workerExecutor?: (task: EvaluationTask) => Promise<CandidateIndependentEval>;
    onProgress?: (completed: number, total: number, result: CandidateIndependentEval) => void;
    pool?: PersistentSimPool;
  } = {},
): Promise<{
  evaluations: CandidateIndependentEval[];
  peakActiveWorkers: number;
  totalDurationMs: number;
  workerConfig: any;
}> {
  const startTime = Date.now();
  const workerInfo = resolveCandidateWorkers(options.requestedWorkers, tasks.length);

  if (tasks.length === 0) {
    return {
      evaluations: [],
      peakActiveWorkers: 0,
      totalDurationMs: 0,
      workerConfig: workerInfo,
    };
  }

  for (const t of tasks) {
    if (t.gamesPerCellFinal < 3) {
      throw new Error(`[Configuration Error] gamesPerCellFinal (${t.gamesPerCellFinal}) is less than minimum statistically valid threshold (3).`);
    }
  }

  if (options.workerExecutor) {
    const effectiveLimit = workerInfo.effectiveWorkers;
    const evaluations: CandidateIndependentEval[] = new Array(tasks.length);
    let activeWorkers = 0;
    let peakActiveWorkers = 0;
    let nextTaskIndex = 0;
    let completedCount = 0;
    const executor = options.workerExecutor;

    return new Promise((resolvePool) => {
      function dispatch() {
        while (activeWorkers < effectiveLimit && nextTaskIndex < tasks.length) {
          const taskIdx = nextTaskIndex++;
          const task = tasks[taskIdx];
          activeWorkers++;
          if (activeWorkers > peakActiveWorkers) {
            peakActiveWorkers = activeWorkers;
          }

          executor(task)
            .then((res) => {
              evaluations[taskIdx] = res;
              completedCount++;
              options.onProgress?.(completedCount, tasks.length, res);
            })
            .catch((err) => {
              evaluations[taskIdx] = {
                candidateIndex: task.candidateIndex,
                candidateId: task.rawCandidate.candidateId,
                sourceSeedIndex: task.rawCandidate.sourceSeedIndex ?? 0,
                sourceSeedName: task.rawCandidate.sourceSeedName ?? 'Unknown',
                sourceSeedId: task.rawCandidate.sourceSeedId ?? 'unknown',
                archPath: task.rawCandidate.archPath,
                modulePath: task.rawCandidate.modulePath,
                noveltyScore: task.rawCandidate.mutationVector?.noveltyScore ?? 0,
                noveltyBucket: task.rawCandidate.mutationVector?.direction?.mutationBucket ?? 'low',
                classification: 'archive',
                failureDiagnosis: `worker_error: ${err?.message || String(err)}`,
                optimizerResult: {
                  status: 'ERROR',
                  improved: false,
                  durationMs: 0,
                  searchSeedBase: task.optRes.searchSeedBase,
                  validationSeedBase: task.optRes.validationSeedBase,
                  error: err?.message || String(err),
                },
                baselineEval: { w: 0, d: 0, l: 0, total: 0, trainingScore: 0, pureWinRate: 0, undefeatedRate: 0, weakestCell: 0, cells: [] },
                finalEval: { w: 0, d: 0, l: 0, total: 0, trainingScore: 0, pureWinRate: 0, undefeatedRate: 0, weakestCell: 0, cells: [] },
                deltas: { trainingScoreDelta: 0, weakestCellDelta: 0, undefeatedDelta: 0 },
                qualifiesQualityGate: false,
              };
              completedCount++;
            })
            .finally(() => {
              activeWorkers--;
              if (completedCount === tasks.length) {
                resolvePool({
                  evaluations,
                  peakActiveWorkers,
                  totalDurationMs: Date.now() - startTime,
                  workerConfig: workerInfo,
                });
              } else {
                dispatch();
              }
            });
        }
      }
      dispatch();
    });
  }

  const pool = options.pool ?? PersistentSimPool.getInstance();
  const simTasks: SimTaskMessage[] = [];
  let simTaskId = 0;

  interface SimMeta {
    taskIdx: number;
    kind: 'baseline' | 'final';
    oppIdx: number;
    oppName: string;
    side: 1 | 2;
  }
  const metaList: SimMeta[] = [];

  for (let tIdx = 0; tIdx < tasks.length; tIdx++) {
    const task = tasks[tIdx];
    const raw = task.rawCandidate;
    const optRes = task.optRes;

    const baselineForm: EvolFormation = {
      name: raw.candidateId,
      archetype: raw.archPath || 'prayer',
      team: raw.team,
      root: raw.tree,
    };

    const finalForm: EvolFormation = {
      name: raw.candidateId,
      archetype: raw.archPath || 'prayer',
      team: raw.team,
      root: (optRes?.status === 'IMPROVED' && optRes.resultTree) ? optRes.resultTree : raw.tree,
    };

    const forms: Array<{ kind: 'baseline' | 'final'; form: EvolFormation }> = [
      { kind: 'baseline', form: baselineForm },
      { kind: 'final', form: finalForm },
    ];

    for (const fItem of forms) {
      for (let oppIdx = 0; oppIdx < task.evaluationPanel.length; oppIdx++) {
        const opp = task.evaluationPanel[oppIdx];
        for (const side of [1, 2] as (1 | 2)[]) {
          const id = simTaskId++;
          simTasks.push({
            taskId: id,
            formationA: fItem.form,
            opponentNameOrId: opp.id ?? opp.name,
            side,
            seed: task.candFinalSeed + oppIdx * 20 + side * 10,
            games: task.gamesPerCellFinal,
          });
          metaList.push({
            taskIdx: tIdx,
            kind: fItem.kind,
            oppIdx,
            oppName: opp.name,
            side,
          });
        }
      }
    }
  }

  const simResults = await pool.dispatchTasks(simTasks);
  const evaluations: CandidateIndependentEval[] = [];

  for (let tIdx = 0; tIdx < tasks.length; tIdx++) {
    const task = tasks[tIdx];
    const raw = task.rawCandidate;
    const optRes = task.optRes;

    const baseCells: CellEvaluation[] = [];
    const finalCells: CellEvaluation[] = [];

    for (let sIdx = 0; sIdx < simResults.length; sIdx++) {
      const meta = metaList[sIdx];
      if (meta.taskIdx !== tIdx) continue;
      const res = simResults[sIdx];
      const metrics = calculateMatchMetrics(res.w, res.d, res.l);
      const cell: CellEvaluation = {
        opponentIndex: meta.oppIdx,
        opponentName: meta.oppName,
        side: meta.side,
        w: res.w,
        d: res.d,
        l: res.l,
        total: metrics.total,
        trainingScore: metrics.trainingScore,
        pureWinRate: metrics.pureWinRate,
        undefeatedRate: metrics.undefeatedRate,
      };
      if (meta.kind === 'baseline') {
        baseCells.push(cell);
      } else {
        finalCells.push(cell);
      }
    }

    const calcSummary = (cells: CellEvaluation[]) => {
      let tw = 0, td = 0, tl = 0, weakest = 1.0;
      let weakestCellInfo: CellEvaluation | undefined = undefined;
      for (const c of cells) {
        tw += c.w;
        td += c.d;
        tl += c.l;
        if (c.trainingScore < weakest || !weakestCellInfo) {
          weakest = c.trainingScore;
          weakestCellInfo = c;
        }
      }
      const grandMetrics = calculateMatchMetrics(tw, td, tl);
      return {
        w: tw,
        d: td,
        l: tl,
        total: grandMetrics.total,
        trainingScore: grandMetrics.trainingScore,
        pureWinRate: grandMetrics.pureWinRate,
        undefeatedRate: grandMetrics.undefeatedRate,
        weakestCell: grandMetrics.total > 0 ? weakest : 0,
        weakestCellInfo,
        cells,
      };
    };

    const baseEval = calcSummary(baseCells);
    const finalEval = calcSummary(finalCells);

    const trainingScoreDelta = finalEval.trainingScore - baseEval.trainingScore;
    const weakestCellDelta = finalEval.weakestCell - baseEval.weakestCell;
    const undefeatedDelta = finalEval.undefeatedRate - baseEval.undefeatedRate;

    let classification: 'tree_optimized_candidate' | 'deck_only_candidate' | 'archive' = 'deck_only_candidate';
    let diagnosis = '';

    if (optRes.status === 'ERROR') {
      classification = 'archive';
      diagnosis = `worker_error: ${optRes.error || 'Unknown error'}`;
    } else if (finalEval.trainingScore < 0.25) {
      classification = 'archive';
      diagnosis = 'deck_weakness (<25% training score)';
    } else if (optRes.status === 'IMPROVED' && trainingScoreDelta >= -1e-6 && weakestCellDelta >= -1e-6) {
      classification = 'tree_optimized_candidate';
    } else {
      classification = 'deck_only_candidate';
      if (optRes.status === 'NO_INFORMATIVE_SPLIT') {
        diagnosis = 'optimizer_no_informative_split (IG=0)';
      } else if (optRes.status === 'NO_OBSERVED_TRIGGER_AT_FORK') {
        diagnosis = 'optimizer_no_trigger_at_fork';
      } else if (optRes.status === 'BRANCH_SEARCH_NO_TRAINING_GAIN') {
        diagnosis = 'branch_search_no_training_gain';
      } else if (optRes.status === 'VALIDATION_TRAINING_REJECTED') {
        diagnosis = 'validation_training_rejected (<5% gain or loss increased)';
      } else if (trainingScoreDelta < -1e-6 || weakestCellDelta < -1e-6) {
        diagnosis = 'independent_regression (final < baseline)';
      } else {
        diagnosis = 'validation_training_rejected';
      }
    }

    const noveltyScore = raw.mutationVector?.noveltyScore ?? 0;
    const noveltyBucket = raw.mutationVector?.direction?.mutationBucket ?? 'low';
    const isHighNovelty = noveltyBucket === 'medium' || noveltyBucket === 'heavy' || noveltyScore >= 0.4;
    const qualifiesQualityGate = (classification === 'tree_optimized_candidate')
      && (finalEval.trainingScore >= 0.60)
      && (finalEval.weakestCell >= 0.40)
      && isHighNovelty;

    const evalResult: CandidateIndependentEval = {
      candidateIndex: task.candidateIndex,
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
        beforeMetrics: optRes.beforeMetrics,
        afterMetrics: optRes.afterMetrics,
        targetPoolDiagnostics: optRes.targetPoolDiagnostics,
        searchOperatorStats: optRes.searchOperatorStats,
        error: optRes.error,
      },
      baselineEval: baseEval,
      finalEval: finalEval,
      deltas: {
        trainingScoreDelta,
        weakestCellDelta,
        undefeatedDelta,
      },
      qualifiesQualityGate,
    };

    evaluations.push(evalResult);
    options.onProgress?.(tIdx + 1, tasks.length, evalResult);
  }

  return {
    evaluations,
    peakActiveWorkers: pool.workerCount,
    totalDurationMs: Date.now() - startTime,
    workerConfig: workerInfo,
  };
}

export async function runSequentialTreeOptimizationCycle(options: {
  outputDir?: string;
  frozenCandidatesPath?: string;
  requestedWorkers?: number;
  gamesPerOpp?: number;
  gamesPerCellFinal?: number;
  baseSearchSeed?: number;
  baseValidationSeed?: number;
  baseFinalEvalSeed?: number;
  maxCandidates?: number;
  pool?: PersistentSimPool;
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
  let rawCandidates = loadAuthoritativeFrozenCandidates(options.frozenCandidatesPath);
  if (options.maxCandidates && options.maxCandidates > 0) {
    rawCandidates = rawCandidates.slice(0, options.maxCandidates);
  }

  const evaluationPanel = resolveEvaluationPanel();

  const gamesPerOpp = options.gamesPerOpp ?? 1;
  const gamesPerCellFinal = options.gamesPerCellFinal ?? 5;
  if (gamesPerCellFinal < 3) {
    throw new Error(`[Configuration Error] gamesPerCellFinal (${gamesPerCellFinal}) is less than minimum statistically valid threshold (3). Weakest-cell evidence requires at least 3 games per cell.`);
  }

  const baseSearchSeed = options.baseSearchSeed ?? 5000;
  const baseValidationSeed = options.baseValidationSeed ?? 20000;
  const baseFinalEvalSeed = options.baseFinalEvalSeed ?? 35000;
  const pool = options.pool ?? PersistentSimPool.getInstance();

  // 统计 Seed 分布
  const seedDistribution: Record<string, number> = {};
  for (const c of rawCandidates) {
    const sKey = `s${(c.sourceSeedIndex ?? 0) + 1}`;
    seedDistribution[sKey] = (seedDistribution[sKey] ?? 0) + 1;
  }

  const panelManifest = {
    cycleType: 'cross_seed_branch_deck_opening_optimization',
    startedAt,
    candidateCount: rawCandidates.length,
    seedDistribution,
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

  // 1. 构建候选树优化任务
  const tasks: CandidateOptimizationTask[] = rawCandidates.map((c, idx) =>
    buildCandidateTask(c, idx, evaluationPanel, {
      gamesPerOpp,
      baseSearchSeed,
      baseValidationSeed,
    }),
  );

  options.onProgress?.('OPTIMIZATION_START', { taskCount: tasks.length });

  // 2. 并行调度树优化
  const poolReport = await runCandidateOptimizationPool(tasks, {
    requestedWorkers: options.requestedWorkers ?? 16,
    pool,
    onProgress: (comp, total, res) => {
      options.onProgress?.('OPTIMIZATION_PROGRESS', { completed: comp, total, result: res });
    },
  });

  writeFileSync(
    join(outputDir, 'optimization_results.jsonl'),
    poolReport.results.map(r => JSON.stringify(r)).join('\n') + (poolReport.results.length ? '\n' : ''),
    'utf8',
  );

  options.onProgress?.('INDEPENDENT_EVAL_START', { candidateCount: rawCandidates.length });

  // 3. 并发执行独立最终评估
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
    pool,
    onProgress: (comp, total, res) => {
      options.onProgress?.('EVALUATION_PROGRESS', { completed: comp, total, result: res });
    },
  });

  const evaluations = evalReport.evaluations;

  writeFileSync(
    join(outputDir, 'independent_final_evaluation.jsonl'),
    evaluations.map(e => JSON.stringify(e)).join('\n') + (evaluations.length ? '\n' : ''),
    'utf8',
  );

  // 4. 汇总算子统计与质量决策
  const searchOperatorAggregate = {
    totalInDeckCandidates: 0,
    totalExternalCandidates: 0,
    totalRejectedByConstraints: 0,
    totalOpeningCandidates: 0,
    totalAcceptedExternalReplacements: 0,
  };

  for (const r of poolReport.results) {
    if (r.searchOperatorStats) {
      searchOperatorAggregate.totalInDeckCandidates += r.searchOperatorStats.inDeckCandidates;
      searchOperatorAggregate.totalExternalCandidates += r.searchOperatorStats.externalCandidates;
      searchOperatorAggregate.totalRejectedByConstraints += r.searchOperatorStats.rejectedByConstraintCandidates;
      searchOperatorAggregate.totalOpeningCandidates += r.searchOperatorStats.openingCandidates;
      searchOperatorAggregate.totalAcceptedExternalReplacements += r.searchOperatorStats.acceptedExternalReplacements;
    }
  }

  const failureDiagnosesCount: Record<string, number> = {
    'deck_weakness (<25% training score)': 0,
    'optimizer_no_informative_split (IG=0)': 0,
    'optimizer_no_trigger_at_fork': 0,
    'branch_search_no_training_gain': 0,
    'validation_training_rejected (<5% gain or loss increased)': 0,
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
        finalTrainingScore: e.finalEval.trainingScore,
        weakestCellScore: e.finalEval.weakestCell,
        weakestCellOpponent: e.finalEval.weakestCellInfo?.opponentName ?? 'N/A',
        weakestCellSide: e.finalEval.weakestCellInfo?.side ?? 1,
        trainingScoreDelta: e.deltas.trainingScoreDelta,
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
    seedDistribution,
    breakdown: {
      treeOptimizedCount,
      deckOnlyCount,
      archiveCount,
      qualifyingCandidatesCount: qualifyingCandidates.length,
    },
    outcomeCounts: poolReport.outcomeCounts,
    searchOperatorAggregate,
    qualifyingCandidates,
    failureDiagnosesSummary: failureDiagnosesCount,
    dominantFailureMode: passesCycleGate ? undefined : dominantFailureEntry?.[0],
    proposedNextDirection: passesCycleGate
      ? 'Expand variant production to next batch of candidate seeds'
      : `Address dominant failure mode '${dominantFailureEntry?.[0]}' via targeted tree branch induction / split refinement`,
  };

  writeFileSync(join(outputDir, 'quality_decision.json'), JSON.stringify(qualityDecision, null, 2), 'utf8');

  // 5. 写入 summary.md
  let summaryMd = `# Cross-Seed Branch, Deck, and Opening Optimization Summary (T011)\n\n`;
  summaryMd += `## 1. Balanced Seed Distribution & Quality Overview\n`;
  summaryMd += `- **Decision**: \`${qualityDecision.decision}\`\n`;
  summaryMd += `- **Candidates Processed**: **${evaluations.length}**\n`;
  summaryMd += `- **Seed Distribution**: ${Object.entries(seedDistribution).map(([k, v]) => `\`${k}\`: ${v}`).join(', ')}\n`;
  summaryMd += `- **Final Games Per Cell**: **${gamesPerCellFinal}** (>=3 threshold satisfied)\n`;
  summaryMd += `- **Breakdown**:\n`;
  summaryMd += `  - \`tree_optimized_candidate\`: **${treeOptimizedCount}**\n`;
  summaryMd += `  - \`deck_only_candidate\`: **${deckOnlyCount}**\n`;
  summaryMd += `  - \`archive\`: **${archiveCount}**\n`;
  summaryMd += `  - **Qualifying Gate Candidates**: **${qualifyingCandidates.length}**\n\n`;

  summaryMd += `## 2. Search Operators & Deck Exploration Statistics\n`;
  summaryMd += `- **In-Deck Replacement Candidates Evaluated**: **${searchOperatorAggregate.totalInDeckCandidates}**\n`;
  summaryMd += `- **External Deck Candidates Evaluated**: **${searchOperatorAggregate.totalExternalCandidates}**\n`;
  summaryMd += `- **Candidates Rejected by Constraints (Cost/Deck/Legality)**: **${searchOperatorAggregate.totalRejectedByConstraints}**\n`;
  summaryMd += `- **Early Opening Mutation Candidates Evaluated**: **${searchOperatorAggregate.totalOpeningCandidates}**\n`;
  summaryMd += `- **Accepted External Replacements**: **${searchOperatorAggregate.totalAcceptedExternalReplacements}**\n\n`;

  summaryMd += `## 3. Optimizer Detailed Outcome Distribution\n`;
  summaryMd += `| Outcome Category | Count | Interpretation |\n`;
  summaryMd += `|---|---|---|\n`;
  summaryMd += `| \`IMPROVED\` | ${poolReport.outcomeCounts.IMPROVED} | Verified gain >= 5% in training score with no loss increase |\n`;
  summaryMd += `| \`NO_INFORMATIVE_SPLIT\` | ${poolReport.outcomeCounts.NO_INFORMATIVE_SPLIT} | No feature split yielded information gain > 0 |\n`;
  summaryMd += `| \`NO_OBSERVED_TRIGGER_AT_FORK\` | ${poolReport.outcomeCounts.NO_OBSERVED_TRIGGER_AT_FORK} | Candidate side/fork round observed no matching panel opponents |\n`;
  summaryMd += `| \`BRANCH_SEARCH_NO_TRAINING_GAIN\` | ${poolReport.outcomeCounts.BRANCH_SEARCH_NO_TRAINING_GAIN} | Tree search space yielded no training score improvement |\n`;
  summaryMd += `| \`VALIDATION_TRAINING_REJECTED\` | ${poolReport.outcomeCounts.VALIDATION_TRAINING_REJECTED} | Independent validation score did not reach +5% gain or loss worsened |\n`;
  summaryMd += `| \`ERROR\` | ${poolReport.outcomeCounts.ERROR} | Execution exception/worker failure |\n\n`;

  if (passesCycleGate) {
    summaryMd += `### Qualifying Candidates Evidence\n`;
    summaryMd += `| Candidate ID | Source Seed | Module | Novelty | Final Training Score | Weakest Cell (Opponent / Side) | Delta |\n`;
    summaryMd += `|---|---|---|---|---|---|---|\n`;
    for (const q of qualifyingCandidates) {
      summaryMd += `| \`${q.candidateId}\` | ${q.sourceSeedName} | ${q.modulePath} | ${(q.noveltyScore * 100).toFixed(1)}% (${q.noveltyBucket}) | **${(q.finalTrainingScore * 100).toFixed(1)}%** | **${(q.weakestCellScore * 100).toFixed(1)}%** (\`${q.weakestCellOpponent}\` S${q.weakestCellSide}) | +${(q.trainingScoreDelta * 100).toFixed(1)}% |\n`;
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

  summaryMd += `\n## 4. Worker Safety Evidence\n`;
  summaryMd += `- **Worker Error Count**: ${poolReport.errorCount} (Expected: 0)\n`;
  summaryMd += `- **Total Duration**: ${(evalReport.totalDurationMs / 1000).toFixed(1)}s\n`;

  writeFileSync(join(outputDir, 'summary.md'), summaryMd, 'utf8');

  return {
    panelManifest,
    poolReport,
    evaluations,
    qualityDecision,
    outputDir,
  };
}
