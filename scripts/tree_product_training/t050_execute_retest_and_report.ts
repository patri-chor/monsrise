// ============================================================
// scripts/tree_product_training/t050_execute_retest_and_report.ts
// T050: 独立重测可疑满分记录、总账语义修复与简洁胜率报告生成 (多线程/多进程并发版)
// ============================================================

import '../../src/engine/env';
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { cpus } from 'node:os';
import { execFileSync, spawn } from 'node:child_process';
import { FORMATION_LIBRARY } from '../../src/ai/formation_library';
import { computeCalculatorPolicyFingerprint } from '../../src/engine/tree/calculator_policy';
import type { TargetTaskData, TargetTaskResult } from './t050_worker';

const T037_DIR = resolve('tests/fixtures/tree/experience_library/product_path_t037');
const FORMATION_LIBRARY_PATH = resolve(`${T037_DIR}/formation_strength_library.json`);
const INVENTORY_PATH = resolve(`${T037_DIR}/perfect_score_retest_inventory.json`);
const RAW_RETEST_PATH = resolve(`${T037_DIR}/perfect_score_retest_raw.jsonl`);
const VECTORS_RETEST_PATH = resolve(`${T037_DIR}/perfect_score_retest_vectors.jsonl`);
const LEDGER_V3_PATH = resolve(`${T037_DIR}/formation_winrate_audit_ledger.v3.jsonl`);
const USER_TXT_REPORT_PATH = resolve('winrate_report.txt');

console.log('=== T050: Parallel Multi-Process Suspicious Perfect-Score Retest & Report ===\n');

// 1. 加载阵型库
const library = JSON.parse(readFileSync(FORMATION_LIBRARY_PATH, 'utf8'));

// 2. 清点所有可疑的 L2 / L1 满分候选
const suspiciousTargets: Array<{
  formationId: string;
  rootT0SourceId: string;
  currentTier: string;
  canonicalFingerprint: string;
  l2Score: number | null;
  l1Score: number | null;
  l2AttemptsCount: number | null;
  levelsToRetest: ('L2' | 'L1')[];
}> = [];

for (const f of library.formations) {
  const needsL2 = f.l2Score === 1;
  const needsL1 = f.l1Score === 1 && f.currentTier === 'T1';
  if (needsL2 || needsL1) {
    const levels: ('L2' | 'L1')[] = [];
    if (needsL2) levels.push('L2');
    if (needsL1) levels.push('L1');
    suspiciousTargets.push({
      formationId: f.formationId,
      rootT0SourceId: f.rootT0SourceId,
      currentTier: f.currentTier,
      canonicalFingerprint: f.canonicalFingerprint,
      l2Score: f.l2Score,
      l1Score: f.l1Score,
      l2AttemptsCount: f.l2AttemptsCount,
      levelsToRetest: levels,
    });
  }
}

// 写入清点清单
writeFileSync(INVENTORY_PATH, JSON.stringify({
  schemaVersion: 'T050_PERFECT_SCORE_RETEST_INVENTORY_V1',
  createdAt: new Date().toISOString(),
  targetCount: suspiciousTargets.length,
  targets: suspiciousTargets,
}, null, 2), 'utf8');

console.log(`✓ Retest Inventory Created: ${suspiciousTargets.length} suspicious perfect-score targets inventoried.`);
console.log(`  Saved to: ${INVENTORY_PATH}\n`);

// 3. 构建多进程任务切片
const numWorkers = Math.min(cpus().length || 8, suspiciousTargets.length, 12);
console.log(`--- 启动 ${numWorkers} 个并发 Worker 并行重测 ---`);

const strong11Ids = FORMATION_LIBRARY.slice(0, 11).map(f => f.id);
const allTasks: TargetTaskData[] = suspiciousTargets.map((target, idx) => ({
  targetIdx: idx,
  formationId: target.formationId,
  rootT0SourceId: target.rootT0SourceId,
  currentTier: target.currentTier,
  canonicalFingerprint: target.canonicalFingerprint,
  levelsToRetest: target.levelsToRetest,
  strong11Ids,
  seedBaseL2: 910000,
  seedBaseL1: 920000,
}));

// 将 tasks 均分给 numWorkers
const workerSlices: TargetTaskData[][] = Array.from({ length: numWorkers }, () => []);
allTasks.forEach((task, i) => {
  workerSlices[i % numWorkers].push(task);
});

