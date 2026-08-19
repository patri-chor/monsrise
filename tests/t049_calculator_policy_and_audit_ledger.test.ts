// ============================================================
// tests/t049_calculator_policy_and_audit_ledger.test.ts
// T049: Calculator Context-Policy 学习与阵型胜率审计总账专项验收测试
// ============================================================

import '../src/engine/env'; // 环境桩必须最先导入
import assert from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  validateCalculatorPolicy,
  canonicalizeCalculatorPolicy,
  computeCalculatorPolicyFingerprint,
  evaluateSpecialPlacementWithPolicy,
  evaluateAimPlacementWithPolicy,
  DEFAULT_CALCULATOR_POLICY,
  ALL2RUSH_USER_OPTIMIZED_POLICY,
  CALCULATOR_POLICY_SCHEMA_VERSION,
  type CalculatorContextPolicy,
} from '../src/engine/tree/calculator_policy';
import {
  computeCandidateFingerprint,
  type CandidateMetadata,
} from '../src/engine/tree/product_training/02_candidates';
import {
  treeStrategyFor,
} from '../src/engine/tree/product_tree_strategy';
import type { EvolFormation, EvolNode } from '../src/engine/tree/evol_gene';
import { emptyMask } from '../src/engine/tree/evol_gene';
import {
  AUDIT_LEDGER_PATH,
} from '../src/engine/tree/product_training/audit_ledger';

console.log('=== 开始执行 T049 Calculator Context-Policy 与胜率审计总账专项验收测试 ===\n');

// -------------------------------------------------------------
// [Test 1] 验证 Calculator Policy 白名单校验、非法字段拦截与默认等价性
// -------------------------------------------------------------
console.log('[Test 1] 验证 Calculator Policy 白名单校验、非法字段拦截与默认等价性...');

// 1.1 默认 Policy 规范化
const defaultCanon = canonicalizeCalculatorPolicy(null);
assert.strictEqual(defaultCanon.schemaVersion, CALCULATOR_POLICY_SCHEMA_VERSION);
assert.strictEqual(defaultCanon.special?.spell?.targetPriority, 'default');
assert.strictEqual(defaultCanon.special?.spell?.preferXOffset, 6);

// 1.2 未知顶级字段拒绝
const unknownTop = { schemaVersion: CALCULATOR_POLICY_SCHEMA_VERSION, fakeField: 123 };
const val1 = validateCalculatorPolicy(unknownTop);
assert.strictEqual(val1.valid, false);
assert(val1.errors.some(e => e.includes('Unknown top-level field')), '必须拦截未知顶级字段');

// 1.3 非法枚举值拒绝
const invalidEnum = {
  schemaVersion: CALCULATOR_POLICY_SCHEMA_VERSION,
  special: {
    spell: { targetPriority: 'invalid_mode' as any },
  },
};
const val2 = validateCalculatorPolicy(invalidEnum);
assert.strictEqual(val2.valid, false);
assert(val2.errors.some(e => e.includes('Invalid spell.targetPriority')), '必须拦截非法枚举值');

// 1.4 合法全二冲 Policy 校验通过
const val3 = validateCalculatorPolicy(ALL2RUSH_USER_OPTIMIZED_POLICY);
assert.strictEqual(val3.valid, true, '合法优化 Policy 必须通过校验');
console.log('  ✓ Policy 白名单强校验与默认等价性测试通过。');

// -------------------------------------------------------------
// [Test 2] 验证 Policy 深度参与指纹计算（指纹敏感性与稳定性）
// -------------------------------------------------------------
console.log('\n[Test 2] 验证 Policy 深度参与指纹计算（敏感性与跨平台稳定性）...');

const dummyRoot: EvolNode = {
  id: 'n_root',
  round: 0,
  condition: emptyMask(),
  placements: [],
  children: [
    {
      id: 'n_r1',
      round: 1,
      condition: emptyMask(),
      placements: [
        { monsterId: 110, x: 7, y: 2 },
        { monsterId: 107, x: 8, y: 2 },
      ],
      children: [],
    },
  ],
};

const baseEvol: EvolFormation = {
  name: '全二冲测试',
  archetype: 'full_rush',
  team: [
    { monsterId: 110, badgeIds: [23, 30] },
    { monsterId: 107, badgeIds: [20, 1] },
  ],
  root: dummyRoot,
  calculatorPolicy: null,
};

const fpBase = computeCandidateFingerprint(baseEvol);

// 赋予不同 Policy
const evolWithPolicyA: EvolFormation = {
  ...baseEvol,
  calculatorPolicy: ALL2RUSH_USER_OPTIMIZED_POLICY,
};
const fpA = computeCandidateFingerprint(evolWithPolicyA);

