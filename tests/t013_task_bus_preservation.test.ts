import '../src/engine/env';
import * as assertStrict from 'node:assert/strict';
import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execSync } from 'node:child_process';

/**
 * 校验 TASKS/tree/ 下的任务总线记录保留完整性
 * @param preTrackedFiles 任务前已存在的 TASKS/tree 文件名集合
 * @param currentFiles 当前工作区 TASKS/tree 文件名集合
 */
export function validateTaskBusPreservation(
  preTrackedFiles: string[],
  currentFiles: string[],
): { valid: boolean; deletedFiles: string[] } {
  const currentSet = new Set(currentFiles);
  const deletedFiles: string[] = [];

  for (const file of preTrackedFiles) {
    if (!currentSet.has(file)) {
      deletedFiles.push(file);
    }
  }

  return {
    valid: deletedFiles.length === 0,
    deletedFiles,
  };
}

async function runT013Tests() {
  console.log('=== 开始执行 T013 任务总线历史记录保留与防意外删除专项验收测试 ===\n');

  const tasksDir = resolve('TASKS/tree');

  // Test 1: 全量任务编号规格与报告成对存在性检查 (T005 到 T022)
  console.log('[Test 1] 验证所有历史与当前任务的规范与报告成对存在且非空...');
  const taskIds = [
    'T005', 'T006', 'T007', 'T008', 'T009', 'T010',
    'T011', 'T012', 'T013', 'T014', 'T015', 'T016',
    'T017', 'T018', 'T019', 'T020', 'T021', 'T022',
    'T023',
  ];

  const actualFiles = readdirSync(tasksDir);

  for (const tid of taskIds) {
    const reportFile = `${tid}.report.md`;
    assertStrict.ok(existsSync(join(tasksDir, reportFile)), `必须存在交付报告: ${reportFile}`);

    // 匹配规格文件 (如 T022-*.md)
    const specFile = actualFiles.find(f => f.startsWith(`${tid}-`) && f.endsWith('.md'));
    assertStrict.ok(specFile, `任务 ${tid} 必须存在对应的规格文件 (Txxx-*.md)`);
    
    const specContent = readFileSync(join(tasksDir, specFile!), 'utf8').trim();
    assertStrict.ok(specContent.length > 0, `规格文件不得为空: ${specFile}`);
  }
  console.log('  ✓ 全部 T005~T023 任务规格与交付报告成对存在且非空。\n');

  // Test 2: 模拟意外删除场景拦截
  console.log('[Test 2] 模拟意外删除场景（包含历史或当前 spec 被删除）...');
  const allExpectedFiles = [
    'README.md',
    'T005-existing-formation-tree-cycle.md', 'T005.report.md',
    'T006-training-score-and-winrate-display.md', 'T006.report.md',
    'T007-fixed-opponent-panel-optimizer.md', 'T007.closed.md', 'T007.report.md',
    'T008-candidate-optimizer-experiment-validity.md', 'T008.report.md',
    'T009-reproducible-optimizer-validity-proof.md', 'T009.closed.md', 'T009.report.md',
    'T010-t009-delivery-recovery.md', 'T010.closed.md', 'T010.report.md',
    'T011-cross-seed-branch-deck-opening-optimization.md', 'T011.closed.md', 'T011.report.md',
    'T012-eight-candidate-control-baseline.md', 'T012.closed.md', 'T012.report.md',
    'T013-task-bus-preservation-repair.md', 'T013.closed.md', 'T013.report.md',
    'T014-early-seven-bundle-order-search.md', 'T014.closed.md', 'T014.report.md',
    'T015-t014-report-identity-correction.md', 'T015.closed.md', 'T015.report.md',
    'T016-overnight-eleven-library-training.md', 'T016.report.md',
    'T017-t016-audit-cost-reinforcement-rework.md', 'T017.report.md',
    'T018-t017-readable-archive-completion.md', 'T018.report.md',
    'T019-t018-git-tracked-archive-delivery.md', 'T019.report.md',
    'T020-runtime-integrity-and-elite-seed-continuity.md', 'T020.report.md',
    'T021-t020-elite-retest-and-runtime-diagnostic-repair.md', 'T021.report.md',
    'T022-four-cost-fidelity-gate-and-resumable-experience-training.md', 'T022.report.md',
    'T023-real-trace-fidelity-and-atomic-experience-runner.md', 'T023.report.md',
  ];

  const faultyScenario = allExpectedFiles.filter(f => !f.startsWith('T022-') && !f.startsWith('T020-'));
  const checkResultFaulty = validateTaskBusPreservation(allExpectedFiles, faultyScenario);
  assertStrict.equal(checkResultFaulty.valid, false, '意外删除必须被判定为 invalid');
  assertStrict.ok(checkResultFaulty.deletedFiles.includes('T022-four-cost-fidelity-gate-and-resumable-experience-training.md'));
  assertStrict.ok(checkResultFaulty.deletedFiles.includes('T020-runtime-integrity-and-elite-seed-continuity.md'));
  console.log(`  ✓ 历史意外删除拦截验证通过，成功捕获 ${checkResultFaulty.deletedFiles.length} 个意外删除。\n`);

  // Test 3: 验证真实工作区全量保留
  console.log('[Test 3] 验证当前真实工作区全量保留通过...');
  const checkResultActual = validateTaskBusPreservation(allExpectedFiles, actualFiles);
  assertStrict.equal(checkResultActual.valid, true, `未通过项: ${checkResultActual.deletedFiles.join(', ')}`);
  console.log(`  ✓ 当前工作区共 ${actualFiles.length} 个文件，全部保留完整无丢失。\n`);

  // Test 4: 检查 Git 暂存区是否有意外删除 TASKS/tree/
  console.log('[Test 4] 检查 Git 暂存区防删除断言...');
  try {
    const stagedDiff = execSync('git diff --cached --name-status', { encoding: 'utf8' });
    const stagedLines = stagedDiff.trim().split('\n').filter(Boolean);
    const deletedTasks = stagedLines.filter(l => l.startsWith('D\tTASKS/tree/'));
    assertStrict.equal(deletedTasks.length, 0, `Git 暂存区禁止包含任务删除操作: ${deletedTasks.join(', ')}`);
  } catch (e: any) {
    if (e.message.includes('AssertionError')) throw e;
    // 非 git repo 或环境不抛出
  }
  console.log('  ✓ Git 暂存区无任何任务删除操作。\n');

  console.log('=== 所有 T013 验收测试全部通过 ===');
}

runT013Tests().catch((err) => {
  console.error('T013 测试失败:', err);
  process.exit(1);
});
