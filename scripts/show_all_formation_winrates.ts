// ============================================================
// scripts/show_all_formation_winrates.ts
// 输出当前阵型库中所有阵型（T0 / T1 / T2 / T3）的胜率、对局数据与审计状态
// ============================================================

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const T037_DIR = resolve('tests/fixtures/tree/experience_library/product_path_t037');
const FORMATION_LIBRARY_PATH = resolve(`${T037_DIR}/formation_strength_library.json`);
const AUDIT_LEDGER_PATH = resolve(`${T037_DIR}/formation_winrate_audit_ledger.jsonl`);

if (!existsSync(FORMATION_LIBRARY_PATH)) {
  console.error(`Error: Formation library not found at ${FORMATION_LIBRARY_PATH}`);
  process.exit(1);
}

const library = JSON.parse(readFileSync(FORMATION_LIBRARY_PATH, 'utf8'));
const ledgerRecords = existsSync(AUDIT_LEDGER_PATH)
  ? readFileSync(AUDIT_LEDGER_PATH, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
  : [];

// 按 formationId 聚合最新最高级别的胜率与对局数据
const ledgerByFormation = new Map<string, {
  latestLevel: string;
  totalGames: number;
  w: number;
  d: number;
  l: number;
  score: number;
  pureWinRate: number;
  policyFp: string;
  verificationState: string;
}>();

for (const r of ledgerRecords) {
  const existing = ledgerByFormation.get(r.formationId);
  // 优先级：L1 > L2 > L3
  const levelPriority: Record<string, number> = { L1: 3, L2: 2, L3: 1 };
  const currentPrio = levelPriority[r.learningLevel] ?? 0;
  const existingPrio = existing ? (levelPriority[existing.latestLevel] ?? 0) : -1;

  if (currentPrio >= existingPrio) {
    ledgerByFormation.set(r.formationId, {
      latestLevel: r.learningLevel,
      totalGames: r.totalGames,
      w: r.w,
      d: r.d,
      l: r.l,
      score: r.score,
      pureWinRate: r.pureWinRate,
      policyFp: r.calculatorPolicyFingerprint,
      verificationState: r.verificationState,
    });
  }
}

interface FormationRow {
  formationId: string;
  rootT0: string;
  tier: string;
  status: string;
  l3Score: string;
  l2Score: string;
  l1Score: string;
  bestWinRate: string;
  w_d_l: string;
  games: number;
  highestLevel: string;
  policyFp: string;
  verification: string;
  numericSortScore: number;
}

const rows: FormationRow[] = [];

for (const f of library.formations) {
  const ledger = ledgerByFormation.get(f.formationId);
  const l3Str = f.l3Score !== null && f.l3Score !== undefined ? (f.l3Score * 100).toFixed(1) + '%' : '-';
  const l2Str = f.l2Score !== null && f.l2Score !== undefined ? (f.l2Score * 100).toFixed(1) + '%' : '-';
  const l1Str = f.l1Score !== null && f.l1Score !== undefined ? (f.l1Score * 100).toFixed(1) + '%' : '-';

  const bestScoreVal = f.l1Score ?? f.l2Score ?? f.l3Score ?? 0;
  const bestScoreStr = (bestScoreVal * 100).toFixed(1) + '%';
  const wdlStr = ledger ? `${ledger.w}/${ledger.d}/${ledger.l}` : '-';
  const games = ledger ? ledger.totalGames : 0;
  const highestLevel = ledger ? ledger.latestLevel : 'L3';
  const policyFp = ledger ? ledger.policyFp.slice(0, 8) : 'default';
  const verification = ledger ? ledger.verificationState : (f.currentTier === 'T0' ? 'INDEPENDENT_VERIFIED' : 'UNVERIFIED');

  rows.push({
    formationId: f.formationId,
    rootT0: f.rootT0SourceId,
    tier: f.currentTier,
    status: f.l1LearnerStatus ?? 'NOT_APPLICABLE',
    l3Score: l3Str,
    l2Score: l2Str,
    l1Score: l1Str,
    bestWinRate: bestScoreStr,
    w_d_l: wdlStr,
    games,
    highestLevel,
    policyFp,
    verification: verification === 'INDEPENDENT_VERIFIED' ? '✓ VERIFIED' : '⚠ QUARANTINED',
    numericSortScore: bestScoreVal,
  });
}

// 按胜率降序排序（同胜率按 Tier 排序: T0 -> T1 -> T2 -> T3）
const tierRank: Record<string, number> = { T0: 4, T1: 3, T2: 2, T3: 1 };
rows.sort((a, b) => {
  if (b.numericSortScore !== a.numericSortScore) {
    return b.numericSortScore - a.numericSortScore;
  }
  return (tierRank[b.tier] ?? 0) - (tierRank[a.tier] ?? 0);
});

// 打印格式化表格
console.log('========================================================================================================================');
console.log('                                  MONSRISE 阵型强度库全量胜率榜单 (T0 / T1 / T2 / T3)                                   ');
console.log('========================================================================================================================');
console.log(
  '序号'.padEnd(4) + ' | ' +
  '阵型 ID'.padEnd(42) + ' | ' +
  '流派根源'.padEnd(12) + ' | ' +
  '梯队'.padEnd(4) + ' | ' +
  '最高胜率'.padEnd(8) + ' | ' +
  'L3 (早鸟8)'.padEnd(9) + ' | ' +
  'L2 (强池11)'.padEnd(10) + ' | ' +
  'L1 (Melee88)'.padEnd(11) + ' | ' +
  '胜/平/负'.padEnd(10) + ' | ' +
  '局数'.padEnd(4) + ' | ' +
  'Policy'.padEnd(8) + ' | ' +
  '验证状态'
);
console.log('------------------------------------------------------------------------------------------------------------------------');

let idx = 1;
for (const r of rows) {
  const num = String(idx++).padStart(3, ' ');
  const fid = r.formationId.length > 42 ? r.formationId.slice(0, 39) + '...' : r.formationId.padEnd(42);
  const root = r.rootT0.padEnd(12);
  const tier = r.tier.padEnd(4);
  const best = r.bestWinRate.padStart(7) + ' ';
  const l3 = r.l3Score.padStart(8) + ' ';
  const l2 = r.l2Score.padStart(9) + ' ';
  const l1 = r.l1Score.padStart(10) + ' ';
  const wdl = r.w_d_l.padEnd(10);
  const games = String(r.games).padStart(4, ' ');
  const policy = r.policyFp.padEnd(8);
  const ver = r.verification;

  console.log(`${num} | ${fid} | ${root} | ${tier} | ${best} | ${l3} | ${l2} | ${l1} | ${wdl} | ${games} | ${policy} | ${ver}`);
}

console.log('========================================================================================================================');
console.log(`总阵型数: ${rows.length} 套 (T0 基准: ${library.counts.T0Count}, T1 精英: ${library.counts.T1Count}, T2 中坚: ${library.counts.T2Count}, T3 孵化: ${library.counts.T3Count})`);
console.log('说明:');
console.log('  1. L3 为 Early Bundle 8 对手池基线，L2 为 Frozen T0 11 强阵池，L1 为全谱系 88 成员概率 Melee 池。');
console.log('  2. 标有 ⚠ QUARANTINED 的满分记录受 T048 隔离门禁保护（属于未完成独立 220 局重测的聚合探索数据，杜绝虚夸）。');
console.log('========================================================================================================================\n');
