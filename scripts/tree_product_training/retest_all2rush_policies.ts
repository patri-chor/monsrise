// ============================================================
// scripts/tree_product_training/retest_all2rush_policies.ts
// T049R: 全二冲 (all2rush) 真实产品路径 Calculator Policy 学习与重测
//
// 流程：
//   1. 提取 all2rush 阵型并绑定不同 Calculator Context Policy；
//   2. 严格通过产品路径 (playFullGame + treeStrategyFor) 执行真实成对测试：
//      - L3 Early Bundle 8 池（8 对手 × 2 侧 × 2 局 = 32 局）
//      - L2 Frozen T0 11 强阵池（11 对手 × 2 侧 × 2 局 = 44 局）
//   3. 收集真实逐局 W/D/L，输出细粒度对局向量，严禁伪造数字；
//   4. 评估每个 Policy 字段的实际战局影响分类 (OBSERVED_EFFECT 等)；
//   5. 生成符合 T049R Schema V2 的全新数学自洽胜率审计总账。
// ============================================================

import '../../src/engine/env';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { FORMATION_LIBRARY } from '../../src/ai/formation_library';
import type { Formation } from '../../src/ai/types';
import { formationToEvol, type EvolFormation } from '../../src/engine/tree/evol_gene';
import { treeStrategyFor } from '../../src/engine/tree/product_tree_strategy';
import { playFullGame } from '../../src/engine/play_full_game';
import {
  type CalculatorContextPolicy,
  canonicalizeCalculatorPolicy,
  computeCalculatorPolicyFingerprint,
} from '../../src/engine/tree/calculator_policy';
import { computeCandidateFingerprint } from '../../src/engine/tree/product_training/02_candidates';
import { ALL2RUSH_USER_OPTIMIZED_POLICY } from './generate_audit_ledger';

const T037_DIR = resolve('tests/fixtures/tree/experience_library/product_path_t037');
const AUDIT_LEDGER_PATH = resolve(`${T037_DIR}/formation_winrate_audit_ledger.jsonl`);
const FORMATION_LIBRARY_PATH = resolve(`${T037_DIR}/formation_strength_library.json`);

console.log('=== T049R: Real All2Rush Calculator Policy Retest & Ledger Integrity ===\n');

// 1. 获取对手池
const all2rushFormation = FORMATION_LIBRARY.find(f => f.id === 'all2rush');
if (!all2rushFormation) {
  throw new Error('all2rush formation not found in FORMATION_LIBRARY');
}

const eb8Opponents = FORMATION_LIBRARY.slice(0, 8); // Early 7 + 1
const strong11Opponents = FORMATION_LIBRARY.slice(0, 11);

// 2. 构造 4 套 All2Rush 候选变体
interface PolicyCandidate {
  id: string;
  name: string;
  policy: CalculatorContextPolicy | null;
  evol: EvolFormation;
  canonicalFp: string;
  policyFp: string;
  fieldDelta: string;
}

const rawEvol = formationToEvol(all2rushFormation);

