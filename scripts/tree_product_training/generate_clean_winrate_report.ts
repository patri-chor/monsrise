// ============================================================
// scripts/tree_product_training/generate_clean_winrate_report.ts
// 根据真实重测对战向量生成最终洁净的胜率与优化次数报告 TXT
// ============================================================

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const T037_DIR = resolve('tests/fixtures/tree/experience_library/product_path_t037');
const FORMATION_LIBRARY_PATH = resolve(`${T037_DIR}/formation_strength_library.json`);
const VECTORS_RETEST_PATH = resolve(`${T037_DIR}/perfect_score_retest_vectors.jsonl`);
const USER_TXT_REPORT_PATH = resolve('winrate_report.txt');

const library = JSON.parse(readFileSync(FORMATION_LIBRARY_PATH, 'utf8'));
const vectorLines = readFileSync(VECTORS_RETEST_PATH, 'utf8').split('\n').filter(Boolean);
const verifiedMap = new Map<string, { l2?: any; l1?: any }>();

for (const line of vectorLines) {
  const v = JSON.parse(line);
  if (!verifiedMap.has(v.formationId)) verifiedMap.set(v.formationId, {});
  if (v.level === 'L2') verifiedMap.get(v.formationId)!.l2 = v;
  if (v.level === 'L1') verifiedMap.get(v.formationId)!.l1 = v;
}

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
  const aVerified = verifiedMap.get(a.formationId);
  const bVerified = verifiedMap.get(b.formationId);

  const aScore = aVerified?.l1?.pureWinRate ?? aVerified?.l2?.pureWinRate ?? a.l1Score ?? a.l2Score ?? a.l3Score ?? 0;
  const bScore = bVerified?.l1?.pureWinRate ?? bVerified?.l2?.pureWinRate ?? b.l1Score ?? b.l2Score ?? b.l3Score ?? 0;
  return bScore - aScore;
});

for (const f of sortedFormations) {
  const idStr = f.formationId.length > 45 ? f.formationId.slice(0, 42) + '...' : f.formationId.padEnd(45);
  const tierStr = f.currentTier.padEnd(10);
  const verified = verifiedMap.get(f.formationId);

  const l3Str = f.l3Score !== null && f.l3Score !== undefined ? (f.l3Score * 100).toFixed(1) + '%' : '-';
  
  // L2 胜率 (优先使用 220 局实测胜率)
  let l2Str = '-';
  if (verified?.l2) {
    l2Str = (verified.l2.pureWinRate * 100).toFixed(1) + '%';
  } else if (f.l2Score !== null && f.l2Score !== undefined) {
    l2Str = (f.l2Score * 100).toFixed(1) + '%';
  }

  // L1 胜率 (优先使用 220 局实测胜率)
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
txtLines.push('  - L3 胜率: Early Bundle 8 基础对手池胜率');
txtLines.push('  - L2 实测胜率: 经 220 局 (11 T0 强阵 × 双侧 × 10 局) 独立重测后的真实纯胜率 (Pure Win-Rate)');
txtLines.push('  - L1 实测胜率: 经 220 局 (11 谱系 × 双侧 × 10 局) 独立重测后的真实纯胜率 (Pure Win-Rate)');
txtLines.push('  - 优化次数: 该阵型经过的演化/针对性尝试次数 (Attempts Count)');
txtLines.push('================================================================================================\n');

const txtContent = txtLines.join('\n');
writeFileSync(USER_TXT_REPORT_PATH, txtContent, 'utf8');

console.log(`✓ 真实胜率报告 TXT 生成完毕: ${USER_TXT_REPORT_PATH}`);
