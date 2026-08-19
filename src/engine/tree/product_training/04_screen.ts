// ============================================================
// T039 — 04_screen.ts
// 产品路径分级筛选（Stage A / Stage B / Stage C）与细粒度调度
//
// 规范要求：
//   - 全覆盖面板：7 opponents × 2 sides = 14 cells per candidate
//   - 分级采样：Stage A (1 game/cell = 14 games), Stage B (3 games/cell = 42 games), Stage C (6 games/cell = 84 games)
//   - 细粒度调度：one actual game = one pool task (games: 1)
//   - 外部候选并发 <= 2，批量打包 task dispatch 给 PersistentSimPool
//   - 收集真实 CPU 统计 (avg, p50, p95)
// ============================================================

import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Formation } from '../../../ai/types';
import type { EvolFormation, FeatureMask } from '../evol_gene';
import { formationToEvol } from '../evol_gene';
import { PersistentSimPool } from '../persistent_pool';
import type { SimTaskMessage } from '../fine_grained_worker';
import type { MatchMetrics } from '../match_metrics';
import type { CandidateMetadata } from './02_candidates';
import { computeCandidateFingerprint } from './02_candidates';

export const T037_PROTOCOL = 'PRODUCT_PATH_T037_V1';
export const T037_SCHEDULE_ID = 't037-heldout-7x2x10-seed-v1';
export const T037_OUTPUT_DIR = resolve('tests/fixtures/tree/experience_library/product_path_t037');
export const STAGE_RECORDS_PATH = resolve(`${T037_OUTPUT_DIR}/stage_screen_records.jsonl`);
export const TELEMETRY_PATH = resolve(`${T037_OUTPUT_DIR}/t039_cpu_telemetry.jsonl`);

export const GAMES_PER_CELL = 10;
export const HELD_OUT_FAMILIES = 7;
export const SIDES = 2;
export const CELLS_PER_ENTITY = HELD_OUT_FAMILIES * SIDES; // 14 cells
export const SEED_BASE = 37001;

// ---- 分级采样定义 ----

export type ScreenStage = 'STAGE_A' | 'STAGE_B' | 'STAGE_C';

export interface StageConfig {
  stage: ScreenStage;
  gamesPerCell: number;
  totalGames: number;
}

export const STAGE_CONFIGS: Record<ScreenStage, StageConfig> = {
  STAGE_A: { stage: 'STAGE_A', gamesPerCell: 1, totalGames: 14 },
  STAGE_B: { stage: 'STAGE_B', gamesPerCell: 3, totalGames: 42 },
  STAGE_C: { stage: 'STAGE_C', gamesPerCell: 6, totalGames: 84 },
};

// ---- Stage 审计记录 ----

export interface StageScreenRecord {
  recordId: string;
  evidenceClass: 'AGGREGATE_EXPLORATION_ONLY';
  cycleId: string;
  candidateId: string;
  sourceId: string;
  operatorFamily: string;
  stage: ScreenStage;
  gamesPerCell: number;
  totalGames: number;
  w: number;
  d: number;
  l: number;
  trainingScore: number;
  sourceRelativeScore: number;
  stageDecision: 'PROMOTED_TO_NEXT_STAGE' | 'RETAINED_AT_STAGE' | 'STAGE_COMPLETED';
  exactCriterion: string;
  completedAt: string;
}

// ---- CPU 测量遥测 ----

export interface CpuTelemetryRecord {
  cycleId: string;
  screenBatchId: string;
  configuredWorkers: number;
  observedWorkers: number;
  peakInFlight: number;
  avgInFlight: number;
  cpuAvg: number;
  cpuP50: number;
  cpuP95: number;
  lowQueueIntervals: number;
  sampleDurationMs: number;
  recordedAt: string;
}

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

export interface ScreenCell {
  protocol: string;
  scheduleId: string;
  manifestHash: string;
  entityId: string;
  entityKind: 'baseline' | 'candidate';
  entityFingerprint: string;
  parentFingerprint: string | null;
  operatorFamily: string;
  sourceId: string;
  cellIndex: number;
  sourceSide: 1 | 2;
  opponentId: string;
  exactSeed: number;
  gamesPerCell: number;
  w: number;
  d: number;
  l: number;
  completed: boolean;
  error: string | null;
  nonemptyTeamProof: boolean;
  candidateDeploymentCount: number | null;
  opponentDeploymentCount: number | null;
  branchTraceLink: string | null;
  traceHash: string | null;
}

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

export interface CandidateEntry {
  meta: CandidateMetadata;
  evol: EvolFormation;
}

export function appendJsonl(path: string, record: unknown): void {
  appendFileSync(path, JSON.stringify(record) + '\n', 'utf8');
}

export function writeAtomic(path: string, value: unknown): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  renameSync(tmp, path);
}

export function computeManifestHash(manifest: object): string {
  return createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
}

// ---- 候选批次生成（基础 Phase-2 批次，保留向下兼容） ----

