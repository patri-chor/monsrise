// ============================================================
// scripts/tree_product_training/t051_execute_regrade.ts
// T051: Dynamic Strength Ladder, Active-L2 Pool & 0.70 Draw-Value Regrade
// ============================================================

import '../../src/engine/env';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { FORMATION_LIBRARY } from '../../src/ai/formation_library';
import { formationToEvol } from '../../src/engine/tree/evol_gene';
import { computeCandidateFingerprint } from '../../src/engine/tree/product_training/02_candidates';
import {
  computeScore70Metrics,
  createActiveL2Manifest,
  getDefaultTierPolicyV4,
  type R0HistoricalRoot,
  type ActiveFormationV4,
  type ActiveL2Member,
  type DynamicTier,
} from '../../src/engine/tree/product_training/formation_tiers_v4';

const T037_DIR = resolve('tests/fixtures/tree/experience_library/product_path_t037');
const FORMATION_LIBRARY_V3_PATH = resolve(`${T037_DIR}/formation_strength_library.json`);
const FORMATION_LIBRARY_V4_PATH = resolve(`${T037_DIR}/formation_strength_library.v4.json`);
const R0_ROOTS_PATH = resolve(`${T037_DIR}/r0_historical_roots.json`);
const ACTIVE_L2_MANIFEST_PATH = resolve(`${T037_DIR}/active_l2_manifest.json`);
const VECTORS_PATH = resolve(`${T037_DIR}/perfect_score_retest_vectors.jsonl`);
const LEDGER_V4_PATH = resolve(`${T037_DIR}/formation_winrate_audit_ledger.v4.jsonl`);
const USER_TXT_REPORT_PATH = resolve('winrate_report.txt');
const POLICY_V4_PATH = resolve(`${T037_DIR}/formation_tier_policy.v4.json`);

