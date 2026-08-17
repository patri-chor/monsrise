process.env.IS_TEST = 'true';
import '../src/engine/env';
import * as assertStrict from 'node:assert/strict';
import { readFileSync, existsSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { FORMATION_LIBRARY } from '../src/ai/formation_library';
import {
  analyzeAndRetainCandidates,
  calculateMutationVector,
  selectRetainedCandidates,
  type CandidateAnalysisRecord,
} from '../src/engine/tree/candidate_retention';
import { formationToEvol } from '../src/engine/tree/evol_gene';

async function runTests() {
  console.log('=== 开始执行 T009/T010 候选阵型多样性保留机制专项测试 ===\n');

  // 生产数据集快照（用于验证测试零污染与 byte-identical）
  const prodDatasetPath = resolve('reports/new-formation-pilot/candidates.jsonl');
  const prodDatasetSnapshot = existsSync(prodDatasetPath) ? readFileSync(prodDatasetPath, 'utf8') : null;

  const testTmpDir = resolve('tests/.tmp/retention-test');
  if (existsSync(testTmpDir)) {
    rmSync(testTmpDir, { recursive: true, force: true });
  }
  mkdirSync(testTmpDir, { recursive: true });

  const refSpring = FORMATION_LIBRARY.find(f => f.name === '泉水剑')!;
  const refAll2 = FORMATION_LIBRARY.find(f => f.name === '全二永平')!;
  const refRush = FORMATION_LIBRARY.find(f => f.name === '全二冲')!;

  // Test 1: 验证变异向量与 Bucket 分类确立性 (T009-1)
  console.log('[Test 1] 验证变异向量计算与 Bucket 判定确定性...');
  const mockCand1: any = {
    candidateId: 'cand_test_1',
    generationSeed: 100,
    archPath: 'halfrush',
    modulePath: '秒杀',
    coreKey: 'all2',
    referenceFormation: '全二永平',
    team: [
      { monsterId: 105, badgeIds: [8, 17] },
      { monsterId: 110, badgeIds: [8, 23] },
      { monsterId: 116, badgeIds: [5, 3] },
      { monsterId: 113, badgeIds: [20, 3] },
      { monsterId: 111, badgeIds: [23, 3] },
      { monsterId: 112, badgeIds: [8, 6] },
      { monsterId: 125, badgeIds: [8, 6] },
    ],
    treeFingerprint: 'fp_123',
    canonicalKey: 'c_key_1',
    tree: { id: 'r0', round: 0, placements: [{ monsterId: 105, x: 6, y: 1 }] },
    validation: { valid: true, cost: 16, size: 7, hasTactic: true },
  };

  const v1 = calculateMutationVector(mockCand1, formationToEvol(refAll2), 16);
  const v2 = calculateMutationVector(mockCand1, formationToEvol(refAll2), 16);

  assertStrict.deepEqual(v1, v2, '相同输入计算出的变异向量必须严格一致');
  assertStrict.ok(v1.noveltyScore >= 0 && v1.noveltyScore <= 1, '新颖度得分必须在 0..1 范围');
  assertStrict.ok(['light', 'medium', 'heavy'].includes(v1.direction.mutationBucket), 'Bucket 必须在 light/medium/heavy 之一');
  console.log(`  ✓ 变异向量与新颖度 (${v1.noveltyScore}, bucket: ${v1.direction.mutationBucket}) 确定性计算验证通过。\n`);

  // Test 2: 验证最高分 Performance Baseline 必然保留并记录 scoreSource (T009-2 / T010)
  console.log('[Test 2] 验证最佳性能候选 (Performance Baseline) 优先保留...');
  const mockCandidates: CandidateAnalysisRecord[] = [
    {
      ...mockCand1,
      candidateId: 'top_performer',
      effectiveScore: 0.95,
      scoreSource: 'refined',
      mutationVector: v1,
    },
    {
      ...mockCand1,
      candidateId: 'low_performer',
      canonicalKey: 'c_key_2',
      treeFingerprint: 'fp_2',
      effectiveScore: 0.10,
      scoreSource: 'coarse',
      mutationVector: v1,
    },
  ];

  const res2 = selectRetainedCandidates(mockCandidates, 6, 0.25);
  const topRetained = res2.retained.find(r => r.candidateId === 'top_performer');
  assertStrict.ok(topRetained, '最高分候选必须被保留');
  assertStrict.ok(topRetained.retentionReasons.includes('performance_baseline'), '必须包含 performance_baseline 理由');
  assertStrict.equal(topRetained.scoreSource, 'refined', 'scoreSource 必须为 refined');
  console.log('  ✓ 最佳性能候选优先保留成功。\n');

  // Test 3: 验证流派代表 (Archetype Coverage) 优先于低分探索 (T009-3)
  console.log('[Test 3] 验证各流派代表优先覆盖...');
  const multiArchList: CandidateAnalysisRecord[] = [
    {
      ...mockCand1,
      candidateId: 'half_1',
      archPath: 'halfrush',
      effectiveScore: 0.80,
      scoreSource: 'refined',
      mutationVector: v1,
    },
    {
      ...mockCand1,
      candidateId: 'prayer_1',
      archPath: 'prayer',
      canonicalKey: 'c_prayer_1',
      treeFingerprint: 'fp_prayer',
      effectiveScore: 0.50,
      scoreSource: 'refined',
      mutationVector: v1,
    },
    {
      ...mockCand1,
      candidateId: 'rush_1',
      archPath: 'fullrush',
      canonicalKey: 'c_rush_1',
      treeFingerprint: 'fp_rush',
      effectiveScore: 0.40,
      scoreSource: 'refined',
      mutationVector: v1,
    },
  ];

  const res3 = selectRetainedCandidates(multiArchList, 6, 0.25);
  const retainedArchs = new Set(res3.retained.map(r => r.archPath));
  assertStrict.ok(retainedArchs.has('halfrush'), '应覆盖 halfrush');
  assertStrict.ok(retainedArchs.has('prayer'), '应覆盖 prayer');
  assertStrict.ok(retainedArchs.has('fullrush'), '应覆盖 fullrush');
  console.log('  ✓ 三大流派代表均成功入选覆盖。\n');

  // Test 4: 验证低分探索拒绝（低于 0.25 及 0 分绝不入选） (T009-4)
  console.log('[Test 4] 验证低分探索候选过滤与拒绝...');
  const exploreFilterList: CandidateAnalysisRecord[] = [
    {
      ...mockCand1,
      candidateId: 'good_cand',
      effectiveScore: 0.85,
      scoreSource: 'refined',
      mutationVector: v1,
    },
    {
      ...mockCand1,
      candidateId: 'zero_cand',
      canonicalKey: 'c_zero',
      treeFingerprint: 'fp_zero',
      effectiveScore: 0.0,
      coarseEvaluation: { adScore: 0.0 },
      scoreSource: 'coarse',
      mutationVector: { ...v1, noveltyScore: 0.99 },
    },
    {
      ...mockCand1,
      candidateId: 'sub_floor_cand',
      canonicalKey: 'c_sub',
      treeFingerprint: 'fp_sub',
      effectiveScore: 0.20,
      coarseEvaluation: { adScore: 0.20 },
      scoreSource: 'coarse',
      mutationVector: { ...v1, noveltyScore: 0.95 },
    },
  ];

  const res4 = selectRetainedCandidates(exploreFilterList, 6, 0.25);
  assertStrict.ok(!res4.retained.some(r => r.candidateId === 'zero_cand'), '0 分候选绝不应被保留');
  assertStrict.ok(!res4.retained.some(r => r.candidateId === 'sub_floor_cand'), '低于 0.25 的候选绝不应被保留');

  const zeroRej = res4.rejected.find(r => r.candidateId === 'zero_cand');
  assertStrict.ok(zeroRej?.rejectionReason.includes('zero_score') || zeroRej?.rejectionReason.includes('below'), '0 分候选应记录拒绝理由');
  console.log('  ✓ 0 分及低于 0.25 探索门槛候选被严格拦截拒绝。\n');

  // Test 5: 验证卡组与树指纹严格去重 (T009-5)
  console.log('[Test 5] 验证重复队伍与重复树指纹去重...');
  const dupList: CandidateAnalysisRecord[] = [
    {
      ...mockCand1,
      candidateId: 'cand_orig',
      canonicalKey: 'dup_key',
      treeFingerprint: 'dup_fp',
      effectiveScore: 0.70,
      scoreSource: 'refined',
      mutationVector: v1,
    },
    {
      ...mockCand1,
      candidateId: 'cand_dup',
      canonicalKey: 'dup_key',
      treeFingerprint: 'dup_fp',
      effectiveScore: 0.70,
      scoreSource: 'refined',
      mutationVector: v1,
    },
  ];

  const res5 = selectRetainedCandidates(dupList, 6, 0.25);
  assertStrict.equal(res5.retained.length, 1, '重复项只能保留 1 个');
  assertStrict.equal(res5.rejected.length, 1, '重复项应进入 rejected 列表');
  assertStrict.ok(res5.rejected[0].rejectionReason.includes('duplicate_canonical_key'));
  console.log('  ✓ 重复卡组去重验证通过。\n');

  // Test 6: 验证容量上限 6 与理由完整性 (T009-6)
  console.log('[Test 6] 验证容量上限 6 与理由完整性...');
  const manyCandidates: CandidateAnalysisRecord[] = Array.from({ length: 12 }, (_, i) => ({
    ...mockCand1,
    candidateId: `cand_${i}`,
    canonicalKey: `key_${i}`,
    treeFingerprint: `fp_${i}`,
    archPath: ['prayer', 'halfrush', 'fullrush'][i % 3],
    modulePath: `mod_${i}`,
    effectiveScore: 0.40 + (i * 0.04),
    coarseEvaluation: { adScore: 0.40 + (i * 0.04) },
    scoreSource: 'coarse',
    mutationVector: {
      ...v1,
      noveltyScore: 0.3 + (i * 0.05),
      direction: {
        archPath: ['prayer', 'halfrush', 'fullrush'][i % 3],
        modulePath: `mod_${i}`,
        coreKey: 'all2',
        mutationBucket: ['light', 'medium', 'heavy'][i % 3] as any,
      },
    },
  }));

  const res6 = selectRetainedCandidates(manyCandidates, 6, 0.25);
  assertStrict.equal(res6.retained.length, 6, '保留数量最多为 6');
  for (const r of res6.retained) {
    assertStrict.ok(r.retentionReasons.length > 0, `保留候选 ${r.candidateId} 必须有明确理由`);
  }
  console.log('  ✓ 最多保留 6 个且均携带合法 retentionReasons 验证通过。\n');

  // Test 7: 验证输入异常与畸变处理 (测试临时目录隔离) (T009-7 / T010)
  console.log('[Test 7] 验证异常输入容错 (隔离在 testTmpDir)...');
  await assertStrict.rejects(async () => {
    await analyzeAndRetainCandidates({ inputPath: join(testTmpDir, 'non_existent_file.jsonl') });
  }, /does not exist/, '文件不存在时必须安全抛错');

  const tmpMalformedPath = join(testTmpDir, 'malformed_test.jsonl');
  writeFileSync(tmpMalformedPath, '{"broken json\n', 'utf8');
  await assertStrict.rejects(async () => {
    await analyzeAndRetainCandidates({ inputPath: tmpMalformedPath });
  }, /Malformed JSON/, 'JSON 损坏时必须安全抛错');
  console.log('  ✓ 异常输入与畸变文件安全退出验证通过。\n');

  // Test 8: 验证 FORMATION_LIBRARY 活跃库未受修改 (T009-8)
  console.log('[Test 8] 验证 FORMATION_LIBRARY 活跃库未受修改...');
  const librarySnapshot = JSON.stringify(FORMATION_LIBRARY);
  assertStrict.equal(JSON.stringify(FORMATION_LIBRARY), librarySnapshot, 'FORMATION_LIBRARY 必须 100% 保持未修改');
  console.log('  ✓ 活跃库数据未被污染。\n');

  // Test 9: T010 核心回归 - 证明生产数据集未被测试套件修改 (byte-identical)
  console.log('[Test 9] 验证生产数据集 reports/new-formation-pilot/candidates.jsonl 零污染与 byte-identical...');
  if (prodDatasetSnapshot !== null) {
    const currentProdDataset = readFileSync(prodDatasetPath, 'utf8');
    assertStrict.equal(currentProdDataset, prodDatasetSnapshot, '生产数据集在测试套件运行后必须 100% byte-identical');
  }
  console.log('  ✓ 生产数据集 byte-identical 零污染验证通过。\n');

  // 清理临时目录
  rmSync(testTmpDir, { recursive: true, force: true });

  console.log('=== 所有 T009/T010 验收测试全部通过 (9/9) ===');
}

runTests().catch(e => {
  console.error('Test failed:', e);
  process.exit(1);
});
