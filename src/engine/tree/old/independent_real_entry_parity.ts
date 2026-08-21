// ============================================================
// T031 —— 真实入口独立 parity 门禁（Repair T029 False Independent-Entry Parity）
//
// 修复要点（对照 T031 规范）：
//  A. 权威制品身份 = 显式不可变绝对路径，绝不使用 cwd 相对路径；缺/错即 Fail-Closed。
//  B. 真实侧 = 产品自有公开入口 playFullGame（经 src/engine/real_application_entry.ts
//     适配，无任何 tree 传递依赖）；树侧 = playSpecVsSpec（Tree Runner 沙盒）。
//  C. 规范轨迹全字段逐位比较（side/阵型身份/分支/观察/计划坐标/尝试序/实际坐标/
//     接受拒绝+原因/预算前-扣费-后/回合分/最终 W/D/L），输出首字段差异诊断。
//  D. 负例控制：权威制品路径覆盖/缺失/错配 + 分歧 cwd bundle；引用禁止 tree 符号的
//     适配器；注入分支/坐标/尝试序/接受原因/预算差异；side 传播证据；
//     故意委托 tree 代码的“真实适配器”在比较前即被拒绝。
//
// 本文件不得修改任务规范。禁止 apply/deploy/优化运行。
// ============================================================

import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname, isAbsolute, normalize, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

import { playSpecVsSpec, type SideSpec, type DeploymentTraceEvent, type BranchDecision } from './arena';
import { formationToEvol } from './evol_gene';
import type { Formation } from '../../ai/types';
import type { CanonicalGameTrace, CanonicalMismatch } from '../canonical_trace';
import { compareCanonicalTraces } from '../canonical_trace';
import { executeRealApplicationEntry } from '../real_application_entry';

// 真实侧入口由独立模块 src/engine/real_application_entry.ts 提供（与树侧分离），
// 在此 re-export 供门禁与测试使用。
export { executeRealApplicationEntry } from '../real_application_entry';
export type { CanonicalGameTrace, CanonicalMismatch, CanonicalDeployment, CanonicalBranch, CanonicalObservation } from '../canonical_trace';

// ============================================================
// A. 权威制品身份（显式不可变绝对路径）
// ============================================================

/**
 * 权威真实应用构建产物。显式绝对路径，为「权威制品身份」的唯一来源，
 * 绝不从执行器 cwd 推导（cwd 相对路径被禁止）。
 * 该产物由真实应用构建生成；其来源提交见 getAuthorityArtifactManifest().runnerCommit。
 */
export const AUTHORITY_ARTIFACT_ABSOLUTE_PATH = 'D:\\develope\\monsrise1\\public\\ai-bundle.iife.js';

/** 禁止真实侧适配器引用/导入的 tree 符号（T031 B.2） */
export const PROHIBITED_TREE_SYMBOLS = ['playSpecVsSpec', 'PersistentSimPool', 'fine_grained_worker'] as const;
/** 禁止真实侧适配器 import 的路径标记 */
export const PROHIBITED_PATH_MARKERS = ['engine/tree/arena', '/tree/', 'src/engine/tree'] as const;

export interface AuthorityArtifactManifest {
  authorityBundleAbsoluteSource: string;
  authorityBundleSHA256: string;
  authorityBundleSize: number;
  /** 权威身份是否来自不可变绝对路径（恒 true；cwd 相对路径被禁止） */
  isAuthorityImmutable: boolean;
  /** 权威身份是否经过 cwd 相对解析（恒 false，证明与执行器 cwd 无关） */
  authorityResolvedFromCwd: boolean;
  isArtifactProvenanceValid: boolean;
  nodeRuntimeVersion: string;
  runnerCommit: string;
  checkTimestamp: string;
}

export class ArtifactProvenanceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArtifactProvenanceError';
  }
}

export class RealAdapterNotIndependentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RealAdapterNotIndependentError';
  }
}

function fileHash(p: string): string {
  if (!existsSync(p)) return 'FILE_NOT_FOUND';
  return createHash('sha256').update(readFileSync(p)).digest('hex');
}

function fileSize(p: string): number {
  try {
    return existsSync(p) ? statSync(p).size : -1;
  } catch {
    return -1;
  }
}

function gitHead(): string {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return 'N/A';
  }
}

