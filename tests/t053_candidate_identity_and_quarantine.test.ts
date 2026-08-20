import '../src/engine/env';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FormationSnapshotResolver,
  resolveFormationSnapshot,
  registerFormationSnapshot,
  SnapshotResolutionError,
} from '../src/engine/tree/product_training/snapshot_resolver';
import {
  deduplicateActiveFormationsByBehavior,
  type ActiveFormationV4,
} from '../src/engine/tree/product_training/formation_tiers_v4';
import {
  verifyBatchPayloadIdentity,
} from '../src/engine/tree/product_training/eval_engine';
import { loadProductSources } from '../src/engine/tree/product_training/01_sources';
import { formationToEvol, cloneEvolFormation, walkEvolNodes } from '../src/engine/tree/evol_gene';
import { computeCandidateFingerprint } from '../src/engine/tree/product_training/02_candidates';

test('T053 A: Strict Lineage Reconstruction & Quarantine', () => {
  const resolver = FormationSnapshotResolver.getInstance();
  resolver.init();

  const quarantined = resolver.getQuarantinedRecords();
  assert.ok(quarantined.length > 0, 'Quarantine records should exist for incomplete lineage entries');

  // Verify that all quarantined branch records have INSUFFICIENT_ATOMIC_DATA
  const branchQuarantined = quarantined.filter(q => q.operatorFamily === 'strategy_schedule_branch');
  assert.ok(branchQuarantined.length > 0, 'Should quarantine vague branch candidates');
  for (const b of branchQuarantined) {
    assert.strictEqual(b.reason, 'INSUFFICIENT_ATOMIC_DATA');
    assert.ok(b.failureReason.includes('Missing exact AST branch node'));
    assert.strictEqual(resolver.hasSnapshot(b.candidateId), false, 'Quarantined candidate must not be registered');
  }
});

test('T053 A.2: Snapshot resolution fails closed on unknown or quarantined candidates', () => {
  assert.throws(() => {
    resolveFormationSnapshot({
      formationId: 'cand:unknown:non_existent:123',
    });
  }, (err: any) => {
    return err instanceof SnapshotResolutionError && err.code === 'WEB/TRAINING_SNAPSHOT_UNRESOLVED';
  });

  assert.throws(() => {
    resolveFormationSnapshot({
      formationId: 'cand:springsword:strategy_schedule_branch:c0_side2',
    });
  }, (err: any) => {
    return err instanceof SnapshotResolutionError && err.code === 'WEB/TRAINING_SNAPSHOT_UNRESOLVED';
  });
});

