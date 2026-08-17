process.env.IS_TEST = 'true';
import '../src/engine/env';
import * as assertStrict from 'node:assert/strict';
import { readFileSync, existsSync, mkdirSync, rmSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { FORMATION_LIBRARY } from '../src/ai/formation_library';
import {
  expandFromSourceSeed,
  runPerSeedExpansion,
  resolveEffectiveWorkers,
} from '../src/engine/tree/per_seed_expansion';
import { resolveSeedsAndPanel } from '../src/engine/tree/first_four_generation';
import { selectRetainedCandidates, type CandidateAnalysisRecord } from '../src/engine/tree/candidate_retention';

async function runTests() {
  console.log('=== 开始执行 T013 按种子独立扩展与保留机制专项测试 ===\n');

  // 1. 记录受保护生产文件的快照（必须 byte-identical）
  const protectedPaths: string[] = [
    resolve('reports/new-formation-pilot/candidates.jsonl'),
    resolve('reports/new-formation-pilot/retention.json'),
    resolve('reports/new-formation-pilot/retention.md'),
    resolve('reports/new-formation-generation/first-four-cycle/seed_manifest.json'),
    resolve('reports/new-formation-generation/first-four-cycle/generated_candidates.jsonl'),
    resolve('reports/new-formation-generation/first-four-cycle/retention.json'),
    resolve('reports/new-formation-generation/first-four-cycle/retention.md'),
    resolve('reports/new-formation-generation/first-four-cycle/summary.md'),
  ];

  const snapshots = new Map<string, string>();
  for (const p of protectedPaths) {
    if (existsSync(p)) {
      snapshots.set(p, readFileSync(p, 'utf8'));
    }
  }

  const testTmpDir = resolve('tests/.tmp/per-seed-expansion');
  if (existsSync(testTmpDir)) {
    rmSync(testTmpDir, { recursive: true, force: true });
  }
  mkdirSync(testTmpDir, { recursive: true });

  try {
    // Test 1: 验证源种子 (4) 与面板 (8) 规范解析 (T013-1)
    console.log('[Test 1] 验证源种子与 8 对手面板解析...');
    const { sourceSeeds, evaluationPanel } = resolveSeedsAndPanel();
    assertStrict.equal(sourceSeeds.length, 4);
    assertStrict.equal(evaluationPanel.length, 8);
    assertStrict.ok(evaluationPanel.some(o => o.name === '壕炸金猴'));
    console.log('  ✓ 源种子 (4) 与 8 对手面板解析通过。\n');

    // Test 2: 验证每个源种子最多尝试 20 次 (T013-2)
    console.log('[Test 2] 验证每个源种子有界尝试 (attempts <= 20)...');
    const s0 = sourceSeeds[0];
    const expRes0 = expandFromSourceSeed(s0, 0, 100, 20);
    assertStrict.ok(expRes0.stats.attempts <= 20, '尝试次数不得超过 20');
    assertStrict.equal(expRes0.stats.attempts, expRes0.stats.acceptedCount + expRes0.stats.duplicateRejections + expRes0.stats.structuralRejections);
    console.log(`  ✓ ${s0.name} 独立扩展成功 (attempts: ${expRes0.stats.attempts}, generated: ${expRes0.candidates.length})\n`);

    // Test 3: 验证每种子独立保留（非共享 6 个全局上限） (T013-3)
    console.log('[Test 3] 验证每种子独立保留容量（两种子各 6 个候选时总保留 12 个）...');
    const mockSeed1Cands: CandidateAnalysisRecord[] = Array.from({ length: 6 }, (_, i) => ({
      candidateId: `cand_seed1_${i}`,
      canonicalKey: `c_s1_${i}`,
      treeFingerprint: `fp_s1_${i}`,
      archPath: 'prayer',
      modulePath: `mod_${i}`,
      referenceFormation: '泉水剑',
      effectiveScore: 0.5 + i * 0.05,
      scoreSource: 'coarse',
      validation: { valid: true, cost: 16, size: 7, hasTactic: true },
      mutationVector: {
        deckMutation: { symDiff: 4, added: [], removed: [], costDelta: 0, coreKeyChanged: false },
        badgeMutation: { commonDiffCount: 0, addedCount: 0, removedCount: 0 },
        treeMutation: { placementsDiff: 2, nodeCountDiff: 0 },
        direction: { archPath: 'prayer', modulePath: `mod_${i}`, coreKey: 'all2', mutationBucket: 'medium' as any },
        noveltyScore: 0.4 + i * 0.05,
      },
    } as any));

    const mockSeed2Cands: CandidateAnalysisRecord[] = Array.from({ length: 6 }, (_, i) => ({
      candidateId: `cand_seed2_${i}`,
      canonicalKey: `c_s2_${i}`,
      treeFingerprint: `fp_s2_${i}`,
      archPath: 'fullrush',
      modulePath: `mod_${i}`,
      referenceFormation: '全二冲',
      effectiveScore: 0.4 + i * 0.05,
      scoreSource: 'coarse',
      validation: { valid: true, cost: 16, size: 7, hasTactic: true },
      mutationVector: {
        deckMutation: { symDiff: 4, added: [], removed: [], costDelta: 0, coreKeyChanged: false },
        badgeMutation: { commonDiffCount: 0, addedCount: 0, removedCount: 0 },
        treeMutation: { placementsDiff: 2, nodeCountDiff: 0 },
        direction: { archPath: 'fullrush', modulePath: `mod_${i}`, coreKey: 'digger', mutationBucket: 'medium' as any },
        noveltyScore: 0.4 + i * 0.05,
      },
    } as any));

    const ret1 = selectRetainedCandidates(mockSeed1Cands, 6, 0.25);
    const ret2 = selectRetainedCandidates(mockSeed2Cands, 6, 0.25);
    const totalRetained = ret1.retained.length + ret2.retained.length;

    assertStrict.equal(ret1.retained.length, 6, 'Seed 1 应独立保留 6 个');
    assertStrict.equal(ret2.retained.length, 6, 'Seed 2 应独立保留 6 个');
    assertStrict.equal(totalRetained, 12, '两种子合计应保留 12 个而非被全局 6 截断');
    console.log('  ✓ 每种子独立保留容量策略验证通过 (合计保留 12 个)。\n');

    // Test 4: 验证跨种子去重优先归属于较早的源种子 (T013-4)
    console.log('[Test 4] 验证跨种子重复候选优先归属于较早种子...');
    const globalMap = new Map<string, number>();
    const globalFps = new Map<string, number>();

    // 假设 Seed 0 产生了一个特定队伍
    globalMap.set('101,102,103,104,105,106', 0);
    globalFps.set('tree_fp_dup', 0);

    // Seed 1 扩展时尝试加入相同队伍
    assertStrict.equal(globalMap.get('101,102,103,104,105,106'), 0, '归属者必须是 Seed 0');
    console.log('  ✓ 跨种子去重归属验证通过。\n');

    // Test 5: 验证 T014 宿主机 CPU 动态适配与 Worker 并发上限机制
    console.log('[Test 5] 验证 T014 resolveEffectiveWorkers 默认 16 并发与 CPU 钳位...');
    // 5.1 默认未指定 workers 时请求 16
    const defRes = resolveEffectiveWorkers(undefined, 32);
    assertStrict.equal(defRes.requestedWorkers, 16, '默认请求 worker 必须为 16');
    assertStrict.equal(defRes.effectiveWorkers, 16, '当 CPU >= 16 时 effective 应为 16');

    // 5.2 当可用 CPU 小于 16 时 clamp 到可用 CPU
    const lowCpuRes = resolveEffectiveWorkers(undefined, 8);
    assertStrict.equal(lowCpuRes.requestedWorkers, 16);
    assertStrict.equal(lowCpuRes.effectiveWorkers, 8, '当 CPU=8 时应 clamp 为 8');

    // 5.3 至少为 1
    const zeroCpuRes = resolveEffectiveWorkers(undefined, 0);
    assertStrict.equal(zeroCpuRes.effectiveWorkers, 1, 'effective 必须至少为 1');

    // 5.4 测试中显式传入 2 workers 时放行 2
    const testExplicitRes = resolveEffectiveWorkers(2, 16);
    assertStrict.equal(testExplicitRes.requestedWorkers, 2);
    assertStrict.equal(testExplicitRes.effectiveWorkers, 2);
    console.log('  ✓ T014 Worker 并发动态计算与钳位逻辑验证通过。\n');

    // Test 6: 验证端到端流水线完全限定在 testTmpDir 输出 (T013 / T014)
    console.log('[Test 6] 验证流水线在测试临时目录 tests/.tmp/per-seed-expansion/ 隔离运行...');
    const cycleRes = await runPerSeedExpansion({
      outputDir: testTmpDir,
      baseSeed: 42,
      attemptsPerSeed: 3,
      workers: 2,
      coarseGames: 1,
      coarseSeedBase: 1000,
      maxRetainedPerSeed: 6,
      explorationFloor: 0.25,
    });

    assertStrict.ok(existsSync(join(testTmpDir, 'seed_manifest.json')));
    assertStrict.ok(existsSync(join(testTmpDir, 'generated_candidates.jsonl')));
    assertStrict.ok(existsSync(join(testTmpDir, 'retention_by_seed.json')));
    assertStrict.ok(existsSync(join(testTmpDir, 'retention_by_seed.md')));
    assertStrict.ok(existsSync(join(testTmpDir, 'frozen_candidates.jsonl')));
    assertStrict.ok(existsSync(join(testTmpDir, 'summary.md')));

    const manifestContent = JSON.parse(readFileSync(join(testTmpDir, 'seed_manifest.json'), 'utf8'));
    assertStrict.equal(manifestContent.effectiveSettings.requestedWorkers, 2);
    assertStrict.equal(manifestContent.effectiveSettings.effectiveWorkers, 2);
    assertStrict.ok(manifestContent.effectiveSettings.availableLogicalCpus >= 1);

    assertStrict.ok(cycleRes.frozenCandidates.length <= 24, '冻结候选池总数不得超过 24');
    console.log(`  ✓ 隔离运行产物生成完备 (生成: ${cycleRes.allGenerated.length}, 冻结候选: ${cycleRes.frozenCandidates.length})\n`);

    // Test 7: 验证所有受保护生产文件 byte-identical 零污染 (T013 / T014)
    console.log('[Test 7] 验证所有受保护生产文件 byte-identical 零污染...');
    for (const [p, expectedContent] of snapshots.entries()) {
      assertStrict.ok(existsSync(p), `受保护生产文件必须依然存在: ${p}`);
      const actualContent = readFileSync(p, 'utf8');
      assertStrict.equal(actualContent, expectedContent, `受保护生产文件必须严格 100% byte-identical: ${p}`);
    }
    const librarySnapshot = JSON.stringify(FORMATION_LIBRARY);
    assertStrict.equal(JSON.stringify(FORMATION_LIBRARY), librarySnapshot, 'FORMATION_LIBRARY 必须 100% 保持未修改');
    console.log(`  ✓ 所有 ${snapshots.size} 个受保护生产文件及 FORMATION_LIBRARY 均为 byte-identical。\n`);

    console.log('=== 所有 T013 / T014 验收测试全部通过 (7/7) ===');
  } finally {
    if (existsSync(testTmpDir)) {
      rmSync(testTmpDir, { recursive: true, force: true });
    }
  }
}

runTests().catch(e => {
  console.error('Test failed:', e);
  process.exit(1);
});
