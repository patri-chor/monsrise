// ============================================================
// 常驻高并发对局调度池 (Persistent Simulation Worker Pool)
//
// 架构特性：
//   1. 线程安全 initPromise 防重复初始化
//   2. 基于 requestId 的全异步请求隔离，杜绝跨调度结果污染
//   3. 结构化异常抛出与严格非空断言，杜绝 undefined 访问
// ============================================================

import { Worker } from 'node:worker_threads';
import { execSync } from 'node:child_process';
import { cpus } from 'node:os';
import { resolve } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { Formation } from '../../ai/types';
import type { EvolFormation, FeatureMask } from './evol_gene';
import type { SimTaskMessage, SimResultMessage } from './fine_grained_worker';
import { calculateMatchMetrics, type MatchMetrics } from './match_metrics';
import { CpuLoadMonitor } from './cpu_monitor';
import type { MatchTrace } from './branch_induct';

const WORKER_SRC = resolve('src/engine/tree/fine_grained_worker.ts');
const WORKER_OUT = resolve('reports/fine_grained_worker.cjs');

export class StructuredSimError extends Error {
  public requestId: string;
  public expectedCount: number;
  public receivedCount: number;
  public candidateIdentity?: string;

  constructor(message: string, meta: { requestId: string; expectedCount: number; receivedCount: number; candidateIdentity?: string }) {
    super(`[StructuredSimError] ${message} | RequestId=${meta.requestId}, Expected=${meta.expectedCount}, Received=${meta.receivedCount}, Candidate=${meta.candidateIdentity ?? 'N/A'}`);
    this.name = 'StructuredSimError';
    this.requestId = meta.requestId;
    this.expectedCount = meta.expectedCount;
    this.receivedCount = meta.receivedCount;
    this.candidateIdentity = meta.candidateIdentity;
  }
}

export interface PoolOptions {
  workerCount?: number;
  enableCpuMonitor?: boolean;
  targetCpuUsage?: number;
}

export class PersistentSimPool {
  private static instance: PersistentSimPool | null = null;

  private workers: Worker[] = [];
  public workerCount: number;
  private initPromise: Promise<void> | null = null;
  private cpuMonitor: CpuLoadMonitor | null = null;

  constructor(options: PoolOptions = {}) {
    const defaultWorkers = Math.min(64, Math.max(16, cpus().length * 2));
    this.workerCount = options.workerCount ?? defaultWorkers;

    if (options.enableCpuMonitor !== false) {
      this.cpuMonitor = new CpuLoadMonitor(options.targetCpuUsage ?? 0.80, 250);
      this.cpuMonitor.start();
    }
  }

  public static getInstance(options?: PoolOptions): PersistentSimPool {
    if (!PersistentSimPool.instance) {
      PersistentSimPool.instance = new PersistentSimPool(options);
    }
    return PersistentSimPool.instance;
  }

