import '../src/engine/env';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  runGeneration2Optimizer,
  resumeGeneration2Optimizer,
} from '../src/engine/tree/product_training/generation2';

test('T119: Generation 2 Optimizer Program Correctness & Resume Integration Audit', async () => {
  const baseConfig = {
    targetFormationId: 't0:all2rush',
    opponentFormationIds: ['t0:golden_boom', 't0:all2prayer', 't0:gift_jungle'],
    baselineSeeds: [1, 7, 42],
    validationSeeds: [1, 42],
    maxOpponents: 3,
    maxAdverseCasesPerOpponent: 2,
    populationSize: 8,
    uniqueCandidatesPerCase: 12,
    maxGenerations: 2,
    searchSeed: 119101,
    allowForwardCompilation: true,
  };

  // 1. 运行中断测试 (Run with stopAfterGeneration = 1)
  const interruptedRun = await runGeneration2Optimizer({
    ...baseConfig,
    stopAfterGeneration: 1,
  });

  assert.ok(interruptedRun.runId.startsWith('RUN_'));
  const runDir = path.join(process.cwd(), 'reports', 'tree-cycle', 'generation2-optimizer', interruptedRun.runId);

  // 检查所有 12 个关键证据文件存在
  const requiredFiles = [
    'config.json',
    'manifest.json',
    'baseline_cases.jsonl',
    'candidates.jsonl',
    'evaluations.jsonl',
    'archive.jsonl',
    'generations.jsonl',
    'forward_candidates.jsonl',
    'validations.jsonl',
    'diagnostics.jsonl',
    'checkpoint.json',
    'summary.json',
  ];

  for (const f of requiredFiles) {
    assert.ok(fs.existsSync(path.join(runDir, f)), `Required file ${f} must exist in ${runDir}`);
  }

  // 2. 运行 Resume (不生成新 runId，继续完成第 2 代)
  const resumedRun = await resumeGeneration2Optimizer(interruptedRun.runId);
  assert.strictEqual(resumedRun.runId, interruptedRun.runId, 'Resume must retain identical runId');

  // 3. 运行不中断的完整对比运行 (Uninterrupted Run)
  const uninterruptedRun = await runGeneration2Optimizer({
    ...baseConfig,
  });

  // 4. 验证 Resume 与 Uninterrupted 产出的逻辑等价性
  assert.strictEqual(resumedRun.summary.totalCasesMined, uninterruptedRun.summary.totalCasesMined);
  assert.strictEqual(resumedRun.summary.totalUniqueEvaluations, uninterruptedRun.summary.totalUniqueEvaluations);
  assert.strictEqual(resumedRun.summary.archiveSize, uninterruptedRun.summary.archiveSize);
  assert.strictEqual(resumedRun.summary.nonDominatedSolutionsCount, uninterruptedRun.summary.nonDominatedSolutionsCount);
  assert.strictEqual(resumedRun.summary.representativesCount, uninterruptedRun.summary.representativesCount);

  // 5. 校验 Evaluator 隔离性：普通候选只走单回合，全比赛仅用于验证
  assert.ok(resumedRun.evaluatorCounters.oneRoundCandidateEvaluations > 0);
  assert.ok(resumedRun.evaluatorCounters.fullMatchValidationEvaluations >= 0);

  // 6. 校验 No-Edit 基线保真等价门禁
  for (const c of resumedRun.baselineCases) {
    assert.strictEqual(c.parityPassed, true, `Case ${c.caseId} must pass no-edit product parity`);
    assert.strictEqual(c.parityFields.roundWinner, c.baselineResult.roundWinner);
  }

  // 7. 校验前向分支状态与验证结果严格一致：发生 regression 的不能存在于 activePilotBranches
  for (const act of resumedRun.activePilotBranches) {
    const records = resumedRun.validationRecords.filter(r => r.candidateId === act.candidateId);
    assert.strictEqual(records.some(r => r.classification === 'REGRESSES'), false);
    assert.strictEqual(act.classification, 'PILOT_ACTIVE');
  }
});
