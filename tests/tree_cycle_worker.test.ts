import '../src/engine/env';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { TreeCycleOrchestrator } from '../src/engine/tree/tree_cycle';
import { TreeDynamicPool } from '../src/engine/tree/tree_dynamic_pool';

test('T135 Worker Test: Worker S/D+S/Backprop Dispatch, Single vs Worker Parity, Fail-Closed', async () => {
  const tmpPoolPath = path.join(process.cwd(), 'reports', 'tree-cycle', `t135_worker_pool_${Date.now()}.json`);
  const pool = new TreeDynamicPool(tmpPoolPath);
  const entries = pool.initOrLoad();
  const targetEntry = entries[0];

  // 1. Single-backend run
  const singleReport = await TreeCycleOrchestrator.runCycle({
    targetFormationId: targetEntry.formationId,
    maxIterations: 1,
    uniqueCandidatesPerCase: 6,
    populationSize: 3,
    maxGenerations: 1,
    baselineSeeds: [1, 7],
    validationSeeds: [1, 42],
    parallelBackend: 'single',
  });

  // 2. Worker_threads run
  const workerReport = await TreeCycleOrchestrator.runCycle({
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

  // Check worker execution metrics
  const workerIter1 = workerReport.iterations[0];
  assert.ok(workerIter1.parallelMetrics, 'parallelMetrics must exist');
  assert.strictEqual(workerIter1.parallelMetrics.backend, 'worker_threads');
  assert.ok(workerIter1.parallelMetrics.completedTasksCount > 0, 'completedTasksCount > 0');

  // Check logical parity
  const singleDir = path.join(process.cwd(), 'reports', 'tree-cycle', singleReport.runId, 'iteration-001');
  const workerDir = path.join(process.cwd(), 'reports', 'tree-cycle', workerReport.runId, 'iteration-001');

  const singleS = fs.readFileSync(path.join(singleDir, 's_trials.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
  const workerS = fs.readFileSync(path.join(workerDir, 's_trials.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
  assert.strictEqual(singleS.length, workerS.length, 'S trial counts match');

  for (let i = 0; i < singleS.length; i++) {
    assert.strictEqual(singleS[i].candidateId, workerS[i].candidateId);
    assert.strictEqual(singleS[i].editedStateFingerprint, workerS[i].editedStateFingerprint);
  }

  const singleBP = fs.readFileSync(path.join(singleDir, 'backprop_validations.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
  const workerBP = fs.readFileSync(path.join(workerDir, 'backprop_validations.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
  assert.strictEqual(singleBP.length, workerBP.length, 'Backprop validation counts match');

  for (let i = 0; i < singleBP.length; i++) {
    assert.strictEqual(singleBP[i].candidateId, workerBP[i].candidateId);
    assert.strictEqual(singleBP[i].classification, workerBP[i].classification);
  }

  if (fs.existsSync(tmpPoolPath)) fs.unlinkSync(tmpPoolPath);
});
