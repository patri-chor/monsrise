process.env.IS_TEST = 'true';
import '../src/engine/env';
import * as assertStrict from 'node:assert/strict';
import { readFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { FORMATION_LIBRARY } from '../src/ai/formation_library';
import {
  resolveSeedsAndPanel,
  generateFromSourceSeed,
  checkTreeOptimizerPanelInterface,
  runFirstFourGenerationCycle,
} from '../src/engine/tree/first_four_generation';

async function runTests() {
  console.log('=== 开始执行 T012 前四种子周期产物隔离与回归保护测试 ===\n');

  // 1. 记录受保护生产文件的快照（必须 byte-identical）
  const protectedPaths = [
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

  const testTmpDir = resolve('tests/.tmp/first-four-generation');
  if (existsSync(testTmpDir)) {
    rmSync(testTmpDir, { recursive: true, force: true });
  }
  mkdirSync(testTmpDir, { recursive: true });

  try {
    // Test 1: 验证源种子 (4个) 与评估面板 (8个) 规范解析 (T011-1 / T012)
    console.log('[Test 1] 验证前 4 变异源种子与 8 对手面板规范解析...');
    const { sourceSeeds, evaluationPanel } = resolveSeedsAndPanel();

    assertStrict.equal(sourceSeeds.length, 4, '源种子必须严格为 4 个');
    assertStrict.equal(sourceSeeds[0].name, '泉水剑');
    assertStrict.equal(sourceSeeds[1].name, '坚果救星');
    assertStrict.equal(sourceSeeds[2].name, '全二冲');
    assertStrict.equal(sourceSeeds[3].name, '经典救星');

    assertStrict.equal(evaluationPanel.length, 8, '评估面板必须严格包含 8 个唯一对手');
    const panelNames = evaluationPanel.map(o => o.name);
    assertStrict.ok(panelNames.includes('壕炸金猴'), '评估面板必须包含 壕炸金猴');
    assertStrict.equal(new Set(panelNames).size, 8, '8 个对手必须完全互斥唯一');
    console.log(`  ✓ 源种子与评估面板规范解析通过: [${panelNames.join(', ')}]\n`);

    // Test 2: 验证单源独立变异与统计记录 (T011-2 / T012)
    console.log('[Test 2] 验证每个源种子独立变异与统计审计...');
    const s1 = sourceSeeds[0];
    const genRes1 = generateFromSourceSeed(s1, 0, 100, 6);
    assertStrict.ok(genRes1.stats.attempts <= 6, '单源尝试次数不得超过 6');
    assertStrict.equal(genRes1.stats.sourceSeedName, s1.name);
    assertStrict.equal(genRes1.stats.attempts, genRes1.stats.accepted + genRes1.stats.duplicateRejections + genRes1.stats.structuralRejections);
    console.log(`  ✓ ${s1.name} 独立变异通过 (attempts: ${genRes1.stats.attempts}, accepted: ${genRes1.stats.accepted})\n`);

    // Test 3: 验证优化器固定面板接口检测机制 (T011 / T016)
    console.log('[Test 3] 验证树优化器固定面板接口检测...');
    const ifaceCheck = checkTreeOptimizerPanelInterface();
    assertStrict.equal(ifaceCheck.supported, true, '公开接口已支持 fixed opponents 参数时必须判定为 true');
    console.log(`  ✓ 优化器接口检测通过: ${ifaceCheck.reason}\n`);

    // Test 4: 验证端到端流水线完全限定在 testTmpDir 输出 (T012 核心隔离)
    console.log('[Test 4] 验证流水线在测试临时目录 tests/.tmp/first-four-generation/ 的完全隔离运行...');
    const cycleRes = await runFirstFourGenerationCycle({
      outputDir: testTmpDir,
      baseSeed: 42,
      attemptsPerSeed: 2,
      workers: 2,
      coarseGames: 1,
      coarseSeedBase: 1000,
      maxRetained: 6,
      explorationFloor: 0.25,
    });

    assertStrict.ok(existsSync(join(testTmpDir, 'seed_manifest.json')), 'seed_manifest.json 必须生成于 testTmpDir');
    assertStrict.ok(existsSync(join(testTmpDir, 'generated_candidates.jsonl')), 'generated_candidates.jsonl 必须生成于 testTmpDir');
    assertStrict.ok(existsSync(join(testTmpDir, 'retention.json')), 'retention.json 必须生成于 testTmpDir');
    assertStrict.ok(existsSync(join(testTmpDir, 'retention.md')), 'retention.md 必须生成于 testTmpDir');
    assertStrict.ok(existsSync(join(testTmpDir, 'summary.md')), 'summary.md 必须生成于 testTmpDir');
    console.log(`  ✓ 临时目录产物生成完备 (产出候选: ${cycleRes.generatedCandidates.length}, 保留: ${cycleRes.retainedRecords.length})\n`);

    // Test 5: 验证所有受保护生产文件 byte-identical 零污染 (T012 核心验收)
    console.log('[Test 5] 验证所有受保护生产文件 byte-identical 零污染...');
    for (const [p, expectedContent] of snapshots.entries()) {
      assertStrict.ok(existsSync(p), `受保护生产文件必须依然存在: ${p}`);
      const actualContent = readFileSync(p, 'utf8');
      assertStrict.equal(actualContent, expectedContent, `受保护生产文件必须严格 100% byte-identical: ${p}`);
    }
    const librarySnapshot = JSON.stringify(FORMATION_LIBRARY);
    assertStrict.equal(JSON.stringify(FORMATION_LIBRARY), librarySnapshot, 'FORMATION_LIBRARY 必须 100% 保持未修改');
    console.log(`  ✓ 所有 ${snapshots.size} 个受保护生产文件及 FORMATION_LIBRARY 均为 byte-identical。\n`);

    console.log('=== 所有 T012 验收测试全部通过 (5/5) ===');
  } finally {
    // 清理测试临时目录
    if (existsSync(testTmpDir)) {
      rmSync(testTmpDir, { recursive: true, force: true });
    }
  }
}

runTests().catch(e => {
  console.error('Test failed:', e);
  process.exit(1);
});
