import '../src/engine/env';
import * as assertStrict from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { PersistentSimPool } from '../src/engine/tree/persistent_pool';
import {
  runSequentialTreeOptimizationCycle,
  loadAuthoritativeFrozenCandidates,
} from '../src/engine/tree/sequential_tree_optimization';
import { ARCH_RULES, validateDeck, costOf } from '../src/engine/tree/deck_ontology';

async function runT011Tests() {
  console.log('=== 开始执行 T011 跨种子分支、卡组与开局联合优化专项验收测试 ===\n');

  // Test 1: 验证 4 源种子平衡候选集 (Balanced Four-Seed Set)
  console.log('[Test 1] 验证 4 源种子平衡候选集分布 (s1:2, s2:2, s3:2, s4:2)...');
  const fixturePath = resolve('tests/fixtures/tree/eight_frozen_candidates.jsonl');
  assertStrict.ok(existsSync(fixturePath), 'eight_frozen_candidates.jsonl 必须存在');

  const candidates = loadAuthoritativeFrozenCandidates(fixturePath);
  assertStrict.equal(candidates.length, 8, '候选总数必须恰好为 8');

  const seedCounts: Record<string, number> = {};
  for (const c of candidates) {
    const sKey = `s${(c.sourceSeedIndex ?? 0) + 1}`;
    seedCounts[sKey] = (seedCounts[sKey] ?? 0) + 1;
  }

  assertStrict.equal(seedCounts['s1'], 2, 's1 必须有 2 个候选');
  assertStrict.equal(seedCounts['s2'], 2, 's2 必须有 2 个候选');
  assertStrict.equal(seedCounts['s3'], 2, 's3 必须有 2 个候选');
  assertStrict.equal(seedCounts['s4'], 2, 's4 必须有 2 个候选');
  console.log('  ✓ 4 源种子平衡分布验证通过: ', JSON.stringify(seedCounts), '\n');

  // Test 2: 验证受约束的外部卡组搜索逻辑 (Constrained External Deck Search)
  console.log('[Test 2] 验证受约束外部怪兽过滤与合法性校验...');
  const sampleCandidate = candidates[0];
  const arch = sampleCandidate.archPath || 'prayer';
  const archRule = (ARCH_RULES as any)[arch];
  assertStrict.ok(archRule, '必须能识别候选架构规则');

  // 构造超费测试
  const overCostTeam = sampleCandidate.team.map((s: any, idx: number) => {
    if (idx === 0) return { monsterId: 101, badgeIds: [3, 22, 21] }; // 4费
    if (idx === 1) return { monsterId: 108, badgeIds: [3, 22, 21] }; // 4费
    if (idx === 2) return { monsterId: 118, badgeIds: [3, 22, 21] }; // 4费
    if (idx === 3) return { monsterId: 120, badgeIds: [3, 22, 21] }; // 4费
    if (idx === 4) return { monsterId: 115, badgeIds: [3, 22, 21] }; // 4费
    return s;
  });
  const valErrors = validateDeck(overCostTeam);
  assertStrict.ok(valErrors.length > 0, '超费/非法多核心卡组必须被 validateDeck 拒绝');
  console.log('  ✓ 约束拦截校验验证通过: ', valErrors[0], '\n');

  // Test 3: 启动诊断 Proof Run (8 候选, outer workers=2, gamesPerCellFinal=5)
  console.log('[Test 3] 启动跨种子/外卡/开局联合优化 Proof Run (8 候选, outer workers=2, 5 局/格)...');
  const pool = new PersistentSimPool({ workerCount: 16, enableCpuMonitor: false });
  await pool.init();

  const proofDir = resolve('reports/new-formation-generation/cross-seed-branch-deck-opening-proof');

  const proofResult = await runSequentialTreeOptimizationCycle({
    outputDir: proofDir,
    frozenCandidatesPath: fixturePath,
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
        console.log(`    [T011 Opt] ${detail.completed}/${detail.total} | Cand: ${detail.result.candidateId} (Seed ${detail.result.sourceSeedName}) -> ${detail.result.status} ${opSummary}`);
      } else if (step === 'EVALUATION_PROGRESS') {
        console.log(`    [T011 Eval] ${detail.completed}/${detail.total} | Cand: ${detail.result.candidateId} -> ${detail.result.classification} (Training: ${(detail.result.finalEval.trainingScore * 100).toFixed(1)}%, Weakest: ${(detail.result.finalEval.weakestCell * 100).toFixed(1)}%)`);
      }
    },
  });

  assertStrict.equal(proofResult.evaluations.length, 8, 'Proof run 必须处理全部 8 个候选');
  assertStrict.equal(proofResult.poolReport.errorCount, 0, 'Proof run 中 worker error 必须为 0');

  // 验证所有产物生成完整
  assertStrict.ok(existsSync(join(proofDir, 'panel_manifest.json')), '必须产出 panel_manifest.json');
  assertStrict.ok(existsSync(join(proofDir, 'optimization_results.jsonl')), '必须产出 optimization_results.jsonl');
  assertStrict.ok(existsSync(join(proofDir, 'independent_final_evaluation.jsonl')), '必须产出 independent_final_evaluation.jsonl');
  assertStrict.ok(existsSync(join(proofDir, 'quality_decision.json')), '必须产出 quality_decision.json');
  assertStrict.ok(existsSync(join(proofDir, 'summary.md')), '必须产出 summary.md');

  // Test 4: 验证低分目标池与算子统计字段
  console.log('[Test 4] 验证目标格池诊断与搜索算子统计字段...');
  const optLines = readFileSync(join(proofDir, 'optimization_results.jsonl'), 'utf8').trim().split('\n').map((l: string) => JSON.parse(l));
  for (const opt of optLines) {
    assertStrict.ok(opt.targetPoolDiagnostics, `候选 ${opt.candidateId} 必须包含 targetPoolDiagnostics`);
    assertStrict.ok(opt.targetPoolDiagnostics.targetPoolCount > 0, '目标池格数量必须 > 0');
    assertStrict.ok(opt.searchOperatorStats, `候选 ${opt.candidateId} 必须包含 searchOperatorStats`);
    assertStrict.ok(opt.searchOperatorStats.inDeckCandidates >= 0, '必须统计 inDeckCandidates');
    assertStrict.ok(opt.searchOperatorStats.externalCandidates >= 0, '必须统计 externalCandidates');
    assertStrict.ok(opt.searchOperatorStats.rejectedByConstraintCandidates >= 0, '必须统计 rejectedByConstraintCandidates');
  }
  console.log('  ✓ 目标池与算子统计验证通过。\n');

  pool.destroy();
  console.log('=== 所有 T011 验收测试全部通过 ===');
}

runT011Tests().catch((err) => {
  console.error('T011 测试失败:', err);
  process.exit(1);
});
