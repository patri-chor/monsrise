// ============================================================
// 轮回优化 v2（cycle optimize）—— 胜率表 → 筛选 → 多阵型并行优化
//
// 核心思路（用户定案）：
//   - 每轮先跑全对阵胜率表（reports/胜率表格.md 固定更新）
//   - 只优化两类阵容：① 新增阵容 ② 胜率下降较多的阵容
//   - 门槛：优化次数 <3 且 胜率 <90% 才优化（避免反复优化/已达标）
//   - 多个阵型一起优化（每阵型独立进程），结果隔离到 reports/optimized/{id}.json
//   - 全部跑完后由 apply_optimized 统一覆盖 + 自动剪枝 + 重跑胜率表
//
// 运行：npx vite-node --script src/engine/tree/cycle_optimize.ts [分支归纳局数] [并行度] [起始索引] [EB局数] [胜率表局数]
// ============================================================

import '../env';
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { cpus } from 'node:os';
import { FORMATION_LIBRARY } from '../../ai/formation_library';
import { fullMatrixEvaluate } from './round_robin';
import { writeMatrixReports, loadCycleState } from './winrate_matrix';

// ---------- 优化门槛（用户定案：3，90，15） ----------
const MAX_OPT_COUNT = 3;     // 优化次数上限（>=3 次不再优化）
const HIGH_WINRATE = 0.90;   // 高胜率线（胜率 >=90% 不再优化）
const DROP_TRIGGER = 0.15;   // 胜率下降触发线（相比上次下降 >15% 才优化）

function runOne(name: string, games: number, ebGames: number): Promise<void> {
  return new Promise((resolveP, reject) => {
    const child = spawn(
      'npx',
      ['vite-node', '--script', 'src/engine/tree/optimize_one.ts', name, String(games), String(ebGames)],
      { stdio: 'inherit', shell: true },
    );
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolveP();
      else reject(new Error(`optimize_one ${name} 退出码 ${code}`));
    });
  });
}

/** 并发信号量：最多 max 个任务同时跑 */
async function runWithConcurrency<T>(items: T[], max: number, fn: (item: T) => Promise<void>): Promise<void> {
  let idx = 0;
  const workers = Array.from({ length: Math.min(max, items.length) }, async () => {
    while (idx < items.length) {
      const i = idx++;
      await fn(items[i]);
    }
  });
  await Promise.all(workers);
}

/** 清空目录里的 .json/.md（本轮结果隔离，apply_optimized 只看本轮） */
function clearDir(dir: string): void {
  if (!existsSync(dir)) { mkdirSync(dir, { recursive: true }); return; }
  for (const f of readdirSync(dir)) {
    if (f.endsWith('.json') || f.endsWith('.md')) unlinkSync(resolve(dir, f));
  }
}

interface FilterDecision {
  f: (typeof FORMATION_LIBRARY)[number];
  shouldOptimize: boolean;
  reason: string;
}

function decideTargets(currentWinrate: Map<string, number>): FilterDecision[] {
  const state = loadCycleState();
  const out: FilterDecision[] = [];
  for (const f of FORMATION_LIBRARY) {
    const cur = currentWinrate.get(f.id) ?? 0;
    const st = state[f.id];
    const isNew = !st;
    const dropped = st ? (st.lastWinrate - cur) > DROP_TRIGGER : false;
    const optExhausted = !!st && st.optCount >= MAX_OPT_COUNT;
    const alreadyHigh = cur >= HIGH_WINRATE;

    let shouldOptimize = false;
    let reason = '';
    if (optExhausted) reason = `已优化 ${st!.optCount} 次（≥${MAX_OPT_COUNT}），不再优化`;
    else if (alreadyHigh) reason = `胜率 ${(cur * 100).toFixed(1)}% 已达标（≥${HIGH_WINRATE * 100}%），不再优化`;
    else if (isNew) { shouldOptimize = true; reason = '新增阵容（首次）'; }
    else if (dropped) { shouldOptimize = true; reason = `胜率下降 ${(st!.lastWinrate * 100).toFixed(1)}%→${(cur * 100).toFixed(1)}%（-${((st!.lastWinrate - cur) * 100).toFixed(1)}%）`; }
    else reason = `胜率 ${(cur * 100).toFixed(1)}%（未下降超 ${DROP_TRIGGER * 100}%），跳过`;

    out.push({ f, shouldOptimize, reason });
  }
  return out;
}

