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
  DEFAULT_CYCLE_CONFIG,
  LineageManager,
} from '../src/engine/tree/product_training/generation2/cycle';
import { cloneEvolFormation, emptyMask } from '../src/engine/tree/evol_gene';

test('T132: Executable S/D+S Frontier and Back-Propagation Audit', async () => {
  // 1. Default config assertions: S unique candidates per case default is 32
  assert.strictEqual(DEFAULT_CYCLE_CONFIG.uniqueCandidatesPerCase, 32, 'Default S trials per case must be 32');

  const tmpPoolPath = path.join(process.cwd(), 'reports', 'tree-cycle', 'dynamic-t0-pool', `t132_test_pool_${Date.now()}.json`);
  const mgr = new DynamicPoolManager(tmpPoolPath);
  const entries = mgr.initOrLoad();
  const baseEntry = entries[0];

  // 2. Direct unit audit for D+S 4x8 loop and D catalog generator
  const resolver = (await import('../src/engine/tree/product_training/snapshot_resolver')).FormationSnapshotResolver.getInstance();
  resolver.init();
  const targetSnap = resolver.resolveFormationSnapshot({ formationId: baseEntry.formationId });

  const dCatalog = LineageManager.generateDCatalog({
    team: targetSnap.team,
    evol: baseEntry.currentEvol,
    canonicalFingerprint: baseEntry.currentSnapshotFingerprint,
  }, 132001);

  assert.ok(dCatalog.length > 0 && dCatalog.length <= 4, 'D catalog must generate <= 4 valid changes');
  for (const d of dCatalog) {
    assert.ok(d.valid, 'D candidate must be marked valid');
    assert.ok(d.modifiedTeam.length >= 6 && d.modifiedTeam.length <= 8, 'Team size must be 6..8');
  }

  // 3. Fast executable cycle test verifying all T132 required artifacts
  const report = await runGeneration2OptimizerCycle({
    targetFormationId: baseEntry.formationId,
    maxIterations: 1,
    uniqueCandidatesPerCase: 8,
    populationSize: 4,
    maxGenerations: 1,
    baselineSeeds: [1, 7],
    validationSeeds: [1, 42],
  });

  assert.ok(report.runId.startsWith('CYCLE_RUN_'));
  assert.strictEqual(report.totalIterationsExecuted, 1);

  const iterDir = path.join(process.cwd(), 'reports', 'tree-cycle', 'generation2-optimizer-cycle', report.runId, 'iteration-001');

  // Verify all T132 required artifact files exist
  assert.ok(fs.existsSync(path.join(iterDir, 's_trials.jsonl')), 's_trials.jsonl must exist');
  assert.ok(fs.existsSync(path.join(iterDir, 'd_catalog.jsonl')), 'd_catalog.jsonl must exist');
  assert.ok(fs.existsSync(path.join(iterDir, 'ds_trials.jsonl')), 'ds_trials.jsonl must exist');
  assert.ok(fs.existsSync(path.join(iterDir, 'local_lineages.jsonl')), 'local_lineages.jsonl must exist');
  assert.ok(fs.existsSync(path.join(iterDir, 'backprop_validations.jsonl')), 'backprop_validations.jsonl must exist');
  assert.ok(fs.existsSync(path.join(iterDir, 'lineage_selection.json')), 'lineage_selection.json must exist');

  // Clean test pool file
  if (fs.existsSync(tmpPoolPath)) fs.unlinkSync(tmpPoolPath);
});
