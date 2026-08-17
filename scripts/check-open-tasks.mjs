#!/usr/bin/env node
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execSync } from 'node:child_process';

const repoRoot = resolve('.');
const tasksDir = join(repoRoot, 'TASKS');

// 1. 同步远程
try {
  execSync('git pull', { cwd: repoRoot, stdio: 'pipe' });
} catch (e) {
  // git pull 失败时不阻断本地检查
}

if (!existsSync(tasksDir)) {
  console.log(JSON.stringify({ status: 'NO_TASK', reason: 'TASKS directory not found' }));
  process.exit(0);
}

// 2. 扫描 TASKS 目录
const files = readdirSync(tasksDir);
const taskFiles = files.filter(f => /^T\d+.*\.md$/i.test(f) && !f.endsWith('.report.md') && !f.endsWith('.closed.md') && f !== 'T000-template.md');

// 按编号升序排序
taskFiles.sort((a, b) => {
  const numA = parseInt(a.match(/^T(\d+)/i)?.[1] ?? '0', 10);
  const numB = parseInt(b.match(/^T(\d+)/i)?.[1] ?? '0', 10);
  return numA - numB;
});

let openTask = null;

// 从最大编号往前找最新 OPEN 任务
for (let i = taskFiles.length - 1; i >= 0; i--) {
  const file = taskFiles[i];
  const fullPath = join(tasksDir, file);
  const content = readFileSync(fullPath, 'utf8');
  
  // 检查状态是否为 STATUS: OPEN
  const firstLine = content.split('\n')[0]?.trim() ?? '';
  const isOpen = /^STATUS:\s*OPEN/i.test(firstLine) || /^STATUS:\s*OPEN/im.test(content.slice(0, 200));
  
  if (!isOpen) continue;

  // 检查是否已有对应的 DONE report
  const taskId = file.match(/^(T\d+)/i)?.[1];
  if (!taskId) continue;

  const reportFile = files.find(f => f.startsWith(taskId) && f.endsWith('.report.md'));
  if (reportFile) {
    const reportContent = readFileSync(join(tasksDir, reportFile), 'utf8');
    const isDone = /^STATUS:\s*DONE/im.test(reportContent.slice(0, 200));
    if (isDone) continue; // 已完成，跳过
  }

  openTask = {
    taskId,
    file: `TASKS/${file}`,
    title: content.split('\n').find(l => l.startsWith('# '))?.replace('# ', '').trim() ?? file,
  };
  break;
}

if (openTask) {
  console.log(JSON.stringify({
    status: 'TASK_FOUND',
    taskId: openTask.taskId,
    taskFile: openTask.file,
    title: openTask.title,
  }));
  process.exit(100);
} else {
  console.log(JSON.stringify({ status: 'NO_TASK' }));
  process.exit(0);
}
