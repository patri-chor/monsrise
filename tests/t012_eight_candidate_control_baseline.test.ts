import '../src/engine/env';
import * as assertStrict from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { PersistentSimPool } from '../src/engine/tree/persistent_pool';
import {
  runSequentialTreeOptimizationCycle,
  loadAuthoritativeFrozenCandidates,
} from '../src/engine/tree/sequential_tree_optimization';

async function runT012Tests() {
  console.log('=== 开始执行 T012 8 候选消融对照基线专项验收测试 ===\n');

  const fixturePath = resolve('tests/fixtures/tree/eight_frozen_candidates.jsonl');
  assertStrict.ok(existsSync(fixturePath), 'eight_frozen_candidates.jsonl 必须存在');

  const candidates = loadAuthoritativeFrozenCandidates(fixturePath);
  assertStrict.equal(candidates.length, 8, '候选总数必须恰好为 8');

  // Test 1: 启动 Control Baseline Run (8 候选, mode='control', outer workers=2, gamesPerCellFinal=5)
  console.log('[Test 1] 启动 8 候选 Control Baseline 评测 (mode=control, 5 局/格)...');
  const pool = new PersistentSimPool({ workerCount: 16, enableCpuMonitor: false });
  await pool.init();

  const controlDir = resolve('reports/new-formation-generation/eight-candidate-control-baseline');

  const controlResult = await runSequentialTreeOptimizationCycle({
    outputDir: controlDir,
    frozenCandidatesPath: fixturePath,
    mode: 'control',
    requestedWorkers: 2,
    maxCandidates: 8,
    gamesPerCellFinal: 5,
    pool,
    onProgress: (step, detail) => {
      if (step === 'OPTIMIZATION_PROGRESS') {
        const opStats = detail.result.searchOperatorStats;
        const opSummary = opStats
          ? `(InDeck: ${opStats.inDeckCandidates}, Ext: ${opStats.externalCandidates}, Open: ${opStats.openingCandidates})`
          : '';
        console.log(`    [T012 Control Opt] ${detail.completed}/${detail.total} | Cand: ${detail.result.candidateId} (Seed ${detail.result.sourceSeedName}) -> ${detail.result.status} ${opSummary}`);
      } else if (step === 'EVALUATION_PROGRESS') {
        console.log(`    [T012 Control Eval] ${detail.completed}/${detail.total} | Cand: ${detail.result.candidateId} -> ${detail.result.classification} (Training: ${(detail.result.finalEval.trainingScore * 100).toFixed(1)}%, Weakest: ${(detail.result.finalEval.weakestCell * 100).toFixed(1)}%)`);
      }
    },
  });

  assertStrict.equal(controlResult.evaluations.length, 8, 'Control run 必须处理全部 8 个候选');
  assertStrict.equal(controlResult.poolReport.errorCount, 0, 'Control run 中 worker error 必须为 0');

  // 验证所有产物生成完整
  assertStrict.ok(existsSync(join(controlDir, 'panel_manifest.json')), '必须产出 panel_manifest.json');
  assertStrict.ok(existsSync(join(controlDir, 'optimization_results.jsonl')), '必须产出 optimization_results.jsonl');
  assertStrict.ok(existsSync(join(controlDir, 'independent_final_evaluation.jsonl')), '必须产出 independent_final_evaluation.jsonl');
  assertStrict.ok(existsSync(join(controlDir, 'quality_decision.json')), '必须产出 quality_decision.json');
  assertStrict.ok(existsSync(join(controlDir, 'summary.md')), '必须产出 summary.md');

  // Test 2: 严格验证 Zero-External 与 Zero-Opening
  console.log('[Test 2] 验证对照组外卡与开局算子调用均为 0 (Zero External / Zero Opening)...');
  const optLines = readFileSync(join(controlDir, 'optimization_results.jsonl'), 'utf8').trim().split('\n').map((l: string) => JSON.parse(l));
  for (const opt of optLines) {
    const stats = opt.searchOperatorStats;
    assertStrict.ok(stats, `候选 ${opt.candidateId} 必须包含 searchOperatorStats`);
    assertStrict.equal(stats.externalCandidates, 0, `候选 ${opt.candidateId} externalCandidates 必须为 0`);
    assertStrict.equal(stats.rejectedByConstraintCandidates, 0, `候选 ${opt.candidateId} rejectedByConstraintCandidates 必须为 0`);
    assertStrict.equal(stats.openingCandidates, 0, `候选 ${opt.candidateId} openingCandidates 必须为 0`);
    assertStrict.equal(stats.acceptedExternalReplacements, 0, `候选 ${opt.candidateId} acceptedExternalReplacements 必须为 0`);

    // 验证目标池为单最弱格（targetPoolCount === 1）
    if (opt.targetPoolDiagnostics) {
      assertStrict.equal(opt.targetPoolDiagnostics.targetPoolCount, 1, `候选 ${opt.candidateId} 目标格数必须为 1（单最弱格）`);
    }
  }
  console.log('  ✓ Zero-External / Zero-Opening 与单最弱格验证通过。\n');

  pool.destroy();
  console.log('=== 所有 T012 验收测试全部通过 ===');
}

runT012Tests().catch((err) => {
  console.error('T012 测试失败:', err);
  process.exit(1);
});
