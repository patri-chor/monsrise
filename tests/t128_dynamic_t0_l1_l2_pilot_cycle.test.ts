import '../src/engine/env';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  runDynamicT0PilotCycle,
} from '../src/engine/tree/product_training/generation2/pool';

test('T128: Dynamic T0 L1/L2 Pilot Cycle & Multi-Formation Learning Audit', async () => {
  const tmpPoolPath = path.join(process.cwd(), 'reports', 'tree-cycle', 'dynamic-t0-pool', `test_pool_${Date.now()}.json`);

  const report = await runDynamicT0PilotCycle({
    maxPilotFormations: 2,
    optimizerIterations: 1,
    uniqueCandidatesPerCase: 6,
    populationSize: 3,
    maxGenerations: 1,
    poolFilePath: tmpPoolPath,
    l1Seeds: [101, 107],
    l2Seeds: [201, 207],
  });

  // 1. Structure check
  assert.ok(report.runId.startsWith('T0_PILOT_RUN_'));
  assert.ok(report.selection.selectedFormations.length > 0);
  assert.ok(report.results.length === report.selection.selectedFormations.length);

  // 2. Output files check
  const runDir = path.join(process.cwd(), 'reports', 'tree-cycle', 'dynamic-t0-l1-l2-pilot', report.runId);
  assert.ok(fs.existsSync(path.join(runDir, 'config.json')));
  assert.ok(fs.existsSync(path.join(runDir, 'pool_before.json')));
  assert.ok(fs.existsSync(path.join(runDir, 'pilot_selection.json')));
  assert.ok(fs.existsSync(path.join(runDir, 'pool_after.json')));
  assert.ok(fs.existsSync(path.join(runDir, 'aggregate.json')));
  assert.ok(fs.existsSync(path.join(runDir, 'by_formation.jsonl')));
  assert.ok(fs.existsSync(path.join(runDir, 'summary.json')));

  // 3. Per formation artifact checks
  for (const res of report.results) {
    const formDir = path.join(runDir, `formation-${res.formationId.replace(/[^a-zA-Z0-9_]/g, '_')}`);
    assert.ok(fs.existsSync(path.join(formDir, 'l1_before.json')));
    assert.ok(fs.existsSync(path.join(formDir, 'l2_before.json')));
    assert.ok(fs.existsSync(path.join(formDir, 'l1_candidate.json')));
    assert.ok(fs.existsSync(path.join(formDir, 'l2_candidate.json')));
    assert.ok(fs.existsSync(path.join(formDir, 'search_metrics.json')));
    assert.ok(fs.existsSync(path.join(formDir, 'decision.json')));
  }

  // Clean test pool file
  if (fs.existsSync(tmpPoolPath)) fs.unlinkSync(tmpPoolPath);
});
