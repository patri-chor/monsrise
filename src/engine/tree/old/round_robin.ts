// ============================================================
// 循环赛评估（round-robin）—— 阵型互相对战（含先手/后手，多线程并行）
//
// 两种用法：
//   1. 全量互评（CLI）：11 阵型两两配对双向，输出排名表。
//   2. 单候选评估（roundRobinEvaluate 导出）：评估一个候选阵型（evol/native）
//      vs 其他所有阵型的循环赛不败率（先手/后手/合并），供轮回优化前后对比。
//
// 并行：worker_threads 多核（战斗模拟是 JS 逻辑，非 GPU 矩阵运算，显卡不适用；
//   用 CPU 多核吃满算力）。worker 脚本 arena_worker.ts 先由 esbuild 编译成
//   reports/arena_worker.cjs，再被多个 Worker 加载。
//
// 运行：npx vite-node --script src/engine/tree/round_robin.ts [gamesPerPair] [worker数]
// ============================================================

import '../env';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { Worker } from 'node:worker_threads';
import { cpus } from 'node:os';
import { FORMATION_LIBRARY } from '../../ai/formation_library';
import { playSpecVsSpec, type SideSpec } from './arena';

const WORKER_SRC = resolve('src/engine/tree/arena_worker.ts');
const WORKER_OUT = resolve('reports/arena_worker.cjs');

export interface Task { aKind: 'native' | 'evol'; aIndex: number; aFormation?: any; b: number; side: 1 | 2; seed: number; games: number }
export interface Result { a: number; b: number; side: 1 | 2; w: number; d: number; l: number }

/** 编译 worker。esbuild 编译仅 ~40ms，每次强制重编译，确保 worker 快照
 *  永远与当前 formation_library.ts 一致（Copy-Item 会保留源 mtime，
 *  导致 mtime 判断不可靠，故不依赖 mtime）。 */
export function ensureWorker(): void {
  execSync(
    `npx esbuild "${WORKER_SRC}" --bundle --outfile="${WORKER_OUT}" --platform=node --format=cjs --target=node20`,
    { stdio: 'ignore' },
  );
}

export function runWorker(chunk: Task[]): Promise<Result[]> {
  return new Promise((resolveP, reject) => {
    const w = new Worker(WORKER_OUT, { workerData: { tasks: chunk } });
    const timer = setTimeout(() => { w.terminate(); reject(new Error('worker 超时')); }, 3600000);
    w.once('message', (msg) => { clearTimeout(timer); resolveP(msg as Result[]); w.terminate(); });
    w.once('error', (e) => { clearTimeout(timer); reject(e); });
    w.once('exit', (code) => { if (code !== 0) { clearTimeout(timer); reject(new Error(`worker exit ${code}`)); } });
  });
}

export interface RoundRobinScore {
  first: { w: number; d: number; l: number };
  second: { w: number; d: number; l: number };
  undefeated: number;  // 总不败率（先手+后手合并）
  firstUndefeated: number;
  secondUndefeated: number;
}

/**
 * 评估一个候选阵型 vs 其他所有阵型的循环赛战绩（双向 × games 局）。
 * specA 可以是 evol（进化个体）或 native（原生阵型）；对手始终 native。
 * 用 worker 池并行。
 */
