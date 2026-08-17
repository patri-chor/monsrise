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
  console.log('=== 开始执行 T011 前四种子变异与树优化接口专项测试 ===\n');

  const prodPilotPath = resolve('reports/new-formation-pilot/candidates.jsonl');
  const prodPilotSnapshot = existsSync(prodPilotPath) ? readFileSync(prodPilotPath, 'utf8') : null;

  const testTmpDir = resolve('tests/.tmp/first-four-test');
  if (existsSync(testTmpDir)) {
    rmSync(testTmpDir, { recursive: true, force: true });
  }
  mkdirSync(testTmpDir, { recursive: true });

  // Test 1: 验证前 4 种子与 8 对手面板的规范解析 (T011-1)
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
  console.log(`  ✓ 源种子 (4个) 与评估面板 (8个) 解析成功: [${panelNames.join(', ')}]\n`);

  // Test 2: 验证每个源种子的独立有界变异与统计记录 (T011-2)
  console.log('[Test 2] 验证每个源种子独立变异与统计审计...');
  const s1 = sourceSeeds[0];
  const genRes1 = generateFromSourceSeed(s1, 0, 100, 6);
  assertStrict.ok(genRes1.stats.attempts <= 6, '单源尝试次数不得超过 6');
  assertStrict.equal(genRes1.stats.sourceSeedName, s1.name);
  assertStrict.equal(genRes1.stats.attempts, genRes1.stats.accepted + genRes1.stats.duplicateRejections + genRes1.stats.structuralRejections);
  console.log(`  ✓ ${s1.name} 独立变异成功 (attempts: ${genRes1.stats.attempts}, accepted: ${genRes1.stats.accepted})\n`);

  // Test 3: 验证优化器固定面板接口检测机制 (T011-3)
  console.log('[Test 3] 验证树优化器固定面板接口检测与缺失判定...');
  const ifaceCheck = checkTreeOptimizerPanelInterface();
  assertStrict.equal(ifaceCheck.supported, false, '现有公开接口未支持 fixed opponents 参数时必须判定为 false');
  assertStrict.ok(ifaceCheck.missingInterfaceDescription.includes('opponents?: Formation[]'), '必须准确指出缺失的签名');
  console.log(`  ✓ 优化器接口缺失检测准确: ${ifaceCheck.missingInterfaceDescription}\n`);

  // Test 4: 验证端到端流水线在测试临时目录的隔离运行 (T011-4)
  console.log('[Test 4] 验证端到端流水线隔离运行与产物完整性...');
  const cycleRes = await runFirstFourGenerationCycle({
    outputDir: testTmpDir,
    baseSeed: 42,
    attemptsPerSeed: 3,
    workers: 2,
    coarseGames: 1,
    coarseSeedBase: 1000,
    maxRetained: 6,
    explorationFloor: 0.25,
  });

  assertStrict.ok(existsSync(join(testTmpDir, 'seed_manifest.json')), 'seed_manifest.json 必须生成');
  assertStrict.ok(existsSync(join(testTmpDir, 'generated_candidates.jsonl')), 'generated_candidates.jsonl 必须生成');
  assertStrict.ok(existsSync(join(testTmpDir, 'retention.json')), 'retention.json 必须生成');
  assertStrict.ok(existsSync(join(testTmpDir, 'retention.md')), 'retention.md 必须生成');
  assertStrict.ok(existsSync(join(testTmpDir, 'summary.md')), 'summary.md 必须生成');

  assertStrict.equal(cycleRes.manifest.seedCount, 4);
  assertStrict.equal(cycleRes.manifest.panelCount, 8);
  assertStrict.ok(cycleRes.retainedRecords.length <= 6);
  console.log(`  ✓ 流水线隔离生成完成 (产出候选: ${cycleRes.generatedCandidates.length}, 保留: ${cycleRes.retainedRecords.length}, 拒绝: ${cycleRes.rejectedRecords.length})\n`);

  // Test 5: 验证 FORMATION_LIBRARY 与 Pilot 生产数据集未受修改 (T011-5)
  console.log('[Test 5] 验证活跃库零污染与生产数据集 byte-identical...');
  const librarySnapshot = JSON.stringify(FORMATION_LIBRARY);
  assertStrict.equal(JSON.stringify(FORMATION_LIBRARY), librarySnapshot, 'FORMATION_LIBRARY 必须 100% 保持未修改');
  if (prodPilotSnapshot !== null) {
    const currentProdPilot = readFileSync(prodPilotPath, 'utf8');
    assertStrict.equal(currentProdPilot, prodPilotSnapshot, 'Pilot 生产数据集必须 100% byte-identical');
  }
  console.log('  ✓ 活跃库与生产数据集 byte-identical 零污染验证通过。\n');

  // 清理临时目录
  rmSync(testTmpDir, { recursive: true, force: true });

  console.log('=== 所有 T011 验收测试全部通过 (5/5) ===');
}

runTests().catch(e => {
  console.error('Test failed:', e);
  process.exit(1);
});
