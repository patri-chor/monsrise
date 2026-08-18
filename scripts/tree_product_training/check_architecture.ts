// ============================================================
// scripts/tree_product_training/check_architecture.ts
// T036 模块架构只读检查脚本
// 验证：
//   - Phase-1 模块文件全部存在
//   - 无废弃沙盒导入（arena/hill_climb/sequential_tree_optimization/branch_induct）
//   - 规范指纹区分有意义变更并拒绝无操作
//   - R1 分支选择（含 P1/P2 坐标镜像）
//   - side-only 和 side+visible-opponent-feature 条件接受
//   - future-state R1 条件拒绝
// ============================================================

import '../../src/engine/env';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  loadProductSources,
  computeCandidateFingerprint,
  validateCandidateLegality,
  rejectIfNoOp,
  isR1Observable,
  getR1BranchSelection,
  listR1Branches,
  isSideOnlyCondition,
  isSidePlusOpponentFeatureCondition,
  hasFutureStateCondition,
  treeXToProductX,
} from '../../src/engine/tree/product_training';
import {
  formationToEvol,
  cloneEvolFormation,
  walkEvolNodes,
} from '../../src/engine/tree/evol_gene';
import type { FeatureMask } from '../../src/engine/tree/evol_gene';
import { treeStrategyFor } from '../../src/engine/tree/product_tree_strategy';

console.log('=== check_architecture.ts — T036 Architecture Verification ===\n');

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

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`ASSERT_FAIL: ${message}`);
}

// ---- 1. 模块文件存在 ----
const MODULE_FILES = [
  'src/engine/tree/product_training/01_sources.ts',
  'src/engine/tree/product_training/02_candidates.ts',
  'src/engine/tree/product_training/03_validate.ts',
  'src/engine/tree/product_training/branch_semantics.ts',
  'src/engine/tree/product_training/index.ts',
];

console.log('--- Module file existence ---');
for (const file of MODULE_FILES) {
  check(`${file} exists`, () => {
    assert(existsSync(resolve(file)), `File not found: ${file}`);
  });
}