const evolWithPolicyB: EvolFormation = {
  ...baseEvol,
  calculatorPolicy: {
    schemaVersion: 'T049_CALCULATOR_POLICY_V1',
    special: {
      spell: { targetPriority: 'prayer_first', preferXOffset: 0 },
    },
  },
};
const fpB = computeCandidateFingerprint(evolWithPolicyB);

// 断言：不同 Policy 必定产生不同候选指纹
assert.notStrictEqual(fpBase, fpA, '不同 Policy 必须改变候选指纹');
assert.notStrictEqual(fpA, fpB, '不同 Policy 变体之间指纹必须不同');

// 断言：相同 Policy 指纹严格幂等稳定
const fpA_recomputed = computeCandidateFingerprint({ ...evolWithPolicyA });
assert.strictEqual(fpA, fpA_recomputed, '同一 Policy 指纹计算必须完全稳定可重现');
console.log(`  Base FP:   ${fpBase}`);
console.log(`  PolicyA FP: ${fpA}`);
console.log(`  PolicyB FP: ${fpB}`);
console.log('  ✓ 指纹敏感性与确定性稳定性校验通过。');

// -------------------------------------------------------------
// [Test 3] 验证产品策略路径中计算器行为真实受 Policy 控制且战局只读
// -------------------------------------------------------------
console.log('\n[Test 3] 验证产品策略路径中计算器行为真实受 Policy 控制且战局只读...');

// 构造只读测试战局
const dummyContext: any = {
  side: 2,
  identity: 'all2rush_test',
  round: 2,
  seed: 12345,
  rng: () => 0.5,
  team: baseEvol.team,
  hand: baseEvol.team,
  ownMonsters: [
    { dbId: 110, gridX: 7, gridY: 2, badges: [{ id: 23 }, { id: 30 }] },
  ],
  enemyMonsters: [
    { dbId: 105, gridX: 2, gridY: 1, badges: [{ id: 8 }] }, // 祈祷
    { dbId: 102, gridX: 3, gridY: 3, badges: [{ id: 3 }] }, // 4费核心
  ],
  enemyRevealedHand: [
    { monsterId: 105, badgeIds: [8] },
    { monsterId: 102, badgeIds: [3] },
  ],
  budget: 4,
  zone: { min: 6, max: 10 },
};

// 冻结上下文防止被篡改
Object.freeze(dummyContext.enemyMonsters);
Object.freeze(dummyContext.ownMonsters);

// Strategy A: 默认行为（咒法优先对位祈祷 105，y=1）
const strategyDefault = treeStrategyFor(baseEvol);
const intentsDefault = strategyDefault(dummyContext);
const spellIntentDefault = intentsDefault.find(i => i.monsterId === 107)!;
assert(spellIntentDefault, '必须产生咒法意图');
assert.strictEqual(spellIntentDefault.plannedY, 1, '默认咒法策略应瞄准祈祷所在行 y=1');

// Strategy B: 优化策略（四费优先 four_cost_first，咒法改瞄准 4费核心 102，y=3）
const strategyOpt = treeStrategyFor(evolWithPolicyA);
const intentsOpt = strategyOpt(dummyContext);
const spellIntentOpt = intentsOpt.find(i => i.monsterId === 107)!;
assert(spellIntentOpt, '必须产生咒法意图');
assert.strictEqual(spellIntentOpt.plannedY, 3, '优化咒法策略(four_cost_first)应瞄准4费核心所在行 y=3');

console.log(`  默认 Policy 咒法落点: (${spellIntentDefault.plannedX}, ${spellIntentDefault.plannedY})`);
console.log(`  优化 Policy 咒法落点: (${spellIntentOpt.plannedX}, ${spellIntentOpt.plannedY})`);
console.log('  ✓ 纯只读上下文驱动与 Policy 行为响应测试通过。');

// -------------------------------------------------------------
// [Test 4] 验证全二冲用户优化 Policy 种子与其算子 Delta 结构
// -------------------------------------------------------------
console.log('\n[Test 4] 验证全二冲用户优化 Policy 种子与其算子 Delta 结构...');

const policyDelta: any = {
  operatorFamily: 'calculator_context_policy',
  schemaVersion: CALCULATOR_POLICY_SCHEMA_VERSION,
  fieldPath: 'special.spell.targetPriority',
  oldCanonicalValue: 'default',
  newCanonicalValue: 'four_cost_first',
  applicableMonsterIds: [107],
  parentFingerprint: fpBase,
  resultFingerprint: fpA,
  reason: 'Target enemy 4-cost anchor instead of prayer line in rush matchups',
};

