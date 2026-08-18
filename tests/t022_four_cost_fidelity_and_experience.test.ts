import '../src/engine/env';
import * as assertStrict from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { EXPERIENCE_LIB_DIR } from '../src/engine/tree/experience_training_pipeline';
import { validateTreeDeckCoherence } from '../src/engine/tree/order_search';
import type { EvolFormation } from '../src/engine/tree/evol_gene';

async function runT022Tests() {
  console.log('=== 开始执行 T022 四费保真门禁与可恢复经验训练专项验收测试 ===\n');

  const libDir = EXPERIENCE_LIB_DIR;
  assertStrict.ok(existsSync(libDir), 'experience_library 目录必须存在');

  // Test 1: 验证 Phase A 四费保真门禁与负例拦截
  console.log('[Test 1] 验证四费保真门禁与负例控制拦截...');
  const fidelityLedgerPath = join(libDir, 'four_cost_fidelity_ledger.jsonl');
  assertStrict.ok(existsSync(fidelityLedgerPath), 'four_cost_fidelity_ledger.jsonl 必须存在');

  const fidelityRecords = readFileSync(fidelityLedgerPath, 'utf8')
    .trim()
    .split('\n')
    .map(l => JSON.parse(l));

  assertStrict.ok(fidelityRecords.length >= 10, '必须覆盖全部基准中的四费怪兽放置 (>=10 处)');
  for (const r of fidelityRecords) {
    assertStrict.equal(r.status, 'PASS', `${r.sourceSeedName} 中的四费怪兽 ${r.monsterName} 必须 PASS`);
    assertStrict.equal(r.roundTripLossless, true, '序列化 Round-trip 必须无损');
    assertStrict.equal(r.workerErrorCount, 0, 'Worker 错误必须为 0');
  }

  // 负例非法四费放置拦截断言
  const illegalFourCost: EvolFormation = {
    name: 'IllegalFourCostTest',
    archetype: 'prayer',
    team: [{ monsterId: 110, badgeIds: [] }],
    root: {
      id: 'root',
      round: 0,
      condition: { side: null, main: null, subs: [], keys: [] },
      placements: [],
      children: [
        {
          id: 'n1',
          round: 1,
          condition: { side: null, main: null, subs: [], keys: [] },
          placements: [{ monsterId: 103, x: 8, y: 2 }], // 103 4费怪兽未在 team 中
          children: [],
        },
      ],
    },
  };
  const negCheck = validateTreeDeckCoherence(illegalFourCost);
  assertStrict.equal(negCheck.valid, false, '非法四费放置必须被门禁精准拦截');
  assertStrict.equal(negCheck.error, 'MISSING_TEAM_MONSTER', '拦截原因必须为 MISSING_TEAM_MONSTER');
  console.log('  ✓ 四费保真门禁与负例拦截断言通过。\n');

  // Test 2: 验证多源 8 怪兽候选池均衡性 (>=60 候选，覆盖 10 套基准)
  console.log('[Test 2] 验证多源 8 怪兽候选池均衡性与合规性...');
  const registryPath = join(libDir, 'candidate_registry.jsonl');
  assertStrict.ok(existsSync(registryPath), 'candidate_registry.jsonl 必须存在');

  const registry = readFileSync(registryPath, 'utf8')
    .trim()
    .split('\n')
    .map(l => JSON.parse(l));

  assertStrict.equal(registry.length, 60, '必须包含恰好 60 个多源候选 (10 基准 * 6 突变)');
  const sourceGroups = new Map<string, number>();
  for (const c of registry) {
    assertStrict.equal(c.teamSize, 8, '每个候选必须严格为 8 怪兽');
    assertStrict.equal(c.isCoherenceValid, true, '每个候选必须静态闭包合规');
    sourceGroups.set(c.sourceSeedName, (sourceGroups.get(c.sourceSeedName) ?? 0) + 1);
  }
  assertStrict.equal(sourceGroups.size, 10, '必须均衡覆盖全部 10 套 8 怪兽基准');
  for (const [sName, count] of sourceGroups.entries()) {
    assertStrict.equal(count, 6, `基准 ${sName} 必须恰好生成 6 个突变候选`);
  }
  console.log('  ✓ 10 套基准 60 个 8 怪兽候选均衡覆盖校验通过。\n');

  // Test 3: 验证累积经验库全部 8 项资产完整性
  console.log('[Test 3] 验证累积经验库全部 8 项核心资产...');
  const expected8Files = [
    'manifest.json',
    'source_baseline_evidence.jsonl',
    'four_cost_fidelity_ledger.jsonl',
    'candidate_registry.jsonl',
    'evaluation_observations.jsonl',
    'promotion_decisions.jsonl',
    'source_frontiers.json',
    'README.md',
  ];

  for (const f of expected8Files) {
    const fPath = join(libDir, f);
    assertStrict.ok(existsSync(fPath), `经验库资产必须存在: ${f}`);
    assertStrict.ok(readFileSync(fPath, 'utf8').length > 0, `经验库资产不得为空: ${f}`);
  }

  const readme = readFileSync(join(libDir, 'README.md'), 'utf8');
  assertStrict.ok(readme.includes('历史小样本数据定位'), 'README 必须说明历史小样本数据定位');
  assertStrict.ok(readme.includes('Append-Only 观察语义'), 'README 必须说明 Append-Only 观察语义');

  const frontiers = JSON.parse(readFileSync(join(libDir, 'source_frontiers.json'), 'utf8'));
  assertStrict.ok(Object.keys(frontiers).length >= 10, 'source_frontiers 必须包含全部基准的前沿记录');
  console.log('  ✓ 经验库全部 8 项资产完整且合规。\n');

  // Test 4: 验证任务规范文件完整存在
  console.log('[Test 4] 验证 T020/T021/T022 任务规范文件完整存在...');
  assertStrict.ok(existsSync(resolve('TASKS/tree/T020-runtime-integrity-and-elite-seed-continuity.md')));
  assertStrict.ok(existsSync(resolve('TASKS/tree/T021-t020-elite-retest-and-runtime-diagnostic-repair.md')));
  assertStrict.ok(existsSync(resolve('TASKS/tree/T022-four-cost-fidelity-gate-and-resumable-experience-training.md')));
  console.log('  ✓ 任务规范文件完整保留。\n');

  console.log('=== 所有 T022 验收测试全部通过 ===');
}

runT022Tests().catch((err) => {
  console.error('T022 测试失败:', err);
  process.exit(1);
});
