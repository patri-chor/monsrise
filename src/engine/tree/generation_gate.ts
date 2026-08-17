// ============================================================
// Generation Resource Gate Helper (T008)
//
// 目的：为 generation 域评估流水线提供机器可判定的资源门禁检查。
// 依据 canonical 任务文件状态判定 tree 域（如 T005）是否活跃，
// 防止双域高负载 Arena 并行评估冲突。
// ============================================================

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

export interface GateVerdict {
  allowed: boolean;
  status: 'OPEN' | 'BLOCKED';
  reason: string;
  source: string;
  treeTaskStatus?: string;
  checkedAt: string;
}

export interface GateCheckOptions {
  repoRoot?: string;
  tasksDir?: string;
  customTreeDir?: string;
  mockTreeTaskStatus?: string;
}

/**
 * 检查 generation 评估流水线资源门禁
 * - 检查 TASKS/tree/ (以及 TASKS/) 下的 T005 任务及状态
 * - 若 T005 处于 IN_PROGRESS 或 OPEN 且未闭环 (无 closed / 未完成 report)，则阻断非 dry-run 评估
 * - 若 T005 处于 DONE / CLOSED 或已闭环，则判定为 OPEN 允许执行
 */
export function checkGenerationResourceGate(options: GateCheckOptions = {}): GateVerdict {
  const checkedAt = new Date().toISOString();
  const repoRoot = options.repoRoot ?? resolve('.');
  const tasksDir = options.tasksDir ?? join(repoRoot, 'TASKS');
  const treeDir = options.customTreeDir ?? join(tasksDir, 'tree');

  // 支持测试 mock
  if (options.mockTreeTaskStatus !== undefined) {
    const status = options.mockTreeTaskStatus.toUpperCase();
    const isActive = status === 'IN_PROGRESS' || status === 'OPEN';
    return {
      allowed: !isActive,
      status: isActive ? 'BLOCKED' : 'OPEN',
      reason: isActive
        ? `Tree domain task T005 is active with status '${status}' (mocked). Evaluation blocked.`
        : `Tree domain is idle (mock status: '${status}'). Evaluation permitted.`,
      source: 'mock',
      treeTaskStatus: status,
      checkedAt,
    };
  }

  // 1. 查找 tree 目录下的 T005 任务文件
  let t005TaskFile: string | null = null;
  let searchDir = treeDir;

  if (existsSync(treeDir)) {
    const files = readdirSync(treeDir);
    const found = files.find(f => /^T005.*\.md$/i.test(f) && !f.endsWith('.report.md') && !f.endsWith('.closed.md'));
    if (found) {
      t005TaskFile = join(treeDir, found);
      searchDir = treeDir;
    }
  }

  if (!t005TaskFile && existsSync(tasksDir)) {
    const files = readdirSync(tasksDir);
    const found = files.find(f => /^T005.*\.md$/i.test(f) && !f.endsWith('.report.md') && !f.endsWith('.closed.md'));
    if (found) {
      t005TaskFile = join(tasksDir, found);
      searchDir = tasksDir;
    }
  }

  if (!t005TaskFile || !existsSync(t005TaskFile)) {
    return {
      allowed: true,
      status: 'OPEN',
      reason: 'No active tree T005 task file found. Resource gate is idle.',
      source: 'tasks_check',
      checkedAt,
    };
  }

  // 2. 读取任务文件状态
  const content = readFileSync(t005TaskFile, 'utf8');
  const firstLine = content.split('\n')[0]?.trim() ?? '';
  const statusMatch = firstLine.match(/^STATUS:\s*([A-Za-z_-]+)/i) || content.match(/^STATUS:\s*([A-Za-z_-]+)/im);
  const taskStatus = (statusMatch ? statusMatch[1] : 'UNKNOWN').toUpperCase();

  // 3. 检查是否有 closed 文件或完成的 report
  const dirFiles = existsSync(searchDir) ? readdirSync(searchDir) : [];
  const closedFile = dirFiles.find(f => /^T005.*\.closed\.md$/i.test(f));
  const reportFile = dirFiles.find(f => /^T005.*\.report\.md$/i.test(f));

  let isReportDone = false;
  if (reportFile) {
    try {
      const repContent = readFileSync(join(searchDir, reportFile), 'utf8');
      const repStatusMatch = repContent.match(/^STATUS:\s*([A-Za-z_-]+)/im);
      if (repStatusMatch && repStatusMatch[1].toUpperCase() === 'DONE') {
        isReportDone = true;
      }
    } catch {}
  }

  if (closedFile || isReportDone || taskStatus === 'DONE' || taskStatus === 'CLOSED' || taskStatus === 'REJECTED') {
    return {
      allowed: true,
      status: 'OPEN',
      reason: `Tree task T005 is completed/closed (status: ${taskStatus}, closed: ${Boolean(closedFile)}, reportDone: ${isReportDone}). Gate is idle.`,
      source: t005TaskFile,
      treeTaskStatus: taskStatus,
      checkedAt,
    };
  }

  // 若处于 IN_PROGRESS 或 OPEN 且未闭环，则阻断
  return {
    allowed: false,
    status: 'BLOCKED',
    reason: `Tree domain task T005 is currently active (${taskStatus}) at '${t005TaskFile}'. Non-dry-run evaluation blocked to avoid concurrency interference.`,
    source: t005TaskFile,
    treeTaskStatus: taskStatus,
    checkedAt,
  };
}
