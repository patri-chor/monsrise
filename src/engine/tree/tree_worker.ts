import '../env';
import { isMainThread, parentPort } from 'node:worker_threads';
import { TreeSearch } from './tree_search';
import { TreeDeck } from './tree_deck';
import { TreeLineage } from './tree_lineage';

export interface WorkerTaskPayload {
  workId: string;
  type: 'S_SEARCH' | 'DS_ATTEMPT' | 'BACKPROP_VALIDATION';
  payload: any;
}

export interface WorkerTaskResult {
  workId: string;
  success: boolean;
  data?: any;
  error?: string;
  wallTimeMs: number;
  cpuTimeUserMs: number;
  cpuTimeSystemMs: number;
  rssBytes: number;
}

if (!isMainThread && parentPort) {
  parentPort.on('message', async (task: WorkerTaskPayload) => {
    const startTime = Date.now();
    const startCpu = process.cpuUsage();

    try {
      let data: any = null;

      if (task.type === 'S_SEARCH') {
        const { cases, config, searchSeed, caseIndexOffset } = task.payload;
        data = TreeSearch.runLocalSearch(cases, config, searchSeed, caseIndexOffset);
      } else if (task.type === 'DS_ATTEMPT') {
        const { dCatalog, adverseCases, searchSeed } = task.payload;
        data = await TreeDeck.executeDPlusSSearch(dCatalog, adverseCases, searchSeed);
      } else if (task.type === 'BACKPROP_VALIDATION') {
        const { cand, baseCase, targetSnap, oppSnap, currentTargetEvol, config, iter } = task.payload;
        data = TreeLineage.validateCandidateAgainstCurrentPilot(
          cand,
          baseCase,
          targetSnap,
          oppSnap,
          currentTargetEvol,
          config,
          iter
        );
      } else {
        throw new Error(`Unknown worker task type: ${task.type}`);
      }

      const cpuDiff = process.cpuUsage(startCpu);
      const res: WorkerTaskResult = {
        workId: task.workId,
        success: true,
        data,
        wallTimeMs: Date.now() - startTime,
        cpuTimeUserMs: Math.round(cpuDiff.user / 1000),
        cpuTimeSystemMs: Math.round(cpuDiff.system / 1000),
        rssBytes: process.memoryUsage().rss,
      };
      parentPort!.postMessage(res);
    } catch (err: any) {
      const cpuDiff = process.cpuUsage(startCpu);
      const res: WorkerTaskResult = {
        workId: task.workId,
        success: false,
        error: err?.message || String(err),
        wallTimeMs: Date.now() - startTime,
        cpuTimeUserMs: Math.round(cpuDiff.user / 1000),
        cpuTimeSystemMs: Math.round(cpuDiff.system / 1000),
        rssBytes: process.memoryUsage().rss,
      };
      parentPort!.postMessage(res);
    }
  });
}
