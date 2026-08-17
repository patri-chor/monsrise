// ============================================================
// 胜率矩阵（winrate matrix）—— 11×11 循环赛胜率表，固定更新
//
// 职责：
//   1. 调用 fullMatrixEvaluate 跑全对阵（先手+后手），得到 11×11 矩阵
//   2. 写 reports/胜率表格.md（用户每次看的固定表格）+ reports/winrate_matrix.json（结构化）
//   3. 维护 cycle_state.json：每个阵型的「已优化次数 optCount」与「上次胜率 lastWinrate」
//      供 cycle_optimize 判断「只优化新增 / 胜率下降较多的阵型」
//
// 运行：npx vite-node --script src/engine/tree/winrate_matrix.ts [每配对局数] [worker数]
// ============================================================

import '../env';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fullMatrixEvaluate, type MatrixResult } from './round_robin';

const MATRIX_MD = 'reports/胜率表格.md';
const MATRIX_JSON = 'reports/winrate_matrix.json';
const STATE_JSON = 'reports/cycle_state.json';

// ---------- 状态（cycle_state.json） ----------

export interface FormationState {
  name: string;
  optCount: number;       // 已优化次数（每次 apply 覆盖 +1）
  lastWinrate: number;    // 上次 apply 后测得的 round-robin 总不败率（0~1）
}

export type CycleState = Record<string, FormationState>;

export function loadCycleState(): CycleState {
  try {
    if (!existsSync(resolve(STATE_JSON))) return {};
    return JSON.parse(readFileSync(resolve(STATE_JSON), 'utf8'));
  } catch {
    return {};
  }
}

export function saveCycleState(state: CycleState): void {
  writeFileSync(resolve(STATE_JSON), JSON.stringify(state, null, 2), 'utf8');
}

// ---------- 输出 ----------

function fmtPct(v: number): string {
  return (v * 100).toFixed(1) + '%';
}

/** 生成 markdown 表格内容（11×11 矩阵 + 每行总不败率） */
export function buildMatrixMd(matrix: MatrixResult): string {
  const n = matrix.names.length;
  const lines: string[] = [];
  lines.push('# 阵型循环赛胜率表（11×11）');
  lines.push('');
  lines.push(`> 更新时间：${new Date().toLocaleString('zh-CN', { hour12: false })}`);
  lines.push(`> 口径：每格 = 行阵型(我方) vs 列阵型(对方) 先手+后手合并不败率（胜+平）/总，共 ${matrix.games * 2} 局/配对`);
  lines.push('> 主指标：每行「总不败率」= 该阵型 vs 其他 10 阵型先手+后手合并不败率');
  lines.push('');
  lines.push('| 我方 \\ 对方 | ' + matrix.names.join(' | ') + ' | **总不败率** |');
  lines.push('|' + '---|'.repeat(n + 1));
  for (let a = 0; a < n; a++) {
    const cells = matrix.cells[a].map((c) => {
      if (!c) return '—';
      return fmtPct(c.undefeated);
    });
    const total = matrix.rowTotals[a];
    lines.push(`| ${matrix.names[a]} | ${cells.join(' | ')} | **${fmtPct(total.undefeated)}** |`);
  }
  lines.push('');
  return lines.join('\n');
}

/** 写胜率表格.md + winrate_matrix.json */
export function writeMatrixReports(matrix: MatrixResult): { md: string; json: string } {
  const md = buildMatrixMd(matrix);
  writeFileSync(resolve(MATRIX_MD), md, 'utf8');
  writeFileSync(resolve(MATRIX_JSON), JSON.stringify({
    type: 'winrate_matrix',
    updatedAt: new Date().toISOString(),
    games: matrix.games,
    ids: matrix.ids,
    names: matrix.names,
    cells: matrix.cells.map(row => row.map(c => c ? { w: c.w, d: c.d, l: c.l, undefeated: c.undefeated } : null)),
    rowTotals: matrix.rowTotals,
  }, null, 2), 'utf8');
  return { md: resolve(MATRIX_MD), json: resolve(MATRIX_JSON) };
}

// ---------- CLI ----------

async function main(): Promise<void> {
  const games = Number(process.argv[2] || 10);
  const workerArg = Number(process.argv[3] || 0);
  const workerCount = workerArg > 0 ? workerArg : undefined;

  console.log(`===== 胜率矩阵评估：全对阵（每配对先手+后手 × ${games} 局） =====`);
  const t0 = Date.now();
  const matrix = await fullMatrixEvaluate(games, workerCount);
  const ms = Date.now() - t0;

  const out = writeMatrixReports(matrix);
  console.log(`\n${buildMatrixMd(matrix)}`);
  console.log(`耗时 ${(ms / 1000).toFixed(1)}s（${workerCount ?? 'auto'} worker）`);
  console.log(`已写 → ${out.md}`);
  console.log(`已写 → ${out.json}`);
}

// 仅 CLI 直接运行时执行 main（被 import 时不执行）
if (process.argv[1] && process.argv[1].endsWith('winrate_matrix.ts')) {
  main();
}
