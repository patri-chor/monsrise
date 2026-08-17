import '../env';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import os from 'node:os';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { FORMATION_LIBRARY } from '../../ai/formation_library';
import type { Formation } from '../../ai/types';
import { resolveSeedsAndPanel } from './first_four_generation';
import {
  optimizeFormation,
  loadBundle,
  type OptimizeFormationOptions,
} from './branch_induct';

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
  status: 'IMPROVED' | 'NO_IMPROVEMENT' | 'ERROR';
  startedAt: string;
  completedAt: string;
  durationMs: number;
  searchSeedBase: number;
  validationSeedBase: number;
  forkRound?: number;
  maskLabel?: string;
  beforeUndefeated?: number;
  afterUndefeated?: number;
  improved: boolean;
  resultTree?: any;
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
  errorCount: number;
  results: CandidateOptimizationResult[];
  settings: {
    gamesPerOpp: number;
    baseSearchSeed: number;
    baseValidationSeed: number;
    evaluationPanel: string[];
  };
}

/**
 * 计算并发 Worker 配额策略
 */
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

/**
 * 为第 index 个候选生成确定性种子对
 */
export function deriveCandidateSeeds(index: number, baseSearchSeed: number = 5000, baseValidationSeed: number = 15000): {
  searchSeedBase: number;
  validationSeedBase: number;
} {
  return {
    searchSeedBase: baseSearchSeed + index * 500,
    validationSeedBase: baseValidationSeed + index * 500,
  };
}

import { evolToBundleFormation, type EvolFormation } from './evol_gene';

/**
 * 构造单个候选优化任务
 */
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

/**
 * 单个 Candidate 优化执行体（可在主线程或 Worker 中运行）
 */
export async function executeCandidateOptimizationDirect(
  task: CandidateOptimizationTask,
  BundleAI?: any,
): Promise<CandidateOptimizationResult> {
  const startedAt = new Date().toISOString();
  const startTime = Date.now();

  try {
    const ai = BundleAI ?? loadBundle();
    const optRes = await optimizeFormation(ai, task.deckFormation, task.gamesPerOpp, {
      opponents: task.opponents,
      searchSeedBase: task.searchSeedBase,
      validationSeedBase: task.validationSeedBase,
    });

    const completedAt = new Date().toISOString();
    const durationMs = Date.now() - startTime;

    if (!optRes) {
      return {
        candidateIndex: task.candidateIndex,
        candidateId: task.candidateId,
        sourceSeedIndex: task.sourceSeedIndex,
        sourceSeedName: task.sourceSeedName,
        sourceSeedId: task.sourceSeedId,
        status: 'NO_IMPROVEMENT',
        startedAt,
        completedAt,
        durationMs,
        searchSeedBase: task.searchSeedBase,
        validationSeedBase: task.validationSeedBase,
        improved: false,
      };
    }

    return {
      candidateIndex: task.candidateIndex,
      candidateId: task.candidateId,
      sourceSeedIndex: task.sourceSeedIndex,
      sourceSeedName: task.sourceSeedName,
      sourceSeedId: task.sourceSeedId,
      status: optRes.improved ? 'IMPROVED' : 'NO_IMPROVEMENT',
      startedAt,
      completedAt,
      durationMs,
      searchSeedBase: task.searchSeedBase,
      validationSeedBase: task.validationSeedBase,
      forkRound: optRes.forkRound,
      maskLabel: optRes.maskLabel,
      beforeUndefeated: optRes.before?.undefeated,
      afterUndefeated: optRes.after?.undefeated,
      improved: optRes.improved,
      resultTree: optRes.optimized?.root,
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

/**
 * 并发候选池调度器（支持注入 workerExecutor 实现单元测试 mock 与真实调度）
 */
export async function runCandidateOptimizationPool(
  tasks: CandidateOptimizationTask[],
  options: {
    requestedWorkers?: number;
    workerExecutor?: (task: CandidateOptimizationTask) => Promise<CandidateOptimizationResult>;
    onProgress?: (completed: number, total: number, result: CandidateOptimizationResult) => void;
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

  const executor = options.workerExecutor ?? ((task) => executeCandidateOptimizationDirect(task));

  return new Promise((resolvePool, rejectPool) => {
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
        errorCount: 0,
        results: [],
        settings: {
          gamesPerOpp: 0,
          baseSearchSeed: 0,
          baseValidationSeed: 0,
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
            results[taskIdx] = {
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
            completedCount++;
          })
          .finally(() => {
            activeWorkers--;
            if (completedCount === tasks.length) {
              const totalDurationMs = Date.now() - startTime;
              const improvedCount = results.filter(r => r.status === 'IMPROVED').length;
              const noImprovementCount = results.filter(r => r.status === 'NO_IMPROVEMENT').length;
              const errorCount = results.filter(r => r.status === 'ERROR').length;

              resolvePool({
                timestamp: new Date().toISOString(),
                candidateCount: tasks.length,
                requestedWorkers: workerInfo.requestedWorkers,
                effectiveWorkers: workerInfo.effectiveWorkers,
                availableLogicalCpus: workerInfo.availableLogicalCpus,
                peakActiveWorkers,
                totalDurationMs,
                improvedCount,
                noImprovementCount,
                errorCount,
                results,
                settings: {
                  gamesPerOpp: tasks[0]?.gamesPerOpp ?? 1,
                  baseSearchSeed: tasks[0]?.searchSeedBase ?? 5000,
                  baseValidationSeed: tasks[0]?.validationSeedBase ?? 15000,
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

/**
 * 加载权威 T017 冻结候选池
 */
export function loadAuthoritativeFrozenCandidates(customPath?: string): any[] {
  const p = customPath ? resolve(customPath) : resolve('reports/new-formation-generation/sequential-per-seed-cycle/frozen_candidates.jsonl');
  if (!existsSync(p)) {
    throw new Error(`Authoritative frozen candidates file not found: ${p}`);
  }
  const lines = readFileSync(p, 'utf8').trim().split('\n').filter(l => l.trim().length > 0);
  return lines.map(l => JSON.parse(l));
}
