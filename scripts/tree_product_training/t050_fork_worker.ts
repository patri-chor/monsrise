// ============================================================
// scripts/tree_product_training/t050_fork_worker.ts
// Fork-based IPC worker for T050
// ============================================================

import '../../src/engine/env';
import { runTargetEvaluation, type TargetTaskData } from './t050_worker';

process.on('message', (tasks: TargetTaskData[]) => {
  const results = tasks.map(t => runTargetEvaluation(t));
  if (process.send) {
    process.send(results);
  }
});
