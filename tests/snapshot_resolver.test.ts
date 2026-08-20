import '../src/engine/env';
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveFormationSnapshot, registerFormationSnapshot, SnapshotResolutionError } from '../src/engine/tree/product_training/snapshot_resolver';
import { loadProductSources } from '../src/engine/tree/product_training/01_sources';
import { formationToEvol, walkEvolNodes } from '../src/engine/tree/evol_gene';

test('SnapshotResolver: resolves R0 root formations with strict verified fingerprints', () => {
  const sources = loadProductSources().executable;
  for (const src of sources) {
    const srcId = (src as any).id;
    const resolved = resolveFormationSnapshot({ formationId: `t0:${srcId}` });
    assert.equal(resolved.rootR0SourceId, srcId);
    assert.ok(resolved.canonicalFingerprint.length > 0);
    assert.equal(resolved.team.length, src.team.length);
  }
});

test('SnapshotResolver: resolves historical registered candidate snapshot accurately without fallback', () => {
  const resolved = resolveFormationSnapshot({
    formationId: 'cand:springsword:spatial_local:0',
    canonicalFingerprint: '64c37c871c2ba5bb2f6803db',
  });
  assert.equal(resolved.formationId, 'cand:springsword:spatial_local:0');
  assert.equal(resolved.canonicalFingerprint, '64c37c871c2ba5bb2f6803db');
  assert.equal(resolved.provenance, 'candidate_registry#cand:springsword:spatial_local:0');
});

test('SnapshotResolver: rejects unknown formations fail-closed without fallback to root', () => {
  assert.throws(() => {
    resolveFormationSnapshot({ formationId: 'cand:unknown_non_existent:0' });
  }, (err: any) => {
    return err instanceof SnapshotResolutionError && err.code === 'WEB/TRAINING_SNAPSHOT_UNRESOLVED';
  });
});

test('SnapshotResolver: rejects fingerprint mismatch during query', () => {
  assert.throws(() => {
    resolveFormationSnapshot({
      formationId: 't0:springsword',
      canonicalFingerprint: 'invalid_dummy_fingerprint_123',
    });
  }, (err: any) => {
    return err instanceof SnapshotResolutionError && err.code === 'WEB/TRAINING_SNAPSHOT_UNRESOLVED';
  });
});

test('SnapshotResolver: rejects mismatched declared fingerprint at registration', () => {
  const source = loadProductSources().executable[0];
  const evol = formationToEvol(source);

  assert.throws(() => {
    registerFormationSnapshot({
      formationId: 'cand:identity-contract:invalid',
      displayName: 'identity-contract-invalid',
      canonicalFingerprint: 'declared_fingerprint_does_not_match_tree',
      calculatorPolicyFingerprint: 'calc_pol_default_v1',
      team: source.team.map(slot => ({ monsterId: slot.monsterId, badgeIds: [...slot.badgeIds] })),
      evol,
      provenance: 'test',
      rootR0SourceId: (source as any).id,
    });
  }, (err: any) => {
    return err instanceof SnapshotResolutionError && err.code === 'WEB/TRAINING_SNAPSHOT_UNRESOLVED';
  });
});
