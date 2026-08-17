import '../env';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import os from 'node:os';
import { FORMATION_LIBRARY } from '../../ai/formation_library';
import type { Formation } from '../../ai/types';
import {
  optimizeFormation,
  loadBundle,
  type BranchInductionOutcome,
  type TargetCellInfo,
  type SearchOperatorStats,
} from './branch_induct';
import { PersistentSimPool } from './persistent_pool';
import type { MatchMetrics } from './match_metrics';
import { evolToBundleFormation, type EvolFormation } from './evol_gene';

export const SEQUENTIAL_TREE_OPT_DIR = resolve('reports/new-formation-generation/sequential-tree-optimization');

export interface CandidateOptimizationTask {
  candidateIndex: number;
  candidateId: string;
  sourceSeedIndex: number;
  sourceSeedName: string;
  sourceSeedId: string;
  deckFormation: Formation;
  opponents: Formation[];
  gamesPerOpp: number;
  searchSeedBase: number;
  validationSeedBase: number;
  isolatedOutputDir?: string;
}

export interface CandidateOptimizationResult {
  candidateIndex: number;
  candidateId: string;
  sourceSeedIndex: number;
  sourceSeedName: string;
  sourceSeedId: string;
  status: BranchInductionOutcome;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  searchSeedBase: number;
  validationSeedBase: number;
  forkRound?: number;
  maskLabel?: string;
  beforeMetrics?: MatchMetrics;
  afterMetrics?: MatchMetrics;
  beforeUndefeated?: number;
  afterUndefeated?: number;
  beforeTrainingScore?: number;
  afterTrainingScore?: number;
  improved: boolean;
  resultTree?: any;
  targetPoolDiagnostics?: {
    targetPoolCount: number;
    cells: TargetCellInfo[];
  };
  searchOperatorStats?: SearchOperatorStats;
  error?: string;
}

export interface CandidatePoolRunReport {
  timestamp: string;
  candidateCount: number;
  requestedWorkers: number;
  effectiveWorkers: number;
  availableLogicalCpus: number;
  peakActiveWorkers: number;
  totalDurationMs: number;
  improvedCount: number;
  noImprovementCount: number;
  outcomeCounts: Record<BranchInductionOutcome, number>;
  errorCount: number;
  results: CandidateOptimizationResult[];
  settings: {
    gamesPerOpp: number;
    baseSearchSeed: number;
    baseValidationSeed: number;
    evaluationPanel: string[];
  };
}

export function resolveEvaluationPanel(): Formation[] {
  const firstSeven = FORMATION_LIBRARY.slice(0, 7);
  const goldenMonkey = FORMATION_LIBRARY.find(f => f.name === '壕炸金猴');
  if (!goldenMonkey) {
    throw new Error(`[Panel Resolution Error] Eighth opponent named '壕炸金猴' not found in FORMATION_LIBRARY.`);
  }
  return [...firstSeven, goldenMonkey];
}

export function resolveCandidateWorkers(requested?: number, candidateCount: number = 24): {
  requestedWorkers: number;
  effectiveWorkers: number;
  availableLogicalCpus: number;
  candidateCount: number;
} {
  const cpusCount = os.cpus().length || 1;
  const req = requested ?? 16;
  const effective = Math.max(1, Math.min(req, cpusCount, Math.max(1, candidateCount)));
  return {
    requestedWorkers: req,
    effectiveWorkers: effective,
    availableLogicalCpus: cpusCount,
    candidateCount,
  };
}

export function deriveCandidateSeeds(index: number, baseSearchSeed: number = 5000, baseValidationSeed: number = 20000): {
  searchSeedBase: number;
  validationSeedBase: number;
} {
  return {
    searchSeedBase: baseSearchSeed + index * 500,
    validationSeedBase: baseValidationSeed + index * 500,
  };
}

