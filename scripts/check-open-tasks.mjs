#!/usr/bin/env node
/**
 * scripts/check-open-tasks.mjs
 * 
 * 智能阶梯降频任务检测器：
 * - 提交 report 后 0~5 分钟：高频期，每 1 分钟检查一次；
 * - 5~30 分钟：中频期，每 5 分钟检查一次；
 * - > 30 分钟：低频期，每 30 分钟检查一次；
 * - 发现新任务并提交 report 后，自动重置回高频期。
 */

import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execSync } from 'node:child_process';

const repoRoot = resolve('.');
const tasksDir = join(repoRoot, 'TASKS');
const statePath = join(repoRoot, '.task-poll-state.json');

// 读取或初始化状态
function loadState() {
  if (existsSync(statePath)) {
    try {
      return JSON.parse(readFileSync(statePath, 'utf8'));
    } catch {}
  }
  return {
    lastReportTime: Date.now(), // 默认从当前算起
    lastCheckTime: 0,
  };
}

function saveState(state) {
  try {
    writeFileSync(statePath, JSON.stringify(state, null, 2));
  } catch {}
}

const isManualForce = process.argv.includes('--force') || process.argv.includes('-f');
const isMarkReport = process.argv.includes('--report-submitted');

const state = loadState();
const now = Date.now();

if (isMarkReport) {
  state.lastReportTime = now;
  saveState(state);
  console.log(JSON.stringify({ status: 'REPORT_MARKED', lastReportTime: now }));
  process.exit(0);
}

// 计算当前应遵循的检查间隔
const elapsedSinceReportMs = now - (state.lastReportTime || now);
const elapsedSinceReportMin = elapsedSinceReportMs / 60000;

let requiredIntervalMs = 60000; // 默认 1 分钟 (0~5 分钟内)
let stageName = 'high (1 min)';

if (elapsedSinceReportMin > 30) {
  requiredIntervalMs = 30 * 60000; // >30 分钟：30 分钟一次
  stageName = 'low (30 min)';
} else if (elapsedSinceReportMin > 5) {
  requiredIntervalMs = 5 * 60000; // 5~30 分钟：5 分钟一次
  stageName = 'medium (5 min)';
}

// 判断是否已达到该阶段的检查时间
const elapsedSinceLastCheckMs = now - (state.lastCheckTime || 0);

if (!isManualForce && elapsedSinceLastCheckMs < requiredIntervalMs) {
  const waitRemainingSec = Math.ceil((requiredIntervalMs - elapsedSinceLastCheckMs) / 1000);
  console.log(JSON.stringify({
    status: 'NO_TASK',
    reason: 'BACKOFF_SKIPPED',
    stage: stageName,
    waitRemainingSec,
  }));
  process.exit(0);
}

// 记录本次实际执行检查的时间
state.lastCheckTime = now;
saveState(state);

// 1. 同步远程
try {
  execSync('git pull', { cwd: repoRoot, stdio: 'pipe' });
} catch (e) {
  // 失败时不阻断
}

if (!existsSync(tasksDir)) {
  console.log(JSON.stringify({ status: 'NO_TASK', reason: 'TASKS directory not found' }));
  process.exit(0);
}

// 2. 扫描 TASKS 目录
const files = readdirSync(tasksDir);
const taskFiles = files.filter(f => /^T\d+.*\.md$/i.test(f) && !f.endsWith('.report.md') && !f.endsWith('.closed.md') && f !== 'T000-template.md');

taskFiles.sort((a, b) => {
  const numA = parseInt(a.match(/^T(\d+)/i)?.[1] ?? '0', 10);
  const numB = parseInt(b.match(/^T(\d+)/i)?.[1] ?? '0', 10);
  return numA - numB;
});

let openTask = null;

for (let i = taskFiles.length - 1; i >= 0; i--) {
  const file = taskFiles[i];
  const fullPath = join(tasksDir, file);
  const content = readFileSync(fullPath, 'utf8');
  
  const firstLine = content.split('\n')[0]?.trim() ?? '';
  const isOpen = /^STATUS:\s*OPEN/i.test(firstLine) || /^STATUS:\s*OPEN/im.test(content.slice(0, 200));
  
  if (!isOpen) continue;

  const taskId = file.match(/^(T\d+)/i)?.[1];
  if (!taskId) continue;

  const reportFile = files.find(f => f.startsWith(taskId) && f.endsWith('.report.md'));
  if (reportFile) {
    const reportContent = readFileSync(join(tasksDir, reportFile), 'utf8');
    const isDone = /^STATUS:\s*DONE/im.test(reportContent.slice(0, 200));
    if (isDone) continue;
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
    stage: stageName,
  }));
  process.exit(100);
} else {
  console.log(JSON.stringify({
    status: 'NO_TASK',
    stage: stageName,
    elapsedSinceReportMin: elapsedSinceReportMin.toFixed(1),
  }));
  process.exit(0);
}
