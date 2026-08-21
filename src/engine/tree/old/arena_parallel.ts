// ============================================================
// 并行分离测试评估器：复用 arena_worker.ts 的 worker 池，多核并行评估候选卡组。
//
// 每个候选生成任务：3 靶分离测试（全二永平/全二冲/泉水剑）× 先/后手 × games 局
//   + vs 全部阵型泛化 × 先手 × 1 局。
// 主进程把任务分片 → 16~32 个 worker 并行 → 汇总成 ArenaResult（adScore/weakest/三维）。
//
// worker 脚本 arena_worker.ts 先由 esbuild 编译成 reports/arena_worker.cjs（同 round_robin）。
// ============================================================

import { Worker } from 'node:worker_threads';
import { execSync } from 'node:child_process';
import { cpus } from 'node:os';
import { resolve } from 'node:path';
import { FORMATION_LIBRARY } from '../../ai/formation_library';
import type { EvolFormation } from './evol_gene';

const WORKER_SRC = resolve('src/engine/tree/arena_worker.ts');
const WORKER_OUT = resolve('reports/arena_worker.cjs');

export interface Task { aKind: 'evol'; aIndex: number; aFormation: any; b: number; side: 1 | 2; seed: number; games: number }
export interface Result { a: number; b: number; side: 1 | 2; w: number; d: number; l: number }

export interface ParallelArenaOptions {
  workerCount?: number;
  seedBase?: number;
}

export function buildArenaTasks(
  candidates: { name: string; f: EvolFormation }[],
  games: number,
  seedBase: number = 7000,
): Task[] {
  const tasks: Task[] = [];
  const targetIdx = SEPARATION_TARGETS.map(t => FORMATION_LIBRARY.findIndex(f => f.name === t));
  candidates.forEach((c, idx) => {
    const aFormation = JSON.parse(JSON.stringify(c.f)) as any;
    for (let t = 0; t < targetIdx.length; t++) {
      const b = targetIdx[t];
      tasks.push({ aKind: 'evol', aIndex: idx, aFormation, b, side: 1, seed: seedBase + idx * 200 + t * 20 + 1, games });
      tasks.push({ aKind: 'evol', aIndex: idx, aFormation, b, side: 2, seed: seedBase + idx * 200 + t * 20 + 2, games });
    }
    for (let b = 0; b < FORMATION_LIBRARY.length; b++) {
      tasks.push({ aKind: 'evol', aIndex: idx, aFormation, b, side: 1, seed: seedBase + 100000 + idx * 500 + b * 2 + 1, games: 1 });
      tasks.push({ aKind: 'evol', aIndex: idx, aFormation, b, side: 2, seed: seedBase + 100000 + idx * 500 + b * 2 + 2, games: 1 });
    }
  });
  return tasks;
}

function ensureWorker(): void {
  execSync(
    `npx esbuild "${WORKER_SRC}" --bundle --outfile="${WORKER_OUT}" --platform=node --format=cjs --target=node20`,
    { stdio: 'ignore' },
  );
}

function runWorker(chunk: Task[]): Promise<Result[]> {
  return new Promise((resolveP, reject) => {
    const w = new Worker(WORKER_OUT, { workerData: { tasks: chunk } });
    const timer = setTimeout(() => { w.terminate(); reject(new Error('worker 超时')); }, 3600000);
    w.once('message', (msg) => { clearTimeout(timer); resolveP(msg as Result[]); w.terminate(); });
    w.once('error', (e) => { clearTimeout(timer); reject(e); });
    w.once('exit', (code) => { if (code !== 0) { clearTimeout(timer); reject(new Error(`worker exit ${code}`)); } });
  });
}

const SEPARATION_TARGETS = ['全二永平', '全二冲', '泉水剑'];  // 攻击/生存/综合 三靶

export interface ParallelArenaResult {
  name: string;
  attack: { w: number; d: number; l: number };
  survival: { w: number; d: number; l: number };
  comprehensive: { w: number; d: number; l: number };
  vsAll: { w: number; d: number; l: number };
  adScore: number;   // 三维不败率均值（先/后手合并）
  weakest: number;   // 6 格最弱不败率
}

