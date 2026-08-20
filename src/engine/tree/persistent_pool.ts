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
import type { SimTaskMessage, SimResultMessage, ExecutionMode } from './fine_grained_worker';
import { calculateMatchMetrics, type MatchMetrics } from './match_metrics';
import { CpuLoadMonitor } from './cpu_monitor';
import type { MatchTrace } from './branch_induct';
import { EXECUTION_SEMANTICS_VERSION } from '../play_full_game';
import { STRATEGY_ADAPTER_VERSION } from './product_tree_strategy';
import { getAuthorityArtifactManifest } from './independent_real_entry_parity';

const WORKER_SRC = resolve('src/engine/tree/fine_grained_worker.ts');
const WORKER_OUT = resolve('reports/fine_grained_worker.cjs');

/** T032 C.4/D.5：正式请求选择旧 arena 路径 → 在 worker 启动前 fail-closed */
export class DeprecatedArenaFormalError extends Error {
  public taskIds: number[];
  constructor(taskIds: number[]) {
    super(`[DeprecatedArenaFormalError] Formal request must use product path (playFullGame); arena.ts -> playSpecVsSpec is SANDBOX_ONLY_DEPRECATED. Blocked tasks: ${taskIds.join(', ')}`);
    this.name = 'DeprecatedArenaFormalError';
    this.taskIds = taskIds;
  }
}

/** T032 D.1：产品路径 manifest */
export interface ProductPathManifest {
  executionSemanticsVersion: string;
  productEntryModule: string;
  strategyAdapterVersion: string;
  authorityBundleAbsolutePath: string;
  authorityBundleSHA256: string;
  runnerCommit: string;
  configuredWorkerCount: number;
  observedWorkerCount: number;
}