async function main() {
  console.log('=== T051: Dynamic Strength Ladder, Active-L2 & Score70 Regrade ===\n');

  // 1. 固化 R0 不可变根快照 (Original 11 Historical Roots)
  console.log('--- 1. 固化 R0 历史根谱系不可变快照 ---');
  const original11 = FORMATION_LIBRARY.slice(0, 11);
  const r0Roots: R0HistoricalRoot[] = original11.map(f => {
    const evol = formationToEvol(f);
    const fp = (f as any).fingerprint ?? computeCandidateFingerprint(evol);
    return {
      r0SourceId: f.id,
      sourceName: f.name,
      immutableFingerprint: fp,
      archetypeId: (f as any).archetype ?? 'general',
      canonicalTeamSnapshot: JSON.parse(JSON.stringify(f.team)),
    };
  });

  writeFileSync(R0_ROOTS_PATH, JSON.stringify(r0Roots, null, 2), 'utf8');
  console.log(`✓ R0 历史根快照已写入: ${R0_ROOTS_PATH} (${r0Roots.length} 套核心根阵型永久不可变)\n`);

  // 2. 构建 Active-L2 Manifest v1 (当前各谱系活跃 T0 主力)
  console.log('--- 2. 构建 Active-L2 动态基准清单 v1 ---');
  const activeL2Members: ActiveL2Member[] = r0Roots.map(r0 => ({
    r0SourceId: r0.r0SourceId,
    formationId: `t0:${r0.r0SourceId}`,
    name: r0.sourceName,
    canonicalFingerprint: r0.immutableFingerprint,
    calculatorPolicyFingerprint: 'calc_pol_default_v1',
    selectedAt: new Date().toISOString(),
    selectionEvidenceId: 't050_product_path_verified_retest',
  }));

  const activeL2Manifest = createActiveL2Manifest(activeL2Members, 'v1.0.0-t051-active-l2-baseline');
  writeFileSync(ACTIVE_L2_MANIFEST_PATH, JSON.stringify(activeL2Manifest, null, 2), 'utf8');
  console.log(`✓ Active-L2 Manifest 已生成: ${ACTIVE_L2_MANIFEST_PATH}`);
  console.log(`  Revision: ${activeL2Manifest.manifestRevision} (Hash: ${activeL2Manifest.manifestHash})\n`);

  // 3. 读取 220 局真实重测向量并解析 Score70
  console.log('--- 3. 加载真实独立重测向量并计算 Score70 指标 ---');
  const vectorMap = new Map<string, { l2?: any; l1?: any }>();
  if (existsSync(VECTORS_PATH)) {
    const lines = readFileSync(VECTORS_PATH, 'utf8').split('\n').filter(Boolean);
    for (const l of lines) {
      const v = JSON.parse(l);
      if (!vectorMap.has(v.formationId)) vectorMap.set(v.formationId, {});
      if (v.level === 'L2') vectorMap.get(v.formationId)!.l2 = v;
      if (v.level === 'L1') vectorMap.get(v.formationId)!.l1 = v;
    }
  }
  console.log(`✓ 已加载 ${vectorMap.size} 个阵型的真实重测向量\n`);

  // 4. 迁移旧阵型库至 V4 动态天梯，并执行 Score70 动态重分级
  console.log('--- 4. 执行 Score70 动态重分级 (Dynamic Regrade) ---');
  const oldLibrary = JSON.parse(readFileSync(FORMATION_LIBRARY_V3_PATH, 'utf8'));
  const policyV4 = getDefaultTierPolicyV4();
  writeFileSync(POLICY_V4_PATH, JSON.stringify(policyV4, null, 2), 'utf8');

  const activeFormationsV4: ActiveFormationV4[] = [];
  const oldToNewCounts = {
    T0: { T0: 0, T1: 0, T2: 0, T3: 0 },
    T1: { T0: 0, T1: 0, T2: 0, T3: 0 },
    T2: { T0: 0, T1: 0, T2: 0, T3: 0 },
    T3: { T0: 0, T1: 0, T2: 0, T3: 0 },
  };

  for (const f of oldLibrary.formations) {
    const fid = f.formationId;
    const oldTier = f.currentTier as DynamicTier;
    const vec = vectorMap.get(fid);

    let activeL2Metrics = null;
    let l1Metrics = null;
    let l3Metrics = null;

    if (vec?.l2) {
      activeL2Metrics = computeScore70Metrics(vec.l2.w, vec.l2.d, vec.l2.l);
    }

    if (vec?.l1) {
      l1Metrics = computeScore70Metrics(vec.l1.w, vec.l1.d, vec.l1.l);
    }

    if (f.l3Score !== null && f.l3Score !== undefined) {
      l3Metrics = computeScore70Metrics(Math.round(f.l3Score * 8), 0, Math.round((1 - f.l3Score) * 8));
    }

    // 动态分级判定 (以真实 L1 实测 Score70 为首要基准，结合 Active-L2 综合表现)
    let newTier: DynamicTier = 'T3';
    let regradeReason = '';

    const effectiveL1Score70 = l1Metrics?.primaryScore70 ?? null;
    const effectiveL2Score70 = activeL2Metrics?.primaryScore70 ?? null;
    const effectiveL3Score70 = f.l3Score ?? null;

    if (f.benchmarkRoles?.includes('L2_FROZEN_T0_ANCHOR') || fid.startsWith('t0:')) {
      // 原 T0 锚点作为当前 Active T0 角色
      newTier = 'T0';
      regradeReason = 'Active T0 root anchor in Active-L2 manifest';
    } else if (effectiveL1Score70 !== null && effectiveL1Score70 >= policyV4.regradeGates.t1GateScore70) {
      newTier = 'T1';
      regradeReason = `Verified L1 Score70 (${effectiveL1Score70.toFixed(3)}) >= 0.88 T1 gate`;
    } else if (
      (effectiveL1Score70 !== null && effectiveL1Score70 >= 0.60) ||
      (effectiveL2Score70 !== null && effectiveL2Score70 >= 0.60) ||
      (effectiveL1Score70 === null && effectiveL3Score70 !== null && effectiveL3Score70 >= 0.80)
    ) {
      newTier = 'T2';
      regradeReason = effectiveL1Score70 !== null
        ? `Verified Score70 (L1: ${effectiveL1Score70.toFixed(3)}) qualifies for T2 main force`
        : `L3 Baseline score qualifies for T2 pending-L1 evaluation`;
    } else {
      newTier = 'T3';
      regradeReason = `Score70 below T2 gate or pending evaluation, assigned to T3 exploration reserve`;
    }

    // 活跃角色判定
    const activeRoles: any[] = [];
    if (newTier === 'T0') {
      activeRoles.push('CURRENT_ROOT_MAIN', 'ACTIVE_TRAINING_PARENT', 'ACTIVE_COMPETITOR');
    } else if (newTier === 'T1') {
      activeRoles.push('ACTIVE_TRAINING_PARENT', 'ACTIVE_COMPETITOR');
    } else {
      activeRoles.push('ACTIVE_COMPETITOR');
    }

    const verificationState = vec?.l2 || vec?.l1 ? 'INDEPENDENT_VERIFIED' : 'UNVERIFIED_AGGREGATE_ONLY';

    activeFormationsV4.push({
      formationId: fid,
      rootR0SourceId: f.rootT0SourceId,
      displayName: f.formationId,
      canonicalFingerprint: f.canonicalFingerprint,
      calculatorPolicyFingerprint: 'calc_pol_default_v1',
      activeRoles,
      currentDynamicTier: newTier,
      previousTier: oldTier,
      activeLibraryRevision: 'v4.0.0-t051-dynamic-ladder',
      activeL2ManifestHash: activeL2Manifest.manifestHash,
      activeL2Metrics,
      l1Metrics,
      l3Metrics,
      verificationState,
      l2AttemptsCount: f.l2AttemptsCount ?? 0,
      regradeReason,
      updatedAt: new Date().toISOString(),
    });

    oldToNewCounts[oldTier][newTier]++;
  }

  // 统计 V4 数量
  const countsV4 = {
    T0Count: activeFormationsV4.filter(x => x.currentDynamicTier === 'T0').length,
    T1Count: activeFormationsV4.filter(x => x.currentDynamicTier === 'T1').length,
    T2Count: activeFormationsV4.filter(x => x.currentDynamicTier === 'T2').length,
    T3Count: activeFormationsV4.filter(x => x.currentDynamicTier === 'T3').length,
  };

  const libraryV4 = {
    schemaVersion: 'T051_FORMATION_LIBRARY_V4',
    libraryRevision: 'v4.0.0-t051-dynamic-ladder',
    updatedAt: new Date().toISOString(),
    activeL2ManifestHash: activeL2Manifest.manifestHash,
    policyRevision: policyV4.policyRevision,
    counts: countsV4,
    formations: activeFormationsV4,
  };

  writeFileSync(FORMATION_LIBRARY_V4_PATH, JSON.stringify(libraryV4, null, 2), 'utf8');
  console.log(`✓ V4 动态战力阵型库已写入: ${FORMATION_LIBRARY_V4_PATH}`);
  console.log(`  新梯队分布: T0=${countsV4.T0Count}, T1=${countsV4.T1Count}, T2=${countsV4.T2Count}, T3=${countsV4.T3Count}\n`);

  console.log('--- 旧 -> 新梯队迁移矩阵 ---');
  console.table(oldToNewCounts);

  // 5. 写入 V4 审计总账 (`formation_winrate_audit_ledger.v4.jsonl`)
  console.log('--- 5. 生成 V4 审计总账 ---');
  const ledgerLines: string[] = [];
  for (const f of activeFormationsV4) {
    const record = {
      recordId: `v4_${f.formationId}`,
      formationId: f.formationId,
      rootR0SourceId: f.rootR0SourceId,
      activeRoles: f.activeRoles,
      activeLibraryRevision: f.activeLibraryRevision,
      activeL2ManifestHash: f.activeL2ManifestHash,
      previousTier: f.previousTier,
      currentDynamicTier: f.currentDynamicTier,
      primaryScore70_L2: f.activeL2Metrics?.primaryScore70 ?? null,
      primaryScore70_L1: f.l1Metrics?.primaryScore70 ?? null,
      l2Metrics: f.activeL2Metrics,
      l1Metrics: f.l1Metrics,
      l3Metrics: f.l3Metrics,
      verificationState: f.verificationState,
      regradeReason: f.regradeReason,
      supersessionLink: null,
      updatedAt: f.updatedAt,
    };
    ledgerLines.push(JSON.stringify(record));
  }
  writeFileSync(LEDGER_V4_PATH, ledgerLines.join('\n') + '\n', 'utf8');
  console.log(`✓ V4 审计总账写入完毕: ${ledgerLines.length} 行记录 -> ${LEDGER_V4_PATH}\n`);

  // 6. 生成最新纯文本简洁胜率报告 (`winrate_report.txt`)
  console.log('--- 6. 生成简洁纯文本胜率报告 TXT ---');
  const txtLines: string[] = [];
  txtLines.push('========================================================================================================================');
  txtLines.push('                          MONSRISE 动态战力天梯与 Score70 阵型胜率汇总报告 (T051 V4 标准版)                              ');
  txtLines.push('========================================================================================================================');
  txtLines.push(
    '阵型名称 (Formation ID)'.padEnd(42) + ' | ' +
    'R0 根谱系'.padEnd(12) + ' | ' +
    '动态层级'.padEnd(8) + ' | ' +
    'Active-L2 (Score70 / W-D-L)'.padEnd(28) + ' | ' +
    'L1 实测 (Score70 / 胜% / 平% / 不败%)'.padEnd(35) + ' | ' +
    '优化次数'
  );
  txtLines.push('------------------------------------------------------------------------------------------------------------------------');

  const sorted = [...activeFormationsV4].sort((a, b) => {
    const tierOrder: Record<string, number> = { T0: 4, T1: 3, T2: 2, T3: 1 };
    if (tierOrder[b.currentDynamicTier] !== tierOrder[a.currentDynamicTier]) {
      return (tierOrder[b.currentDynamicTier] ?? 0) - (tierOrder[a.currentDynamicTier] ?? 0);
    }
    const aScore = a.l1Metrics?.primaryScore70 ?? a.activeL2Metrics?.primaryScore70 ?? a.l3Metrics?.primaryScore70 ?? 0;
    const bScore = b.l1Metrics?.primaryScore70 ?? b.activeL2Metrics?.primaryScore70 ?? b.l3Metrics?.primaryScore70 ?? 0;
    return bScore - aScore;
  });

  for (const f of sorted) {
    const idStr = f.formationId.length > 42 ? f.formationId.slice(0, 39) + '...' : f.formationId.padEnd(42);
    const r0Str = f.rootR0SourceId.padEnd(12);
    const tierStr = f.currentDynamicTier.padEnd(8);

    let l2Str = '-';
    if (f.activeL2Metrics && f.activeL2Metrics.n > 0) {
      l2Str = `${(f.activeL2Metrics.primaryScore70 * 100).toFixed(1)}% (${f.activeL2Metrics.w}-${f.activeL2Metrics.d}-${f.activeL2Metrics.l})`;
    }

    let l1Str = '-';
    if (f.l1Metrics && f.l1Metrics.n > 0) {
      l1Str = `${(f.l1Metrics.primaryScore70 * 100).toFixed(1)}% (W:${(f.l1Metrics.winRate * 100).toFixed(0)}% D:${(f.l1Metrics.drawRate * 100).toFixed(0)}% NL:${(f.l1Metrics.noLossRate * 100).toFixed(0)}%)`;
    }

    const attemptsStr = String(f.l2AttemptsCount ?? 0).padStart(8);

    txtLines.push(
      `${idStr} | ${r0Str} | ${tierStr} | ${l2Str.padEnd(28)} | ${l1Str.padEnd(35)} | ${attemptsStr}`
    );
  }

  txtLines.push('========================================================================================================================');
  txtLines.push(`统计总数: 阵型共 ${activeFormationsV4.length} 套 (T0: ${countsV4.T0Count}, T1: ${countsV4.T1Count}, T2: ${countsV4.T2Count}, T3: ${countsV4.T3Count})`);
  txtLines.push('说明:');
  txtLines.push('  - 评价指标: Score70 = (W + 0.70 * D) / N (对高平局防守永平流派客观友好)');
  txtLines.push('  - Active-L2: 对战当前活跃 T0 强阵池 (11 对手 × 双侧 × 10 局 = 220 局)');
  txtLines.push('  - L1 实测: 对战全谱系 22 跨谱系 Melee 对手池 (22 对手 × 双侧 × 5 局 = 220 局)');
  txtLines.push('  - L1 字段: Score70 / W:纯胜率 / D:平局率 / NL:不败率 (No-Loss Rate = W+D)');
  txtLines.push('  - 优化次数: 该阵型经过的演化/针对性尝试次数 (Attempts Count)');
  txtLines.push('========================================================================================================================\n');

  writeFileSync(USER_TXT_REPORT_PATH, txtLines.join('\n'), 'utf8');
  console.log(`✓ 简洁报告生成完毕: ${USER_TXT_REPORT_PATH}`);
}

main().catch(err => {
  console.error('Fatal execution error:', err);
  process.exit(1);
});