test('T053 B: Candidate Behavior Fingerprint Deduplication', () => {
  const mockFormations: ActiveFormationV4[] = [
    {
      formationId: 'cand:springsword:spatial_local:c0_110',
      rootR0SourceId: 'springsword',
      displayName: 'cand:springsword:spatial_local:c0_110',
      canonicalFingerprint: '51dd319f03f41d266e09fe3b',
      calculatorPolicyFingerprint: 'calc_pol_default_v1',
      activeRoles: ['ACTIVE_COMPETITOR'],
      currentDynamicTier: 'T1',
      previousTier: 'T3',
      activeLibraryRevision: 'v4.7.0',
      activeL2ManifestHash: 'hash1',
      activeL2Metrics: null,
      l1Metrics: null,
      l3Metrics: null,
      verificationState: 'INDEPENDENT_VERIFIED',
      l2AttemptsCount: 0,
      regradeReason: 'init',
      updatedAt: new Date().toISOString(),
    },
    {
      // Duplicate of the first one (same canonicalFingerprint)
      formationId: 'cand:springsword:spatial_local:c0_110_dup',
      rootR0SourceId: 'springsword',
      displayName: 'cand:springsword:spatial_local:c0_110_dup',
      canonicalFingerprint: '51dd319f03f41d266e09fe3b',
      calculatorPolicyFingerprint: 'calc_pol_default_v1',
      activeRoles: ['ACTIVE_COMPETITOR'],
      currentDynamicTier: 'T1',
      previousTier: 'T3',
      activeLibraryRevision: 'v4.7.0',
      activeL2ManifestHash: 'hash1',
      activeL2Metrics: null,
      l1Metrics: null,
      l3Metrics: null,
      verificationState: 'INDEPENDENT_VERIFIED',
      l2AttemptsCount: 0,
      regradeReason: 'init',
      updatedAt: new Date().toISOString(),
    },
    {
      // Unique formation
      formationId: 'cand:nutsavior:spatial_local:c0_110',
      rootR0SourceId: 'nutsavior',
      displayName: 'cand:nutsavior:spatial_local:c0_110',
      canonicalFingerprint: 'fe14d73e9531479cb0d6fc78',
      calculatorPolicyFingerprint: 'calc_pol_default_v1',
      activeRoles: ['ACTIVE_COMPETITOR'],
      currentDynamicTier: 'T1',
      previousTier: 'T3',
      activeLibraryRevision: 'v4.7.0',
      activeL2ManifestHash: 'hash1',
      activeL2Metrics: null,
      l1Metrics: null,
      l3Metrics: null,
      verificationState: 'INDEPENDENT_VERIFIED',
      l2AttemptsCount: 0,
      regradeReason: 'init',
      updatedAt: new Date().toISOString(),
    },
  ];

  const { activeUnique, duplicates } = deduplicateActiveFormationsByBehavior(mockFormations);
  assert.strictEqual(activeUnique.length, 2, 'Should have 2 unique active formations');
  assert.strictEqual(duplicates.length, 1, 'Should have 1 duplicate formation');

  const dup = duplicates[0];
  assert.strictEqual(dup.formationId, 'cand:springsword:spatial_local:c0_110_dup');
  assert.strictEqual(dup.duplicateOfFormationId, 'cand:springsword:spatial_local:c0_110');
  assert.ok(dup.activeRoles.includes('DUPLICATE_BEHAVIOR_FINGERPRINT_HISTORICAL'));
  assert.strictEqual(dup.verificationState, 'DUPLICATE_BEHAVIOR');
});

test('T053 C: Batch-Level Payload Identity Gate', () => {
  const sources = loadProductSources().executable;
  const src = sources[0];
  const evol = formationToEvol(src);
  const fp = computeCandidateFingerprint(evol);

  // 1. Valid matching payload
  const validRes = verifyBatchPayloadIdentity(fp, {
    canonicalFingerprint: fp,
    evol,
  });
  assert.strictEqual(validRes.valid, true);
  assert.strictEqual(validRes.error, undefined);

  // 2. Mismatching payload
  const invalidRes = verifyBatchPayloadIdentity('declared_fingerprint_mismatch', {
    canonicalFingerprint: fp,
    evol,
  });
  assert.strictEqual(invalidRes.valid, false);
  assert.ok(invalidRes.error?.includes('Payload identity mismatch'));
});

test('T053 D: T0 Optimization & Exact Snapshot Lineage Continuity', () => {
  const sources = loadProductSources().executable;
  const src = sources[0];
  const srcId = (src as any).id;

  const t0Snap = resolveFormationSnapshot({ formationId: `t0:${srcId}`, rootR0SourceId: srcId });
  assert.strictEqual(t0Snap.rootR0SourceId, srcId);
  assert.ok(t0Snap.team.length > 0);
  assert.strictEqual(computeCandidateFingerprint(t0Snap.evol), t0Snap.canonicalFingerprint);

  // Clone and mutate from T0 exact snapshot
  const evolMut = cloneEvolFormation(t0Snap.evol);
  const r1Node = walkEvolNodes(evolMut.root).find(n => n.round === 1) || evolMut.root;
  if (r1Node.placements.length > 0) {
    r1Node.placements[0].x = 10;
  }
  const mutFp = computeCandidateFingerprint(evolMut);
  const mutId = `cand:${srcId}:mut_test_${mutFp.slice(0, 6)}`;

  registerFormationSnapshot({
    formationId: mutId,
    displayName: mutId,
    canonicalFingerprint: mutFp,
    calculatorPolicyFingerprint: 'calc_pol_default_v1',
    team: t0Snap.team,
    evol: evolMut,
    provenance: `mutation#${t0Snap.formationId}`,
    rootR0SourceId: srcId,
  });

  const resolvedMut = resolveFormationSnapshot({ formationId: mutId, canonicalFingerprint: mutFp });
  assert.strictEqual(resolvedMut.formationId, mutId);
  assert.strictEqual(resolvedMut.canonicalFingerprint, mutFp);
});