/**
 * 读取权威制品清单（身份 = 绝对路径常量）。返回的清单在 worker/模拟启动前被记录，
 * 供报告取证；权威身份与执行器 cwd 完全解耦。
 */
export function getAuthorityArtifactManifest(): AuthorityArtifactManifest {
  const authPath = AUTHORITY_ARTIFACT_ABSOLUTE_PATH;
  const authHash = fileHash(authPath);
  return {
    authorityBundleAbsoluteSource: authPath,
    authorityBundleSHA256: authHash,
    authorityBundleSize: fileSize(authPath),
    isAuthorityImmutable: true,
    authorityResolvedFromCwd: false,
    isArtifactProvenanceValid: authHash !== 'FILE_NOT_FOUND',
    nodeRuntimeVersion: process.version,
    runnerCommit: gitHead(),
    checkTimestamp: new Date().toISOString(),
  };
}

/**
 * 模拟前的权威制品门禁：记录权威路径+SHA，要求 Runner 加载路径绝对且哈希与权威一致；
 * 缺/错/相对一律 Fail-Closed 抛错。返回已记录 { path, sha256 }。
 */
export function assertAuthorityArtifact(runnerBundleAbsPath?: string): { path: string; sha256: string } {
  const manifest = getAuthorityArtifactManifest();
  const authHash = manifest.authorityBundleSHA256;
  if (authHash === 'FILE_NOT_FOUND') {
    throw new ArtifactProvenanceError(`权威制品缺失: ${AUTHORITY_ARTIFACT_ABSOLUTE_PATH}`);
  }
  const target = runnerBundleAbsPath ?? AUTHORITY_ARTIFACT_ABSOLUTE_PATH;
  if (!isAbsolute(target)) {
    throw new ArtifactProvenanceError(`Runner 制品路径必须为绝对路径，收到相对路径: ${target}`);
  }
  const targetHash = fileHash(target);
  if (targetHash === 'FILE_NOT_FOUND') {
    throw new ArtifactProvenanceError(`Runner 制品缺失: ${target}`);
  }
  if (targetHash !== authHash) {
    throw new ArtifactProvenanceError(
      `Runner 制品与权威制品哈希不匹配 (fail-closed): ${target}\n  runner sha256=${targetHash}\n  authority sha256=${authHash}`,
    );
  }
  return { path: target, sha256: targetHash };
}

// ============================================================
// B. 真实侧适配器静态独立性门禁
// ============================================================

function normalizeSlashes(p: string): string {
  return p.split(sep).join('/');
}

function resolveImportTarget(fromFileAbs: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null; // 裸/包导入跳过
  const base = normalizeSlashes(normalize(resolve(dirname(fromFileAbs), spec)));
  return base;
}

function extractImportSpecifiers(source: string): string[] {
  const specs: string[] = [];
  const re = /(?:import\s+[^'"]+?\s+from\s+|import\s*\(|require\s*\()\s*['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    specs.push(m[1]);
  }
  return specs;
}

/** 剥离行注释与块注释，仅保留真实代码（避免把注释/文档字符串误判为代码引用） */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n\r]*/g, ' ');
}

/**
 * 扫描任意适配器源码/源字符串，若真实代码引用禁止的 tree 符号或导入 tree 路径则抛
 * RealAdapterNotIndependentError（在比较之前被拒绝）。
 */
export function validateRealAdapterSource(source: string, label = 'adapter'): void {
  const code = stripComments(source);
  for (const sym of PROHIBITED_TREE_SYMBOLS) {
    if (code.includes(sym)) {
      throw new RealAdapterNotIndependentError(`真实侧适配器引用了禁止的 tree 符号「${sym}」 (${label})`);
    }
  }
  for (const marker of PROHIBITED_PATH_MARKERS) {
    if (code.includes(marker)) {
      throw new RealAdapterNotIndependentError(`真实侧适配器引用了禁止的 tree 路径标记「${marker}」 (${label})`);
    }
  }
}

export interface RealAdapterAudit {
  realAdapterFile: string;
  invokesPlayFullGame: boolean;
  scannedFiles: string[];
  prohibitedReferences: string[];
  prohibitedImportTargets: string[];
  clean: boolean;
}

/**
 * 审计真实侧适配器文件 + 其直接传递依赖（canonical_trace.ts、play_full_game.ts
 * 及其直接 import）均不引用/导入 tree 代码；并确认产品入口 playFullGame 被真实调用。
 */
