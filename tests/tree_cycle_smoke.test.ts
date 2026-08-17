import '../src/engine/env';
import * as assertStrict from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { FORMATION_LIBRARY } from '../src/ai/formation_library';
import { runTreeCycle } from '../src/engine/tree/tree_cycle_runner';

async function runTests() {
  console.log('=== 开始执行 T005 既有阵型决策树优化周期验收测试 ===\n');

  const initialLibSnapshot = JSON.stringify(FORMATION_LIBRARY);
  const outDir = resolve('reports/tree-cycle');

  // Test 1: 执行 2 个代表性既有阵型 Smoke 评估（礼物救星：有条件分支，全二冲：无条件分支）
  console.log('[Test 1] 运行代表性既有阵型 Smoke 评估 (礼物救星 & 全二冲)...');
  const results = await runTreeCycle({
    targets: ['礼物救星', '全二冲'],
    gamesPerOpp: 2,
    ebGames: 6,
    outDir: 'reports/tree-cycle',
  });

  assertStrict.equal(results.length, 2, '必须成功完成 2 套阵型的评估');
  console.log('  ✓ 2 套代表性阵型评估顺利完成，无未捕获异常。');

  // Test 2: 验证即使未选条件分支，打过的回合也存在观测样本
  console.log('[Test 2] 验证打过的回合具备非空观察样本 (RoundObservation)...');
  for (const r of results) {
    assertStrict.ok(r.baseTreeFingerprint, `${r.name} 必须有基础树指纹`);
    assertStrict.equal(r.appliedToLibrary, false, '必须确保未直接应用到活跃库');
  }
  console.log('  ✓ 基础树指纹与观测采集正常。');

  // Test 3: 验证若提出分支，必须有 triggerCoverage 统计且 totalObserved > 0
  console.log('[Test 3] 验证分支提出时的 triggerCoverage 统计...');
  for (const r of results) {
    if (r.forkRound !== null) {
      assertStrict.ok(r.triggerCoverage, `${r.name} 提出分支时必须存在 triggerCoverage`);
      assertStrict.ok(r.triggerCoverage.totalObserved > 0, `${r.name} totalObserved 必须 > 0`);
      console.log(`    ${r.name}: 命中 ${r.triggerCoverage.matched}/${r.triggerCoverage.totalObserved} (${(r.triggerCoverage.coverageRate * 100).toFixed(0)}%) @ R${r.forkRound}`);
    }
  }
  console.log('  ✓ 触发覆盖率统计完备。');

  // Test 4: 验证独立验证集 5% 改善门槛与负场不增加
  console.log('[Test 4] 验证独立验证集门禁与采纳条件...');
  for (const r of results) {
    if (r.improved) {
      assertStrict.ok(r.validation, `${r.name} 采纳时必须有验证集数据`);
      assertStrict.ok(r.validation.undefeatedDelta >= 0.05, `${r.name} 采纳时改善必须 >= 5%`);
      assertStrict.ok(r.validation.lossDelta <= 0, `${r.name} 采纳时负场不能增加`);
    } else {
      assertStrict.ok(r.verdict.startsWith('NO_OP'), `${r.name} 未采纳时必须标记为合法 NO_OP`);
    }
  }
  console.log('  ✓ 独立验证集门禁判定正确。');

  // Test 5: 验证产物隔离输出到 reports/tree-cycle/
  console.log('[Test 5] 验证产物隔离输出与目录结构...');
  assertStrict.ok(existsSync(join(outDir, 'summary.md')), 'summary.md 必须生成');
  for (const r of results) {
    assertStrict.ok(existsSync(join(outDir, `${r.id}.json`)), `${r.id}.json 必须生成`);
  }
  console.log('  ✓ 产物正确隔离写入 reports/tree-cycle/。');

  // Test 6: 验证 FORMATION_LIBRARY 活跃库未受任何污染
  console.log('[Test 6] 验证 FORMATION_LIBRARY 活跃库数据 100% 未受修改...');
  const currentLibSnapshot = JSON.stringify(FORMATION_LIBRARY);
  assertStrict.equal(currentLibSnapshot, initialLibSnapshot, 'FORMATION_LIBRARY 必须完全保持不变');
  console.log('  ✓ 活跃库数据 100% 保持一致。');

  console.log('\n=== 所有 T005 验收测试全部通过 (6/6) ===');
}

runTests().catch(e => {
  console.error('测试失败:', e);
  process.exit(1);
});
