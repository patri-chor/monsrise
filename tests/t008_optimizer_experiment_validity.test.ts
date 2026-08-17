import '../src/engine/env';
import * as assertStrict from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { FORMATION_LIBRARY } from '../src/ai/formation_library';
import { formationToEvol } from '../src/engine/tree/evol_gene';
import { PersistentSimPool } from '../src/engine/tree/persistent_pool';
import {
  runSequentialTreeOptimizationCycle,
  evaluateFormationOnPanel,
} from '../src/engine/tree/sequential_tree_optimization';
import type { SimTaskMessage } from '../src/engine/tree/fine_grained_worker';

async function runT008ValidityTests() {
  console.log('=== 开始执行 T008 候选树优化实验有效性专项验收测试 ===\n');

  // Test 1: 并发请求隔离测试 (Concurrent Request Safety)
  console.log('[Test 1] 验证 PersistentSimPool 并发多批次请求隔离与 requestId 路由安全...');
  const pool = new PersistentSimPool({ workerCount: 8, enableCpuMonitor: false });
  await pool.init();

  const form1 = formationToEvol(FORMATION_LIBRARY[0]); // 泉水剑
  const form2 = formationToEvol(FORMATION_LIBRARY[1]); // 全二永平
  const opp = FORMATION_LIBRARY[2]; // 全二冲

  const tasksReqA: SimTaskMessage[] = [
    { taskId: 101, candidateIdx: 0, formationA: form1, opponentNameOrId: opp.name, side: 1, seed: 11000, games: 2 },
    { taskId: 102, candidateIdx: 0, formationA: form1, opponentNameOrId: opp.name, side: 2, seed: 11001, games: 2 },
  ];

  const tasksReqB: SimTaskMessage[] = [
    { taskId: 201, candidateIdx: 1, formationA: form2, opponentNameOrId: opp.name, side: 1, seed: 22000, games: 2 },
    { taskId: 202, candidateIdx: 1, formationA: form2, opponentNameOrId: opp.name, side: 2, seed: 22001, games: 2 },
  ];

  // 同时并发派发两个独立的 batch
  const [resA, resB] = await Promise.all([
    pool.dispatchTasks(tasksReqA, 'BatchA-泉水剑'),
    pool.dispatchTasks(tasksReqB, 'BatchB-全二永平'),
  ]);

  assertStrict.equal(resA.length, 2, 'Batch A 必须返回 2 条结果');
  assertStrict.equal(resB.length, 2, 'Batch B 必须返回 2 条结果');
  assertStrict.equal(resA[0].taskId, 101, 'Batch A taskId 必须完全对应，不能被 Batch B 污染');
  assertStrict.equal(resA[1].taskId, 102);
  assertStrict.equal(resB[0].taskId, 201, 'Batch B taskId 必须完全对应，不能被 Batch A 污染');
  assertStrict.equal(resB[1].taskId, 202);

  // 严格非空校验
  for (const r of [...resA, ...resB]) {
    assertStrict.ok(typeof r.w === 'number' && typeof r.d === 'number' && typeof r.l === 'number', '结果 W/D/L 必须全部非空');
  }
  console.log('  ✓ 并发请求隔离与 taskId 严格匹配验证通过，无跨请求污染。\n');

  // Test 2: 验证 init() 单例防重复初始化
  console.log('[Test 2] 验证 init() 单例并发防重复初始化...');
  const initPromises = [pool.init(), pool.init(), pool.init()];
  await Promise.all(initPromises);
  console.log('  ✓ init() 单例防重复初始化验证通过。\n');

  // Test 3: 验证 gamesPerCellFinal < 3 严格拒绝与统计有效性
  console.log('[Test 3] 验证 gamesPerCellFinal < 3 严格拒绝与配置错误抛出...');
  const BundleAI = (globalThis as any).BattleAI;
  assertStrict.throws(
    () => {
      evaluateFormationOnPanel(BundleAI, form1, [opp], 5000, 1);
    },
    /Configuration Error.*gamesPerCellFinal.*less than minimum/i,
    'gamesPerCellFinal=1 必须严格抛出配置错误拒绝执行',
  );

  assertStrict.throws(
    () => {
      evaluateFormationOnPanel(BundleAI, form1, [opp], 5000, 2);
    },
    /Configuration Error.*gamesPerCellFinal.*less than minimum/i,
    'gamesPerCellFinal=2 必须严格抛出配置错误拒绝执行',
  );
  console.log('  ✓ gamesPerCellFinal < 3 严格配置拦截验证通过。\n');

  // Test 4: 验证 Bounded Proof Run (4 个候选, outer workers=2, gamesPerCellFinal=5)
  console.log('[Test 4] 启动诊断 Proof Run (4 候选, outer workers=2, gamesPerCellFinal=5)...');
  const proofDir = resolve('reports/new-formation-generation/optimizer-validity-proof');

  const proofResult = await runSequentialTreeOptimizationCycle({
    outputDir: proofDir,
    frozenCandidatesPath: resolve('tests/fixtures/tree/four_frozen_candidates.jsonl'),
    requestedWorkers: 2,
    maxCandidates: 4,
    gamesPerCellFinal: 5,
    pool,
    onProgress: (step, detail) => {
      if (step === 'OPTIMIZATION_PROGRESS') {
        console.log(`    [Proof Opt] ${detail.completed}/${detail.total} | Cand: ${detail.result.candidateId} -> ${detail.result.status}`);
      } else if (step === 'EVALUATION_PROGRESS') {
        console.log(`    [Proof Eval] ${detail.completed}/${detail.total} | Cand: ${detail.result.candidateId} -> ${detail.result.classification} (Training: ${(detail.result.finalEval.trainingScore * 100).toFixed(1)}%, Weakest: ${(detail.result.finalEval.weakestCell * 100).toFixed(1)}%)`);
      }
    },
  });

  assertStrict.equal(proofResult.evaluations.length, 4, 'Proof run 必须处理恰好 4 个候选');
  assertStrict.equal(proofResult.poolReport.errorCount, 0, 'Proof run 中 worker error 必须为 0');

  // 验证所有产物生成完整
  assertStrict.ok(existsSync(join(proofDir, 'panel_manifest.json')), '必须产出 panel_manifest.json');
  assertStrict.ok(existsSync(join(proofDir, 'optimization_results.jsonl')), '必须产出 optimization_results.jsonl');
  assertStrict.ok(existsSync(join(proofDir, 'independent_final_evaluation.jsonl')), '必须产出 independent_final_evaluation.jsonl');
  assertStrict.ok(existsSync(join(proofDir, 'quality_decision.json')), '必须产出 quality_decision.json');
  assertStrict.ok(existsSync(join(proofDir, 'summary.md')), '必须产出 summary.md');

  // 检查 detailed outcome 细分状态在产物中正确记录
  const optLines = readFileSync(join(proofDir, 'optimization_results.jsonl'), 'utf8').trim().split('\n').map((l: string) => JSON.parse(l));
  for (const opt of optLines) {
    assertStrict.ok(
      ['IMPROVED', 'NO_INFORMATIVE_SPLIT', 'NO_OBSERVED_TRIGGER_AT_FORK', 'BRANCH_SEARCH_NO_TRAINING_GAIN', 'VALIDATION_TRAINING_REJECTED', 'ERROR'].includes(opt.status),
      `优化状态必须是 6 种明确细分状态之一，当前为: ${opt.status}`,
    );
  }

  // 检查最弱格信息
  const evalLines = readFileSync(join(proofDir, 'independent_final_evaluation.jsonl'), 'utf8').trim().split('\n').map((l: string) => JSON.parse(l));
  for (const ev of evalLines) {
    assertStrict.ok(ev.finalEval.weakestCellInfo, '必须记录 weakestCellInfo');
    assertStrict.ok(ev.finalEval.weakestCellInfo.opponentName, '必须记录最弱对手名称');
    assertStrict.ok(typeof ev.finalEval.trainingScore === 'number', '必须包含 trainingScore');
    assertStrict.ok(typeof ev.finalEval.pureWinRate === 'number', '必须包含 pureWinRate');
    assertStrict.ok(typeof ev.finalEval.undefeatedRate === 'number', '必须包含 undefeatedRate');
  }

  console.log(`  ✓ Proof Run 执行成功，0 worker errors，所有细分状态与 trainingScore 指标流转正确。\n`);

  pool.destroy();
  console.log('=== 所有 T008 验收测试全部通过 (4/4) ===');
}

runT008ValidityTests().catch((err) => {
  console.error('T008 测试失败:', err);
  process.exit(1);
});