export function auditRealAdapter(realAdapterRelPath = 'src/engine/real_application_entry.ts'): RealAdapterAudit {
  const realAdapterAbs = resolve(realAdapterRelPath);
  const adapterSource = readFileSync(realAdapterAbs, 'utf8');
  const adapterCode = stripComments(adapterSource);

  const prohibitedReferences: string[] = [];
  for (const sym of PROHIBITED_TREE_SYMBOLS) {
    if (adapterCode.includes(sym)) prohibitedReferences.push(sym);
  }
  for (const marker of PROHIBITED_PATH_MARKERS) {
    if (adapterCode.includes(marker)) prohibitedReferences.push(marker);
  }

  const invokesPlayFullGame = /\bplayFullGame\s*\(/.test(adapterCode) && /from\s+['"].*play_full_game['"]/.test(adapterSource);

  // 收集传递文件：适配器 + canonical_trace + play_full_game 及其直接 import
  const scannedFiles = [realAdapterAbs, resolve('src/engine/canonical_trace.ts'), resolve('src/engine/play_full_game.ts')];
  const prohibitedImportTargets: string[] = [];
  const queue = [...scannedFiles];
  const visited = new Set<string>();
  while (queue.length > 0) {
    const f = queue.pop()!;
    if (visited.has(f)) continue;
    if (!existsSync(f)) continue;
    visited.add(f);
    const src = readFileSync(f, 'utf8');
    const code = stripComments(src);
    // 该文件真实代码引用禁止符号？
    for (const sym of PROHIBITED_TREE_SYMBOLS) {
      if (code.includes(sym)) {
        const rel = normalizeSlashes(f).replace(normalizeSlashes(process.cwd()) + '/', '');
        if (!prohibitedReferences.includes(`${sym} (${rel})`)) prohibitedReferences.push(`${sym} (${rel})`);
      }
    }
    for (const spec of extractImportSpecifiers(src)) {
      const targetAbs = resolveImportTarget(f, spec);
      if (!targetAbs) continue;
      const norm = normalizeSlashes(targetAbs);
      const isTreePath = PROHIBITED_PATH_MARKERS.some(m => norm.includes(m));
      if (isTreePath) {
        prohibitedImportTargets.push(norm);
      } else if (norm.endsWith('.ts') || norm.endsWith('.js')) {
        queue.push(targetAbs); // 追踪传递导入
      }
    }
  }

  const clean = invokesPlayFullGame && prohibitedReferences.length === 0 && prohibitedImportTargets.length === 0;
  return {
    realAdapterFile: normalizeSlashes(realAdapterAbs),
    invokesPlayFullGame,
    scannedFiles: scannedFiles.map(f => normalizeSlashes(f)),
    prohibitedReferences,
    prohibitedImportTargets,
    clean,
  };
}

/** 比较前的强制门禁：真实侧适配器必须干净且调用产品入口，否则拒绝执行比较。 */
export function assertRealAdapterIndependent(): RealAdapterAudit {
  const audit = auditRealAdapter();
  if (!audit.clean) {
    const reasons = [
      ...(audit.invokesPlayFullGame ? [] : ['未调用产品入口 playFullGame']),
      ...audit.prohibitedReferences.map(r => `引用禁止符号: ${r}`),
      ...audit.prohibitedImportTargets.map(t => `导入禁止 tree 路径: ${t}`),
    ];
    throw new RealAdapterNotIndependentError(`真实侧适配器独立性校验失败: ${reasons.join('; ')}`);
  }
  return audit;
}

// ============================================================
// Tree Runner 沙盒侧（允许使用 tree 代码）
// ============================================================

let cachedBundleAI: any = null;

function getBundleAI(): any {
  // 模拟前先记录权威路径+SHA 并 fail-closed（缺/错不加载）
  assertAuthorityArtifact();
  if (cachedBundleAI) return cachedBundleAI;
  const code = readFileSync(AUTHORITY_ARTIFACT_ABSOLUTE_PATH, 'utf8');
  const factory = new Function('window', 'globalThis', '"use strict";\n' + code + '\n;return BattleAI;');
  const w = globalThis as any;
  const b = factory(w, w);
  cachedBundleAI = b?.BattleAI ?? w.BattleAI;
  return cachedBundleAI;
}

/**
 * Tree Runner 沙盒入口：加载权威 bundle 的 BattleAI，经 playSpecVsSpec 执行，
 * 改编为规范轨迹（含分支选择、观察、部署事件）。
 */
export function executeTreeRunnerEntry(
  formationA: Formation,
  formationB: Formation,
  side: 1 | 2,
  seed: number,
): CanonicalGameTrace {
  const BundleAI = getBundleAI();
  const specA: SideSpec = { kind: 'evol', f: formationToEvol(formationA) };
  const specB: SideSpec = { kind: 'native', f: formationB };
  const res = playSpecVsSpec(BundleAI, specA, specB, side, seed, undefined, true);

  const branches = res.decisions.map((d: BranchDecision) => ({ round: d.round, chosenNodeId: d.chosenBranchId }));
  const observations = res.observations.map(o => ({
    round: o.round,
    side: o.side,
    handIds: o.handIds,
    handBadges: o.handBadges,
    boardIds: o.boardIds,
  }));
  const deployments = (res.deploymentTraces ?? []).map((t: DeploymentTraceEvent) => ({
    round: t.round,
    side: t.side,
    sourceSide: side,
    monsterId: t.monsterId,
    attemptOrder: t.attemptOrder,
    plannedX: t.plannedX,
    plannedY: t.plannedY,
    actualX: t.actualX,
    actualY: t.actualY,
    accepted: t.accepted,
    rejectionReason: t.rejectionReason,
    budgetBefore: t.budgetBefore,
    costCharged: t.costCharged,
    budgetAfter: t.budgetAfter,
  }));

  return {
    sourceId: formationA.id ?? formationA.name,
    sourceName: formationA.name,
    opponentId: formationB.id ?? formationB.name,
    opponentName: formationB.name,
    side,
    seed,
    finalW: res.w,
    finalD: res.d,
    finalL: res.l,
    roundScores: res.roundScores,
    branches,
    observations,
    deployments,
  };
}

// ============================================================
// C. 矩阵比较（真实侧 vs 树侧，双侧+固定种子）
// ============================================================

export interface ParityComparisonDetail {
  sourceId: string;
  sourceName: string;
  opponentId: string;
  opponentName: string;
  side: 1 | 2;
  seed: number;
  realFinal: string; // W/D/L（源视角）
  treeFinal: string; // W/D/L（源视角）
  realDeployments: number;
  treeDeployments: number;
  identical: boolean;
  firstMismatch?: CanonicalMismatch;
}

export interface ParityResult {
  allPassed: boolean;
  totalComparisons: number;
  identicalCount: number;
  details: ParityComparisonDetail[];
}

/**
 * 全矩阵独立 parity：10 源 × 3 对手 × 实际侧 1/2 × 固定种子。
 * 真实侧 = executeRealApplicationEntry（playFullGame），树侧 = executeTreeRunnerEntry。
 * 每条案例做全字段规范轨迹比较并输出首字段差异；identical 绝不为常量。
 */
export function compareIndependentBehaviorParity(
  sources: Formation[],
  opponents: Formation[],
): ParityResult {
  // 比较前强制独立：真实侧适配器不干净则整体拒绝（负例 D.5）
  assertRealAdapterIndependent();

  const details: ParityComparisonDetail[] = [];
  let idx = 0;
  for (const s of sources) {
    for (const opp of opponents) {
      for (const side of [1, 2] as (1 | 2)[]) {
        const seed = 54321 + idx; // 每案例固定确定性种子
        const real = executeRealApplicationEntry(s, opp, side, seed);
        const tree = executeTreeRunnerEntry(s, opp, side, seed);
        const cmp = compareCanonicalTraces(real, tree);
        details.push({
          sourceId: s.id ?? s.name,
          sourceName: s.name,
          opponentId: opp.id ?? opp.name,
          opponentName: opp.name,
          side,
          seed,
          realFinal: `${real.finalW}/${real.finalD}/${real.finalL}`,
          treeFinal: `${tree.finalW}/${tree.finalD}/${tree.finalL}`,
          realDeployments: real.deployments.length,
          treeDeployments: tree.deployments.length,
          identical: cmp.identical,
          firstMismatch: cmp.firstMismatch,
        });
        idx++;
      }
    }
  }

  const identicalCount = details.filter(d => d.identical).length;
  return {
    allPassed: details.length > 0 && details.every(d => d.identical),
    totalComparisons: details.length,
    identicalCount,
    details,
  };
}
