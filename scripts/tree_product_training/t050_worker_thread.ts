// ============================================================
// scripts/tree_product_training/t050_worker_thread.ts
// Worker thread execution logic for T050
// ============================================================

import '../../src/engine/env';
import { parentPort } from 'node:worker_threads';
import { runTargetEvaluation, type TargetTaskData } from './t050_worker';

if (parentPort) {
  parentPort.on('message', (tasks: TargetTaskData[]) => {
    const results = tasks.map(t => runTargetEvaluation(t));
    parentPort!.postMessage(results);
  });
}
