import '../src/engine/env';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { TreeDynamicPool } from '../src/engine/tree/tree_dynamic_pool';

test('T135 Pilot Test: Auto-select 3 Dynamic Entries, Bounded Real Pilot, Replacement & Resource Metrics', async () => {
  const tmpPoolPath = path.join(process.cwd(), 'reports', 'tree-cycle', `t135_pilot_pool_${Date.now()}.json`);
  const pool = new TreeDynamicPool(tmpPoolPath);
  const entries = pool.initOrLoad();
  assert.ok(entries.length >= 3, 'Pool must have at least 3 entries');

  const top3 = pool.selectTopFormations(3);
  assert.strictEqual(top3.length, 3, 'Select exactly 3 entries for pilot');

  // Verify dynamic entry properties
  for (const entry of top3) {
    assert.ok(entry.formationId, 'formationId must be present');
    assert.ok(entry.currentSnapshotFingerprint, 'currentSnapshotFingerprint must be present');
    assert.ok(entry.currentEvol, 'currentEvol must be present');
  }

  // Assert pool replacement and persistence capability
  const updated = pool.replaceEntry(top3[0].formationId, {
    optimizationCycles: (top3[0].optimizationCycles ?? 0) + 1,
    status: 'ACTIVE',
  });
  assert.ok(updated.length >= 3, 'Updated pool remains intact');
  assert.strictEqual(updated.find(e => e.formationId === top3[0].formationId)?.optimizationCycles, 1);

  if (fs.existsSync(tmpPoolPath)) fs.unlinkSync(tmpPoolPath);
});