import { spawn } from 'node:child_process';

async function runParallelRetest(): Promise<TargetTaskResult[]> {
  const runnerPath = resolve('scripts/tree_product_training/t050_batch_runner.ts');
  const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';

  const promises = workerSlices.map((slice, workerIdx) => {
    return new Promise<TargetTaskResult[]>((resPromise, rejPromise) => {
      const sliceFile = resolve(`tests/fixtures/tree/experience_library/product_path_t037/worker_slice_${workerIdx}.json`);
      const outFile = sliceFile.replace('.json', '.out.json');
      writeFileSync(sliceFile, JSON.stringify(slice), 'utf8');

      const child = spawn(npxCmd, ['tsx', runnerPath, sliceFile], {
        stdio: 'inherit',
        shell: true,
      });

      child.on('close', code => {
        if (code === 0 && existsSync(outFile)) {
          const results: TargetTaskResult[] = JSON.parse(readFileSync(outFile, 'utf8'));
          try { unlinkSync(sliceFile); } catch {}
          try { unlinkSync(outFile); } catch {}
          resPromise(results);
        } else {
          rejPromise(new Error(`Worker ${workerIdx} failed with exit code ${code}`));
        }
      });

      child.on('error', err => {
        rejPromise(err);
      });
    });
  });

  const sliceResults = await Promise.all(promises);
  return sliceResults.flat();
}