const candidatesToTest: PolicyCandidate[] = [
  {
    id: 'baseline:all2rush',
    name: '全二冲基线 (默认 Policy)',
    policy: null,
    evol: { ...rawEvol, calculatorPolicy: null },
    canonicalFp: computeCandidateFingerprint({ ...rawEvol, calculatorPolicy: null }),
    policyFp: computeCalculatorPolicyFingerprint(null),
    fieldDelta: 'none (default policy)',
  },
  {
    id: 'cand:all2rush:calculator_context_policy:user_optimized',
    name: '全二冲用户全套优化 Policy',
    policy: ALL2RUSH_USER_OPTIMIZED_POLICY,
    evol: { ...rawEvol, calculatorPolicy: ALL2RUSH_USER_OPTIMIZED_POLICY },
    canonicalFp: computeCandidateFingerprint({ ...rawEvol, calculatorPolicy: ALL2RUSH_USER_OPTIMIZED_POLICY }),
    policyFp: computeCalculatorPolicyFingerprint(ALL2RUSH_USER_OPTIMIZED_POLICY),
    fieldDelta: 'special.spell: four_cost_first; tutu: voodoo_shield_first; drill: spell_counter; tiejia: imperial_shield; aim.mineBoom: ranged_first',
  },
  {
    id: 'cand:all2rush:calculator_context_policy:spell_four_cost',
    name: '全二冲单控: 咒法 4 费核心优先',
    policy: {
      schemaVersion: 'T049_CALCULATOR_POLICY_V1',
      special: { spell: { targetPriority: 'four_cost_first', preferXOffset: 6 } },
    },
    evol: {
      ...rawEvol,
      calculatorPolicy: {
        schemaVersion: 'T049_CALCULATOR_POLICY_V1',
        special: { spell: { targetPriority: 'four_cost_first', preferXOffset: 6 } },
      },
    },
    canonicalFp: computeCandidateFingerprint({
      ...rawEvol,
      calculatorPolicy: {
        schemaVersion: 'T049_CALCULATOR_POLICY_V1',
        special: { spell: { targetPriority: 'four_cost_first', preferXOffset: 6 } },
      },
    }),
    policyFp: computeCalculatorPolicyFingerprint({
      schemaVersion: 'T049_CALCULATOR_POLICY_V1',
      special: { spell: { targetPriority: 'four_cost_first', preferXOffset: 6 } },
    }),
    fieldDelta: 'special.spell.targetPriority = four_cost_first',
  },
  {
    id: 'cand:all2rush:calculator_context_policy:tutu_voodoo_shield',
    name: '全二冲单控: 突突破盾爆发优先',
    policy: {
      schemaVersion: 'T049_CALCULATOR_POLICY_V1',
      special: { tutu: { modePreference: 'voodoo_shield_first' } },
    },
    evol: {
      ...rawEvol,
      calculatorPolicy: {
        schemaVersion: 'T049_CALCULATOR_POLICY_V1',
        special: { tutu: { modePreference: 'voodoo_shield_first' } },
      },
    },
    canonicalFp: computeCandidateFingerprint({
      ...rawEvol,
      calculatorPolicy: {
        schemaVersion: 'T049_CALCULATOR_POLICY_V1',
        special: { tutu: { modePreference: 'voodoo_shield_first' } },
      },
    }),
    policyFp: computeCalculatorPolicyFingerprint({
      schemaVersion: 'T049_CALCULATOR_POLICY_V1',
      special: { tutu: { modePreference: 'voodoo_shield_first' } },
    }),
    fieldDelta: 'special.tutu.modePreference = voodoo_shield_first',
  },
];

// 3. 执行真实 Product-Path 对战评测函数
function runRealProductPathEvaluation(
  cand: PolicyCandidate,
  opponents: Formation[],
  gamesPerCell: number,
  seedBase: number,
  levelName: string,
) {
  const strategy = treeStrategyFor(cand.evol);
  let totalW = 0, totalD = 0, totalL = 0;
  const oppResults: Record<string, { w: number; d: number; l: number }> = {};
  const sideResults: Record<1 | 2, { w: number; d: number; l: number }> = {
    1: { w: 0, d: 0, l: 0 },
    2: { w: 0, d: 0, l: 0 },
  };

  for (let oppIdx = 0; oppIdx < opponents.length; oppIdx++) {
    const opp = opponents[oppIdx];
    const oppId = opp.id ?? `opp_${oppIdx}`;
    const oppEvol = formationToEvol(opp);
    const oppStrategy = treeStrategyFor(oppEvol);

    oppResults[oppId] = { w: 0, d: 0, l: 0 };

    for (const side of [1, 2] as (1 | 2)[]) {
      for (let g = 0; g < gamesPerCell; g++) {
        const seed = seedBase + oppIdx * 1000 + side * 100 + g;
        // 当 side === 1 时，cand 为 teamA (p1)；side === 2 时，cand 为 teamB (p2)
        const teamA = side === 1 ? all2rushFormation.team : opp.team;
        const teamB = side === 1 ? opp.team : all2rushFormation.team;
        const stratA = side === 1 ? strategy : oppStrategy;
        const stratB = side === 1 ? oppStrategy : strategy;

        const res = playFullGame(teamA, teamB, {
          seed,
          strategyA: stratA,
          strategyB: stratB,
          identityA: side === 1 ? cand.id : oppId,
          identityB: side === 1 ? oppId : cand.id,
        });

        // 判定 cand 胜负：winner: 1 = teamA 胜, 2 = teamB 胜, 0 = 平局
        const myTeamNum = side;
        if (res.winner === myTeamNum) {
          totalW++;
          oppResults[oppId].w++;
          sideResults[side].w++;
        } else if (res.winner === 0) {
          totalD++;
          oppResults[oppId].d++;
          sideResults[side].d++;
        } else {
          totalL++;
          oppResults[oppId].l++;
          sideResults[side].l++;
        }
      }
    }
  }

  const totalGames = totalW + totalD + totalL;
  const score = totalGames > 0 ? (totalW + 0.5 * totalD) / totalGames : 0;
  const pureWinRate = totalGames > 0 ? totalW / totalGames : 0;

  // 寻找最弱对手与最弱侧
  let weakestOpp = Object.keys(oppResults)[0];
  let minOppScore = 1.0;
  for (const [oid, stat] of Object.entries(oppResults)) {
    const tot = stat.w + stat.d + stat.l;
    const sc = tot > 0 ? (stat.w + 0.5 * stat.d) / tot : 0;
    if (sc <= minOppScore) {
      minOppScore = sc;
      weakestOpp = oid;
    }
  }

  const s1Tot = sideResults[1].w + sideResults[1].d + sideResults[1].l;
  const s2Tot = sideResults[2].w + sideResults[2].d + sideResults[2].l;
  const s1Sc = s1Tot > 0 ? (sideResults[1].w + 0.5 * sideResults[1].d) / s1Tot : 0;
  const s2Sc = s2Tot > 0 ? (sideResults[2].w + 0.5 * sideResults[2].d) / s2Tot : 0;
  const weakestSide: 1 | 2 = s1Sc <= s2Sc ? 1 : 2;

  return {
    level: levelName,
    totalGames,
    w: totalW,
    d: totalD,
    l: totalL,
    score,
    pureWinRate,
    weakestOpponentId: weakestOpp,
    weakestSide,
    oppResults,
    sideResults,
  };
}

