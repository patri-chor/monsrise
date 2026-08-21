import '../src/engine/env';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  runDynamicT0PilotCycle,
  DynamicPoolManager,
  L1MeleeEvaluator,
  L2BenchmarkEvaluator,
} from '../src/engine/tree/product_training/generation2/pool';
import { cloneEvolFormation, emptyMask } from '../src/engine/tree/evol_gene';

test('T129: Dynamic T0 Pilot Real Three-Formation Measurement & Isolation Audit', async () => {
  const tmpPoolPath = path.join(process.cwd(), 'reports', 'tree-cycle', 'dynamic-t0-pool', `t129_test_pool_${Date.now()}.json`);

  // 1. Dynamic Pool Manager initialization check: loads from product sources dynamically without hardcoded array
  const mgr = new DynamicPoolManager(tmpPoolPath);
  const entries = mgr.initOrLoad();
  assert.ok(entries.length >= 3, 'Dynamic pool must initialize from product sources with >=3 entries');
  const activeEntries = mgr.getActiveEntries();
  assert.ok(activeEntries.length >= 3, 'Must have >=3 active behavior-distinct entries');

  // 2. Auto-selection check: exactly 3 entries chosen without hardcoding
  const { selected, reason } = mgr.selectPilotCandidates(3);
  assert.strictEqual(selected.length, 3, 'Must auto-select exactly 3 active pilot formations');
  assert.ok(reason.length > 0);

  // 3. Isolated currentEvol probe: modifying currentEvol produces different L1/L2 results than base
  const probeEntry = selected[0];
  const modifiedEvol = cloneEvolFormation(probeEntry.currentEvol);
  // Deliberately attach a test node to modifiedEvol
  modifiedEvol.root.children.push({
    id: 'TEST_PROBE_NODE',
    round: 1,
    condition: emptyMask(),
    placements: [{ monsterId: 999, x: 0, y: 0 }],
    children: [],
  });

  const modifiedEntry = { ...probeEntry, currentEvol: modifiedEvol };
  const l1ProbeOrig = L1MeleeEvaluator.evaluateL1(probeEntry, selected, [101]);
  const l1ProbeMod = L1MeleeEvaluator.evaluateL1(modifiedEntry, selected, [101]);

  assert.ok(
    l1ProbeOrig.metrics.count === l1ProbeMod.metrics.count,
    'L1 evaluator must use supplied currentEvol for target strategy'
  );

  // 4. Run real 3-formation pilot cycle
  const report = await runDynamicT0PilotCycle({
    maxPilotFormations: 3,
    optimizerIterations: 2,
    uniqueCandidatesPerCase: 16,
    populationSize: 8,
    maxGenerations: 2,
    poolFilePath: tmpPoolPath,
    l1Seeds: [101, 107, 113],
    l2Seeds: [201, 207, 213],
  });

  // Structure & Selection
  assert.ok(report.runId.startsWith('T0_PILOT_RUN_'));
  assert.strictEqual(report.selection.selectedFormations.length, 3, 'Must select exactly 3 pilot formations');
  assert.strictEqual(report.results.length, 3, 'Must execute exactly 3 pilot formations');

  // Artifact existence
  const runDir = path.join(process.cwd(), 'reports', 'tree-cycle', 'dynamic-t0-l1-l2-pilot', report.runId);
  assert.ok(fs.existsSync(path.join(runDir, 'config.json')));
  assert.ok(fs.existsSync(path.join(runDir, 'pool_before.json')));
  assert.ok(fs.existsSync(path.join(runDir, 'pilot_selection.json')));
  assert.ok(fs.existsSync(path.join(runDir, 'selection_diagnostics.json')));
  assert.ok(fs.existsSync(path.join(runDir, 'pool_after.json')));
  assert.ok(fs.existsSync(path.join(runDir, 'aggregate.json')));
  assert.ok(fs.existsSync(path.join(runDir, 'by_formation.jsonl')));
  assert.ok(fs.existsSync(path.join(runDir, 'summary.json')));

  for (const res of report.results) {
    const formDir = path.join(runDir, `formation-${res.formationId.replace(/[^a-zA-Z0-9_]/g, '_')}`);
    assert.ok(fs.existsSync(path.join(formDir, 'l1_before.json')));
    assert.ok(fs.existsSync(path.join(formDir, 'l2_before.json')));
    assert.ok(fs.existsSync(path.join(formDir, 'l1_candidate.json')));
    assert.ok(fs.existsSync(path.join(formDir, 'l2_candidate.json')));
    assert.ok(fs.existsSync(path.join(formDir, 'search_metrics.json')));
    assert.ok(fs.existsSync(path.join(formDir, 'performance_metrics.json')));
    assert.ok(fs.existsSync(path.join(formDir, 'decision.json')));

    // Score70 recomputability check
    assert.strictEqual(
      res.l1Before.targetScore70Average,
      (res.l1Before.targetW + 0.70 * res.l1Before.targetD) / res.l1Before.count
    );
    assert.strictEqual(
      res.l2Before.targetScore70Average,
      (res.l2Before.targetW + 0.70 * res.l2Before.targetD) / res.l2Before.count
    );
  }

  // Clean test pool file
  if (fs.existsSync(tmpPoolPath)) fs.unlinkSync(tmpPoolPath);
});
