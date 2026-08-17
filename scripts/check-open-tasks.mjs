import { existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';

const repoRoot = resolve('.');
const tasksDir = join(repoRoot, 'TASKS');

// 解析 CLI 参数
const args = process.argv.slice(2);
const domainArgIndex = args.indexOf('--domain');
const targetDomain = domainArgIndex !== -1 ? args[domainArgIndex + 1] : null;
const isMarkReport = args.includes('--report-submitted');
const isManualForce = args.includes('--force');

const stateFile = join(repoRoot, targetDomain ? `.task-poll-state-${targetDomain}.json` : '.task-poll-state.json');

function loadState() {
  if (existsSync(stateFile)) {
    try {
      return JSON.parse(readFileSync(stateFile, 'utf8'));
    } catch {
      return { lastCheckTime: 0, lastReportTime: 0 };
    }
  }
  return { lastCheckTime: 0, lastReportTime: 0 };
}

function saveState(st) {
  try {
    writeFileSync(stateFile, JSON.stringify(st, null, 2), 'utf8');
  } catch {}
}

const now = Date.now();
const state = loadState();

// 标记刚提交完报告
if (isMarkReport) {
  state.lastReportTime = now;
  state.lastCheckTime = now;
  saveState(state);
  console.log(JSON.stringify({ status: 'REPORT_MARKED', domain: targetDomain || 'all', lastReportTime: now }));
  process.exit(0);
}

// ============================================================
// 1. 同步远程：无论处于何种退避阶段，每次调起必须先 Fetch 远程！
// ============================================================
let remoteUpdated = false;
if (existsSync(join(repoRoot, '.git'))) {
  try {
    const proxyArgs = ['-c', 'http.proxy=http://127.0.0.1:7890'];
    const branchName = targetDomain ? `agent/${targetDomain}` : 'main';
    const prevHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    
    // fetch 远程目标分支
    execFileSync('git', [...proxyArgs, 'fetch', 'origin', branchName], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'ignore', 'ignore'],
      timeout: 15000,
    });

    // 尝试 fast-forward merge
    try {
      execFileSync('git', ['merge', '--ff-only', 'FETCH_HEAD'], {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'ignore', 'ignore'],
        timeout: 5000,
      });
    } catch {}

    const newHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (newHead !== prevHead) {
      remoteUpdated = true;
      // 远程有新 commit，重置退避计时器回高频模式
      state.lastReportTime = now;
    }
  } catch {
    // 离线/内网环境允许 fetch 失败，降级为本地任务检查
  }
}

// 记录本次实际执行检查的时间
state.lastCheckTime = now;
saveState(state);

// 计算当前应遵循的检查阶段
const elapsedSinceReportMs = now - (state.lastReportTime || now);
const elapsedSinceReportMin = elapsedSinceReportMs / 60000;
let stageName = 'high (1 min)';
if (elapsedSinceReportMin > 30) {
  stageName = 'low (30 min)';
} else if (elapsedSinceReportMin > 5) {
  stageName = 'medium (5 min)';
}

if (!existsSync(tasksDir)) {
  console.log(JSON.stringify({ status: 'NO_TASK', reason: 'TASKS directory not found', stage: stageName }));
  process.exit(0);
}

// ============================================================
// 2. 扫描指定/所有域目录 (tree, generation 等)
// ============================================================
function findTasksInDir(dir, domain = 'root') {
  if (!existsSync(dir)) return [];
  const entries = readdirSync(dir, { withFileTypes: true });
  const tasks = [];
  
  const files = entries.filter(e => e.isFile()).map(e => e.name);
  const taskFiles = files.filter(f => /^T\d+.*\.md$/i.test(f) && !f.endsWith('.report.md') && !f.endsWith('.closed.md') && f !== 'T000-template.md');

  for (const file of taskFiles) {
    const fullPath = join(dir, file);
    const content = readFileSync(fullPath, 'utf8');
    const firstLine = content.split('\n')[0]?.trim() ?? '';
    const isOpen = /^STATUS:\s*OPEN/i.test(firstLine) || /^STATUS:\s*OPEN/im.test(content.slice(0, 200));
    if (!isOpen) continue;

    const taskId = file.match(/^(T\d+)/i)?.[1];
    if (!taskId) continue;

    const reportFile = files.find(f => f.startsWith(taskId) && f.endsWith('.report.md'));
    if (reportFile) {
      const reportContent = readFileSync(join(dir, reportFile), 'utf8');
      const isSubmitted = /^STATUS:\s*(DONE|PARTIAL)/im.test(reportContent.slice(0, 200));
      if (isSubmitted) continue;
    }

    const relTaskPath = domain === 'root' ? `TASKS/${file}` : `TASKS/${domain}/${file}`;
    const relReportPath = domain === 'root' ? `TASKS/${taskId}.report.md` : `TASKS/${domain}/${taskId}.report.md`;

    tasks.push({
      taskId,
      num: parseInt(taskId.slice(1), 10),
      file: relTaskPath,
      reportFile: relReportPath,
      domain,
      title: content.split('\n').find(l => l.startsWith('# '))?.replace('# ', '').trim() ?? file,
    });
  }
  return tasks;
}

let allOpenTasks = [];

if (targetDomain) {
  const domainDir = join(tasksDir, targetDomain);
  allOpenTasks = findTasksInDir(domainDir, targetDomain);
} else {
  allOpenTasks.push(...findTasksInDir(tasksDir, 'root'));
  const domainDirs = ['tree', 'generation'];
  for (const d of domainDirs) {
    allOpenTasks.push(...findTasksInDir(join(tasksDir, d), d));
  }
}

if (allOpenTasks.length === 0) {
  console.log(JSON.stringify({
    status: 'NO_TASK',
    stage: stageName,
    elapsedSinceReportMin: elapsedSinceReportMin.toFixed(1),
    remoteUpdated,
  }));
  process.exit(0);
}

// 按编号升序排序，取最高编号任务（最新 OPEN）
allOpenTasks.sort((a, b) => a.num - b.num);
const currentTask = allOpenTasks[allOpenTasks.length - 1];

console.log(JSON.stringify({
  status: 'TASK_FOUND',
  taskId: currentTask.taskId,
  domain: currentTask.domain,
  taskFile: currentTask.file,
  reportFile: currentTask.reportFile,
  title: currentTask.title,
  stage: stageName,
  remoteUpdated,
}));

process.exit(100);
