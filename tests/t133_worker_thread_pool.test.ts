import '../src/engine/env';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  runGeneration2OptimizerCycle,
  DEFAULT_CYCLE_CONFIG,
  ProductWorkerPool,
} from '../src/engine/tree/product_training/generation2/cycle';
import { DynamicPoolManager } from '../src/engine/tree/product_training/generation2/pool';

test('T133: Worker-Thread Product Cycle Pool & Determinism Audit', async () => {
  // 1. Worker Pool lifecycle test
  const pool = new ProductWorkerPool(2, 20000);
  const metrics = pool.getMetrics();
  assert.strictEqual(metrics.backend, 'worker_threads');
  assert.strictEqual(metrics.workerCount, 2);
  await pool.terminate();

  // 2. Parity & Determinism test: Single vs Worker_Threads on same inputs
  const tmpPoolPath = path.join(process.cwd(), 'reports', 'tree-cycle', 'dynamic-t0-pool', `t133_test_pool_${Date.now()}.json`);
  const mgr = new DynamicPoolManager(tmpPoolPath);
  const entries = mgr.initOrLoad();
  const targetEntry = entries[0];

  const singleReport = await runGeneration2OptimizerCycle({
    targetFormationId: targetEntry.formationId,
    maxIterations: 1,
    uniqueCandidatesPerCase: 6,
    populationSize: 3,
    maxGenerations: 1,
    baselineSeeds: [1, 7],
    validationSeeds: [1, 42],
    parallelBackend: 'single',
  });

  const workerReport = await runGeneration2OptimizerCycle({
    targetFormationId: targetEntry.formationId,
    maxIterations: 1,
    uniqueCandidatesPerCase: 6,
    populationSize: 3,
    maxGenerations: 1,
    baselineSeeds: [1, 7],
    validationSeeds: [1, 42],
    parallelBackend: 'worker_threads',
    workerCount: 2,
  });

  // Logical results determinism equality check (excluding wall time / cpu fields)
  assert.strictEqual(singleReport.totalIterationsExecuted, workerReport.totalIterationsExecuted);
  assert.strictEqual(singleReport.summary.totalAdverseCasesMined, workerReport.summary.totalAdverseCasesMined);
  assert.strictEqual(singleReport.summary.totalUniqueCandidatesEvaluated, workerReport.summary.totalUniqueCandidatesEvaluated);
  assert.strictEqual(singleReport.summary.totalAcceptedBranches, workerReport.summary.totalAcceptedBranches);
  assert.strictEqual(singleReport.summary.totalRejectedBranches, workerReport.summary.totalRejectedBranches);

  // Clean test pool file
  if (fs.existsSync(tmpPoolPath)) fs.unlinkSync(tmpPoolPath);
});
