import '../src/engine/env';
import * as assertStrict from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadAuthoritativeFrozenCandidates } from '../src/engine/tree/sequential_tree_optimization';
import { computeCalculatedUnitRatio, getMonsterDisplayName } from '../src/engine/tree/order_search';
import { isPositionIrrelevant } from '../src/engine/tree/tree_ops';

async function runT015Tests() {
  console.log('=== 开始执行 T015 T014 报告怪兽身份与计算定位单位订正专项验收测试 ===\n');

  const fixturePath = resolve('tests/fixtures/tree/eight_frozen_candidates.jsonl');
  assertStrict.ok(existsSync(fixturePath), 'eight_frozen_candidates.jsonl 必须存在');

  const candidates = loadAuthoritativeFrozenCandidates(fixturePath);
  assertStrict.equal(candidates.length, 8, '必须校验全部 8 个候选');

  // Test 1: 验证 cand_s1_1_2a 的计算怪兽严格为 116 钻头而非 106 冲锋
  console.log('[Test 1] 验证 cand_s1_1_2a 计算怪兽为 116 钻头 (非 106 冲锋)...');
  const candS1 = candidates.find(c => c.candidateId === 'cand_s1_1_2a');
  assertStrict.ok(candS1, '必须存在 cand_s1_1_2a');
  const s1Analysis = computeCalculatedUnitRatio(candS1.team);
  assertStrict.equal(s1Analysis.calculatedCount, 1, 'cand_s1_1_2a 计算怪兽数必须为 1');
  assertStrict.deepEqual(s1Analysis.calculatedMonsterIds, [116], 'cand_s1_1_2a 计算怪兽 ID 必须恰好为 [116]');
  assertStrict.equal(getMonsterDisplayName(116), '钻头', '116 名称必须解析为 钻头');
  console.log('  ✓ cand_s1_1_2a 身份断言通过 (116 / 钻头)。\n');

  // Test 2: 验证全部 8 个候选的计算怪兽归属与数量一致性
  console.log('[Test 2] 验证全部 8 候选计算怪兽归属性、数量与权威名称一致性...');
  for (const c of candidates) {
    const analysis = computeCalculatedUnitRatio(c.team);
    assertStrict.equal(analysis.calculatedMonsterIds.length, analysis.calculatedCount, `${c.candidateId} 数量必须一致`);

    const teamIds = new Set(c.team.map(s => s.monsterId));
    for (const calcId of analysis.calculatedMonsterIds) {
      assertStrict.ok(teamIds.has(calcId), `计算怪兽 ${calcId} 必须属于候选 ${c.candidateId} 的 team`);
      assertStrict.ok(isPositionIrrelevant(calcId), `怪兽 ${calcId} 必须为计算定位怪兽`);
      assertStrict.ok(getMonsterDisplayName(calcId).length > 0, `怪兽 ${calcId} 必须有权威中文名`);
    }
  }
  console.log('  ✓ 全部 8 候选计算怪兽归属性、数量与名称一致性校验通过。\n');

  // Test 3: 读取 TASKS/tree/T014.report.md 验证其表格与网格已完全订正
  console.log('[Test 3] 校验 TASKS/tree/T014.report.md 内容已使用权威数据订正...');
  const t014ReportPath = resolve('TASKS/tree/T014.report.md');
  assertStrict.ok(existsSync(t014ReportPath), 'TASKS/tree/T014.report.md 必须存在');
  const reportContent = readFileSync(t014ReportPath, 'utf8');

  // 必须包含修正说明 Note
  assertStrict.ok(reportContent.includes('T015 订正说明') || reportContent.includes('524ad11'), '必须包含 T015 订正说明');
  // 必须包含 116钻头
  assertStrict.ok(reportContent.includes('116钻头'), '必须在表格中正确包含 116钻头');
  // 不能在 cand_s1_1_2a 行包含 106冲锋
  const lines = reportContent.split('\n');
  const cand1Line = lines.find(l => l.includes('cand_s1_1_2a'));
  assertStrict.ok(cand1Line, '必须包含 cand_s1_1_2a 行');
  assertStrict.ok(cand1Line.includes('116钻头'), 'cand_s1_1_2a 行必须包含 116钻头');
  assertStrict.ok(!cand1Line.includes('106冲锋'), 'cand_s1_1_2a 行严禁包含 106冲锋');

  console.log('  ✓ TASKS/tree/T014.report.md 文本订正校验通过。\n');

  console.log('=== 所有 T015 验收测试全部通过 ===');
}

runT015Tests().catch((err) => {
  console.error('T015 测试失败:', err);
  process.exit(1);
});