export async function roundRobinEvaluate(
  specA: SideSpec,
  games: number,
  workerCount?: number,
): Promise<RoundRobinScore> {
  const wc = workerCount && workerCount > 0 ? workerCount : Math.max(1, cpus().length - 1);
  ensureWorker();

  const n = FORMATION_LIBRARY.length;
  const aName = specA.f.name;
  // 候选 A 的索引（native 时），evol 时用序列化 formation
  const aIndex = specA.kind === 'native'
    ? FORMATION_LIBRARY.findIndex(f => f.name === aName)
    : -1;

  const tasks: Task[] = [];
  for (let b = 0; b < n; b++) {
    if (specA.kind === 'native' && b === aIndex) continue; // 跳过自己
    const base = specA.kind === 'evol'
      ? { aKind: 'evol' as const, aIndex: -1, aFormation: JSON.parse(JSON.stringify((specA.f as any))) }
      : { aKind: 'native' as const, aIndex, aFormation: undefined };
    tasks.push({ ...base, b, side: 1, seed: 50000 + b * 100, games });
    tasks.push({ ...base, b, side: 2, seed: 60000 + b * 100, games });
  }

  const chunkSize = Math.ceil(tasks.length / wc);
  const chunks: Task[][] = [];
  for (let i = 0; i < tasks.length; i += chunkSize) chunks.push(tasks.slice(i, i + chunkSize));

  const allResults = (await Promise.all(chunks.map(runWorker))).flat();

  const first = { w: 0, d: 0, l: 0 };
  const second = { w: 0, d: 0, l: 0 };
  for (const r of allResults) {
    if (r.side === 1) { first.w += r.w; first.d += r.d; first.l += r.l; }
    else { second.w += r.w; second.d += r.d; second.l += r.l; }
  }
  const fw = first.w + second.w, fd = first.d + second.d, fl = first.l + second.l;
  return {
    first, second,
    undefeated: (fw + fd) / (fw + fd + fl),
    firstUndefeated: (first.w + first.d) / (first.w + first.d + first.l),
    secondUndefeated: (second.w + second.d) / (second.w + second.d + second.l),
  };
}

function pct(w: number, d: number, l: number): string {
  const t = w + d + l;
  if (t === 0) return '-';
  return ((w + d) / t * 100).toFixed(1) + '%';
}

// ---------- 全对阵矩阵（11×11 胜率表） ----------

export interface MatrixCell {
  a: number;          // 行（我方）索引
  b: number;          // 列（对方）索引
  w: number; d: number; l: number;  // 我方先手+后手合并战绩
  undefeated: number; // 我方不败率（胜+平）/总
}

export interface MatrixResult {
  ids: string[];
  names: string[];
  games: number;
  cells: (MatrixCell | null)[][];   // cells[a][b]，a===b 为 null
  rowTotals: { w: number; d: number; l: number; undefeated: number }[]; // 每行 vs 其他全部的总不败率
}

/**
 * 全对阵矩阵评估：每个阵型 vs 其他所有阵型（先手+后手 × games 局），
 * 返回 11×11 胜率矩阵（行=我方，列=对方，单元格=我方不败率）。
 * 用 worker 池并行，吃满多核。
 */
export async function fullMatrixEvaluate(games: number, workerCount?: number): Promise<MatrixResult> {
  const wc = workerCount && workerCount > 0 ? workerCount : Math.max(1, cpus().length - 1);
  ensureWorker();
  const n = FORMATION_LIBRARY.length;

  const tasks: Task[] = [];
  for (let a = 0; a < n; a++) {
    for (let b = 0; b < n; b++) {
      if (a === b) continue;
      tasks.push({ aKind: 'native', aIndex: a, b, side: 1, seed: 30000 + a * 1000 + b * 100, games });
      tasks.push({ aKind: 'native', aIndex: a, b, side: 2, seed: 40000 + a * 1000 + b * 100, games });
    }
  }

  const chunkSize = Math.ceil(tasks.length / wc);
  const chunks: Task[][] = [];
  for (let i = 0; i < tasks.length; i += chunkSize) chunks.push(tasks.slice(i, i + chunkSize));
  const allResults = (await Promise.all(chunks.map(runWorker))).flat();

  const cells: (MatrixCell | null)[][] = [];
  for (let a = 0; a < n; a++) {
    cells[a] = [];
    for (let b = 0; b < n; b++) cells[a][b] = a === b ? null : { a, b, w: 0, d: 0, l: 0, undefeated: 0 };
  }
  for (const r of allResults) {
    const c = cells[r.a]?.[r.b];
    if (!c) continue;
    c.w += r.w; c.d += r.d; c.l += r.l;
  }
  for (let a = 0; a < n; a++) {
    for (let b = 0; b < n; b++) {
      const c = cells[a][b];
      if (!c) continue;
      const t = c.w + c.d + c.l;
      c.undefeated = t ? (c.w + c.d) / t : 0;
    }
  }
  const rowTotals = cells.map((row, a) => {
    let w = 0, d = 0, l = 0;
    for (let b = 0; b < n; b++) { if (b === a) continue; const c = row[b]!; w += c.w; d += c.d; l += c.l; }
    const t = w + d + l;
    return { w, d, l, undefeated: t ? (w + d) / t : 0 };
  });

  return {
    ids: FORMATION_LIBRARY.map(f => f.id),
    names: FORMATION_LIBRARY.map(f => f.name),
    games,
    cells,
    rowTotals,
  };
}