/** 正式请求 fail-closed 守卫（必须在任何 worker 启动前调用） */
export function failClosedArenaFormal(tasks: SimTaskMessage[]): void {
  const blocked = tasks.filter(t => t.formalRequest === true && (t.executionMode ?? 'arena_sandbox_deprecated') === 'arena_sandbox_deprecated');
  if (blocked.length > 0) {
    throw new DeprecatedArenaFormalError(blocked.map(t => t.taskId));
  }
}

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
    const defaultWorkers = Math.min(128, Math.max(32, cpus().length * 4));
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

  /** T032 D.1：记录产品路径运行 provenance 与池实际并发规模 */
  public getProductPathManifest(): ProductPathManifest {
    const authority = getAuthorityArtifactManifest();
    let runnerCommit = 'UNKNOWN';
    try {
      runnerCommit = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
    } catch {
      // 保留 UNKNOWN；调用方可把缺失 provenance 作为 fail-closed 条件处理。
    }
    return {
      executionSemanticsVersion: EXECUTION_SEMANTICS_VERSION,
      productEntryModule: 'src/engine/play_full_game.ts',
      strategyAdapterVersion: STRATEGY_ADAPTER_VERSION,
      authorityBundleAbsolutePath: authority.authorityBundleAbsoluteSource,
      authorityBundleSHA256: authority.authorityBundleSHA256,
      runnerCommit,
      configuredWorkerCount: this.workerCount,
      observedWorkerCount: this.workers.length,
    };
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
   * 并发执行一组 SimTask 任务，支持基于 requestId 的安全请求隔离与结构化校验。
   *
   * 动态并发控制：
   *   - 初始 activeLimit = min(workerCount, tasks)
   *   - 每个 chunk 完成后通过 CpuLoadMonitor.adaptConcurrency() 采样 CPU 负载
   *   - 若 CPU > target（默认 80%）则收窄 limit；若 CPU < target 则扩大 limit
   *   - 使用滑动窗口（Semaphore）保证同时在飞的 chunk 数 ≤ activeLimit
   */
  public async dispatchTasks(
    tasks: SimTaskMessage[],
    candidateIdentity?: string,
    options?: { targetWorkerIndex?: number }
  ): Promise<SimResultMessage[]> {
    // T032 C.4：正式请求若选择旧 arena 路径，在 worker 启动前 fail-closed
    failClosedArenaFormal(tasks);

    await this.init();

    if (tasks.length === 0) return [];

    const requestId = randomUUID();

    // 若指定了目标 workerIndex，直接定向分派给该 Worker
    if (options?.targetWorkerIndex !== undefined && options.targetWorkerIndex >= 0 && options.targetWorkerIndex < this.workers.length) {
      const targetWorker = this.workers[options.targetWorkerIndex];
      return new Promise<SimResultMessage[]>((resolve, reject) => {
        const handler = (msg: any) => {
          if (msg.requestId !== requestId) return;
          targetWorker.off('message', handler);
          if (msg.type === 'batch_result') resolve(msg.results);
          else reject(new Error(msg.error || 'Worker execution failed'));
        };
        targetWorker.on('message', handler);
        targetWorker.postMessage({ type: 'batch', requestId, tasks });
      });
    }

    const optimalChunkSize = Math.max(1, Math.min(8, Math.ceil(tasks.length / (this.workerCount * 8))));
    const chunks: SimTaskMessage[][] = [];
    for (let i = 0; i < tasks.length; i += optimalChunkSize) {
      chunks.push(tasks.slice(i, i + optimalChunkSize));
    }

    const results: SimResultMessage[][] = new Array(chunks.length);
    const pendingChunks = new Map<string, {
      resolve: () => void;
      reject: (err: Error) => void;
      worker: Worker;
      messageHandler: (msg: any) => void;
      errorHandler: (err: any) => void;
    }>();

    const dispatchChunk = (idx: number, workerIdx: number): Promise<void> => {
      const chunk = chunks[idx];
      const worker = this.workers[workerIdx];
      const chunkRequestId = `${requestId}_chk_${idx}`;

      return new Promise<void>((resolveChunk, rejectChunk) => {
        const messageHandler = (msg: any) => {
          if (msg.requestId !== chunkRequestId) return;

          worker.off('message', messageHandler);
          worker.off('error', errorHandler);
          pendingChunks.delete(chunkRequestId);

          if (msg.type === 'batch_result') {
            if (!Array.isArray(msg.results) || msg.results.length !== chunk.length) {
              rejectChunk(new StructuredSimError(
                `Worker result count mismatch: expected ${chunk.length}, received ${msg.results?.length ?? 0}`,
                { requestId: chunkRequestId, expectedCount: chunk.length, receivedCount: msg.results?.length ?? 0, candidateIdentity }
              ));
              return;
            }
            for (let resultIndex = 0; resultIndex < msg.results.length; resultIndex++) {
              const result = msg.results[resultIndex];
              if (!result || typeof result.w !== 'number' || typeof result.d !== 'number' || typeof result.l !== 'number') {
                rejectChunk(new StructuredSimError(
                  `Worker result contains invalid W/D/L at index ${resultIndex}`,
                  { requestId: chunkRequestId, expectedCount: chunk.length, receivedCount: msg.results.length, candidateIdentity }
                ));
                return;
              }
            }
            results[idx] = msg.results;
            resolveChunk();
          } else if (msg.type === 'error') {
            rejectChunk(new StructuredSimError(msg.error || 'Worker execution error', {
              requestId: chunkRequestId,
              expectedCount: chunk.length,
              receivedCount: 0,
              candidateIdentity,
            }));
          }
        };

        const errorHandler = (err: any) => {
          worker.off('message', messageHandler);
          worker.off('error', errorHandler);
          pendingChunks.delete(chunkRequestId);
          rejectChunk(new StructuredSimError(err?.message || String(err), {
            requestId: chunkRequestId,
            expectedCount: chunk.length,
            receivedCount: 0,
            candidateIdentity,
          }));
        };

        pendingChunks.set(chunkRequestId, {
          resolve: resolveChunk,
          reject: rejectChunk,
          worker,
          messageHandler,
          errorHandler,
        });

        worker.on('message', messageHandler);
        worker.on('error', errorHandler);
        worker.postMessage({ type: 'batch', requestId: chunkRequestId, tasks: chunk });
      });
    };

    const maxLimit = Math.min(this.workers.length, chunks.length);
    let activeLimit = maxLimit;
    let nextChunkIndex = 0;
    let completedChunks = 0;
    const totalChunks = chunks.length;
    let lastLoggedPct = 0;

    const freeWorkers = Array.from({ length: this.workers.length }, (_, index) => index);
    const inFlightByWorker = new Map<number, Promise<number>>();

    const startNextChunk = () => {
      const chunkIndex = nextChunkIndex++;
      const workerIndex = freeWorkers.shift();
      if (workerIndex === undefined) {
        throw new Error('No free worker available for dispatch');
      }
      inFlightByWorker.set(workerIndex, dispatchChunk(chunkIndex, workerIndex).then(() => workerIndex));
    };

    try {
      while (nextChunkIndex < chunks.length || inFlightByWorker.size > 0) {
        while (nextChunkIndex < chunks.length && inFlightByWorker.size < activeLimit && freeWorkers.length > 0) {
          startNextChunk();
        }

        if (inFlightByWorker.size === 0) break;
        const completedWorkerIndex = await Promise.race(inFlightByWorker.values());
        inFlightByWorker.delete(completedWorkerIndex);
        freeWorkers.push(completedWorkerIndex);
        completedChunks++;

        if (this.cpuMonitor) {
          activeLimit = this.cpuMonitor.adaptConcurrency(activeLimit, 1, maxLimit);
        }

        const currentPct = Math.floor((completedChunks / totalChunks) * 100);
        if (currentPct >= lastLoggedPct + 10 || completedChunks === totalChunks) {
          lastLoggedPct = Math.floor(currentPct / 10) * 10;
          const cpuStr = this.cpuMonitor ? `${(this.cpuMonitor.getUsage() * 100).toFixed(1)}%` : '80.0%';
          console.log(`    -> [${candidateIdentity ?? 'Simulation'}] 进度: ${currentPct}% (${completedChunks}/${totalChunks} 批次, CPU: ${cpuStr}, 并发: ${activeLimit})...`);
        }
      }
    } catch (err) {
      for (const [chkId, item] of pendingChunks.entries()) {
        item.worker.off('message', item.messageHandler);
        item.worker.off('error', item.errorHandler);
      }
      pendingChunks.clear();
      throw err;
    }

    const flattened: SimResultMessage[] = [];
    for (const list of results) {
      if (list) flattened.push(...list);
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
    mode: ExecutionMode = 'arena_sandbox_deprecated',
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
              opponentFormation: opp,
              side,
              seed: seedBase,
              games,
              executionMode: mode,
              formalRequest: mode === 'product_path',
            });
        }
      }
    }

    const results = await this.dispatchTasks(tasks);
    const stats: Array<{ win: number; draw: number; loss: number; workerErrorCount: number; workerErrors: string[] }> = candidates.map(() => ({
      win: 0,
      draw: 0,
      loss: 0,
      workerErrorCount: 0,
      workerErrors: [],
    }));

    for (const r of results) {
      if (r.candidateIdx !== undefined && stats[r.candidateIdx]) {
        if (r.error) {
          stats[r.candidateIdx].workerErrorCount++;
          stats[r.candidateIdx].workerErrors.push(r.error);
        } else {
          stats[r.candidateIdx].win += r.w;
          stats[r.candidateIdx].draw += r.d;
          stats[r.candidateIdx].loss += r.l;
        }
      }
    }

    return stats.map(s => calculateMatchMetrics(s.win, s.draw, s.loss, s.workerErrorCount, s.workerErrors));
  }

  public async evalCandidateWithDeploymentTraces(
    candidate: EvolFormation,
    matchedOpps: Formation[],
    games: number,
    seedBase: number,
    mode: ExecutionMode = 'arena_sandbox_deprecated',
  ): Promise<{ metrics: MatchMetrics; deploymentTraces: any[] }> {
    const tasks: SimTaskMessage[] = [];
    let taskId = 0;
    for (const opp of matchedOpps) {
      for (const side of [1, 2] as (1 | 2)[]) {
        tasks.push({
          taskId: taskId++,
          candidateIdx: 0,
          formationA: candidate,
          opponentNameOrId: opp.id ?? opp.name,
          opponentFormation: opp,
          side,
          seed: seedBase,
          games,
          collectDeploymentTraces: true,
          executionMode: mode,
          formalRequest: mode === 'product_path',
        });
      }
    }

    const results = await this.dispatchTasks(tasks);
    let win = 0, draw = 0, loss = 0, workerErrorCount = 0;
    const workerErrors: string[] = [];
    const deploymentTraces: any[] = [];

    for (const r of results) {
      if (r.error) {
        workerErrorCount++;
        workerErrors.push(r.error);
      } else {
        win += r.w;
        draw += r.d;
        loss += r.l;
      }
      if (r.deploymentTraces) {
        deploymentTraces.push(...r.deploymentTraces);
      }
    }

    const metrics = calculateMatchMetrics(win, draw, loss, workerErrorCount, workerErrors);
    return { metrics, deploymentTraces };
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

  public async terminate(): Promise<void> {
    if (this.cpuMonitor) {
      this.cpuMonitor.stop();
    }
    for (const worker of this.workers) {
      worker.terminate();
    }
    this.workers = [];
  }
}
