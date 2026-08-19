// ============================================================
// scripts/tree_product_training/check_candidates.ts
// T037 候选批次只读验证脚本（无仿真）
//
// 验证：
//   - 所有可执行源：8怪、合法性、规范指纹唯一性
//   - 候选元数据：operatorFamily、sourceRepairProvenance（gift_jungle）
//   - 拒绝记录：合法拒绝原因，无假阳性
//   - spatial_local/formation_transform 接受记录坐标合法性
// ============================================================

import '../../src/engine/env';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadProductSources } from '../../src/engine/tree/product_training/01_sources';
import { computeCandidateFingerprint } from '../../src/engine/tree/product_training/02_candidates';
import { validateCandidateLegality } from '../../src/engine/tree/product_training/03_validate';
import { generateCandidateBatch } from '../../src/engine/tree/product_training/04_screen';
import type { CandidateEntry } from '../../src/engine/tree/product_training/04_screen';
import { formationToEvol } from '../../src/engine/tree/evol_gene';
import type { Formation } from '../../src/ai/types';

console.log('=== check_candidates.ts — T037 Candidate Batch Verification ===\n');

let passed = 0;
let failed = 0;

function check(label: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${label}`);
    passed++;
  } catch (e: any) {
    console.error(`  ✗ ${label}`);
    console.error(`    ${e.message}`);
    failed++;
  }
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

// ---- 加载数据 ----

const sources = loadProductSources();
const execSources = sources.executable as unknown as Formation[];
console.log(`--- Executable sources: ${execSources.length} ---`);

// ---- 1. 源合法性 ----

check('all executable sources have exactly 8 monsters', () => {
  const bad = execSources.filter((s: any) => s.team?.length !== 8);
  assert(bad.length === 0, `Sources with bad team size: ${bad.map((s: any) => s.id).join(', ')}`);
});

check('gift_jungle is included as executable (8-monster repair)', () => {
  const gj = execSources.find((s: any) => s.id === 'gift_jungle');
  assert(gj !== undefined, 'gift_jungle not found in executable sources');
  assert((gj as any).team.length === 8, `gift_jungle team size: ${(gj as any).team.length}, expected 8`);
});

check('no source has isLegacyBaseline=true in executable set', () => {
  const legacy = execSources.filter((s: any) => s.isLegacyBaseline === true);
  assert(legacy.length === 0, `Legacy sources in executable set: ${legacy.map((s: any) => s.id).join(', ')}`);
});

check('all executable source fingerprints are unique', () => {
  const fps = execSources.map((s: any) => {
    const evol = formationToEvol(s);
    return computeCandidateFingerprint(evol);
  });
  const unique = new Set(fps);
  assert(unique.size === fps.length, `Duplicate fingerprints: ${fps.length} sources, ${unique.size} unique`);
});

check('all executable sources pass validateCandidateLegality', () => {
  const invalid = [];
  for (const src of execSources) {
    const evol = formationToEvol(src);
    const result = validateCandidateLegality(evol);
    if (!result.valid) invalid.push({ id: (src as any).id, reasons: result.reasons });
  }
  assert(invalid.length === 0, `Invalid sources: ${JSON.stringify(invalid)}`);
});

// ---- 2. 候选批次 ----

const allEntries: CandidateEntry[] = generateCandidateBatch(execSources);
const validEntries = allEntries.filter(e => !e.meta.rejected);
const rejectedEntries = allEntries.filter(e => e.meta.rejected);

console.log(`\n--- Candidate batch: ${allEntries.length} total (${validEntries.length} valid, ${rejectedEntries.length} rejected) ---`);

check('each source has a baseline entry', () => {
  for (const src of execSources) {
    const srcId = (src as any).id;
    const baseline = validEntries.find(e => e.meta.operatorFamily === 'baseline' && e.meta.sourceId === srcId);
    assert(baseline !== undefined, `Missing baseline for source: ${srcId}`);
  }
});

check('all valid baselines have operatorFamily=baseline', () => {
  const baselines = validEntries.filter(e => e.meta.operatorFamily === 'baseline');
  assert(baselines.length === execSources.length, `Expected ${execSources.length} baselines, got ${baselines.length}`);
});

check('all valid entries have canonical fingerprint set', () => {
  const missing = validEntries.filter(e => !e.meta.canonicalFingerprint);
  assert(missing.length === 0, `Entries missing canonicalFingerprint: ${missing.map(e => e.meta.candidateId).join(', ')}`);
});

check('all valid candidate fingerprints are unique', () => {
  const fps = validEntries.map(e => e.meta.canonicalFingerprint!);
  const unique = new Set(fps);
  assert(unique.size === fps.length, `Duplicate candidate fingerprints: ${fps.length} entries, ${unique.size} unique`);
});

check('all valid non-baseline candidates have valid operatorFamily', () => {
  const validFamilies = new Set(['baseline', 'spatial_local', 'formation_transform', 'strategy_schedule_branch']);
  const bad = validEntries.filter(e => !validFamilies.has(e.meta.operatorFamily));
  assert(bad.length === 0, `Unknown operatorFamily: ${bad.map(e => `${e.meta.candidateId}:${e.meta.operatorFamily}`).join(', ')}`);
});

check('each operator family has at least one entry (valid or legal rejection)', () => {
  const families = ['spatial_local', 'formation_transform', 'strategy_schedule_branch'];
  for (const fam of families) {
    const hasEntry = allEntries.some(e => e.meta.operatorFamily === fam);
    assert(hasEntry, `No entry for operatorFamily: ${fam}`);
  }
});

check('rejected entries have non-empty rejectionReason', () => {
  const missing = rejectedEntries.filter(e => !e.meta.rejectionReason);
  assert(missing.length === 0, `Rejected entries missing reason: ${missing.map(e => e.meta.candidateId).join(', ')}`);
});

check('strategy_schedule_branch entries are all legally rejected in Phase-2', () => {
  const branchEntries = allEntries.filter(e => e.meta.operatorFamily === 'strategy_schedule_branch');
  assert(branchEntries.length === execSources.length, `Expected ${execSources.length} strategy_schedule_branch entries, got ${branchEntries.length}`);
  const notRejected = branchEntries.filter(e => !e.meta.rejected);
  assert(notRejected.length === 0, `strategy_schedule_branch entries not rejected: ${notRejected.map(e => e.meta.candidateId).join(', ')}`);
  const wrongReason = branchEntries.filter(e => e.meta.rejectionReason && !e.meta.rejectionReason.includes('DEFERRED_TO_T038'));
  assert(wrongReason.length === 0, `strategy_schedule_branch with wrong rejection reason: ${wrongReason.map(e => e.meta.candidateId).join(', ')}`);
});

check('gift_jungle baseline fingerprint differs from legacy 7-monster fingerprint', () => {
  const gjEntry = validEntries.find(e => e.meta.sourceId === 'gift_jungle' && e.meta.operatorFamily === 'baseline');
  assert(gjEntry !== undefined, 'gift_jungle baseline not found');
  // 7-monster 旧指纹（来自 T035 历史数据）
  const LEGACY_7M_FP = '4c913570e3c9';
  assert(gjEntry.meta.canonicalFingerprint !== LEGACY_7M_FP, `gift_jungle fingerprint matches legacy 7-monster fp: ${gjEntry.meta.canonicalFingerprint}`);
});

// ---- 3. 有效候选合法性抽查 ----

check('all accepted spatial_local candidates pass legality check', () => {
  const spatial = validEntries.filter(e => e.meta.operatorFamily === 'spatial_local');
  for (const entry of spatial) {
    const result = validateCandidateLegality(entry.evol);
    assert(result.valid, `spatial_local candidate ${entry.meta.candidateId} failed: ${result.reasons.join('; ')}`);
  }
});

check('all accepted formation_transform candidates pass legality check', () => {
  const transform = validEntries.filter(e => e.meta.operatorFamily === 'formation_transform');
  for (const entry of transform) {
    const result = validateCandidateLegality(entry.evol);
    assert(result.valid, `formation_transform candidate ${entry.meta.candidateId} failed: ${result.reasons.join('; ')}`);
  }
});

check('all accepted candidates have delta metadata set', () => {
  const nonBaseline = validEntries.filter(e => e.meta.operatorFamily !== 'baseline');
  const noDelta = nonBaseline.filter(e => !e.meta.delta);
  assert(noDelta.length === 0, `Accepted non-baseline candidates missing delta: ${noDelta.map(e => e.meta.candidateId).join(', ')}`);
});

// ---- 4. 证据文件存在性（若已生成） ----

const T037_DIR = resolve('tests/fixtures/tree/experience_library/product_path_t037');
console.log(`\n--- Evidence directory: ${T037_DIR} ---`);

const expectedFiles = ['manifest.json', 'sources.jsonl', 'candidate_registry.jsonl', 'rejected_candidates.jsonl',
  'screen_cells.jsonl', 'screen_observations.jsonl', 'cursor.json', 'README.md'];

if (existsSync(T037_DIR)) {
  for (const f of expectedFiles) {
    check(`evidence file exists: ${f}`, () => {
      assert(existsSync(`${T037_DIR}/${f}`), `Missing evidence file: ${f}`);
    });
  }

  check('candidate_registry.jsonl count matches valid entries count', () => {
    const lines = readFileSync(`${T037_DIR}/candidate_registry.jsonl`, 'utf8').split('\n').filter(Boolean);
    assert(lines.length === validEntries.length, `registry=${lines.length}, expected=${validEntries.length}`);
  });

  check('rejected_candidates.jsonl count matches rejected entries count', () => {
    const lines = readFileSync(`${T037_DIR}/rejected_candidates.jsonl`, 'utf8').split('\n').filter(Boolean);
    assert(lines.length === rejectedEntries.length, `rejected=${lines.length}, expected=${rejectedEntries.length}`);
  });
} else {
  console.log('  (evidence directory not yet created — run run_screen.ts first)');
}

// ---- Summary ----

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
console.log('✓ check_candidates PASSED\n');