// ---- 2. 无废弃导入 ----
const DEPRECATED_PATTERNS = [
  { pattern: /from ['"].*arena['"]/, name: 'arena' },
  { pattern: /playSpecVsSpec/, name: 'playSpecVsSpec' },
  { pattern: /evaluateArena/, name: 'evaluateArena' },
  { pattern: /from ['"].*hill_climb['"]/, name: 'hill_climb' },
  { pattern: /from ['"].*sequential_tree_optimization['"]/, name: 'sequential_tree_optimization' },
  { pattern: /from ['"].*branch_induct['"]/, name: 'branch_induct' },
];

console.log('\n--- No deprecated sandbox imports ---');
for (const file of MODULE_FILES) {
  const content = readFileSync(resolve(file), 'utf8');
  for (const { pattern, name } of DEPRECATED_PATTERNS) {
    check(`${file} does not import ${name}`, () => {
      assert(!pattern.test(content), `Found deprecated import of '${name}' in ${file}`);
    });
  }
}

// ---- 3. 规范指纹 ----
console.log('\n--- Canonical fingerprint behavior ---');

const sources = loadProductSources();
const testSrc = sources.executable.find((s: any) => s.id !== 'gift_jungle') ?? sources.executable[0];
const testEvol = formationToEvol(testSrc as any);

check('fingerprint is deterministic (same evol → same fp)', () => {
  const fp1 = computeCandidateFingerprint(testEvol);
  const fp2 = computeCandidateFingerprint(testEvol);
  assert(fp1 === fp2, `non-deterministic fingerprint: ${fp1} vs ${fp2}`);
});

check('fingerprint distinguishes placement coordinate change', () => {
  const modified = cloneEvolFormation(testEvol);
  let changed = false;
  outer: for (const node of walkEvolNodes(modified.root)) {
    for (const p of node.placements) {
      if (p.x < 10) { p.x += 1; changed = true; break outer; }
      if (p.x > 6) { p.x -= 1; changed = true; break outer; }
    }
  }
  if (!changed) { console.log('    (skip: no movable placement found)'); return; }
  const fp1 = computeCandidateFingerprint(testEvol);
  const fp2 = computeCandidateFingerprint(modified);
  assert(fp1 !== fp2, 'fingerprint should differ after coordinate change');
});

check('fingerprint rejects no-op (clone = same fingerprint)', () => {
  const clone = cloneEvolFormation(testEvol);
  const result = rejectIfNoOp(clone, testEvol);
  assert(result.isNoOp, 'clone should be no-op');
});

// ---- 4. R1 直接产品适配器证据 (treeStrategyFor) ----
console.log('\n--- R1 product adapter: direct treeStrategyFor() calls ---');

const gjRaw: any[] = JSON.parse(readFileSync(resolve('tests/fixtures/tree/eleven_frozen_sources.json'), 'utf8'));
const gjSrc = gjRaw.find((s: any) => s.id === 'gift_jungle');
const gjEvol = formationToEvol(gjSrc);
const gjTeam = gjSrc.team.map((s: any) => ({ monsterId: s.monsterId, badgeIds: s.badgeIds ?? [] }));

function makeR1Ctx(side: 1 | 2, enemyHandIds: number[]): any {
  return {
    side, identity: 'gift_jungle', round: 1, seed: 1, rng: () => 0.5,
    team: gjTeam, hand: gjTeam, ownMonsters: [], enemyMonsters: [],
    enemyRevealedHand: enemyHandIds.map(id => ({ monsterId: id, badgeIds: [] })),
    budget: 999,
    zone: side === 1 ? { min: 1, max: 5 } : { min: 6, max: 10 },
  };
}

check('gift_jungle R1 has 2 branches: n2 (fallback) and n7 (fullrush)', () => {
  const branches = listR1Branches(gjEvol);
  assert(branches.length === 2, `expected 2 R1 branches, got ${branches.length}`);
  assert(branches.some(b => b.isFallback && b.nodeId === 'n2'), 'n2 fallback not found');
  assert(branches.some(b => !b.isFallback && b.nodeId === 'n7'), 'n7 condition not found');
});

const gjStrategy = treeStrategyFor(gjEvol);

check('[P2] R1 fallback: treeStrategyFor branchId=n2, m110@(7,3)', () => {
  const intents = gjStrategy(makeR1Ctx(2, []));
  assert(intents.length > 0, 'no intents emitted for P2 fallback');
  assert(intents.every(i => i.branch?.branchId === 'n2'), `expected all branchId=n2, got: ${intents.map(i => i.branch?.branchId)}`);
  const ids = intents.map(i => i.monsterId);
  assert(ids.includes(110), 'missing m110 in P2 fallback');
  assert(ids.includes(124), 'missing m124 in P2 fallback');
  const m110 = intents.find(i => i.monsterId === 110)!;
  assert(m110.plannedX === 7, `P2 m110 plannedX: expected 7, got ${m110.plannedX}`);
  assert(m110.plannedY === 3, `P2 m110 plannedY: expected 3, got ${m110.plannedY}`);
});

check('[P1] R1 fallback: treeStrategyFor branchId=n2, m110 x=3 (10-7 mirror)', () => {
  const intents = gjStrategy(makeR1Ctx(1, []));
  assert(intents.length > 0, 'no intents emitted for P1 fallback');
  assert(intents.every(i => i.branch?.branchId === 'n2'), `expected all branchId=n2, got: ${intents.map(i => i.branch?.branchId)}`);
  const m110 = intents.find(i => i.monsterId === 110)!;
  assert(m110.plannedX === 3, `P1 m110 plannedX: expected 3 (10-7), got ${m110.plannedX}`);
  assert(m110.plannedY === 3, `P1 m110 plannedY: expected 3, got ${m110.plannedY}`);
});

check('[P2] R1 n7/fullrush: treeStrategyFor branchId=n7 (hand=[114,113])', () => {
  const intents = gjStrategy(makeR1Ctx(2, [114, 113]));
  assert(intents.length > 0, 'no intents emitted for P2 fullrush');
  assert(intents.every(i => i.branch?.branchId === 'n7'), `expected all branchId=n7, got: ${intents.map(i => i.branch?.branchId)}`);
  const ids = intents.map(i => i.monsterId);
  assert(ids.includes(110), 'missing m110 in P2 n7');
  assert(ids.includes(124), 'missing m124 in P2 n7');
  const m110 = intents.find(i => i.monsterId === 110)!;
  assert(m110.plannedX === 7, `P2 n7 m110 plannedX: expected 7, got ${m110.plannedX}`);
  assert(m110.plannedY === 3, `P2 n7 m110 plannedY: expected 3, got ${m110.plannedY}`);
});

check('[P1] R1 n7/fullrush: treeStrategyFor branchId=n7, m110 x=3 (mirror)', () => {
  const intents = gjStrategy(makeR1Ctx(1, [114, 113]));
  assert(intents.length > 0, 'no intents emitted for P1 fullrush');
  assert(intents.every(i => i.branch?.branchId === 'n7'), `expected all branchId=n7, got: ${intents.map(i => i.branch?.branchId)}`);
  const m110 = intents.find(i => i.monsterId === 110)!;
  assert(m110.plannedX === 3, `P1 n7 m110 plannedX: expected 3 (10-7), got ${m110.plannedX}`);
  assert(m110.plannedY === 3, `P1 n7 m110 plannedY: expected 3, got ${m110.plannedY}`);
});

check('n7 branchId ≠ n2 branchId (fullrush vs fallback)', () => {
  const fb = gjStrategy(makeR1Ctx(2, []))[0]?.branch?.branchId;
  const n7 = gjStrategy(makeR1Ctx(2, [114, 113]))[0]?.branch?.branchId;
  assert(fb === 'n2', `fallback branchId: expected n2, got ${fb}`);
  assert(n7 === 'n7', `fullrush branchId: expected n7, got ${n7}`);
  assert(fb !== n7, 'n2 and n7 should differ');
});

check('branch_semantics helper agrees with product adapter (fullrush P2)', () => {
  const helper = getR1BranchSelection(gjEvol, { enemyHandIds: new Set([114, 113]), enemyHandBadges: new Set() });
  const adapter = gjStrategy(makeR1Ctx(2, [114, 113]));
  assert(helper.side2?.id === 'n7', `helper selected ${helper.side2?.id}, expected n7`);
  assert(adapter[0]?.branch?.branchId === 'n7', `adapter branchId: ${adapter[0]?.branch?.branchId}, expected n7`);
});

// ---- 5. 分支条件类型 ----
console.log('\n--- Branch condition types ---');

check('side-only condition is accepted (isR1Observable=true)', () => {
  const m: FeatureMask = { side: 1, main: null, subs: [], keys: [] };
  assert(isSideOnlyCondition(m), 'should be side-only');
  assert(isR1Observable(m), 'should be R1 observable');
});

check('side+fullrush condition is accepted', () => {
  const m: FeatureMask = { side: 2, main: 'fullrush', subs: [], keys: [] };
  assert(isSidePlusOpponentFeatureCondition(m), 'should be side+opponent-feature');
  assert(isR1Observable(m), 'should be R1 observable');
});

check('future-state R1 condition is rejected', () => {
  const m: FeatureMask = { side: null, main: null, subs: [], keys: [] };
  (m as any).requiresBoardIds = true;
  assert(!isR1Observable(m), 'requiresBoardIds at R1 should be illegal');
});

check('hasFutureStateCondition detects injected future-state node', () => {
  const futureEvol = cloneEvolFormation(gjEvol);
  const r1Children = futureEvol.root.children.filter(c => c.round === 1);
  if (r1Children.length > 0) {
    (r1Children[0].condition as any).requiresBoardIds = true;
  }
  assert(hasFutureStateCondition(futureEvol), 'should detect future-state condition');
});

check('gift_jungle itself has no future-state conditions', () => {
  assert(!hasFutureStateCondition(gjEvol), 'gift_jungle should not have future-state conditions');
});

// ---- 6. 候选合法性 ----
console.log('\n--- Candidate legality ---');

check('gift_jungle executable source passes legality validation', () => {
  const result = validateCandidateLegality(gjEvol);
  if (!result.valid) throw new Error(result.reasons.join('; '));
});

check('formation with duplicate monsterId fails validation', () => {
  const bad = cloneEvolFormation(testEvol);
  bad.team.push({ monsterId: bad.team[0].monsterId, badgeIds: [] });
  const result = validateCandidateLegality(bad);
  assert(!result.valid, 'duplicate monsterId should fail');
});

// ---- Summary ----
console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
if (failed > 0) {
  process.exit(1);
}
console.log('✓ check_architecture PASSED\n');
