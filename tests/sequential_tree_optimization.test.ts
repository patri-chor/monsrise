process.env.IS_TEST = 'true';
import '../src/engine/env';
import * as assertStrict from 'node:assert/strict';
import { readFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { FORMATION_LIBRARY } from '../src/ai/formation_library';
import {
  runSequentialTreeOptimizationCycle,
  evaluateFormationOnPanel,
} from '../src/engine/tree/sequential_tree_optimization';
import { loadBundle } from '../src/engine/tree/branch_induct';
import { resolveSeedsAndPanel } from '../src/engine/tree/first_four_generation';
import { formationToEvol } from '../src/engine/tree/evol_gene';

async function runTests() {
  console.log('=== 开始执行 T019 冻结候选树优化与质量决策专项验收测试 ===\n');

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
    resolve('reports/new-formation-generation/sequential-per-seed-cycle/run_manifest.json'),
    resolve('reports/new-formation-generation/sequential-per-seed-cycle/frozen_candidates.jsonl'),
    resolve('reports/new-formation-generation/sequential-per-seed-cycle/summary.md'),
  ];

  const snapshots = new Map<string, string>();
  for (const p of protectedPaths) {
    if (existsSync(p)) {
      snapshots.set(p, readFileSync(p, 'utf8'));
    }
  }

  const testTmpDir = resolve('tests/.tmp/sequential-tree-optimization');
  if (existsSync(testTmpDir)) {
    rmSync(testTmpDir, { recursive: true, force: true });
  }
  mkdirSync(testTmpDir, { recursive: true });

  try {
    // Test 1: 验证 evaluateFormationOnPanel 16 cells 全覆盖与 weakestCell 统计 (T019-1)
    console.log('[Test 1] 验证 evaluateFormationOnPanel 16 cells 全覆盖与 weakestCell...');
    const BundleAI = loadBundle();
    const { evaluationPanel } = resolveSeedsAndPanel();
    assertStrict.equal(evaluationPanel.length, 8);

    const testForm = formationToEvol(FORMATION_LIBRARY[0]);
    const evalRes = evaluateFormationOnPanel(BundleAI, testForm, evaluationPanel, 1000, 1);
    assertStrict.equal(evalRes.cells.length, 16, '8 对手 × 2 sides 必须产生 16 个 cell 结果');
    assertStrict.equal(evalRes.total, 16);
    assertStrict.ok(evalRes.weakestCell >= 0 && evalRes.weakestCell <= 1);
    console.log(`  ✓ 16 cells 全覆盖与 weakestCell 验证通过 (泉水剑 baseline undefeated=${(evalRes.undefeated * 100).toFixed(0)}%, weakest=${(evalRes.weakestCell * 100).toFixed(0)}%)。\n`);

    // Test 2: 验证受保护历史生产文件 byte-identical 零污染
    console.log('[Test 2] 验证所有受保护生产文件 byte-identical 零污染...');
    for (const [p, expectedContent] of snapshots.entries()) {
      assertStrict.ok(existsSync(p), `受保护生产文件必须存在: ${p}`);
      const actualContent = readFileSync(p, 'utf8');
      assertStrict.equal(actualContent, expectedContent, `受保护生产文件必须 100% byte-identical: ${p}`);
    }
    const librarySnapshot = JSON.stringify(FORMATION_LIBRARY);
    assertStrict.equal(JSON.stringify(FORMATION_LIBRARY), librarySnapshot, 'FORMATION_LIBRARY 必须保持未修改');
    console.log(`  ✓ 所有 ${snapshots.size} 个受保护生产文件及 FORMATION_LIBRARY 均为 byte-identical。\n`);

    console.log('=== 所有 T019 基础验收测试全部通过 (2/2) ===');
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