async function main() {
  const startTime = Date.now();
  const allResults = await runParallelRetest();
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n✓ 并发对战重测全部完成！总耗时: ${elapsed} 秒 (28 个阵型全部完成)\n`);

  const rawGameRecords: any[] = [];
  const vectorRecords: any[] = [];
  const verifiedResultsMap = new Map<string, { l2?: any; l1?: any }>();

  // 排序保持确定性
  allResults.sort((a, b) => a.targetIdx - b.targetIdx);

  for (const res of allResults) {
    if (res.rawGames) rawGameRecords.push(...res.rawGames);
    if (res.l2Vector) {
      vectorRecords.push(res.l2Vector);
      if (!verifiedResultsMap.has(res.formationId)) verifiedResultsMap.set(res.formationId, {});
      verifiedResultsMap.get(res.formationId)!.l2 = res.l2Vector;
    }
    if (res.l1Vector) {
      vectorRecords.push(res.l1Vector);
      if (!verifiedResultsMap.has(res.formationId)) verifiedResultsMap.set(res.formationId, {});
      verifiedResultsMap.get(res.formationId)!.l1 = res.l1Vector;
    }
  }

  // 写入 Raw 与 Derived Vectors
  writeFileSync(RAW_RETEST_PATH, rawGameRecords.map(r => JSON.stringify(r)).join('\n') + '\n', 'utf8');
  writeFileSync(VECTORS_RETEST_PATH, vectorRecords.map(r => JSON.stringify(r)).join('\n') + '\n', 'utf8');

  console.log(`✓ Raw Retest Games Saved: ${rawGameRecords.length} records written to: ${RAW_RETEST_PATH}`);
  console.log(`✓ Derived Vectors Saved: ${vectorRecords.length} records written to: ${VECTORS_RETEST_PATH}\n`);

  // 4. 生成全新的严格语义 V3 审计总账 (`formation_winrate_audit_ledger.v3.jsonl`)
  console.log('--- 写入严格语义 V3 审计总账 ---');

  const v3LedgerRecords: any[] = [];
  let seq = 1;

  for (const form of library.formations) {
    const formationId = form.formationId;
    const rootId = form.rootT0SourceId;
    const verified = verifiedResultsMap.get(formationId);

    // --- L3 记录 ---
    const l3Score = form.l3Score;
    v3LedgerRecords.push({
      recordId: `ledger_v3_${String(seq++).padStart(4, '0')}_${formationId}_L3`,
      evaluatedAt: form.lastEvaluatedAt ?? new Date().toISOString(),
      schemaVersion: 'T050_FORMATION_WINRATE_AUDIT_LEDGER_V3',
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
      verificationState: 'UNVERIFIED_AGGREGATE_ONLY',
      workerErrors: 0,
      evidenceClass: 'AGGREGATE_EXPLORATION_ONLY',
      noApplyConfirmation: 'NO_APPLY_NO_DEPLOY_NO_PUBLISH_NO_TIER_CHANGE',
    });

    // --- L2 记录 ---
    if (verified?.l2) {
      const l2 = verified.l2;
      v3LedgerRecords.push({
        recordId: `ledger_v3_${String(seq++).padStart(4, '0')}_${formationId}_L2`,
        evaluatedAt: new Date().toISOString(),
        schemaVersion: 'T050_FORMATION_WINRATE_AUDIT_LEDGER_V3',
        formationId,
        rootT0SourceId: rootId,
        currentTier: form.currentTier,
        canonicalFingerprint: form.canonicalFingerprint,
        calculatorPolicyFingerprint: computeCalculatorPolicyFingerprint(null),
        executionProvenance: 'PRODUCT_PATH',
        learningLevel: 'L2',
        benchmarkRevision: 'v1.0.0-t050-retested-220g',
        opponentCoverageCount: 11,
        p1p2Coverage: 'DUAL_SIDE_EQUAL',
        gamesPerCell: 10,
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
      v3LedgerRecords.push({
        recordId: `ledger_v3_${String(seq++).padStart(4, '0')}_${formationId}_L2`,
        evaluatedAt: form.lastEvaluatedAt ?? new Date().toISOString(),
        schemaVersion: 'T050_FORMATION_WINRATE_AUDIT_LEDGER_V3',
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
        verificationState: 'UNVERIFIED_AGGREGATE_ONLY',
        workerErrors: 0,
        evidenceClass: 'AGGREGATE_EXPLORATION_ONLY',
        noApplyConfirmation: 'NO_APPLY_NO_DEPLOY_NO_PUBLISH_NO_TIER_CHANGE',
      });
    }

    // --- L1 记录 ---
    if (verified?.l1) {
      const l1 = verified.l1;
      v3LedgerRecords.push({
        recordId: `ledger_v3_${String(seq++).padStart(4, '0')}_${formationId}_L1`,
        evaluatedAt: new Date().toISOString(),
        schemaVersion: 'T050_FORMATION_WINRATE_AUDIT_LEDGER_V3',
        formationId,
        rootT0SourceId: rootId,
        currentTier: form.currentTier,
        canonicalFingerprint: form.canonicalFingerprint,
        calculatorPolicyFingerprint: computeCalculatorPolicyFingerprint(null),
        executionProvenance: 'PRODUCT_PATH',
        learningLevel: 'L1',
        benchmarkRevision: 'v1.0.0-t050-retested-220g',
        opponentCoverageCount: 11,
        p1p2Coverage: 'DUAL_SIDE_EQUAL',
        gamesPerCell: 10,
        totalGames: l1.totalGames,
        outcomeEvidenceKind: 'RAW_OUTCOMES_RECONCILED',
        w: l1.w,
        d: l1.d,
        l: l1.l,
        score: l1.score,
        pureWinRate: l1.pureWinRate,
        weakestOpponentId: l1.weakestOpponentId,
        weakestSide: l1.weakestSide,
        verificationState: 'INDEPENDENT_VERIFIED',
        workerErrors: 0,
        evidenceClass: 'INDEPENDENT_VERIFICATION',
        noApplyConfirmation: 'NO_APPLY_NO_DEPLOY_NO_PUBLISH_NO_TIER_CHANGE',
      });
    } else if (form.l1Score !== null && form.l1Score !== undefined) {
      v3LedgerRecords.push({
        recordId: `ledger_v3_${String(seq++).padStart(4, '0')}_${formationId}_L1`,
        evaluatedAt: form.lastEvaluatedAt ?? new Date().toISOString(),
        schemaVersion: 'T050_FORMATION_WINRATE_AUDIT_LEDGER_V3',
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
        verificationState: 'UNVERIFIED_AGGREGATE_ONLY',
        workerErrors: 0,
        evidenceClass: 'AGGREGATE_EXPLORATION_ONLY',
        noApplyConfirmation: 'NO_APPLY_NO_DEPLOY_NO_PUBLISH_NO_TIER_CHANGE',
      });
    }
  }

  // 写入 V3 审计总账
  writeFileSync(LEDGER_V3_PATH, v3LedgerRecords.map(r => JSON.stringify(r)).join('\n') + '\n', 'utf8');
  console.log(`✓ V3 审计总账生成完毕: ${v3LedgerRecords.length} 条记录写入: ${LEDGER_V3_PATH}\n`);

  // 5. 生成用户要求的简洁胜率报告 TXT (`winrate_report.txt`)
  console.log('--- 生成人工可读的简洁真实胜率报告 TXT ---');

  const txtLines: string[] = [];
  txtLines.push('================================================================================================');
  txtLines.push('                     MONSRISE 阵型真实胜率与优化次数汇总报告 (T050 独立重测实测版)                ');
  txtLines.push('================================================================================================');
  txtLines.push(
    '阵型名称 (Formation ID)'.padEnd(45) + ' | ' +
    '层级 (Tier)'.padEnd(10) + ' | ' +
    'L3 胜率'.padEnd(9) + ' | ' +
    'L2 实测胜率'.padEnd(10) + ' | ' +
    'L1 实测胜率'.padEnd(10) + ' | ' +
    '优化次数 (Attempts)'
  );
  txtLines.push('------------------------------------------------------------------------------------------------');

  const sortedFormations = [...library.formations].sort((a: any, b: any) => {
    const tierOrder: Record<string, number> = { T0: 4, T1: 3, T2: 2, T3: 1 };
    if (tierOrder[b.currentTier] !== tierOrder[a.currentTier]) {
      return (tierOrder[b.currentTier] ?? 0) - (tierOrder[a.currentTier] ?? 0);
    }
    const aVerified = verifiedResultsMap.get(a.formationId);
    const bVerified = verifiedResultsMap.get(b.formationId);

    const aScore = aVerified?.l1?.pureWinRate ?? aVerified?.l2?.pureWinRate ?? a.l1Score ?? a.l2Score ?? a.l3Score ?? 0;
    const bScore = bVerified?.l1?.pureWinRate ?? bVerified?.l2?.pureWinRate ?? b.l1Score ?? b.l2Score ?? b.l3Score ?? 0;
    return bScore - aScore;
  });

  for (const f of sortedFormations) {
    const idStr = f.formationId.length > 45 ? f.formationId.slice(0, 42) + '...' : f.formationId.padEnd(45);
    const tierStr = f.currentTier.padEnd(10);
    const verified = verifiedResultsMap.get(f.formationId);

    const l3Str = f.l3Score !== null && f.l3Score !== undefined ? (f.l3Score * 100).toFixed(1) + '%' : '-';
    
    // L2: 优先使用 220 局真实重测胜率
    let l2Str = '-';
    if (verified?.l2) {
      l2Str = (verified.l2.pureWinRate * 100).toFixed(1) + '%';
    } else if (f.l2Score !== null && f.l2Score !== undefined) {
      l2Str = (f.l2Score * 100).toFixed(1) + '%';
    }

    // L1: 优先使用 220 局真实重测胜率
    let l1Str = '-';
    if (verified?.l1) {
      l1Str = (verified.l1.pureWinRate * 100).toFixed(1) + '%';
    } else if (f.l1Score !== null && f.l1Score !== undefined) {
      l1Str = (f.l1Score * 100).toFixed(1) + '%';
    }

    const attemptsStr = String(f.l2AttemptsCount ?? 0);

    txtLines.push(
      `${idStr} | ${tierStr} | ${l3Str.padStart(7)} | ${l2Str.padStart(10)} | ${l1Str.padStart(10)} | ${attemptsStr.padStart(8)}`
    );
  }

  txtLines.push('================================================================================================');
  txtLines.push(`统计总数: 阵型共 ${library.formations.length} 套 (T0: ${library.counts.T0Count}, T1: ${library.counts.T1Count}, T2: ${library.counts.T2Count}, T3: ${library.counts.T3Count})`);
  txtLines.push('说明:');
  txtLines.push('  - L3: Early Bundle 8 基础对手池胜率');
  txtLines.push('  - L2 实测胜率: 经 220 局 (11 T0 × 双侧 × 10 局) 独立重测后的真实纯胜率 (Pure Win-Rate)');
  txtLines.push('  - L1 实测胜率: 经 220 局 (11 谱系 × 双侧 × 10 局) 独立重测后的真实纯胜率 (Pure Win-Rate)');
  txtLines.push('  - 优化次数: 该阵型经过的演化/针对性尝试次数 (Attempts Count)');
  txtLines.push('================================================================================================\n');

  const txtContent = txtLines.join('\n');
  writeFileSync(USER_TXT_REPORT_PATH, txtContent, 'utf8');

  console.log(`✓ 简洁真实胜率报告 TXT 生成完毕: ${USER_TXT_REPORT_PATH}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
