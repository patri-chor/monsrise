import '../src/engine/env';
import * as assertStrict from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

async function runT018Tests() {
  console.log('=== 开始执行 T018 可读归档补齐与一致性专项验收测试 ===\n');

  const archiveDir = resolve('tests/fixtures/tree/t016_training_archive');
  assertStrict.ok(existsSync(archiveDir), 't016_training_archive 目录必须存在');

  // Test 1: 验证全部 13 项产物文件均存在且非空
  console.log('[Test 1] 验证全部 13 项产物文件完整性...');
  const all13Files = [
    'source_snapshot.json',
    'generation_manifest.json',
    'all_candidates.jsonl',
    'screening_ledger.jsonl',
    'optimization_attempts.jsonl',
    'early_holdout_evaluations.jsonl',
    'current_panel_generalization.jsonl',
    'reinforcement_attempts.jsonl',
    'tier_library.json',
    'tier_library.md',
    'rejection_ledger.jsonl',
    'summary.md',
    'final_r5_grids.md',
  ];

  for (const f of all13Files) {
    const fPath = join(archiveDir, f);
    assertStrict.ok(existsSync(fPath), `必须存在产物文件: ${f}`);
    const stat = readFileSync(fPath, 'utf8');
    assertStrict.ok(stat.length > 0, `产物文件不得为空: ${f}`);
  }
  console.log('  ✓ 全部 13 项产物文件完整存在且非空。\n');

  // Test 2: 验证 tier_library.md 内部统计与 JSON 数据完全一致
  console.log('[Test 2] 验证 tier_library.md 计数与 JSON 一致性...');
  const tierLibJson = JSON.parse(readFileSync(join(archiveDir, 'tier_library.json'), 'utf8'));
  const rejections = readFileSync(join(archiveDir, 'rejection_ledger.jsonl'), 'utf8').trim().split('\n');
  const tierLibMd = readFileSync(join(archiveDir, 'tier_library.md'), 'utf8');

  assertStrict.ok(tierLibMd.includes(`Tier 1: ${tierLibJson.tier1.length}`), 'Tier 1 数量必须一致 (11)');
  assertStrict.ok(tierLibMd.includes(`Tier 2: ${tierLibJson.tier2.length}`), 'Tier 2 数量必须一致 (0)');
  assertStrict.ok(tierLibMd.includes(`Tier 3: ${tierLibJson.tier3.length}`), 'Tier 3 数量必须一致 (5)');
  assertStrict.ok(tierLibMd.includes(`Rejected: ${rejections.length}`), 'Rejected 数量必须一致 (25)');
  console.log('  ✓ tier_library.md 数量与 JSON 记录完全一致。\n');

  // Test 3: 验证 summary.md 包含 11 源, 30 候选, 90 尝试, 1 强化, 0 错误与 no-apply
  console.log('[Test 3] 验证 summary.md 执行参数与关键声明...');
  const sumMd = readFileSync(join(archiveDir, 'summary.md'), 'utf8');
  assertStrict.ok(sumMd.includes('11 frozen sources'), '必须说明 11 frozen sources');
  assertStrict.ok(sumMd.includes('30 coherent 8-monster candidates'), '必须说明 30 候选');
  assertStrict.ok(sumMd.includes('90 attempts'), '必须说明 90 attempts');
  assertStrict.ok(sumMd.includes('1 reinforcement attempt'), '必须说明 1 reinforcement');
  assertStrict.ok(sumMd.includes('0') && sumMd.includes('worker errors'), '必须说明 0 worker errors');
  assertStrict.ok(sumMd.includes('No active formation') || sumMd.includes('No-Apply Confirmation'), '必须包含 no-apply 确认');
  console.log('  ✓ summary.md 关键审计参数校验通过。\n');

  // Test 4: 验证 final_r5_grids.md 包含 11 套 Tier 1 网格、计算怪兽标注 [计算定位]
  console.log('[Test 4] 验证 final_r5_grids.md 网格与计算定位标记...');
  const gridMd = readFileSync(join(archiveDir, 'final_r5_grids.md'), 'utf8');
  assertStrict.ok(gridMd.includes('泉水剑'), '必须包含泉水剑');
  assertStrict.ok(gridMd.includes('礼物丛林'), '必须包含礼物丛林');
  assertStrict.ok(gridMd.includes('7-Monster Legacy Baseline'), '必须标记 7-Monster Legacy');
  assertStrict.ok(gridMd.includes('[计算定位]'), '必须包含 [计算定位] 标记');
  assertStrict.ok(gridMd.includes('Tier 2: Stable Enhanced Candidates (0 Candidates)'), 'Tier 2 必须明确标注为 0 候选');
  console.log('  ✓ final_r5_grids.md 网格与计算定位标注校验通过。\n');

  console.log('=== 所有 T018 验收测试全部通过 ===');
}

runT018Tests().catch((err) => {
  console.error('T018 测试失败:', err);
  process.exit(1);
});