  /** 单例保证并发调用 init() 不会重复初始化 */
  public async init(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this._doInit();
    }
    return this.initPromise;
  }

  private async _doInit(): Promise<void> {
    if (!existsSync(resolve('reports'))) {
      mkdirSync(resolve('reports'), { recursive: true });
    }

    execSync(
      `npx esbuild "${WORKER_SRC}" --bundle --outfile="${WORKER_OUT}" --platform=node --format=cjs --target=node20`,
      { stdio: 'ignore' },
    );

    for (let i = 0; i < this.workerCount; i++) {
      const w = new Worker(WORKER_OUT);
      this.workers.push(w);
    }
  }

  public destroy(): void {
    if (this.cpuMonitor) {
      this.cpuMonitor.stop();
      this.cpuMonitor = null;
    }
    for (const w of this.workers) {
      w.terminate();
    }
    this.workers = [];
    this.initPromise = null;
    PersistentSimPool.instance = null;
  }

  /**
   * 并发执行一组 SimTask 任务，支持基于 requestId 的安全请求隔离与结构化校验
   */
  public async dispatchTasks(tasks: SimTaskMessage[], candidateIdentity?: string): Promise<SimResultMessage[]> {
    await this.init();

    if (tasks.length === 0) return [];

    const requestId = randomUUID();

    const chunks: SimTaskMessage[][] = [];
    const numChunks = Math.min(this.workerCount, tasks.length);
    const chunkSize = Math.ceil(tasks.length / numChunks);

    for (let i = 0; i < tasks.length; i += chunkSize) {
      chunks.push(tasks.slice(i, i + chunkSize));
    }

    const chunkPromises = chunks.map((chunk, idx) => {
      const workerIdx = idx % this.workers.length;
      const worker = this.workers[workerIdx];

      return new Promise<SimResultMessage[]>((resolvePromise, reject) => {
        const handler = (msg: any) => {
          if (msg.requestId !== requestId) {
            // 忽略非当前 request 的消息
            return;
          }

          if (msg.type === 'batch_result') {
            cleanup();
            if (!Array.isArray(msg.results)) {
              reject(new StructuredSimError('Worker returned non-array results payload', {
                requestId,
                expectedCount: chunk.length,
                receivedCount: 0,
                candidateIdentity,
              }));
              return;
            }
            if (msg.results.length !== chunk.length) {
              reject(new StructuredSimError(`Worker result count mismatch: expected ${chunk.length}, received ${msg.results.length}`, {
                requestId,
                expectedCount: chunk.length,
                receivedCount: msg.results.length,
                candidateIdentity,
              }));
              return;
            }
            // 严格非空校验
            for (let rIdx = 0; rIdx < msg.results.length; rIdx++) {
              const res = msg.results[rIdx];
              if (!res || typeof res.w !== 'number' || typeof res.d !== 'number' || typeof res.l !== 'number') {
                reject(new StructuredSimError(`Worker result contains undefined or invalid W/D/L at index ${rIdx}`, {
                  requestId,
                  expectedCount: chunk.length,
                  receivedCount: msg.results.length,
                  candidateIdentity,
                }));
                return;
              }
            }
            resolvePromise(msg.results);
          } else if (msg.type === 'error') {
            cleanup();
            reject(new StructuredSimError(msg.error || 'Worker unknown error', {
              requestId,
              expectedCount: chunk.length,
              receivedCount: 0,
              candidateIdentity,
            }));
          }
        };

        const errorHandler = (err: any) => {
          cleanup();
          reject(new StructuredSimError(err?.message || String(err), {
            requestId,
            expectedCount: chunk.length,
            receivedCount: 0,
            candidateIdentity,
          }));
        };

        const cleanup = () => {
          worker.off('message', handler);
          worker.off('error', errorHandler);
        };

        worker.on('message', handler);
        worker.on('error', errorHandler);
        worker.postMessage({ type: 'batch', requestId, tasks: chunk });
      });
    });

    const resultsNested = await Promise.all(chunkPromises);
    const flattened: SimResultMessage[] = [];
    for (const list of resultsNested) {
      flattened.push(...list);
    }

    flattened.sort((a, b) => a.taskId - b.taskId);
    return flattened;
  }

  public async evalCandidateBatchOnMatchedParallel(
    candidates: EvolFormation[],
    mask: FeatureMask,
    matchedOpps: Formation[],
    games: number,
    seedBase: number,
  ): Promise<MatchMetrics[]> {
    const tasks: SimTaskMessage[] = [];
    let taskId = 0;
    const sides: (1 | 2)[] = mask.side !== null ? [mask.side] : [1, 2];

    for (let cIdx = 0; cIdx < candidates.length; cIdx++) {
      const cand = candidates[cIdx];
      for (const opp of matchedOpps) {
        for (const side of sides) {
          tasks.push({
            taskId: taskId++,
            candidateIdx: cIdx,
            formationA: cand,
            opponentNameOrId: opp.id ?? opp.name,
            side,
            seed: seedBase,
            games,
          });
        }
      }
    }

    const results = await this.dispatchTasks(tasks);
    const stats: Array<{ win: number; draw: number; loss: number }> = candidates.map(() => ({ win: 0, draw: 0, loss: 0 }));

    for (const r of results) {
      if (r.candidateIdx !== undefined && stats[r.candidateIdx]) {
        stats[r.candidateIdx].win += r.w;
        stats[r.candidateIdx].draw += r.d;
        stats[r.candidateIdx].loss += r.l;
      }
    }

    return stats.map(s => calculateMatchMetrics(s.win, s.draw, s.loss));
  }

  public async collectInitialTracesParallel(
    candidate: EvolFormation,
    opponents: Formation[],
    gamesPerOpp: number,
    seedBase: number,
  ): Promise<MatchTrace[]> {
    const tasks: SimTaskMessage[] = [];
    let taskId = 0;

    for (const opp of opponents) {
      for (const side of [1, 2] as (1 | 2)[]) {
        for (let g = 0; g < gamesPerOpp; g++) {
          tasks.push({
            taskId: taskId++,
            formationA: candidate,
            opponentNameOrId: opp.id ?? opp.name,
            side,
            seed: seedBase + g,
            games: 1,
            collectObservations: true,
          });
        }
      }
    }

    const results = await this.dispatchTasks(tasks, candidate.name);
    const traces: MatchTrace[] = [];

    for (const r of results) {
      if (r.traces) {
        for (const raw of r.traces) {
          const obsMap = new Map<number, any>(raw.observations);
          const decMap = new Map<number, any>(raw.decisions);
          traces.push({
            seed: raw.seed,
            side: raw.side,
            oppId: raw.oppId,
            roundScores: raw.roundScores,
            observations: obsMap,
            decisions: decMap,
            w: raw.w,
            d: raw.d,
            l: raw.l,
          });
        }
      }
    }

    return traces;
  }
}
