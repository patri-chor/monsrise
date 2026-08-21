// ============================================================
// 循环赛评估 worker（arena worker）—— 在独立线程里跑对战
//
// 每个 worker 加载一次 bundle，串行执行分配给它的一批对战任务，
// 结果通过 parentPort 回传。主进程用多个 worker 并行吃满多核。
//
// 任务结构：
//   { aKind, aIndex, aFormation, b, side, seed, games }
//   aKind = 'native'（A 用 FORMATION_LIBRARY[aIndex]）| 'evol'（A 用 aFormation 进化个体）
//   b     = B 侧 FORMATION_LIBRARY 索引（B 始终 native）
//   side  = A 先手(1) / A 后手(2)
//   games = 该配对打多少局（不同 seed）
// ============================================================

import { parentPort, workerData } from 'node:worker_threads';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { FORMATION_LIBRARY } from '../../ai/formation_library';
import { playSpecVsSpec, type SideSpec } from './arena';

interface Task {
  aKind: 'native' | 'evol';
  aIndex: number;
  aFormation?: any;
  b: number;
  side: 1 | 2;
  seed: number;
  games: number;
}

function loadBundle(): any {
  const w = globalThis as any;
  const code = readFileSync(resolve('public/ai-bundle.iife.js'), 'utf8');
  const factory = new Function('window', 'globalThis', '"use strict";\n' + code + '\n;return BattleAI;');
  const b = factory(w, w);
  return b?.BattleAI ?? w.BattleAI;
}

const tasks: Task[] = (workerData as { tasks: Task[] }).tasks;
const BundleAI = loadBundle();

const results = tasks.map((t) => {
  const specA: SideSpec = t.aKind === 'evol'
    ? { kind: 'evol', f: t.aFormation as any }
    : { kind: 'native', f: FORMATION_LIBRARY[t.aIndex] };
  const specB: SideSpec = { kind: 'native', f: FORMATION_LIBRARY[t.b] };
  let w = 0, d = 0, l = 0;
  for (let i = 0; i < t.games; i++) {
    const r = playSpecVsSpec(BundleAI, specA, specB, t.side, t.seed + i);
    w += r.w; d += r.d; l += r.l;
  }
  return { a: t.aIndex, b: t.b, side: t.side, w, d, l };
});

parentPort!.postMessage(results);