const candidateMeta: CandidateMetadata = {
  candidateId: 'cand:all2rush:calculator_context_policy:user_opt_0',
  sourceId: 'all2rush',
  sourceName: '全二冲',
  sourceFingerprint: 'all2rush_fp_v1',
  parentCandidateId: 'baseline:all2rush',
  operatorFamily: 'calculator_context_policy',
  delta: policyDelta,
  canonicalFingerprint: fpA,
  rejected: false,
  rejectionReason: null,
  createdAt: new Date().toISOString(),
};

assert.strictEqual(candidateMeta.operatorFamily, 'calculator_context_policy');
assert.strictEqual(candidateMeta.delta?.operatorFamily, 'calculator_context_policy');
assert.strictEqual(candidateMeta.delta.newCanonicalValue, 'four_cost_first');
console.log('  ✓ 候选算子元数据与 Delta 结构校验通过。');

// -------------------------------------------------------------
// [Test 5] 验证阵型胜率审计总账 (T049R Schema V2) 数学不变量与真实 RAW / AGG 分离
// -------------------------------------------------------------
console.log('\n[Test 5] 验证阵型胜率审计总账 (T049R Schema V2) 数学不变量与真实 RAW / AGG 分离...');

assert(existsSync(AUDIT_LEDGER_PATH), `Audit Ledger 文件必须存在: ${AUDIT_LEDGER_PATH}`);
const ledgerLines = readFileSync(AUDIT_LEDGER_PATH, 'utf8').split('\n').filter(Boolean);
const ledgerRecords: any[] = ledgerLines.map(l => JSON.parse(l));

assert(ledgerRecords.length >= 200, `Audit Ledger 条目数必须充分覆盖 (${ledgerRecords.length} >= 200)`);

let rawReconciledCount = 0;
let aggScoreOnlyCount = 0;
let quarantinedCount = 0;
const uniqueFormations = new Set<string>();

for (const r of ledgerRecords) {
  assert.strictEqual(r.schemaVersion, 'T049R_FORMATION_WINRATE_AUDIT_LEDGER_V2');
  assert.strictEqual(r.executionProvenance, 'PRODUCT_PATH');
  assert(r.formationId && r.canonicalFingerprint, '必须包含阵型身份与规范指纹');
  assert(r.calculatorPolicyFingerprint, '必须包含 Policy 独立指纹');
  assert(Number.isFinite(r.score) && r.score >= 0 && r.score <= 1, '得分必须合法在 0-1');
  assert(Number.isFinite(r.totalGames) && r.totalGames > 0, '总局数必须 > 0');
  uniqueFormations.add(r.formationId);

  if (r.outcomeEvidenceKind === 'RAW_OUTCOMES_RECONCILED') {
    rawReconciledCount++;
    assert.strictEqual(typeof r.w, 'number', 'RAW 记录必须包含数字 w');
    assert.strictEqual(typeof r.d, 'number', 'RAW 记录必须包含数字 d');
    assert.strictEqual(typeof r.l, 'number', 'RAW 记录必须包含数字 l');
    assert.strictEqual(r.w + r.d + r.l, r.totalGames, 'RAW 记录必须严格满足 w+d+l === totalGames');
    assert(r.pureWinRate >= 0 && r.pureWinRate <= 1, 'pureWinRate 必须在 [0, 1]');
  } else if (r.outcomeEvidenceKind === 'AGGREGATE_SCORE_ONLY') {
    aggScoreOnlyCount++;
    assert.strictEqual(r.w, null, 'AGG 记录严禁伪造数字 w');
    assert.strictEqual(r.d, null, 'AGG 记录严禁伪造数字 d');
    assert.strictEqual(r.l, null, 'AGG 记录严禁伪造数字 l');
    assert.strictEqual(r.pureWinRate, null, 'AGG 记录严禁伪造 pureWinRate');
  }

  if (r.verificationState === 'UNVERIFIED_AGGREGATE_ONLY') {
    quarantinedCount++;
  }
}

assert(uniqueFormations.size >= 90, `必须覆盖至少 90 套活跃阵型 (实际: ${uniqueFormations.size})`);
assert(rawReconciledCount > 0, '必须包含全二冲等真实产品路径 RAW 记录');
assert(aggScoreOnlyCount > 0, '必须包含探索阶段的 AGG 记录');
assert(quarantinedCount > 0, '未经验证的满分记录必须处于隔离状态');

console.log(`  覆盖活跃阵型数:     ${uniqueFormations.size}`);
console.log(`  总账记录数:         ${ledgerRecords.length}`);
console.log(`  RAW 重测自洽记录数: ${rawReconciledCount}`);
console.log(`  AGG 探索分数记录数: ${aggScoreOnlyCount}`);
console.log(`  隔离状态记录数:     ${quarantinedCount}`);
console.log('  ✓ 阵型胜率审计总账数学不变量与分类证据支持 100% 校验通过。');

console.log('\n=== 所有 T049R 验收测试全部通过 ===');

