// ============================================================
// tests/t051_dynamic_ladder_and_score70.test.ts
// Unit tests for T051: Dynamic Strength Ladder, Active-L2 & Score70
// ============================================================

import '../src/engine/env';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { computeScore70Metrics } from '../src/engine/tree/product_training/formation_tiers_v4';

const T037_DIR = resolve('tests/fixtures/tree/experience_library/product_path_t037');
const R0_ROOTS_PATH = resolve(`${T037_DIR}/r0_historical_roots.json`);
const ACTIVE_L2_MANIFEST_PATH = resolve(`${T037_DIR}/active_l2_manifest.json`);
const FORMATION_LIBRARY_V4_PATH = resolve(`${T037_DIR}/formation_strength_library.v4.json`);
const LEDGER_V4_PATH = resolve(`${T037_DIR}/formation_winrate_audit_ledger.v4.jsonl`);
const USER_TXT_REPORT_PATH = resolve('winrate_report.txt');

describe('T051: Score70 Arithmetic & High-Draw Undefeated Cases', () => {
  it('passes 80% draw, 20% loss, 0% win regression case (Score70 = 0.56)', () => {
    const m = computeScore70Metrics(0, 80, 20);
    assert.equal(m.n, 100);
    assert.equal(m.primaryScore70, 0.56);
    assert.equal(m.winRate, 0);
    assert.equal(m.drawRate, 0.8);
    assert.equal(m.lossRate, 0.2);
    assert.equal(m.noLossRate, 0.8);
  });

  it('passes 80% draw, 20% win, 0% loss regression case (Score70 = 0.76)', () => {
    const m = computeScore70Metrics(20, 80, 0);
    assert.equal(m.n, 100);
    assert.equal(m.primaryScore70, 0.76);
    assert.equal(m.winRate, 0.2);
    assert.equal(m.drawRate, 0.8);
    assert.equal(m.lossRate, 0);
    assert.equal(m.noLossRate, 1.0);
  });

  it('passes 100% draw undefeated case (Score70 = 0.70)', () => {
    const m = computeScore70Metrics(0, 100, 0);
    assert.equal(m.n, 100);
    assert.equal(m.primaryScore70, 0.70);
    assert.equal(m.noLossRate, 1.0);
  });

  it('enforces Score70 is always in [0, 1] and W+D+L=N', () => {
    for (let w = 0; w <= 10; w += 2) {
      for (let d = 0; d <= 10; d += 2) {
        for (let l = 0; l <= 10; l += 2) {
          if (w + d + l === 0) continue;
          const m = computeScore70Metrics(w, d, l);
          assert.equal(m.w + m.d + m.l, m.n);
          assert(m.primaryScore70 >= 0 && m.primaryScore70 <= 1);
        }
      }
    }
  });
});

describe('T051: R0 Historical Roots Immutability', () => {
  it('r0_historical_roots.json exists with 11 immutable roots', () => {
    assert(existsSync(R0_ROOTS_PATH), 'Missing r0_historical_roots.json');
    const roots = JSON.parse(readFileSync(R0_ROOTS_PATH, 'utf8'));
    assert.equal(roots.length, 11);
    for (const r of roots) {
      assert(r.r0SourceId, 'Missing r0SourceId');
      assert(r.immutableFingerprint, 'Missing immutableFingerprint');
      assert(r.canonicalTeamSnapshot && r.canonicalTeamSnapshot.length > 0, 'Empty team snapshot');
    }
  });
});

describe('T051: Active-L2 Manifest Integrity', () => {
  it('active_l2_manifest.json exists and contains valid manifest hash', () => {
    assert(existsSync(ACTIVE_L2_MANIFEST_PATH), 'Missing active_l2_manifest.json');
    const manifest = JSON.parse(readFileSync(ACTIVE_L2_MANIFEST_PATH, 'utf8'));
    assert.equal(manifest.schemaVersion, 'ACTIVE_L2_MANIFEST_V1');
    assert(manifest.manifestHash && manifest.manifestHash.length > 0);
    assert.equal(manifest.members.length, 11);
  });
});

describe('T051: V4 Formation Library & Dynamic Ladder', () => {
  it('formation_strength_library.v4.json exists with healthy tier distribution', () => {
    assert(existsSync(FORMATION_LIBRARY_V4_PATH), 'Missing formation_strength_library.v4.json');
    const lib = JSON.parse(readFileSync(FORMATION_LIBRARY_V4_PATH, 'utf8'));
    assert.equal(lib.schemaVersion, 'T051_FORMATION_LIBRARY_V4');
    assert.equal(lib.counts.T0Count, 11);
    assert(lib.counts.activeTotal >= 80 && lib.counts.activeTotal <= 120);
    assert(lib.formations.length >= lib.counts.activeTotal);
  });

  it('formation_winrate_audit_ledger.v4.jsonl reconciles with library records', () => {
    assert(existsSync(LEDGER_V4_PATH), 'Missing formation_winrate_audit_ledger.v4.jsonl');
    const lines = readFileSync(LEDGER_V4_PATH, 'utf8').split('\n').filter(Boolean);
    assert(lines.length >= 90);
    for (const l of lines) {
      const rec = JSON.parse(l);
      assert(rec.formationId);
      assert(rec.rootR0SourceId);
      assert(rec.currentDynamicTier);
      assert(['T0', 'T1', 'T2', 'T3', 'T4'].includes(rec.currentDynamicTier));
    }
  });

  it('winrate_report.txt exists and contains human-readable report', () => {
    assert(existsSync(USER_TXT_REPORT_PATH), 'Missing winrate_report.txt');
    const content = readFileSync(USER_TXT_REPORT_PATH, 'utf8');
    assert(content.includes('MONSRISE 阵型胜率与优化次数汇总报告'));
    assert(content.includes('统计总数: 活跃阵型共'));
  });
});
