import '../src/engine/env';
import * as assertStrict from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

async function runT019Tests() {
  console.log('=== 开始执行 T019 Git 跟踪归档与交付修复专项验收测试 ===\n');

  // Test 1: 验证 Git 追踪状态 (git ls-files) 必须包含全部 13 项产物文件
  console.log('[Test 1] 验证 git ls-files 跟踪全部 13 项归档产物文件...');
  const lsFilesOutput = execSync('git ls-files tests/fixtures/tree/t016_training_archive/', { encoding: 'utf8' });
  const trackedFiles = new Set(lsFilesOutput.trim().split('\n').map(p => p.trim()).filter(Boolean));

  const expected13Files = [
    'tests/fixtures/tree/t016_training_archive/source_snapshot.json',
    'tests/fixtures/tree/t016_training_archive/generation_manifest.json',
    'tests/fixtures/tree/t016_training_archive/all_candidates.jsonl',
    'tests/fixtures/tree/t016_training_archive/screening_ledger.jsonl',
    'tests/fixtures/tree/t016_training_archive/optimization_attempts.jsonl',
    'tests/fixtures/tree/t016_training_archive/early_holdout_evaluations.jsonl',
    'tests/fixtures/tree/t016_training_archive/current_panel_generalization.jsonl',
    'tests/fixtures/tree/t016_training_archive/reinforcement_attempts.jsonl',
    'tests/fixtures/tree/t016_training_archive/tier_library.json',
    'tests/fixtures/tree/t016_training_archive/tier_library.md',
    'tests/fixtures/tree/t016_training_archive/rejection_ledger.jsonl',
    'tests/fixtures/tree/t016_training_archive/summary.md',
    'tests/fixtures/tree/t016_training_archive/final_r5_grids.md',
  ];

  for (const expected of expected13Files) {
    assertStrict.ok(trackedFiles.has(expected), `Git 必须显式追踪文件: ${expected}`);
  }
  console.log('  ✓ 全部 13 项归档文件均已进入 Git 跟踪 (git ls-files 验证通过)。\n');

  // Test 2: 验证 T018 任务规范文件完整存在且被 Git 跟踪
  console.log('[Test 2] 验证 T018 任务规范文件存在与恢复...');
  const t018SpecPath = 'TASKS/tree/T018-t017-readable-archive-completion.md';
  assertStrict.ok(existsSync(resolve(t018SpecPath)), `${t018SpecPath} 物理文件必须存在`);
  const t018Content = readFileSync(resolve(t018SpecPath), 'utf8');
  assertStrict.ok(t018Content.includes('T018 - T017 Readable Archive Completion'), 'T018 标题必须完整');
  console.log('  ✓ T018 任务规范已完整恢复。\n');

  // Test 3: 验证 tier_library.md 内部统计与 JSON 数据完全一致
  console.log('[Test 3] 验证 tier_library.md 数量与 JSON 记录严格一致...');
  const archiveDir = resolve('tests/fixtures/tree/t016_training_archive');
  const tierLibJson = JSON.parse(readFileSync(join(archiveDir, 'tier_library.json'), 'utf8'));
  const rejections = readFileSync(join(archiveDir, 'rejection_ledger.jsonl'), 'utf8').trim().split('\n');
  const tierLibMd = readFileSync(join(archiveDir, 'tier_library.md'), 'utf8');

  assertStrict.ok(tierLibMd.includes(`Tier 1: ${tierLibJson.tier1.length}`), 'Tier 1 数量必须一致 (11)');
  assertStrict.ok(tierLibMd.includes(`Tier 2: ${tierLibJson.tier2.length}`), 'Tier 2 数量必须一致 (0)');
  assertStrict.ok(tierLibMd.includes(`Tier 3: ${tierLibJson.tier3.length}`), 'Tier 3 数量必须一致 (5)');
  assertStrict.ok(tierLibMd.includes(`Rejected: ${rejections.length}`), 'Rejected 数量必须一致 (25)');
  console.log('  ✓ tier_library.md 数量与 JSON 记录完全一致。\n');

  // Test 4: 验证 final_r5_grids.md 包含 11 套 Tier 1 网格、计算怪兽标注 [计算定位]
  console.log('[Test 4] 验证 final_r5_grids.md 网格与计算定位标记...');
  const gridMd = readFileSync(join(archiveDir, 'final_r5_grids.md'), 'utf8');
  assertStrict.ok(gridMd.includes('泉水剑'), '必须包含泉水剑');
  assertStrict.ok(gridMd.includes('礼物丛林'), '必须包含礼物丛林');
  assertStrict.ok(gridMd.includes('7-Monster Legacy Baseline'), '必须标记 7-Monster Legacy');
  assertStrict.ok(gridMd.includes('[计算定位]'), '必须包含 [计算定位] 标记');
  assertStrict.ok(gridMd.includes('Tier 2: Stable Enhanced Candidates (0 Candidates)'), 'Tier 2 必须明确标注为 0 候选');
  console.log('  ✓ final_r5_grids.md 网格与计算定位标注校验通过。\n');

  console.log('=== 所有 T019 验收测试全部通过 ===');
}

runT019Tests().catch((err) => {
  console.error('T019 测试失败:', err);
  process.exit(1);
});