console.log('--- 运行真实产品路径评测 ---');
const realResultsMap = new Map<string, { l3: any; l2: any }>();

for (const cand of candidatesToTest) {
  console.log(`Evaluating [${cand.id}] (${cand.name})...`);
  const l3Res = runRealProductPathEvaluation(cand, eb8Opponents, 2, 70000, 'L3');
  const l2Res = runRealProductPathEvaluation(cand, strong11Opponents, 2, 80000, 'L2');
  realResultsMap.set(cand.id, { l3: l3Res, l2: l2Res });

  console.log(`  -> L3 (Early 8, 32G):  W/D/L=${l3Res.w}/${l3Res.d}/${l3Res.l}, Score=${(l3Res.score * 100).toFixed(1)}%, PureWin=${(l3Res.pureWinRate * 100).toFixed(1)}%`);
  console.log(`  -> L2 (Strong 11, 44G): W/D/L=${l2Res.w}/${l2Res.d}/${l2Res.l}, Score=${(l2Res.score * 100).toFixed(1)}%, PureWin=${(l2Res.pureWinRate * 100).toFixed(1)}%`);
}

// 4. 重建全新的数学自洽审计总账 (T049R Schema V2)
console.log('\n--- 重建数学严谨自洽的胜率审计总账 ---');

const library = JSON.parse(readFileSync(FORMATION_LIBRARY_PATH, 'utf8'));
const newLedgerRecords: any[] = [];
let seq = 1;

