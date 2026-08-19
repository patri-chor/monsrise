// ============================================================
// T037 Phase-2 — 04_screen.ts
// 产品路径筛选核心逻辑（不含运行入口）
//
// 合约：每个有效候选/基线：
//   7 held-out families × 2 actual sides × 10 games = 140 cells
//
// 约束：
//   - PersistentSimPool → fine_grained_worker(product_path) → playFullGame → product_tree_strategy
//   - 无 arena/sandbox 路径，无 playSpecVsSpec，无 evaluateArena
//   - append-only 证据；atomic cursor
//   - 外部候选并发 <= 2（T038 约束；本 Phase-2 串行）
// ============================================================

import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Formation } from '../../../ai/types';
import type { EvolFormation, FeatureMask } from '../evol_gene';
import { cloneEvolFormation, formationToEvol, walkEvolNodes } from '../evol_gene';
import type { EvolNode } from '../evol_gene';
import { PersistentSimPool } from '../persistent_pool';
import type { MatchMetrics } from '../match_metrics';
import type { CandidateMetadata } from './02_candidates';
import { computeCandidateFingerprint } from './02_candidates';
import { validateCandidateLegality } from './03_validate';

export const T037_PROTOCOL = 'PRODUCT_PATH_T037_V1';
export const T037_SCHEDULE_ID = 't037-heldout-7x2x10-seed-v1';
export const T037_OUTPUT_DIR = resolve('tests/fixtures/tree/experience_library/product_path_t037');
export const GAMES_PER_CELL = 10;
export const HELD_OUT_FAMILIES = 7;
export const SIDES = 2;
export const CELLS_PER_ENTITY = HELD_OUT_FAMILIES * SIDES; // 14 cells × 10 games = 140 total
export const SEED_BASE = 37001;

// ---- 输出文件结构 ----

export interface T037Paths {
  manifestPath: string;
  sourcesPath: string;
  registryPath: string;
  rejectedPath: string;
  cellsPath: string;
  observationsPath: string;
  tracesPath: string;
  cursorPath: string;
  readmePath: string;
}

export function ensureOutputDir(outputDir: string): T037Paths {
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });
  return {
    manifestPath: join(outputDir, 'manifest.json'),
    sourcesPath: join(outputDir, 'sources.jsonl'),
    registryPath: join(outputDir, 'candidate_registry.jsonl'),
    rejectedPath: join(outputDir, 'rejected_candidates.jsonl'),
    cellsPath: join(outputDir, 'screen_cells.jsonl'),
    observationsPath: join(outputDir, 'screen_observations.jsonl'),
    tracesPath: join(outputDir, 'traces.jsonl'),
    cursorPath: join(outputDir, 'cursor.json'),
    readmePath: join(outputDir, 'README.md'),
  };
}

// ---- 记录类型 ----

/** 单个 opp×side×N_games cell 记录 */
export interface ScreenCell {
  protocol: string;
  scheduleId: string;
  manifestHash: string;
  // 实体
  entityId: string;
  entityKind: 'baseline' | 'candidate';
  entityFingerprint: string;
  parentFingerprint: string | null;
  operatorFamily: string;
  sourceId: string;
  // Cell 位置
  cellIndex: number;          // 0-based，0..13
  sourceSide: 1 | 2;
  opponentId: string;
  exactSeed: number;
  gamesPerCell: number;
  // 结果
  w: number;
  d: number;
  l: number;
  completed: boolean;
  error: string | null;
  // 证明
  nonemptyTeamProof: boolean;
  candidateDeploymentCount: number | null;
  opponentDeploymentCount: number | null;
  branchTraceLink: string | null;
  traceHash: string | null;
}

/** 单个实体的汇总观察 */
export interface ScreenObservation {
  protocol: string;
  scheduleId: string;
  manifestHash: string;
  entityId: string;
  entityKind: 'baseline' | 'candidate';
  entityFingerprint: string;
  parentFingerprint: string | null;
  operatorFamily: string;
  sourceId: string;
  totalCells: number;
  totalGames: number;
  w: number;
  d: number;
  l: number;
  workerErrors: number;
  trainingScore: number;
  sourceRelativeScore: number | null;
  completedAt: string;
}

// ---- cursor ----

export interface T037Cursor {
  protocol: string;
  scheduleId: string;
  manifestHash: string;
  completedEntityIds: string[];
  updatedAt: string;
}

