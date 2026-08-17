#!/usr/bin/env node
/**
 * Domain-aware taskrunner heartbeat.
 * Polls each decision domain and persists activation requests for the matching
 * agent session. It does not pull/rebase or execute task code in a dirty tree.
 */
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const repoRoot = resolve('.');
const domains = ['tree', 'generation'];
const statePath = join(repoRoot, '.taskrunner-activation.json');
const logPath = join(repoRoot, 'TASKS', 'taskrunner.log');
const checkScript = join(repoRoot, 'scripts', 'check-open-tasks.mjs');
const force = process.argv.includes('--force');

function loadState() {
  if (!existsSync(statePath)) return { activated: {}, lastRun: null };
  try {
    const value = JSON.parse(readFileSync(statePath, 'utf8'));
    return { activated: value.activated ?? {}, lastRun: value.lastRun ?? null };
  } catch {
    return { activated: {}, lastRun: null };
  }
}

function saveState(state) {
  writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n', 'utf8');
}

function log(message) {
  const line = `${new Date().toISOString()} ${message}\n`;
  appendFileSync(logPath, line, 'utf8');
  process.stdout.write(line);
}

function runCheck(domain) {
  return new Promise((resolveCheck) => {
    const args = [checkScript, `--domain=${domain}`];
    if (force) args.push('--force');
    const child = spawn(process.execPath, args, { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => resolveCheck({ error: error.message }));
    child.on('close', (code) => {
      let payload = null;
      try { payload = JSON.parse(stdout.trim().split(/\r?\n/).pop() ?? ''); } catch {}
      resolveCheck({ code, payload, stderr: stderr.trim() });
    });
  });
}

const state = loadState();
state.lastRun = new Date().toISOString();
for (const domain of domains) {
  const result = await runCheck(domain);
  if (result.error) {
    log(`[${domain}] check error: ${result.error}`);
    continue;
  }
  if (result.stderr) log(`[${domain}] stderr: ${result.stderr}`);
  const task = result.payload;
  if (!task || task.status !== 'TASK_FOUND') {
    log(`[${domain}] ${task?.status ?? 'CHECK_FAILED'}`);
    continue;
  }

  const identity = `${domain}/${task.taskId}/${task.reportFile}`;
  const previous = state.activated[identity];
  if (previous?.status === 'ACTIVE' || previous?.status === 'ACKNOWLEDGED') {
    log(`[${domain}] already activated ${identity}`);
    continue;
  }

  state.activated[identity] = {
    status: 'ACTIVE',
    domain,
    taskId: task.taskId,
    taskFile: task.taskFile,
    reportFile: task.reportFile,
    title: task.title,
    activatedAt: new Date().toISOString(),
    instruction: `Activate ${domain} decision session for ${task.taskFile}; read only TASKS/${domain}/ and produce ${task.reportFile}.`,
  };
  log(`[${domain}] ACTIVATED ${identity}`);
}
saveState(state);