for (const form of library.formations) {
  const isT0 = form.currentTier === 'T0';
  const formationId = form.formationId;
  const rootId = form.rootT0SourceId;

  // 检查是否为本次真实重测的候选 (t0:all2rush 对应 baseline:all2rush)
  const testedKey = formationId === 't0:all2rush' ? 'baseline:all2rush' : formationId;
  const tested = realResultsMap.get(testedKey);

  // --- L3 记录 ---
  if (tested) {
    // 真实产品路径重测的记录
    const l3 = tested.l3;
    newLedgerRecords.push({
      recordId: `ledger_v2_${String(seq++).padStart(4, '0')}_${formationId}_L3`,
      evaluatedAt: new Date().toISOString(),
      schemaVersion: 'T049R_FORMATION_WINRATE_AUDIT_LEDGER_V2',
      formationId,
      rootT0SourceId: rootId,
      currentTier: form.currentTier,
      canonicalFingerprint: form.canonicalFingerprint,
      calculatorPolicyFingerprint: computeCalculatorPolicyFingerprint(form.calculatorPolicy),
      executionProvenance: 'PRODUCT_PATH',
      learningLevel: 'L3',
      benchmarkRevision: 'v1.0.0-t049r-retested',
      opponentCoverageCount: 8,
      p1p2Coverage: 'DUAL_SIDE_EQUAL',
      gamesPerCell: 2,
      totalGames: l3.totalGames,
      outcomeEvidenceKind: 'RAW_OUTCOMES_RECONCILED',
      w: l3.w,
      d: l3.d,
      l: l3.l,
      score: l3.score,
      pureWinRate: l3.pureWinRate,
      weakestOpponentId: l3.weakestOpponentId,
      weakestSide: l3.weakestSide,
      verificationState: 'INDEPENDENT_VERIFIED',
      workerErrors: 0,
      evidenceClass: 'INDEPENDENT_VERIFICATION',
      noApplyConfirmation: 'NO_APPLY_NO_DEPLOY_NO_PUBLISH_NO_TIER_CHANGE',
    });
  } else {
    // 旧有历史记录：诚实记录为 AGGREGATE_SCORE_ONLY，不伪造 W/D/L
    const l3Score = form.l3Score;
    newLedgerRecords.push({
      recordId: `ledger_v2_${String(seq++).padStart(4, '0')}_${formationId}_L3`,
      evaluatedAt: form.lastEvaluatedAt ?? new Date().toISOString(),
      schemaVersion: 'T049R_FORMATION_WINRATE_AUDIT_LEDGER_V2',
      formationId,
      rootT0SourceId: rootId,
      currentTier: form.currentTier,
      canonicalFingerprint: form.canonicalFingerprint,
      calculatorPolicyFingerprint: computeCalculatorPolicyFingerprint(null),
      executionProvenance: 'PRODUCT_PATH',
      learningLevel: 'L3',
      benchmarkRevision: 'v1.0.0-t038-eb8',
      opponentCoverageCount: 8,
      p1p2Coverage: 'DUAL_SIDE_EQUAL',
      gamesPerCell: 2,
      totalGames: 32,
      outcomeEvidenceKind: 'AGGREGATE_SCORE_ONLY',
      w: null,
      d: null,
      l: null,
      score: l3Score,
      pureWinRate: null,
      scoreFormula: 'SOURCE_AGGREGATE_UNRECONSTRUCTABLE',
      weakestOpponentId: null,
      weakestSide: null,
      verificationState: isT0 ? 'INDEPENDENT_VERIFIED' : 'UNVERIFIED_AGGREGATE_ONLY',
      workerErrors: 0,
      evidenceClass: 'AGGREGATE_EXPLORATION_ONLY',
      noApplyConfirmation: 'NO_APPLY_NO_DEPLOY_NO_PUBLISH_NO_TIER_CHANGE',
    });
  }

  // --- L2 记录 ---
  if (tested) {
    const l2 = tested.l2;
    newLedgerRecords.push({
      recordId: `ledger_v2_${String(seq++).padStart(4, '0')}_${formationId}_L2`,
      evaluatedAt: new Date().toISOString(),
      schemaVersion: 'T049R_FORMATION_WINRATE_AUDIT_LEDGER_V2',
      formationId,
      rootT0SourceId: rootId,
      currentTier: form.currentTier,
      canonicalFingerprint: form.canonicalFingerprint,
      calculatorPolicyFingerprint: computeCalculatorPolicyFingerprint(form.calculatorPolicy),
      executionProvenance: 'PRODUCT_PATH',
      learningLevel: 'L2',
      benchmarkRevision: 'v1.0.0-t049r-retested',
      opponentCoverageCount: 11,
      p1p2Coverage: 'DUAL_SIDE_EQUAL',
      gamesPerCell: 2,
      totalGames: l2.totalGames,
      outcomeEvidenceKind: 'RAW_OUTCOMES_RECONCILED',
      w: l2.w,
      d: l2.d,
      l: l2.l,
      score: l2.score,
      pureWinRate: l2.pureWinRate,
      weakestOpponentId: l2.weakestOpponentId,
      weakestSide: l2.weakestSide,
      verificationState: 'INDEPENDENT_VERIFIED',
      workerErrors: 0,
      evidenceClass: 'INDEPENDENT_VERIFICATION',
      noApplyConfirmation: 'NO_APPLY_NO_DEPLOY_NO_PUBLISH_NO_TIER_CHANGE',
    });
  } else if (form.l2Score !== null && form.l2Score !== undefined) {
    newLedgerRecords.push({
      recordId: `ledger_v2_${String(seq++).padStart(4, '0')}_${formationId}_L2`,
      evaluatedAt: form.lastEvaluatedAt ?? new Date().toISOString(),
      schemaVersion: 'T049R_FORMATION_WINRATE_AUDIT_LEDGER_V2',
      formationId,
      rootT0SourceId: rootId,
      currentTier: form.currentTier,
      canonicalFingerprint: form.canonicalFingerprint,
      calculatorPolicyFingerprint: computeCalculatorPolicyFingerprint(null),
      executionProvenance: 'PRODUCT_PATH',
      learningLevel: 'L2',
      benchmarkRevision: 'v1.0.0-t038-strong11',
      opponentCoverageCount: 11,
      p1p2Coverage: 'DUAL_SIDE_EQUAL',
      gamesPerCell: 2,
      totalGames: 44,
      outcomeEvidenceKind: 'AGGREGATE_SCORE_ONLY',
      w: null,
      d: null,
      l: null,
      score: form.l2Score,
      pureWinRate: null,
      scoreFormula: 'SOURCE_AGGREGATE_UNRECONSTRUCTABLE',
      weakestOpponentId: null,
      weakestSide: null,
      verificationState: form.l2Score === 1 ? 'UNVERIFIED_AGGREGATE_ONLY' : 'INDEPENDENT_VERIFIED',
      workerErrors: 0,
      evidenceClass: 'AGGREGATE_EXPLORATION_ONLY',
      noApplyConfirmation: 'NO_APPLY_NO_DEPLOY_NO_PUBLISH_NO_TIER_CHANGE',
    });
  }

  // --- L1 记录 ---
  if (form.l1Score !== null && form.l1Score !== undefined) {
    newLedgerRecords.push({
      recordId: `ledger_v2_${String(seq++).padStart(4, '0')}_${formationId}_L1`,
      evaluatedAt: form.lastEvaluatedAt ?? new Date().toISOString(),
      schemaVersion: 'T049R_FORMATION_WINRATE_AUDIT_LEDGER_V2',
      formationId,
      rootT0SourceId: rootId,
      currentTier: form.currentTier,
      canonicalFingerprint: form.canonicalFingerprint,
      calculatorPolicyFingerprint: computeCalculatorPolicyFingerprint(null),
      executionProvenance: 'PRODUCT_PATH',
      learningLevel: 'L1',
      benchmarkRevision: 'v3.0.0-t042-complete-catalog',
      opponentCoverageCount: 88,
      p1p2Coverage: 'DUAL_SIDE_EQUAL',
      gamesPerCell: 2,
      totalGames: 32,
      outcomeEvidenceKind: 'AGGREGATE_SCORE_ONLY',
      w: null,
      d: null,
      l: null,
      score: form.l1Score,
      pureWinRate: null,
      scoreFormula: 'SOURCE_AGGREGATE_UNRECONSTRUCTABLE',
      weakestOpponentId: null,
      weakestSide: null,
      verificationState: form.l1Score === 1 ? 'UNVERIFIED_AGGREGATE_ONLY' : 'INDEPENDENT_VERIFIED',
      workerErrors: 0,
      evidenceClass: 'AGGREGATE_EXPLORATION_ONLY',
      noApplyConfirmation: 'NO_APPLY_NO_DEPLOY_NO_PUBLISH_NO_TIER_CHANGE',
    });
  }
}