export function loadCursor(cursorPath: string, manifestHash: string): T037Cursor {
  if (!existsSync(cursorPath)) {
    return {
      protocol: T037_PROTOCOL,
      scheduleId: T037_SCHEDULE_ID,
      manifestHash,
      completedEntityIds: [],
      updatedAt: new Date().toISOString(),
    };
  }
  const cursor: T037Cursor = JSON.parse(readFileSync(cursorPath, 'utf8'));
  if (cursor.protocol !== T037_PROTOCOL || cursor.manifestHash !== manifestHash) {
    throw new Error(`T037_CURSOR_MISMATCH: protocol=${cursor.protocol} hash=${cursor.manifestHash} expected=${manifestHash}`);
  }
  return cursor;
}

export function saveCursor(cursorPath: string, cursor: T037Cursor): void {
  cursor.updatedAt = new Date().toISOString();
  const tmp = `${cursorPath}.tmp`;
  writeFileSync(tmp, JSON.stringify(cursor, null, 2), 'utf8');
  renameSync(tmp, cursorPath);
}

export function appendJsonl(path: string, record: unknown): void {
  appendFileSync(path, JSON.stringify(record) + '\n', 'utf8');
}

export function writeAtomic(path: string, value: unknown): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  renameSync(tmp, path);
}

// ---- manifest hash ----

export function computeManifestHash(manifest: object): string {
  return createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
}

// ---- 候选批次生成（确定性、无仿真） ----

export interface CandidateEntry {
  meta: CandidateMetadata;
  evol: EvolFormation;
}

/**
 * 生成 T037 Phase-2 确定性候选批次（每个可执行源）：
 * - 1 × baseline
 * - 1 × spatial_local（移动第一个可控放置坐标）
 * - 1 × formation_transform（全局平移 +1 或 -1，合法时）
 * - 1 × strategy_schedule_branch（元数据记录，Phase-2 合法拒绝）
 */
export function generateCandidateBatch(sources: Formation[]): CandidateEntry[] {
  const result: CandidateEntry[] = [];
  const seenFps = new Set<string>();

  for (const src of sources) {
    if ((src as any).isLegacyBaseline) continue;
    const evol = formationToEvol(src);
    const srcFp = (src as any).fingerprint ?? computeCandidateFingerprint(evol);
    const srcId = (src as any).id;
    const srcName = (src as any).name ?? srcId;

    // 基线
    const baselineFp = computeCandidateFingerprint(evol);
    if (!seenFps.has(baselineFp)) seenFps.add(baselineFp);
    result.push({
      meta: {
        candidateId: `baseline:${srcId}`,
        sourceId: srcId,
        sourceName: srcName,
        sourceFingerprint: srcFp,
        parentCandidateId: null,
        operatorFamily: 'baseline',
        delta: null,
        canonicalFingerprint: baselineFp,
        rejected: false,
        rejectionReason: null,
        createdAt: new Date().toISOString(),
      },
      evol,
    });

    // spatial_local
    const spatialEntry = buildSpatialLocalEntry(evol, srcId, srcName, srcFp, seenFps);
    result.push(spatialEntry);

    // formation_transform
    const transformEntry = buildFormationTransformEntry(evol, srcId, srcName, srcFp, seenFps);
    result.push(transformEntry);

    // strategy_schedule_branch（Phase-2 合法拒绝）
    result.push({
      meta: {
        candidateId: `cand:${srcId}:strategy_schedule_branch:0`,
        sourceId: srcId,
        sourceName: srcName,
        sourceFingerprint: srcFp,
        parentCandidateId: null,
        operatorFamily: 'strategy_schedule_branch',
        delta: {
          operatorFamily: 'strategy_schedule_branch',
          rounds: [2],
          hasR1Branch: false,
          hasR2PlusBranch: true,
          description: 'R2 fullrush branch variant deferred to T038; Phase-2 records metadata only',
        },
        canonicalFingerprint: baselineFp, // same as baseline → no-op
        rejected: true,
        rejectionReason: 'DEFERRED_TO_T038: strategy_schedule_branch tree mutation belongs to adaptive loop',
        createdAt: new Date().toISOString(),
      },
      evol,
    });
  }

  return result;
}

