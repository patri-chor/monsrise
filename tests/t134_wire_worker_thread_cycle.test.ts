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

test('T134: Wire Worker-Thread Cycle Execution & Deep Logical Parity Audit', async () => {
  const tmpPoolPath = path.join(process.cwd(), 'reports', 'tree-cycle', 'dynamic-t0-pool', `t134_test_pool_${Date.now()}.json`);
  const mgr = new DynamicPoolManager(tmpPoolPath);
  const entries = mgr.initOrLoad();
  const targetEntry = entries[0];

  // 1. Run exact bounded product-path cycle with Single Backend
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

  // 2. Run exact same workload with Worker Threads (workerCount=2)
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

  // 3. Worker Execution Proof: Assert worker work units and parallelMetrics
  const iter1 = workerReport.iterations[0];
  assert.ok(iter1.parallelMetrics, 'Worker parallelMetrics must exist');
  assert.strictEqual(iter1.parallelMetrics.backend, 'worker_threads');
  assert.ok(iter1.parallelMetrics.completedTasksCount > 0, 'Worker completedTasksCount must be > 0');

  // 4. Deep Canonical Parity Audit: Compare logical contents of artifact records
  const singleDir = path.join(process.cwd(), 'reports', 'tree-cycle', 'generation2-optimizer-cycle', singleReport.runId, 'iteration-001');
  const workerDir = path.join(process.cwd(), 'reports', 'tree-cycle', 'generation2-optimizer-cycle', workerReport.runId, 'iteration-001');

  const singleS = fs.readFileSync(path.join(singleDir, 's_trials.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
  const workerS = fs.readFileSync(path.join(workerDir, 's_trials.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
  assert.strictEqual(singleS.length, workerS.length, 'S trial counts must match exactly');

  for (let i = 0; i < singleS.length; i++) {
    assert.strictEqual(singleS[i].candidateId, workerS[i].candidateId);
    assert.strictEqual(singleS[i].editedStateFingerprint, workerS[i].editedStateFingerprint);
  }

  const singleBP = fs.readFileSync(path.join(singleDir, 'backprop_validations.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
  const workerBP = fs.readFileSync(path.join(workerDir, 'backprop_validations.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
  assert.strictEqual(singleBP.length, workerBP.length, 'Backprop validation counts must match exactly');

  for (let i = 0; i < singleBP.length; i++) {
    assert.strictEqual(singleBP[i].candidateId, workerBP[i].candidateId);
    assert.strictEqual(singleBP[i].classification, workerBP[i].classification);
    assert.strictEqual(singleBP[i].scoreDelta, workerBP[i].scoreDelta);
  }

  // Clean test pool file
  if (fs.existsSync(tmpPoolPath)) fs.unlinkSync(tmpPoolPath);
});