export function buildCandidateTask(
  candidateRecord: any,
  candidateIndex: number,
  evaluationPanel: Formation[],
  options: {
    gamesPerOpp?: number;
    baseSearchSeed?: number;
    baseValidationSeed?: number;
    isolatedOutputDir?: string;
  } = {},
): CandidateOptimizationTask {
  const seeds = deriveCandidateSeeds(
    candidateIndex,
    options.baseSearchSeed ?? 5000,
    options.baseValidationSeed ?? 20000,
  );

  const evolForm: EvolFormation = {
    name: candidateRecord.candidateId,
    archetype: candidateRecord.archPath || 'prayer',
    team: candidateRecord.team,
    root: candidateRecord.tree,
  };
  const bundleDeck = evolToBundleFormation(evolForm);

  const deckFormation: Formation = {
    id: candidateRecord.candidateId,
    name: candidateRecord.candidateId,
    archetype: candidateRecord.archPath || 'prayer',
    team: bundleDeck.team,
    tree: bundleDeck.tree,
  };

  return {
    candidateIndex,
    candidateId: candidateRecord.candidateId,
    sourceSeedIndex: candidateRecord.sourceSeedIndex ?? 0,
    sourceSeedName: candidateRecord.sourceSeedName ?? 'Unknown',
    sourceSeedId: candidateRecord.sourceSeedId ?? 'unknown',
    deckFormation,
    opponents: evaluationPanel,
    gamesPerOpp: options.gamesPerOpp ?? 1,
    searchSeedBase: seeds.searchSeedBase,
    validationSeedBase: seeds.validationSeedBase,
    isolatedOutputDir: options.isolatedOutputDir,
  };
}

export async function executeCandidateOptimizationDirect(
  task: CandidateOptimizationTask,
  BundleAI?: any,
  pool?: PersistentSimPool,
): Promise<CandidateOptimizationResult> {
  const startedAt = new Date().toISOString();
  const startTime = Date.now();

  try {
    const ai = BundleAI ?? loadBundle();
    const optRes = await optimizeFormation(ai, task.deckFormation, task.gamesPerOpp, {
      opponents: task.opponents,
      searchSeedBase: task.searchSeedBase,
      validationSeedBase: task.validationSeedBase,
      pool: pool ?? PersistentSimPool.getInstance(),
    });

    const completedAt = new Date().toISOString();
    const durationMs = Date.now() - startTime;

    return {
      candidateIndex: task.candidateIndex,
      candidateId: task.candidateId,
      sourceSeedIndex: task.sourceSeedIndex,
      sourceSeedName: task.sourceSeedName,
      sourceSeedId: task.sourceSeedId,
      status: optRes.outcome,
      startedAt,
      completedAt,
      durationMs,
      searchSeedBase: task.searchSeedBase,
      validationSeedBase: task.validationSeedBase,
      forkRound: optRes.forkRound,
      maskLabel: optRes.maskLabel,
      beforeMetrics: optRes.before,
      afterMetrics: optRes.after,
      beforeUndefeated: optRes.before?.undefeatedRate,
      afterUndefeated: optRes.after?.undefeatedRate,
      beforeTrainingScore: optRes.before?.trainingScore,
      afterTrainingScore: optRes.after?.trainingScore,
      improved: optRes.improved,
      resultTree: optRes.optimized?.root,
      targetPoolDiagnostics: optRes.targetPoolDiagnostics,
      searchOperatorStats: optRes.searchOperatorStats,
    };
  } catch (err: any) {
    const completedAt = new Date().toISOString();
    const durationMs = Date.now() - startTime;
    return {
      candidateIndex: task.candidateIndex,
      candidateId: task.candidateId,
      sourceSeedIndex: task.sourceSeedIndex,
      sourceSeedName: task.sourceSeedName,
      sourceSeedId: task.sourceSeedId,
      status: 'ERROR',
      startedAt,
      completedAt,
      durationMs,
      searchSeedBase: task.searchSeedBase,
      validationSeedBase: task.validationSeedBase,
      improved: false,
      error: err?.message || String(err),
    };
  }
}