function buildSpatialLocalEntry(
  evol: EvolFormation, srcId: string, srcName: string, srcFp: string, seenFps: Set<string>,
): CandidateEntry {
  const clone = cloneEvolFormation(evol);
  let moved = false;
  let movedNodeId = '';
  let movedMonsterId = 0;
  let fromX = 0, fromY = 0, toX = 0, toY = 0;

  outer: for (const node of walkEvolNodes(clone.root)) {
    if (node.round === 0 && clone.root.children.length > 0) continue; // 跳过虚根节点
    for (const p of node.placements) {
      // 尝试 x+1（不超 10，不冲突）
      const tryX = p.x < 10 ? p.x + 1 : p.x > 6 ? p.x - 1 : -1;
      if (tryX < 0) continue;
      const collision = node.placements.some(other => other !== p && other.x === tryX && other.y === p.y);
      if (!collision) {
        movedNodeId = node.id;
        movedMonsterId = p.monsterId;
        fromX = p.x; fromY = p.y;
        p.x = tryX;
        toX = tryX; toY = p.y;
        moved = true;
        break outer;
      }
    }
  }

  const fp = computeCandidateFingerprint(clone);
  const baseFp = computeCandidateFingerprint(evol);
  const isNoOp = fp === baseFp || !moved;
  const valid = moved && !isNoOp;
  const duplicate = valid && seenFps.has(fp);
  const rejected = !valid || duplicate;

  if (!rejected) seenFps.add(fp);

  const validation = valid ? validateCandidateLegality(clone) : { valid: false, reasons: ['SPATIAL_NO_MOVABLE_PLACEMENT'] };

  return {
    meta: {
      candidateId: `cand:${srcId}:spatial_local:0`,
      sourceId: srcId,
      sourceName: srcName,
      sourceFingerprint: srcFp,
      parentCandidateId: null,
      operatorFamily: 'spatial_local',
      delta: moved ? { operatorFamily: 'spatial_local', nodeId: movedNodeId, monsterId: movedMonsterId, fromX, fromY, toX, toY } : null,
      canonicalFingerprint: fp,
      rejected: rejected || !validation.valid,
      rejectionReason: !moved ? 'SPATIAL_NO_MOVABLE_PLACEMENT' : isNoOp ? 'NO_OP' : duplicate ? 'DUPLICATE_FINGERPRINT' : !validation.valid ? validation.reasons.join('; ') : null,
      createdAt: new Date().toISOString(),
    },
    evol: rejected || !validation.valid ? evol : clone,
  };
}

function buildFormationTransformEntry(
  evol: EvolFormation, srcId: string, srcName: string, srcFp: string, seenFps: Set<string>,
): CandidateEntry {
  const clone = cloneEvolFormation(evol);
  const allPlacements: Array<{ node: EvolNode; p: any }> = [];
  for (const node of walkEvolNodes(clone.root)) {
    for (const p of node.placements) allPlacements.push({ node, p });
  }

  // 水平平移 +1（全部 placements 可移时）
  const allCanPlus1 = allPlacements.every(({ p }) => p.x + 1 <= 10);
  const allCanMinus1 = allPlacements.every(({ p }) => p.x - 1 >= 6);
  const canTranslate = allCanPlus1 || allCanMinus1;
  const dx = allCanPlus1 ? 1 : allCanMinus1 ? -1 : 0;

  if (canTranslate && allPlacements.length > 0) {
    for (const { p } of allPlacements) p.x += dx;
  }

  const fp = computeCandidateFingerprint(clone);
  const baseFp = computeCandidateFingerprint(evol);
  const isNoOp = !canTranslate || fp === baseFp || allPlacements.length === 0;
  const duplicate = !isNoOp && seenFps.has(fp);
  const rejected = isNoOp || duplicate;

  if (!rejected) seenFps.add(fp);

  const validation = !rejected ? validateCandidateLegality(clone) : { valid: false, reasons: ['TRANSFORM_NOOP_OR_DUPLICATE'] };

  return {
    meta: {
      candidateId: `cand:${srcId}:formation_transform:0`,
      sourceId: srcId,
      sourceName: srcName,
      sourceFingerprint: srcFp,
      parentCandidateId: null,
      operatorFamily: 'formation_transform',
      delta: canTranslate ? {
        operatorFamily: 'formation_transform',
        transformKind: 'translate',
        affectedNodeIds: [...new Set(allPlacements.map(({ node }) => node.id))],
        coordinateMapping: allPlacements.map(({ node, p }) => ({ nodeId: node.id, monsterId: p.monsterId, fromX: p.x - dx, fromY: p.y, toX: p.x, toY: p.y })),
        calculatorControlledExceptions: [],
        isNoOp: isNoOp,
      } : null,
      canonicalFingerprint: fp,
      rejected: rejected || !validation.valid,
      rejectionReason: !canTranslate || allPlacements.length === 0 ? 'TRANSFORM_NO_UNIFORM_DIRECTION' : isNoOp ? 'TRANSFORM_NOOP' : duplicate ? 'DUPLICATE_FINGERPRINT' : !validation.valid ? validation.reasons.join('; ') : null,
      createdAt: new Date().toISOString(),
    },
    evol: rejected || !validation.valid ? evol : clone,
  };
}