async function main(): Promise<void> {
  const gamesPerPair = Number(process.argv[2] || 4);
  const workerArg = Number(process.argv[3] || 0);
  const workerCount = workerArg > 0 ? workerArg : Math.max(1, cpus().length - 1);
  const n = FORMATION_LIBRARY.length;

  ensureWorker();

  console.log(`===== 循环赛评估：${n} 阵型互相对战（每配对双向 × ${gamesPerPair} 局，${workerCount} 线程） =====\n`);

  const tasks: Task[] = [];
  for (let a = 0; a < n; a++) {
    for (let b = 0; b < n; b++) {
      if (a === b) continue;
      tasks.push({ aKind: 'native', aIndex: a, b, side: 1, seed: 30000 + a * 1000 + b * 100, games: gamesPerPair });
      tasks.push({ aKind: 'native', aIndex: a, b, side: 2, seed: 40000 + a * 1000 + b * 100, games: gamesPerPair });
    }
  }

  const chunkSize = Math.ceil(tasks.length / workerCount);
  const chunks: Task[][] = [];
  for (let i = 0; i < tasks.length; i += chunkSize) chunks.push(tasks.slice(i, i + chunkSize));

  const t0 = Date.now();
  console.log(`任务 ${tasks.length} 个，分 ${chunks.length} 片，开始并行对战...\n`);

  const allResults = (await Promise.all(chunks.map(runWorker))).flat();
  const ms = Date.now() - t0;

  const standings = FORMATION_LIBRARY.map((f, idx) => ({
    name: f.name, first: { w: 0, d: 0, l: 0 }, second: { w: 0, d: 0, l: 0 }, _idx: idx,
  }));
  for (const r of allResults) {
    const s = standings[r.a];
    if (r.side === 1) { s.first.w += r.w; s.first.d += r.d; s.first.l += r.l; }
    else { s.second.w += r.w; s.second.d += r.d; s.second.l += r.l; }
  }

  console.log(`\n===== 循环赛排名（每阵型 vs 其他 ${n - 1} 阵型，双向 × ${gamesPerPair} 局） =====`);
  console.log(`${'阵型'.padEnd(6, '　')} ${'先手不败'.padEnd(10)} ${'后手不败'.padEnd(10)} ${'总不败'.padEnd(10)} ${'总胜'.padEnd(6)} ${'总平'.padEnd(6)} ${'总负'.padEnd(6)}`);

  const ranked = standings.map(s => {
    const w = s.first.w + s.second.w;
    const d = s.first.d + s.second.d;
    const l = s.first.l + s.second.l;
    return { ...s, undefeated: (w + d) / (w + d + l), w, d, l };
  }).sort((a, b) => b.undefeated - a.undefeated);

  for (const r of ranked) {
    console.log(
      `${r.name.padEnd(6, '　')} ${pct(r.first.w, r.first.d, r.first.l).padEnd(10)} ${pct(r.second.w, r.second.d, r.second.l).padEnd(10)} ${pct(r.w, r.d, r.l).padEnd(10)} ${String(r.w).padEnd(6)} ${String(r.d).padEnd(6)} ${String(r.l).padEnd(6)}`,
    );
  }

  console.log(`\n总对局 ${allResults.length * gamesPerPair} 局（${allResults.length} 任务），耗时 ${(ms / 1000).toFixed(1)}s（${workerCount} 线程）`);
}

// CLI 直接运行
if (process.argv[1] && process.argv[1].endsWith('round_robin.ts')) {
  main();
}

// 供其它模块直接调用（不用 playSpecVsSpec，避免循环导入提示）
export function loadBundleForSync(): any {
  const w = globalThis as any;
  const code = readFileSync(resolve('public/ai-bundle.iife.js'), 'utf8');
  const factory = new Function('window', 'globalThis', '"use strict";\n' + code + '\n;return BattleAI;');
  const b = factory(w, w);
  return b?.BattleAI ?? w.BattleAI;
}
export { playSpecVsSpec };
