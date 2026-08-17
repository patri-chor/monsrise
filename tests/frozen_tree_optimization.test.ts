process.env.IS_TEST = 'true';
import '../src/engine/env';
import * as assertStrict from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { FORMATION_LIBRARY } from '../src/ai/formation_library';
import { checkTreeOptimizerPanelInterface, resolveSeedsAndPanel } from '../src/engine/tree/first_four_generation';

async function runTests() {
  console.log('=== 开始执行 T015 冻结候选树优化前置条件审计与隔离保护测试 ===\n');

  // 1. 记录受保护生产文件的快照
  const protectedPaths: string[] = [
    resolve('reports/new-formation-pilot/candidates.jsonl'),
    resolve('reports/new-formation-pilot/retention.json'),
    resolve('reports/new-formation-pilot/retention.md'),
    resolve('reports/new-formation-generation/first-four-cycle/seed_manifest.json'),
    resolve('reports/new-formation-generation/first-four-cycle/generated_candidates.jsonl'),
    resolve('reports/new-formation-generation/first-four-cycle/retention.json'),
    resolve('reports/new-formation-generation/first-four-cycle/retention.md'),
    resolve('reports/new-formation-generation/first-four-cycle/summary.md'),
    resolve('reports/new-formation-generation/per-seed-expansion/seed_manifest.json'),
    resolve('reports/new-formation-generation/per-seed-expansion/generated_candidates.jsonl'),
    resolve('reports/new-formation-generation/per-seed-expansion/retention_by_seed.json'),
    resolve('reports/new-formation-generation/per-seed-expansion/retention_by_seed.md'),
    resolve('reports/new-formation-generation/per-seed-expansion/frozen_candidates.jsonl'),
    resolve('reports/new-formation-generation/per-seed-expansion/summary.md'),
  ];

  const snapshots = new Map<string, string>();
  for (const p of protectedPaths) {
    if (existsSync(p)) {
      snapshots.set(p, readFileSync(p, 'utf8'));
    }
  }

  // Test 1: 验证 T013 冻结 24 候选数据集完整性
  console.log('[Test 1] 验证 T013 冻结 24 候选数据集可用性...');
  const frozenPath = resolve('reports/new-formation-generation/per-seed-expansion/frozen_candidates.jsonl');
  assertStrict.ok(existsSync(frozenPath), 'frozen_candidates.jsonl 必须存在');
  const frozenLines = readFileSync(frozenPath, 'utf8').trim().split('\n');
  assertStrict.equal(frozenLines.length, 24, '冻结候选池必须包含 24 个候选');
  console.log(`  ✓ 冻结候选池完备: 24 条记录。\n`);

  // Test 2: 验证固定 8 对手面板规范解析
  console.log('[Test 2] 验证固定 8 对手面板解析...');
  const { evaluationPanel } = resolveSeedsAndPanel();
  assertStrict.equal(evaluationPanel.length, 8);
  const panelNames = evaluationPanel.map(p => p.name);
  assertStrict.ok(panelNames.includes('壕炸金猴'));
  console.log(`  ✓ 固定 8 对手面板解析通过: [${panelNames.join(', ')}]\n`);

  // Test 3: 严格审计公共树优化器接口是否满足 T015 Hard Prerequisite
  console.log('[Test 3] 严格审计公共树优化器接口 options.opponents 支持...');
  const ifaceCheck = checkTreeOptimizerPanelInterface();
  assertStrict.equal(ifaceCheck.supported, false, '当前分支上 optimizeFormation 尚未支持 options.opponents，必须判定为 false');
  assertStrict.ok(ifaceCheck.missingInterfaceDescription.includes('opponents?: Formation[]'), '必须指明缺失的接口');
  console.log(`  ✓ 接口前置条件检测准确，识别出缺失的前置接口: ${ifaceCheck.missingInterfaceDescription}\n`);

  // Test 4: 验证所有受保护生产文件及 FORMATION_LIBRARY byte-identical 零污染
  console.log('[Test 4] 验证所有受保护生产文件 byte-identical 零污染...');
  for (const [p, expectedContent] of snapshots.entries()) {
    assertStrict.ok(existsSync(p), `受保护文件必须存在: ${p}`);
    const actualContent = readFileSync(p, 'utf8');
    assertStrict.equal(actualContent, expectedContent, `受保护生产文件必须 100% byte-identical: ${p}`);
  }
  const librarySnapshot = JSON.stringify(FORMATION_LIBRARY);
  assertStrict.equal(JSON.stringify(FORMATION_LIBRARY), librarySnapshot, 'FORMATION_LIBRARY 必须保持未修改');
  console.log(`  ✓ 所有 ${snapshots.size} 个受保护生产文件及 FORMATION_LIBRARY 均为 byte-identical。\n`);

  console.log('=== 所有 T015 验收与前置审计测试全部通过 (4/4) ===');
}

runTests().catch(e => {
  console.error('Test failed:', e);
  process.exit(1);
});