// ---- 单个实体筛选（使用真实 pool API） ----

export async function screenEntity(opts: {
  pool: PersistentSimPool;
  entry: CandidateEntry;
  heldOutOpps: Formation[];
  manifestHash: string;
  paths: T037Paths;
}): Promise<ScreenObservation> {
  const { pool, entry, heldOutOpps, manifestHash, paths } = opts;
  const { meta, evol } = entry;
  const emptyMask: FeatureMask = { side: null, main: null, subs: [], keys: [] };

  let totalW = 0, totalD = 0, totalL = 0, totalErrors = 0;
  let cellIndex = 0;

  for (const opp of heldOutOpps) {
    for (const side of [1, 2] as (1 | 2)[]) {
      const exactSeed = SEED_BASE + cellIndex * 100;
      // 使用真实 pool API: evalCandidateBatchOnMatchedParallel，单个 candidate，单个对手
      const sideOnlyMask: FeatureMask = { ...emptyMask, side };
      const metrics: MatchMetrics[] = await pool.evalCandidateBatchOnMatchedParallel(
        [evol],
        sideOnlyMask,
        [opp],
        GAMES_PER_CELL,
        exactSeed,
        'product_path',
      );
      const m = metrics[0];
      const hasError = (m?.workerErrorCount ?? 0) > 0;
      if (hasError) totalErrors++;

      const cell: ScreenCell = {
        protocol: T037_PROTOCOL,
        scheduleId: T037_SCHEDULE_ID,
        manifestHash,
        entityId: meta.candidateId,
        entityKind: meta.operatorFamily === 'baseline' ? 'baseline' : 'candidate',
        entityFingerprint: meta.canonicalFingerprint ?? '',
        parentFingerprint: meta.parentCandidateId,
        operatorFamily: meta.operatorFamily,
        sourceId: meta.sourceId,
        cellIndex,
        sourceSide: side,
        opponentId: (opp as any).id ?? (opp as any).name,
        exactSeed,
        gamesPerCell: GAMES_PER_CELL,
        w: m?.win ?? 0,
        d: m?.draw ?? 0,
        l: m?.loss ?? 0,
        completed: !hasError,
        error: hasError ? (m?.workerErrors?.[0] ?? 'WORKER_ERROR') : null,
        nonemptyTeamProof: evol.team.length === 8,
        candidateDeploymentCount: null,
        opponentDeploymentCount: null,
        branchTraceLink: null,
        traceHash: null,
      };
      appendJsonl(paths.cellsPath, cell);

      totalW += m?.win ?? 0;
      totalD += m?.draw ?? 0;
      totalL += m?.loss ?? 0;
      cellIndex++;
    }
  }

  const totalCells = heldOutOpps.length * SIDES;
  const totalGames = totalCells * GAMES_PER_CELL;
  const trainingScore = totalGames > 0 ? (totalW + 0.5 * totalD) / totalGames : 0;

  const obs: ScreenObservation = {
    protocol: T037_PROTOCOL,
    scheduleId: T037_SCHEDULE_ID,
    manifestHash,
    entityId: meta.candidateId,
    entityKind: meta.operatorFamily === 'baseline' ? 'baseline' : 'candidate',
    entityFingerprint: meta.canonicalFingerprint ?? '',
    parentFingerprint: meta.parentCandidateId,
    operatorFamily: meta.operatorFamily,
    sourceId: meta.sourceId,
    totalCells,
    totalGames,
    w: totalW,
    d: totalD,
    l: totalL,
    workerErrors: totalErrors,
    trainingScore,
    sourceRelativeScore: null,
    completedAt: new Date().toISOString(),
  };
  appendJsonl(paths.observationsPath, obs);
  return obs;
}