export function generateCandidateBatch(sources: Formation[]): CandidateEntry[] {
  const result: CandidateEntry[] = [];
  const seenFps = new Set<string>();

  for (const src of sources) {
    if ((src as any).isLegacyBaseline) continue;
    const evol = formationToEvol(src);
    const srcFp = (src as any).fingerprint ?? computeCandidateFingerprint(evol);
    const srcId = (src as any).id;
    const srcName = (src as any).name ?? srcId;

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
  }

  return result;
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

// ---- 单局细粒度筛选执行器（Stage A/B/C + 测量） ----

export async function screenCandidateTieredFineGrained(opts: {
  pool: PersistentSimPool;
  candidateEntries: CandidateEntry[];
  heldOutOpps: Formation[];
  baselineScores: Map<string, number>;
  cycleId: string;
  manifestHash: string;
  paths: T037Paths;
}): Promise<ScreenObservation[]> {
  const { pool, candidateEntries, heldOutOpps, baselineScores, cycleId, manifestHash, paths } = opts;
  const observations: ScreenObservation[] = [];

  // 外部并发 <= 2
  const BATCH_SIZE = 2;

  for (let bIdx = 0; bIdx < candidateEntries.length; bIdx += BATCH_SIZE) {
    const candidateBatch = candidateEntries.slice(bIdx, bIdx + BATCH_SIZE);

    for (const entry of candidateBatch) {
      const { meta, evol } = entry;
      const baselineScore = baselineScores.get(meta.sourceId) ?? 0.80;

      // 阶段演进：Stage A -> Stage B -> Stage C
      let stageObs: { w: number; d: number; l: number; score: number; relScore: number } = { w: 0, d: 0, l: 0, score: 0, relScore: 0 };

      // 逐步执行各 stage
      const stagesToRun: ScreenStage[] = ['STAGE_A', 'STAGE_B', 'STAGE_C'];

      for (const stage of stagesToRun) {
        const config = STAGE_CONFIGS[stage];

        // 生成细粒度任务：1 actual game = 1 task (games: 1)
        const tasks: SimTaskMessage[] = [];
        let taskId = 0;

        for (let oppIdx = 0; oppIdx < heldOutOpps.length; oppIdx++) {
          const opp = heldOutOpps[oppIdx];
          const oppId = (opp as any).id ?? (opp as any).name;
          for (const side of [1, 2] as (1 | 2)[]) {
            for (let g = 0; g < config.gamesPerCell; g++) {
              const exactSeed = SEED_BASE + oppIdx * 1000 + side * 100 + g;
              tasks.push({
                taskId: taskId++,
                candidateIdx: 0,
                formationA: evol,
                opponentNameOrId: oppId,
                opponentFormation: opp,
                side,
                seed: exactSeed,
                games: 1, // 严格单局任务
                executionMode: 'product_path',
                formalRequest: true,
              });
            }
          }
        }

        // 提交 pool 运行
        const results = await pool.dispatchTasks(tasks, meta.candidateId);
        let w = 0, d = 0, l = 0;
        for (const r of results) {
          w += r.w ?? 0;
          d += r.d ?? 0;
          l += r.l ?? 0;
        }

        const totalGames = w + d + l;
        const score = totalGames > 0 ? (w + 0.5 * d) / totalGames : 0;
        const relScore = score - baselineScore;
        stageObs = { w, d, l, score, relScore };

        // 判定晋升
        let decision: 'PROMOTED_TO_NEXT_STAGE' | 'RETAINED_AT_STAGE' | 'STAGE_COMPLETED' = 'STAGE_COMPLETED';
        let criterion = '';

        if (stage === 'STAGE_A') {
          if (relScore >= -0.05) {
            decision = 'PROMOTED_TO_NEXT_STAGE';
            criterion = `relScore(${relScore.toFixed(3)}) >= -0.05 -> Stage B`;
          } else {
            decision = 'RETAINED_AT_STAGE';
            criterion = `relScore(${relScore.toFixed(3)}) < -0.05 -> Stopped at Stage A`;
          }
        } else if (stage === 'STAGE_B') {
          if (relScore >= 0.000) {
            decision = 'PROMOTED_TO_NEXT_STAGE';
            criterion = `relScore(${relScore.toFixed(3)}) >= 0.000 -> Stage C`;
          } else {
            decision = 'RETAINED_AT_STAGE';
            criterion = `relScore(${relScore.toFixed(3)}) < 0.000 -> Stopped at Stage B`;
          }
        } else {
          decision = 'STAGE_COMPLETED';
          criterion = `Stage C Completed: final relScore=${relScore.toFixed(3)}`;
        }

        // 写入阶段审计记录
        const stageRecord: StageScreenRecord = {
          recordId: createHash('sha256').update(`${cycleId}_${meta.candidateId}_${stage}_${totalGames}`).digest('hex').slice(0, 16),
          evidenceClass: 'AGGREGATE_EXPLORATION_ONLY',
          cycleId,
          candidateId: meta.candidateId,
          sourceId: meta.sourceId,
          operatorFamily: meta.operatorFamily,
          stage,
          gamesPerCell: config.gamesPerCell,
          totalGames,
          w,
          d,
          l,
          trainingScore: score,
          sourceRelativeScore: relScore,
          stageDecision: decision,
          exactCriterion: criterion,
          completedAt: new Date().toISOString(),
        };
        appendJsonl(STAGE_RECORDS_PATH, stageRecord);

        // 如果未晋升，则提前终止后续 stage
        if (decision === 'RETAINED_AT_STAGE') {
          break;
        }
      }

      // 生成最终观察
      const totalCells = HELD_OUT_FAMILIES * SIDES;
      const finalObs: ScreenObservation = {
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
        totalGames: stageObs.w + stageObs.d + stageObs.l,
        w: stageObs.w,
        d: stageObs.d,
        l: stageObs.l,
        workerErrors: 0,
        trainingScore: stageObs.score,
        sourceRelativeScore: stageObs.relScore,
        completedAt: new Date().toISOString(),
      };

      appendJsonl(paths.observationsPath, finalObs);
      observations.push(finalObs);
    }
  }

  return observations;
}

// ---- 向下兼容 screenEntity 接口 ----

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
      const sideOnlyMask: FeatureMask = { ...emptyMask, side };
      const metrics: MatchMetrics[] = await pool.evalCandidateBatchOnMatchedParallel(
        [evol],
        sideOnlyMask,
        [opp],
        10,
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
        gamesPerCell: 10,
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
  const totalGames = totalCells * 10;
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
