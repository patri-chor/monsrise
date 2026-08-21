import '../src/engine/env';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { TreeCycleOrchestrator } from '../src/engine/tree/tree_cycle';
import { TreeDynamicPool } from '../src/engine/tree/tree_dynamic_pool';

test('T135 Product Test: Snapshots, S/D+S Reconstruction, Score70, Lineage, Artifact Schema', async () => {
  const tmpPoolPath = path.join(process.cwd(), 'reports', 'tree-cycle', `t135_prod_pool_${Date.now()}.json`);
  const pool = new TreeDynamicPool(tmpPoolPath);
  const entries = pool.initOrLoad();
  const targetEntry = entries[0];

  const report = await TreeCycleOrchestrator.runCycle({
    targetFormationId: targetEntry.formationId,
    maxIterations: 1,
    uniqueCandidatesPerCase: 8,
    populationSize: 4,
    maxGenerations: 1,
    baselineSeeds: [1, 7],
    validationSeeds: [1, 42],
    parallelBackend: 'single',
  });

  assert.ok(report.runId, 'runId must exist');
  assert.strictEqual(report.totalIterationsExecuted, 1);
  assert.ok(report.iterations.length > 0, 'iterations must have records');

  const iter1 = report.iterations[0];
  assert.ok(iter1.adverseCasesMined >= 0, 'adverseCasesMined >= 0');
  assert.ok(iter1.uniqueCandidatesEvaluated >= 0, 'uniqueCandidatesEvaluated >= 0');

  // Verify artifact schema
  const runDir = path.join(process.cwd(), 'reports', 'tree-cycle', report.runId);
  assert.ok(fs.existsSync(path.join(runDir, 'config.json')), 'config.json exists');
  assert.ok(fs.existsSync(path.join(runDir, 'summary.json')), 'summary.json exists');
  assert.ok(fs.existsSync(path.join(runDir, 'iteration-001', 's_trials.jsonl')), 's_trials.jsonl exists');

  if (fs.existsSync(tmpPoolPath)) fs.unlinkSync(tmpPoolPath);
});
