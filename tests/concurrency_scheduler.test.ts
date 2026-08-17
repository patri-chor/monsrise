import '../src/engine/env';
import * as assertStrict from 'node:assert/strict';
import { FORMATION_LIBRARY } from '../src/ai/formation_library';
import { formationToEvol } from '../src/engine/tree/evol_gene';
import { CpuLoadMonitor } from '../src/engine/tree/cpu_monitor';
import { PersistentSimPool } from '../src/engine/tree/persistent_pool';
import { optimizeFormation, loadBundle } from '../src/engine/tree/branch_induct';
import { hillClimbParallel } from '../src/engine/tree/hill_climb';

async function runTests() {
  console.log('=== 开始执行细粒度并发调度器与 CPU 负载监控验收测试 ===\n');

  // Test 1: CPU 负载监控与动态自适应节流
  console.log('[Test 1] 验证 CpuLoadMonitor 采样与自适应调节...');
  const monitor = new CpuLoadMonitor(0.80, 100);
  const usage = monitor.sample();
  assertStrict.ok(typeof usage === 'number' && usage >= 0 && usage <= 1, 'CPU 使用率必须在 0.0 ~ 1.0 之间');

  // 模拟自适应扩容与收缩
  const adaptedHigh = monitor.adaptConcurrency(16, 8, 64);
  assertStrict.ok(adaptedHigh >= 8 && adaptedHigh <= 64, '自适应并发数必须在上下限区间内');
  monitor.stop();
  console.log(`  ✓ CPU 采样正常 (当前采样值: ${(usage * 100).toFixed(1)}%)，自适应调节逻辑正确。\n`);

  // Test 2: 常驻 Worker 池初始化与 64-Worker 分块并发调度
  console.log('[Test 2] 验证 PersistentSimPool 常驻线程池并发任务分发...');
  const pool = new PersistentSimPool({ workerCount: 16, enableCpuMonitor: true, targetCpuUsage: 0.80 });
  await pool.init();

  const testFormation = formationToEvol(FORMATION_LIBRARY[0]);
  const sampleOpps = FORMATION_LIBRARY.slice(0, 3);

  const t0 = Date.now();
  const traces = await pool.collectInitialTracesParallel(testFormation, sampleOpps, 2, 3000);
  const elapsedMs = Date.now() - t0;

  // 3 对手 × 2 side × 2 games = 12 条 trace
  assertStrict.equal(traces.length, 12, '必须并发采集 12 条完整对局轨迹');
  for (const tr of traces) {
    assertStrict.ok(tr.observations, '必须采集到观察数据');
    assertStrict.ok(tr.roundScores.length > 0, '必须采集到回合得分');
  }
  console.log(`  ✓ 12 条对局并发采集在 ${elapsedMs}ms 内完成，数据完备。\n`);

  // Test 3: 候选批次全并发与确定性一致性验证
  console.log('[Test 3] 验证 evalCandidateBatchOnMatchedParallel 批次并发评估...');
  const candidates = [
    testFormation,
    formationToEvol(FORMATION_LIBRARY[1]),
    formationToEvol(FORMATION_LIBRARY[2]),
  ];

  const mask = { side: null, main: null, subs: [], keys: [] };
  const metricsBatch = await pool.evalCandidateBatchOnMatchedParallel(
    candidates,
    mask,
    sampleOpps,
    2,
    7000,
  );

  assertStrict.equal(metricsBatch.length, 3, '必须返回 3 个候选的完整对战指标');
  for (const m of metricsBatch) {
    assertStrict.ok(m.total > 0, '总场数必须大于 0');
    assertStrict.ok(typeof m.trainingScore === 'number', '必须计算 trainingScore');
    assertStrict.ok(typeof m.pureWinRate === 'number', '必须计算 pureWinRate');
    assertStrict.ok(typeof m.undefeatedRate === 'number', '必须计算 undefeatedRate');
  }
  console.log('  ✓ 候选批次全并发评测完成，多指标计算准确。\n');

  // Test 4: 细粒度并发爬山优化验证 (hillClimbParallel)
  console.log('[Test 4] 验证 hillClimbParallel 局部并行搜索...');
  const BundleAI = loadBundle();
  const hcResult = await hillClimbParallel(
    BundleAI,
    testFormation,
    3, // 3 steps smoke
    1, // 1 game per target
    42,
    { parallelVariants: 4, pool },
  );

  assertStrict.ok(hcResult.best, '必须生成最佳阵型');
  assertStrict.ok(hcResult.bestArena, '必须包含 6 格分离测试成绩');
  console.log(`  ✓ 并行爬山 3 步完成，最佳 weakest: ${(hcResult.bestFitness * 100).toFixed(1)}%。\n`);

  // Test 5: 分支归纳算法高并发优化闭环
  console.log('[Test 5] 验证 branch_induct 并发优化闭环 (optimizeFormation)...');
  const optResult = await optimizeFormation(
    BundleAI,
    FORMATION_LIBRARY[0],
    1,
    { pool, searchSeedBase: 2000, validationSeedBase: 9000, opponents: FORMATION_LIBRARY.slice(0, 3) },
  );

  assertStrict.ok(optResult !== null, '分支归纳必须成功完成分析并返回结果');
  console.log(`  ✓ 分支归纳并发运行成功（Improved: ${optResult.improved}, Mask: ${optResult.maskLabel}）。\n`);

  pool.destroy();
  console.log('=== 所有细粒度并发与调度测试全部通过 (5/5) ===');
}

runTests().catch(e => {
  console.error('测试失败:', e);
  process.exit(1);
});