async function main(): Promise<void> {
  const gamesPerOpp = Number(process.argv[2] || 5);
  const workerArg = Number(process.argv[3] || 0);
  const concurrency = workerArg > 0 ? workerArg : Math.max(1, cpus().length - 1);
  const startIdx = Number(process.argv[4] || 0);
  const ebGames = Number(process.argv[5] || 16);   // vs 早期 bundle 局数（不变基准）
  const matrixGames = Number(process.argv[6] || 10); // 胜率表每配对每侧局数（至少 10）

  console.log(`===== 轮回优化 v2（${FORMATION_LIBRARY.length} 阵型，分支归纳${gamesPerOpp}局/对手，并行度 ${concurrency}，EB基准${ebGames}局，胜率表${matrixGames}局/配对） =====`);
  console.log(`门槛：优化次数 <${MAX_OPT_COUNT} 且 胜率 <${HIGH_WINRATE * 100}%；只优化 [新增] 或 [胜率下降 >${DROP_TRIGGER * 100}%]。\n`);

  // 清空本轮结果隔离目录
  clearDir(resolve('reports/optimized'));
  clearDir(resolve('reports/decisions'));

  // 1. 跑全对阵胜率表（当前基线）
  console.log('--- 第 1 步：跑全对阵胜率表（当前基线） ---');
  const t0 = Date.now();
  const matrix = await fullMatrixEvaluate(matrixGames, concurrency);
  console.log(`胜率表完成（${((Date.now() - t0) / 1000).toFixed(0)}s）`);
  writeMatrixReports(matrix);
  const currentWinrate = new Map(matrix.ids.map((id, i) => [id, matrix.rowTotals[i].undefeated]));

  // 2. 筛选优化目标
  console.log('\n--- 第 2 步：筛选优化目标 ---');
  const decisions = decideTargets(currentWinrate);
  for (const d of decisions) {
    console.log(`  ${d.shouldOptimize ? '✓' : '✗'} ${d.f.name}: ${d.reason}${d.shouldOptimize ? ' → 优化' : ''}`);
  }
  const targets = decisions.filter(d => d.shouldOptimize).map(d => d.f);

  // 3. 优化
  if (targets.length === 0) {
    console.log('\n无需要优化的阵型（全部已达标或已达优化次数上限），结束。');
    writeFileSync(resolve('reports/cycle_optimize_summary.json'), JSON.stringify({
      type: 'cycle_optimize_summary', gamesPerOpp, concurrency, startIdx, ebGames, matrixGames,
      elapsedMs: Date.now() - t0, improvedCount: 0, total: 0, targets: [],
      filter: decisions.map(d => ({ id: d.f.id, name: d.f.name, shouldOptimize: d.shouldOptimize, reason: d.reason })),
    }, null, 2));
    return;
  }

  console.log(`\n--- 第 3 步：并行优化 ${targets.length} 个阵型 ---`);
  await runWithConcurrency(targets, concurrency, async (f) => {
    console.log(`\n### 启动优化：${f.name}`);
    await runOne(f.name, gamesPerOpp, ebGames);
  });

  const ms = Date.now() - t0;

  // 4. 汇总
  console.log(`\n\n===== 优化结果汇总（含 vs 早期bundle 不变基准） =====`);
  const results: any[] = [];
  for (const f of targets) {
    const p = resolve(`reports/optimized/${f.id}.json`);
    try {
      const r = JSON.parse(readFileSync(p, 'utf8'));
      results.push(r);
      const mark = r.improved ? '✓' : '📝';
      const detail = r.improved ? `采纳「${r.maskLabel}」@R${r.forkRound}` : '未改进（决策日志已输出）';
      let ebStr = '';
      if (r.beforeEb && r.afterEb) {
        const delta = r.afterEb.undefeated - r.beforeEb.undefeated;
        ebStr = `EB ${(r.beforeEb.undefeated * 100).toFixed(0)}%→${(r.afterEb.undefeated * 100).toFixed(0)}%(${delta >= 0 ? '+' : ''}${(delta * 100).toFixed(0)}%)`;
      } else if (r.beforeEb) {
        ebStr = `EB基线 ${(r.beforeEb.undefeated * 100).toFixed(0)}%`;
      }
      console.log(`  ${mark} ${r.name}: ${detail}${ebStr ? ' ｜ ' + ebStr : ''}`);
    } catch (e) {
      console.log(`  ✗ ${f.name}: 结果文件缺失（${(e as Error).message}）`);
    }
  }

  const improvedCount = results.filter(r => r.improved).length;
  console.log(`\n采纳改进 ${improvedCount}/${targets.length} 个阵型，耗时 ${(ms / 1000).toFixed(0)}s（${concurrency} 并发）`);
  console.log(`\n下一步：运行 apply_optimized 统一覆盖 + 自动剪枝 + 重跑胜率表。`);

  writeFileSync(resolve('reports/cycle_optimize_summary.json'), JSON.stringify({
    type: 'cycle_optimize_summary',
    gamesPerOpp, concurrency, startIdx, ebGames, matrixGames, elapsedMs: ms,
    improvedCount, total: targets.length,
    filter: decisions.map(d => ({ id: d.f.id, name: d.f.name, shouldOptimize: d.shouldOptimize, reason: d.reason })),
    results,
  }, null, 2));
}

main();