/**
 * 并行评估一批候选卡组。candidates: [{name, f(EvolFormation)}]。
 * 返回每个候选的分离测试战绩 + 泛化分。
 */
export async function evaluateBatchParallel(
  candidates: { name: string; f: EvolFormation }[],
  games: number,
  workerCountOrOptions?: number | ParallelArenaOptions,
): Promise<ParallelArenaResult[]> {
  const options: ParallelArenaOptions = typeof workerCountOrOptions === 'number'
    ? { workerCount: workerCountOrOptions }
    : (workerCountOrOptions ?? {});
  const wc = options.workerCount && options.workerCount > 0 ? options.workerCount : Math.max(1, cpus().length - 1);
  const seedBase = options.seedBase ?? 7000;
  ensureWorker();

  // 生成任务：候选 × (3 靶 × 2 side × games + 全阵型 × 2 side × 1)
  const tasks: Task[] = buildArenaTasks(candidates, games, seedBase);
  const targetIdx = SEPARATION_TARGETS.map(t => FORMATION_LIBRARY.findIndex(f => f.name === t));

  const chunkSize = Math.ceil(tasks.length / wc);
  const chunks: Task[][] = [];
  for (let i = 0; i < tasks.length; i += chunkSize) chunks.push(tasks.slice(i, i + chunkSize));

  const t0 = Date.now();
  const allResults = (await Promise.all(chunks.map(runWorker))).flat();
  console.log(`  并行评估完成：${tasks.length} 任务 / ${chunks.length} worker，耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  // 汇总：按候选 aIndex 聚合
  const agg = candidates.map(() => ({
    attack: { w: 0, d: 0, l: 0 }, survival: { w: 0, d: 0, l: 0 }, comprehensive: { w: 0, d: 0, l: 0 },
    vsAll: { w: 0, d: 0, l: 0 },
    // 分侧存储：attack[side] 等
    side: {
      attackFirst: { w: 0, d: 0, l: 0 }, attackSecond: { w: 0, d: 0, l: 0 },
      survivalFirst: { w: 0, d: 0, l: 0 }, survivalSecond: { w: 0, d: 0, l: 0 },
      comprehensiveFirst: { w: 0, d: 0, l: 0 }, comprehensiveSecond: { w: 0, d: 0, l: 0 },
    },
  }));

  for (const r of allResults) {
    const a = agg[r.a];
    const isTarget = targetIdx.includes(r.b);
    const tIdx = targetIdx.indexOf(r.b);
    if (isTarget) {
      const dim = tIdx === 0 ? 'attack' : tIdx === 1 ? 'survival' : 'comprehensive';
      a[dim].w += r.w; a[dim].d += r.d; a[dim].l += r.l;
      const sideKey = dim + (r.side === 1 ? 'First' : 'Second');
      a.side[sideKey as 'attackFirst'].w += r.w;
      a.side[sideKey as 'attackFirst'].d += r.d;
      a.side[sideKey as 'attackFirst'].l += r.l;
    } else {
      a.vsAll.w += r.w; a.vsAll.d += r.d; a.vsAll.l += r.l;
    }
  }

  const results: ParallelArenaResult[] = candidates.map((c, idx) => {
    const a = agg[idx];
    const und = (s: { w: number; d: number; l: number }) => (s.w + s.d) / Math.max(1, s.w + s.d + s.l);
    const six = [
      und(a.side.attackFirst), und(a.side.attackSecond),
      und(a.side.survivalFirst), und(a.side.survivalSecond),
      und(a.side.comprehensiveFirst), und(a.side.comprehensiveSecond),
    ];
    return {
      name: c.name,
      attack: a.attack, survival: a.survival, comprehensive: a.comprehensive, vsAll: a.vsAll,
      adScore: (und(a.attack) + und(a.survival) + und(a.comprehensive)) / 3,
      weakest: Math.min(...six),
    };
  });

  return results;
}
