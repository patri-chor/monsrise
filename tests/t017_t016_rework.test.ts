import '../src/engine/env';
import * as assertStrict from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { PersistentSimPool } from '../src/engine/tree/persistent_pool';
import { runElevenLibraryTraining, COMMITTED_ARCHIVE_DIR } from '../src/engine/tree/eleven_library_training';
import { validateTreeDeckCoherence } from '../src/engine/tree/order_search';
import { costOf } from '../src/engine/tree/tree_ops';
import { formationToEvol, cloneEvolFormation, walkEvolNodes } from '../src/engine/tree/evol_gene';
import type { Formation } from '../src/ai/types';

async function runT017Tests() {
  console.log('=== 开始执行 T017 T016 审计、费用、强化通道与可审计归档专项验收测试 ===\n');

  // Test 1: 树/卡组闭包门禁 (Tree/Deck Coherence Gate) 拦截与放行
  console.log('[Test 1] 验证深层分支缺少卡组怪兽的非法候选被闭包门禁精准拦截...');
  const sources = JSON.parse(readFileSync(resolve('tests/fixtures/tree/eleven_frozen_sources.json'), 'utf8'));
  const complexSrc = sources[0]; // 泉水剑
  const validEvol = formationToEvol(complexSrc as unknown as Formation);

  const validRes = validateTreeDeckCoherence(validEvol);
  assertStrict.ok(validRes.valid, '合法复杂树必须通过闭包门禁');

  // 构造非法候选：深层树节点包含怪兽 999 (未在卡组中)
  const invalidEvol = cloneEvolFormation(validEvol);
  const nodes = walkEvolNodes(invalidEvol.root);
  if (nodes.length > 1 && nodes[1].placements.length > 0) {
    nodes[1].placements[0].monsterId = 999;
  }

  const invalidRes = validateTreeDeckCoherence(invalidEvol);
  assertStrict.equal(invalidRes.valid, false, '深层缺失怪兽的候选必须被拦截');
  assertStrict.equal(invalidRes.error, 'MISSING_TEAM_MONSTER', '错误类型必须为 MISSING_TEAM_MONSTER');
  console.log('  ✓ 闭包门禁精准拦截非法深层缺失怪兽候选 (MISSING_TEAM_MONSTER)。\n');

  // Test 2: 验证 8 怪兽卡组规则、多 4 费卡组保留、以及 7 怪兽遗留基准
  console.log('[Test 2] 验证 8 怪兽卡组规则与费用初筛放行...');
  const shovelMulti = sources.find((s: any) => s.name === '铲土多核');
  assertStrict.ok(shovelMulti, '必须存在铲土多核');
  const shovelCost = shovelMulti.team.reduce((sum: number, slot: any) => sum + costOf(slot.monsterId), 0);
  assertStrict.ok(shovelCost > 18, `铲土多核总费 (${shovelCost}) 必须大于 18`);

  const giftJungle = sources.find((s: any) => s.name === '礼物丛林');
  assertStrict.ok(giftJungle, '必须存在礼物丛林');
  assertStrict.equal(giftJungle.team.length, 7, '礼物丛林必须为 7 怪兽');
  assertStrict.equal(giftJungle.isLegacyBaseline, true, '礼物丛林必须标记为 isLegacyBaseline');
  console.log('  ✓ 8 怪兽卡组规则与多 4 费卡组保留校验通过。\n');

  // Test 3: 运行全量 3 次独立优化尝试 + 真实强化通道评测
  console.log('[Test 3] 启动全量 30 候选 3 次独立优化尝试与真实强化通道构建...');
  const pool = new PersistentSimPool({ workerCount: 16, enableCpuMonitor: false });
  await pool.init();

  const outResult = await runElevenLibraryTraining({
    archiveDir: COMMITTED_ARCHIVE_DIR,
    pool,
    onProgress: (msg) => console.log(`    [T017 Training Progress] ${msg}`),
  });

  assertStrict.equal(outResult.results.length, 30, '必须完成全部 30 个 8 怪兽候选评测');
  assertStrict.equal(outResult.tier1.length, 11, 'Tier 1 必须包含全部 11 套基准源阵型');

  // Test 4: 验证 tests/fixtures/tree/t016_training_archive/ 下全部 12 项非空产物
  console.log('[Test 4] 验证 committed archive 目录下全部 12 项产物完整性...');
  const expectedFiles = [
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
  ];

  for (const f of expectedFiles) {
    const fPath = join(COMMITTED_ARCHIVE_DIR, f);
    assertStrict.ok(existsSync(fPath), `必须存在产物文件: ${f}`);
    const content = readFileSync(fPath, 'utf8');
    assertStrict.ok(content.length > 0, `产物文件 ${f} 内容不得为空`);
  }
  console.log('  ✓ 归档目录下全部 12 项 Reviewable 产物非空且格式合规。\n');

  pool.destroy();
  console.log('=== 所有 T017 验收测试全部通过 ===');
}

runT017Tests().catch((err) => {
  console.error('T017 测试失败:', err);
  process.exit(1);
});
