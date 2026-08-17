import '../src/engine/env';
import * as assertStrict from 'node:assert/strict';
import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

/**
 * 校验 TASKS/tree/ 下的任务总线记录保留完整性
 * @param preTrackedFiles 任务前已存在的 TASKS/tree 文件名集合
 * @param currentFiles 当前工作区 TASKS/tree 文件名集合
 * @param currentTaskFile 当前正在执行的任务定义文件（可选）
 */
export function validateTaskBusPreservation(
  preTrackedFiles: string[],
  currentFiles: string[],
  currentTaskFile?: string,
): { valid: boolean; deletedFiles: string[] } {
  const currentSet = new Set(currentFiles);
  const deletedFiles: string[] = [];

  for (const file of preTrackedFiles) {
    if (!currentSet.has(file)) {
      // 仅当当前任务文件显式声明允许删除该文件时豁免（目前无任何任务允许）
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

  // Test 1: 验证当前工作区所有 5 个被恢复文件的存在性与非空性
  console.log('[Test 1] 验证 5 项缺失任务总线文件已完整恢复...');
  const tasksDir = resolve('TASKS/tree');
  const requiredFiles = [
    'T009.closed.md',
    'T010.closed.md',
    'T011-cross-seed-branch-deck-opening-optimization.md',
    'T011.closed.md',
    'T012-eight-candidate-control-baseline.md',
    'T012.report.md',
  ];

  for (const rf of requiredFiles) {
    const fullPath = join(tasksDir, rf);
    assertStrict.ok(existsSync(fullPath), `文件必须存在: ${rf}`);
    const content = readFileSync(fullPath, 'utf8').trim();
    assertStrict.ok(content.length > 0, `文件内容不可为空: ${rf}`);
  }
  console.log('  ✓ 5 项历史任务记录与 T012.report.md 完整存在且内容非空。\n');

  // Test 2: 模拟 T011/T012 历史意外删除场景，验证校验器能够准确拦截报错
  console.log('[Test 2] 模拟历史意外删除场景（包含 T009.closed, T010.closed 等被删除）...');
  const preTaskSetFixture = [
    'README.md',
    'T005-existing-formation-tree-cycle.md',
    'T005.report.md',
    'T006-training-score-and-winrate-display.md',
    'T006.report.md',
    'T007-fixed-opponent-panel-optimizer.md',
    'T007.closed.md',
    'T007.report.md',
    'T008-candidate-optimizer-experiment-validity.md',
    'T008.report.md',
    'T009-reproducible-optimizer-validity-proof.md',
    'T009.closed.md',
    'T009.report.md',
    'T010-t009-delivery-recovery.md',
    'T010.closed.md',
    'T010.report.md',
    'T011-cross-seed-branch-deck-opening-optimization.md',
    'T011.closed.md',
    'T011.report.md',
    'T012-eight-candidate-control-baseline.md',
    'T012.closed.md',
    'T012.report.md',
  ];

  // 模拟被意外删除后的集合
  const faultyScenarioSet = [
    'README.md',
    'T011.report.md',
    'T012.report.md',
  ];

  const checkResultFaulty = validateTaskBusPreservation(preTaskSetFixture, faultyScenarioSet);
  assertStrict.equal(checkResultFaulty.valid, false, '历史意外删除场景必须被判定为 invalid');
  assertStrict.ok(checkResultFaulty.deletedFiles.includes('T009.closed.md'), '必须检测出 T009.closed.md 丢失');
  assertStrict.ok(checkResultFaulty.deletedFiles.includes('T010.closed.md'), '必须检测出 T010.closed.md 丢失');
  assertStrict.ok(checkResultFaulty.deletedFiles.includes('T011-cross-seed-branch-deck-opening-optimization.md'), '必须检测出 T011 task 丢失');
  console.log(`  ✓ 历史意外删除拦截验证通过，成功捕获 ${checkResultFaulty.deletedFiles.length} 个意外删除文件。\n`);

  // Test 3: 验证当前真实工作区文件集合通过检验
  console.log('[Test 3] 验证当前恢复后的真实工作区通过全量保留检查...');
  const currentActualFiles = readdirSync(tasksDir);
  const checkResultActual = validateTaskBusPreservation(preTaskSetFixture, currentActualFiles);
  assertStrict.equal(checkResultActual.valid, true, `当前工作区必须全部通过检查，未通过项: ${checkResultActual.deletedFiles.join(', ')}`);
  console.log(`  ✓ 当前工作区共 ${currentActualFiles.length} 个文件，全部保留完整无丢失。\n`);

  console.log('=== 所有 T013 验收测试全部通过 ===');
}

runT013Tests().catch((err) => {
  console.error('T013 测试失败:', err);
  process.exit(1);
});
