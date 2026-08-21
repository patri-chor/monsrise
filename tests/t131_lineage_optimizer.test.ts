import '../src/engine/env';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  runDynamicT0PilotCycle,
  DynamicPoolManager,
} from '../src/engine/tree/product_training/generation2/pool';
import {
  runGeneration2OptimizerCycle,
} from '../src/engine/tree/product_training/generation2/cycle';
import { cloneEvolFormation, emptyMask } from '../src/engine/tree/evol_gene';

test('T131: S and D+S Lineage Optimizer & Dynamic Snapshot Propagation Audit', async () => {
  const tmpPoolPath = path.join(process.cwd(), 'reports', 'tree-cycle', 'dynamic-t0-pool', `t131_test_pool_${Date.now()}.json`);

  // 1. Snapshot Propagation Integrity: Passing custom targetSnapshot to cycle executes with custom evol
  const mgr = new DynamicPoolManager(tmpPoolPath);
  const entries = mgr.initOrLoad();
  const baseEntry = entries[0];

  const customEvol = cloneEvolFormation(baseEntry.currentEvol);
  customEvol.root.children.push({
    id: 'CUSTOM_TEST_NODE_T131',
    round: 2,
    condition: emptyMask(),
    placements: [{ monsterId: 101, x: 1, y: 1 }],
    children: [],
  });

  const customCycleReport = await runGeneration2OptimizerCycle({
    targetFormationId: baseEntry.formationId,
    targetSnapshot: {
      formationId: baseEntry.formationId,
      displayName: 'Custom T131 Test Formation',
      canonicalFingerprint: 'FP_CUSTOM_T131_TEST',
      rootSourceId: baseEntry.rootSourceId,
      team: [
        { monsterId: 101, badgeIds: [] },
        { monsterId: 102, badgeIds: [] },
        { monsterId: 103, badgeIds: [] },
      ],
      evol: customEvol,
    },
    maxIterations: 1,
    uniqueCandidatesPerCase: 6,
    populationSize: 3,
    maxGenerations: 1,
    baselineSeeds: [1, 7],
    validationSeeds: [1, 42],
  });

  assert.ok(customCycleReport.runId.startsWith('CYCLE_RUN_'));
  assert.strictEqual(customCycleReport.totalIterationsExecuted, 1);

  // Check local_lineages.jsonl output
  const cycleDir = path.join(process.cwd(), 'reports', 'tree-cycle', 'generation2-optimizer-cycle', customCycleReport.runId, 'iteration-001');
  assert.ok(fs.existsSync(path.join(cycleDir, 'local_lineages.jsonl')), 'local_lineages.jsonl must exist');

  // 2. Real Batch Pilot execution with exact snapshot propagation
  const report = await runDynamicT0PilotCycle({
    maxPilotFormations: 3,
    optimizerIterations: 1,
    uniqueCandidatesPerCase: 8,
    populationSize: 4,
    maxGenerations: 1,
    poolFilePath: tmpPoolPath,
    l1Seeds: [101, 107],
    l2Seeds: [201, 207],
  });

  assert.strictEqual(report.results.length, 3);
  const runDir = path.join(process.cwd(), 'reports', 'tree-cycle', 'dynamic-t0-l1-l2-pilot', report.runId);

  for (const res of report.results) {
    const formDir = path.join(runDir, `formation-${res.formationId.replace(/[^a-zA-Z0-9_]/g, '_')}`);
    assert.ok(fs.existsSync(path.join(formDir, 'lineage_summary.json')));
    assert.ok(fs.existsSync(path.join(formDir, 'dynamic_snapshot_propagation.json')));
  }

  // Clean test pool file
  if (fs.existsSync(tmpPoolPath)) fs.unlinkSync(tmpPoolPath);
});
