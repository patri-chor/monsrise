import * as os from 'node:os';
import * as path from 'node:path';
import { Worker } from 'node:worker_threads';
import type { WorkerTaskPayload, WorkerTaskResult } from './product_worker';

export interface PoolExecutionMetrics {
  backend: 'single' | 'worker_threads';
  workerCount: number;
  logicalCpus: number;
  wallTimeMs: number;
  parentCpuUserMs: number;
  parentCpuSystemMs: number;
  sumWorkerCpuUserMs: number;
  sumWorkerCpuSystemMs: number;
  maxWorkerRssBytes: number;
  queuedTasksCount: number;
  completedTasksCount: number;
  failedTasksCount: number;
  timedOutTasksCount: number;
}

export class ProductWorkerPool {
  private workers: Worker[] = [];
  private idleWorkerIndices: number[] = [];
  private taskQueue: Array<{
    task: WorkerTaskPayload;
    resolve: (res: WorkerTaskResult) => void;
    reject: (err: Error) => void;
    timeoutTimer?: NodeJS.Timeout;
  }> = [];
  private activeTasks = new Map<number, { task: WorkerTaskPayload; resolve: (res: WorkerTaskResult) => void; reject: (err: Error) => void; timeoutTimer?: NodeJS.Timeout }>();

  private workerCount: number;
  private timeoutMs: number;
  private completedResults: WorkerTaskResult[] = [];
  private failedCount = 0;
  private timedOutCount = 0;
  private startCpu = process.cpuUsage();
  private startTime = Date.now();

  constructor(workerCount?: number, timeoutMs = 30000) {
    const cpus = os.cpus().length || 4;
    this.workerCount = Math.max(1, workerCount ?? Math.min(Math.max(1, cpus - 1), 6));
    this.timeoutMs = timeoutMs;
  }

  public init(): void {
    if (this.workers.length > 0) return;
    const workerScript = path.join(__dirname, 'product_worker.ts');

    for (let i = 0; i < this.workerCount; i++) {
      const worker = new Worker(workerScript, {
        execArgv: ['--loader', 'ts-node/esm'],
      });

      const workerIndex = i;
      worker.on('message', (res: WorkerTaskResult) => {
        const active = this.activeTasks.get(workerIndex);
        if (active) {
          if (active.timeoutTimer) clearTimeout(active.timeoutTimer);
          this.activeTasks.delete(workerIndex);
          this.completedResults.push(res);
          active.resolve(res);
        }
        this.idleWorkerIndices.push(workerIndex);
        this.dispatchNext();
      });

      worker.on('error', (err) => {
        const active = this.activeTasks.get(workerIndex);
        if (active) {
          if (active.timeoutTimer) clearTimeout(active.timeoutTimer);
          this.activeTasks.delete(workerIndex);
          this.failedCount++;
          active.reject(err);
        }
      });

      this.workers.push(worker);
      this.idleWorkerIndices.push(workerIndex);
    }
  }

  public async executeTask(task: WorkerTaskPayload): Promise<WorkerTaskResult> {
    return new Promise((resolve, reject) => {
      this.taskQueue.push({ task, resolve, reject });
      this.dispatchNext();
    });
  }

  public async executeTasksDeterministic(tasks: WorkerTaskPayload[]): Promise<WorkerTaskResult[]> {
    const promises = tasks.map(t => this.executeTask(t));
    const results = await Promise.all(promises);
    // 按 workId 进行严格确定性排序
    return results.sort((a, b) => a.workId.localeCompare(b.workId));
  }

  private dispatchNext(): void {
    if (this.taskQueue.length === 0 || this.idleWorkerIndices.length === 0) return;

    const workerIndex = this.idleWorkerIndices.shift()!;
    const item = this.taskQueue.shift()!;
    const worker = this.workers[workerIndex];

    item.timeoutTimer = setTimeout(() => {
      this.activeTasks.delete(workerIndex);
      this.timedOutCount++;
      item.reject(new Error(`Worker task timed out after ${this.timeoutMs}ms for workId: ${item.task.workId}`));
    }, this.timeoutMs);

    this.activeTasks.set(workerIndex, item);
    worker.postMessage(item.task);
  }

  public getMetrics(): PoolExecutionMetrics {
    const parentCpuDiff = process.cpuUsage(this.startCpu);
    const sumWorkerCpuUserMs = this.completedResults.reduce((s, r) => s + r.cpuTimeUserMs, 0);
    const sumWorkerCpuSystemMs = this.completedResults.reduce((s, r) => s + r.cpuTimeSystemMs, 0);
    const maxWorkerRssBytes = this.completedResults.reduce((m, r) => Math.max(m, r.rssBytes), 0);

    return {
      backend: 'worker_threads',
      workerCount: this.workerCount,
      logicalCpus: os.cpus().length || 4,
      wallTimeMs: Date.now() - this.startTime,
      parentCpuUserMs: Math.round(parentCpuDiff.user / 1000),
      parentCpuSystemMs: Math.round(parentCpuDiff.system / 1000),
      sumWorkerCpuUserMs,
      sumWorkerCpuSystemMs,
      maxWorkerRssBytes,
      queuedTasksCount: this.completedResults.length + this.taskQueue.length,
      completedTasksCount: this.completedResults.length,
      failedTasksCount: this.failedCount,
      timedOutTasksCount: this.timedOutCount,
    };
  }

  public async terminate(): Promise<void> {
    for (const w of this.workers) {
      await w.terminate();
    }
    this.workers = [];
    this.idleWorkerIndices = [];
    this.activeTasks.clear();
    this.taskQueue = [];
  }
}
