import '../src/engine/env';
import * as assertStrict from 'node:assert/strict';
import { FORMATION_LIBRARY } from '../src/ai/formation_library';
import { formationToEvol } from '../src/engine/tree/evol_gene';
import { PersistentSimPool } from '../src/engine/tree/persistent_pool';
import { playSpecVsSpec, type SideSpec } from '../src/engine/tree/arena';
import { loadBundle } from '../src/engine/tree/branch_induct';
import type { SimTaskMessage } from '../src/engine/tree/fine_grained_worker';

async function runFidelityVerification() {
  console.log('=== 启动加速仿真 vs 真实引擎真实战斗一致性校验 (Simulation Fidelity Verification) ===\n');

  const BundleAI = loadBundle();
  const pool = new PersistentSimPool({ workerCount: 16, enableCpuMonitor: false });
  await pool.init();

  // 选取 4 个代表性阵型作为 Candidate（覆盖不同流派与树结构）
  const testCandidates = [
    formationToEvol(FORMATION_LIBRARY[0]), // 泉水剑 (prayer)
    formationToEvol(FORMATION_LIBRARY[1]), // 全二永平 (halfrush)
    formationToEvol(FORMATION_LIBRARY[2]), // 全二冲 (fullrush)
    formationToEvol(FORMATION_LIBRARY[3]), // 肃清 (suqing)
  ];

  // 选取 5 个对手
  const testOpponents = FORMATION_LIBRARY.slice(0, 5);

  const sides: (1 | 2)[] = [1, 2];
  const seedsCount = 10; // 每个组合 10 个独立 seed
  const baseSeed = 88000;

  console.log(`[测试规模] 4 候选 × 5 对手 × 2 先后手 × ${seedsCount} 局 = 共计 ${4 * 5 * 2 * seedsCount} 场对战`);

  // 1. 生成多线程 Worker Pool 任务列表
  const tasks: SimTaskMessage[] = [];
  let taskId = 0;

  for (let cIdx = 0; cIdx < testCandidates.length; cIdx++) {
    const cand = testCandidates[cIdx];
    for (let oppIdx = 0; oppIdx < testOpponents.length; oppIdx++) {
      const opp = testOpponents[oppIdx];
      for (const side of sides) {
        for (let s = 0; s < seedsCount; s++) {
          const seed = baseSeed + cIdx * 1000 + oppIdx * 100 + side * 10 + s;
          tasks.push({
            taskId: taskId++,
            candidateIdx: cIdx,
            formationA: cand,
            opponentNameOrId: opp.id ?? opp.name,
            side,
            seed,
            games: 1,
            collectObservations: true,
          });
        }
      }
    }
  }

  console.log(`[Step 1] 正在通过 PersistentSimPool 多线程 Worker 并发执行 ${tasks.length} 场对战...`);
  const t0Parallel = Date.now();
  const parallelResults = await pool.dispatchTasks(tasks);
  const parallelDuration = Date.now() - t0Parallel;
  console.log(`  ✓ 多线程并发完成，耗时: ${parallelDuration}ms (平均 ${(parallelDuration / tasks.length).toFixed(2)}ms/场)`);

  console.log(`[Step 2] 正在通过单线程原生 playSpecVsSpec 逐场串行执行真实战斗作为 Golden Truth...`);
  const t0Serial = Date.now();
  const serialResults: any[] = [];

  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    const cand = testCandidates[t.candidateIdx!];
    const opp = testOpponents.find(o => (o.id ?? o.name) === t.opponentNameOrId)!;
    const specA: SideSpec = { kind: 'evol', f: cand };
    const specB: SideSpec = { kind: 'native', f: opp };

    const r = playSpecVsSpec(BundleAI, specA, specB, t.side, t.seed);
    serialResults.push({
      taskId: t.taskId,
      w: r.w,
      d: r.d,
      l: r.l,
      roundScores: r.roundScores,
      observationsCount: r.observations?.length ?? 0,
    });
  }
  const serialDuration = Date.now() - t0Serial;
  console.log(`  ✓ 单线程串行完成，耗时: ${serialDuration}ms (平均 ${(serialDuration / tasks.length).toFixed(2)}ms/场)`);
  console.log(`  ⚡ 并发加速比: ${(serialDuration / Math.max(1, parallelDuration)).toFixed(2)}x\n`);

  console.log(`[Step 3] 逐场严格比对 多线程 vs 单线程真实战斗 结果 (W/D/L、回合比分、观察数据)...`);

  let matchedCount = 0;
  let mismatchedCount = 0;

  for (let i = 0; i < tasks.length; i++) {
    const p = parallelResults[i];
    const s = serialResults[i];

    const pTrace = p.traces?.[0];
    const pScores = pTrace?.roundScores ?? [];

    const isMatch = (p.w === s.w)
      && (p.d === s.d)
      && (p.l === s.l)
      && (JSON.stringify(pScores) === JSON.stringify(s.roundScores));

    if (!isMatch) {
      mismatchedCount++;
      console.error(`[MISMATCH] Task #${i} (Seed: ${tasks[i].seed}, Side: ${tasks[i].side}):`);
      console.error(`  Parallel: W=${p.w}, D=${p.d}, L=${p.l}, Scores=${JSON.stringify(pScores)}`);
      console.error(`  Serial  : W=${s.w}, D=${s.d}, L=${s.l}, Scores=${JSON.stringify(s.roundScores)}`);
    } else {
      matchedCount++;
    }
  }

  console.log(`\n=== 校验结果 ===`);
  console.log(`总比对场次: ${tasks.length}`);
  console.log(`100% 字节级严格匹配: ${matchedCount} / ${tasks.length}`);
  console.log(`不一致场次: ${mismatchedCount}`);

  assertStrict.equal(mismatchedCount, 0, '加速后的多线程模拟必须与真实战斗引擎 100% 确定性完全一致！');
  assertStrict.equal(matchedCount, tasks.length, '所有对局必须全部通过精确比对！');

  console.log('\n✓ 验证通过：加速后的多线程仿真与真实引擎战斗 100% 确定性完全吻合，零误差、零偏差。');

  pool.destroy();
}

runFidelityVerification().catch((err) => {
  console.error('真实战斗一致性校验失败:', err);
  process.exit(1);
});