export async function runCandidateOptimizationPool(
  tasks: CandidateOptimizationTask[],
  options: {
    requestedWorkers?: number;
    workerExecutor?: (task: CandidateOptimizationTask) => Promise<CandidateOptimizationResult>;
    onProgress?: (completed: number, total: number, result: CandidateOptimizationResult) => void;
    pool?: PersistentSimPool;
  } = {},
): Promise<CandidatePoolRunReport> {
  const startTime = Date.now();
  const workerInfo = resolveCandidateWorkers(options.requestedWorkers, tasks.length);
  const effectiveLimit = workerInfo.effectiveWorkers;

  const results: CandidateOptimizationResult[] = new Array(tasks.length);
  let activeWorkers = 0;
  let peakActiveWorkers = 0;
  let nextTaskIndex = 0;
  let completedCount = 0;

  const pool = options.pool ?? PersistentSimPool.getInstance();
  const executor = options.workerExecutor ?? ((task) => executeCandidateOptimizationDirect(task, undefined, pool));

  return new Promise((resolvePool) => {
    if (tasks.length === 0) {
      resolvePool({
        timestamp: new Date().toISOString(),
        candidateCount: 0,
        requestedWorkers: workerInfo.requestedWorkers,
        effectiveWorkers: workerInfo.effectiveWorkers,
        availableLogicalCpus: workerInfo.availableLogicalCpus,
        peakActiveWorkers: 0,
        totalDurationMs: 0,
        improvedCount: 0,
        noImprovementCount: 0,
        outcomeCounts: {
          IMPROVED: 0,
          NO_INFORMATIVE_SPLIT: 0,
          NO_OBSERVED_TRIGGER_AT_FORK: 0,
          BRANCH_SEARCH_NO_TRAINING_GAIN: 0,
          VALIDATION_TRAINING_REJECTED: 0,
          ERROR: 0,
        },
        errorCount: 0,
        results: [],
        settings: {
          gamesPerOpp: 1,
          baseSearchSeed: 5000,
          baseValidationSeed: 20000,
          evaluationPanel: [],
        },
      });
      return;
    }

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
            results[taskIdx] = res;
            completedCount++;
            options.onProgress?.(completedCount, tasks.length, res);
          })
          .catch((err) => {
            const errRes: CandidateOptimizationResult = {
              candidateIndex: task.candidateIndex,
              candidateId: task.candidateId,
              sourceSeedIndex: task.sourceSeedIndex,
              sourceSeedName: task.sourceSeedName,
              sourceSeedId: task.sourceSeedId,
              status: 'ERROR',
              startedAt: new Date().toISOString(),
              completedAt: new Date().toISOString(),
              durationMs: 0,
              searchSeedBase: task.searchSeedBase,
              validationSeedBase: task.validationSeedBase,
              improved: false,
              error: err?.message || String(err),
            };
            results[taskIdx] = errRes;
            completedCount++;
            options.onProgress?.(completedCount, tasks.length, errRes);
          })
          .finally(() => {
            activeWorkers--;
            if (completedCount === tasks.length) {
              const outcomeCounts: Record<BranchInductionOutcome, number> = {
                IMPROVED: 0,
                NO_INFORMATIVE_SPLIT: 0,
                NO_OBSERVED_TRIGGER_AT_FORK: 0,
                BRANCH_SEARCH_NO_TRAINING_GAIN: 0,
                VALIDATION_TRAINING_REJECTED: 0,
                ERROR: 0,
              };

              let improvedCount = 0;
              let noImprovementCount = 0;
              let errorCount = 0;

              for (const r of results) {
                if (r.status in outcomeCounts) {
                  outcomeCounts[r.status]++;
                }
                if (r.status === 'IMPROVED') {
                  improvedCount++;
                } else if (r.status === 'ERROR') {
                  errorCount++;
                } else {
                  noImprovementCount++;
                }
              }

              resolvePool({
                timestamp: new Date().toISOString(),
                candidateCount: tasks.length,
                requestedWorkers: workerInfo.requestedWorkers,
                effectiveWorkers: workerInfo.effectiveWorkers,
                availableLogicalCpus: workerInfo.availableLogicalCpus,
                peakActiveWorkers,
                totalDurationMs: Date.now() - startTime,
                improvedCount,
                noImprovementCount,
                outcomeCounts,
                errorCount,
                results,
                settings: {
                  gamesPerOpp: tasks[0]?.gamesPerOpp ?? 1,
                  baseSearchSeed: tasks[0]?.searchSeedBase ?? 5000,
                  baseValidationSeed: tasks[0]?.validationSeedBase ?? 20000,
                  evaluationPanel: tasks[0]?.opponents.map(o => o.name) ?? [],
                },
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