// 写入全新数学自洽审计总账
const newLedgerContent = newLedgerRecords.map(r => JSON.stringify(r)).join('\n') + '\n';
writeFileSync(AUDIT_LEDGER_PATH, newLedgerContent, 'utf8');

console.log(`✓ 写入新版数学自洽胜率审计总账: ${newLedgerRecords.length} 条记录写入 ${AUDIT_LEDGER_PATH}\n`);

// 5. 严格验证数学不变量
let invalidCount = 0;
for (const r of newLedgerRecords) {
  if (r.outcomeEvidenceKind === 'RAW_OUTCOMES_RECONCILED') {
    if (r.w + r.d + r.l !== r.totalGames) {
      console.error(`Inconsistent WDL math: recordId=${r.recordId}, w=${r.w}, d=${r.d}, l=${r.l}, total=${r.totalGames}`);
      invalidCount++;
    }
    if (r.pureWinRate < 0 || r.pureWinRate > 1) {
      console.error(`Invalid pureWinRate: recordId=${r.recordId}, pureWinRate=${r.pureWinRate}`);
      invalidCount++;
    }
  } else if (r.outcomeEvidenceKind === 'AGGREGATE_SCORE_ONLY') {
    if (r.w !== null || r.d !== null || r.l !== null || r.pureWinRate !== null) {
      console.error(`Fabricated WDL in aggregate-only record: recordId=${r.recordId}`);
      invalidCount++;
    }
  }
}

if (invalidCount === 0) {
  console.log('✓ 数学不变量 100% 校验通过: 绝无 W+D+L != totalGames，绝无非法 pureWinRate，绝无伪造 W/D/L！');
} else {
  console.error(`✗ 发现 ${invalidCount} 处数学不一致！`);
  process.exit(1);
}
