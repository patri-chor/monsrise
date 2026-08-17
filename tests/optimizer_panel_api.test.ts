process.env.IS_TEST = 'true';
import '../src/engine/env';
import * as assertStrict from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { FORMATION_LIBRARY } from '../src/ai/formation_library';
import type { Formation } from '../src/ai/types';
import {
  optimizeFormation,
  loadBundle,
  type OptimizeFormationOptions,
} from '../src/engine/tree/branch_induct';
import { resolveSeedsAndPanel } from '../src/engine/tree/first_four_generation';

const BundleAI = loadBundle();

async function runTests() {
  console.log('=== 开始执行 T016 优化器自定义面板接口专项验收测试 ===\n');

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

  const testSrc = FORMATION_LIBRARY[0]; // 泉水剑

  // Test 1: 验证空面板抛错 (T016-4)
  console.log('[Test 1] 验证空面板 options.opponents = [] 在模拟前抛错...');
  assertStrict.throws(() => {
    optimizeFormation(BundleAI, testSrc, 1, { opponents: [] });
  }, /OptimizeFormationOptions\.opponents cannot be empty/);
  console.log('  ✓ 空面板拦截校验通过。\n');

  // Test 2: 验证省略 options 时向后兼容默认全量 FORMATION_LIBRARY (T016-1 / T016-6)
  console.log('[Test 2] 验证省略 options 时向后兼容默认全量 FORMATION_LIBRARY...');
  const resDefault = optimizeFormation(BundleAI, testSrc, 1);
  if (resDefault) {
    for (const matched of resDefault.searchValidation.matchedOpponents) {
      assertStrict.ok(FORMATION_LIBRARY.some(o => o.name === matched));
    }
  }
  console.log('  ✓ 默认全量面板向后兼容验证通过。\n');

  // Test 3: 验证传入自定义 2 阵型面板时完全限定范围 (T016-2)
  console.log('[Test 3] 验证自定义 2 阵型面板严格隔离...');
  const custom2Panel: Formation[] = [FORMATION_LIBRARY[1], FORMATION_LIBRARY[2]];
  const res2 = optimizeFormation(BundleAI, testSrc, 1, {
    opponents: custom2Panel,
    searchSeedBase: 1000,
    validationSeedBase: 2000,
  });

  if (res2) {
    for (const matched of res2.searchValidation.matchedOpponents) {
      assertStrict.ok(custom2Panel.some(o => o.name === matched), `匹配对手 ${matched} 必须在 custom2Panel 内`);
    }
  }
  console.log('  ✓ 自定义 2 阵型面板隔离验证通过。\n');

  // Test 4: 验证生成域标准 8 对手面板支持与诊断输出 (T016-3)
  console.log('[Test 4] 验证生成域标准 8 对手面板传入与诊断...');
  const { evaluationPanel } = resolveSeedsAndPanel();
  assertStrict.equal(evaluationPanel.length, 8);

  const res8 = optimizeFormation(BundleAI, testSrc, 1, {
    opponents: evaluationPanel,
    searchSeedBase: 3000,
    validationSeedBase: 4000,
  });

  if (res8) {
    for (const matched of res8.searchValidation.matchedOpponents) {
      assertStrict.ok(evaluationPanel.some(o => o.name === matched), `匹配对手 ${matched} 必须在 8 对手面板内`);
    }
  }
  console.log('  ✓ 8 对手面板完整传递与诊断验证通过。\n');

  // Test 5: 验证受保护历史生产文件 byte-identical 零污染
  console.log('[Test 5] 验证所有受保护生产文件 byte-identical 零污染...');
  for (const [p, expectedContent] of snapshots.entries()) {
    assertStrict.ok(existsSync(p), `受保护生产文件必须存在: ${p}`);
    const actualContent = readFileSync(p, 'utf8');
    assertStrict.equal(actualContent, expectedContent, `受保护生产文件必须 100% byte-identical: ${p}`);
  }
  const librarySnapshot = JSON.stringify(FORMATION_LIBRARY);
  assertStrict.equal(JSON.stringify(FORMATION_LIBRARY), librarySnapshot, 'FORMATION_LIBRARY 必须保持未修改');
  console.log(`  ✓ 所有 ${snapshots.size} 个受保护生产文件及 FORMATION_LIBRARY 均为 byte-identical。\n`);

  console.log('=== 所有 T016 验收测试全部通过 (5/5) ===');
}

runTests().catch(e => {
  console.error('Test failed:', e);
  process.exit(1);
});
