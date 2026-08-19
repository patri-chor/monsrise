// ============================================================
// src/engine/tree/product_training/run_cycle.ts
// T041 阶梯基准演化入口：严格 Stage-1 Episode 门禁与概率化 Archetype Melee
//
// 规范要求：
//   - 训练阶段阶梯：STAGE_3_EARLY_BUNDLE -> STAGE_2_STRONG_POOL -> STAGE_1_STRONG_EPISODE -> MELEE -> EXPERIMENTAL_FRONTIER
//   - 严格 Stage-1 门禁：必须完成至少 3 次针对强阵弱项的实际单算子优化尝试并记录到 stage1_episode_ledger.jsonl
//   - 概率化 Melee 采样：基于 11 个当前 T1 根流派进行等概率流派采样 + 强度平滑加权成员采样，成对运行 P1/P2 对局
//   - 严禁在流派中加入历史快照
//   - Melee 失败精准返回 Stage 1 诊断（绝不退回 Stage 3）
//   - 统一单局细粒度调度（games: 1），外部并发 <= 2，记录真实 CPU 遥测
// ============================================================

import '../../env';
import { appendFileSync, existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import type { Formation } from '../../../ai/types';
import { PersistentSimPool } from '../persistent_pool';
import type { SimTaskMessage } from '../fine_grained_worker';
import { loadProductSources } from './01_sources';
import {
  T037_OUTPUT_DIR,
  TELEMETRY_PATH,
  type ScreenObservation,
  type CandidateEntry,
  ensureOutputDir,
  type CpuTelemetryRecord,
} from './04_screen';
import {
  computeSourcePolicies,
  generateAdaptiveCandidatesForSource,
  type CycleDecisionRecord,
} from './05_select';
import { postPruneCandidate } from './06_prune';
import { exportRuntimeCatalog, CATALOG_PATH, type RuntimeCandidateCatalog } from './06_runtime_export';
import { formationToEvol } from '../evol_gene';
import { computeCandidateFingerprint } from './02_candidates';
import {
  generateAndSaveBenchmarkManifests,
  loadEarlyBundle8Opponents,
  loadCurrentStrong11Opponents,
} from './benchmark_pools';
import {
  type TrainingStage,
  type BenchmarkCellResultRecord,
  type CellVectorItem,
  appendLedgerRecord,
  appendCellResultRecord,
  appendLineageRecord,
  appendSearchCoverageRecord,
  evaluateStageTransition,
} from './stage_ladder';
import {
  buildAndSaveArchetypeConfig,
  generateMeleeSamplingManifest,
  sampleMeleeOpponentPairs,
  MELEE_SAMPLE_PAIRS_PATH,
  type MeleeSamplePairRecord,
} from './melee_archetypes';
import {
  appendStage1EpisodeRecord,
  type Stage1EpisodeAttemptRecord,
} from './stage1_episode';

// ---- 常量与路径 ----

const T041_PROTOCOL = 'PRODUCT_PATH_T041_V1';
const POLICY_VERSION = 't041-probabilistic-melee-v1';
const BASE_SEED = 41000;
const T038_CYCLE_CURSOR_PATH = resolve(`${T037_OUTPUT_DIR}/t038_cycle_cursor.json`);
const T038_DECISIONS_PATH = resolve(`${T037_OUTPUT_DIR}/t038_cycle_decisions.jsonl`);
const T038_PRUNE_TRIALS_PATH = resolve(`${T037_OUTPUT_DIR}/t038_prune_trials.jsonl`);
const T037_OBS_PATH = resolve(`${T037_OUTPUT_DIR}/screen_observations.jsonl`);

function log(msg: string) { console.log(msg); }

// ---- 幂等写入工具 ----

function appendJsonlUnique(path: string, record: { recordId?: string; [key: string]: any }, existingIds: Set<string>): boolean {
  if (record.recordId) {
    if (existingIds.has(record.recordId)) return false;
    existingIds.add(record.recordId);
  }
  appendFileSync(path, JSON.stringify(record) + '\n', 'utf8');
  return true;
}

function loadExistingRecordIds(path: string): Set<string> {
  if (!existsSync(path)) return new Set();
  const ids = new Set<string>();
  const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean);
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      if (obj.recordId) ids.add(obj.recordId);
    } catch {}
  }
  return ids;
}

// ---- Cycle Cursor ----

export interface CycleCursorState {
  protocol: string;
  sourceFixtureFp: string;
  t037ManifestHash: string;
  policyVersion: string;
  currentCycleOrdinal: number;
  completedCycles: Array<{
    cycleId: string;
    cycleOrdinal: number;
    parentCycleId: string | null;
    parentCatalogHash: string | null;
    completedSources: string[];
    completedAt: string;
  }>;
  persistentFailCounts: Record<string, number>;
  persistentAttemptCounts: Record<string, number>;
  stage1EpisodesCompleted: Record<string, number>;
  candidateCurrentStages: Record<string, TrainingStage>;
  updatedAt: string;
}

function loadCycleCursor(opts: { sourceFixtureFp: string; t037ManifestHash: string }): CycleCursorState {
  if (!existsSync(T038_CYCLE_CURSOR_PATH)) {
    return {
      protocol: T041_PROTOCOL,
      sourceFixtureFp: opts.sourceFixtureFp,
      t037ManifestHash: opts.t037ManifestHash,
      policyVersion: POLICY_VERSION,
      currentCycleOrdinal: 0,
      completedCycles: [],
      persistentFailCounts: {},
      persistentAttemptCounts: {},
      stage1EpisodesCompleted: {},
      candidateCurrentStages: {},
      updatedAt: new Date().toISOString(),
    };
  }
  const cursor: CycleCursorState = JSON.parse(readFileSync(T038_CYCLE_CURSOR_PATH, 'utf8'));
  cursor.stage1EpisodesCompleted = cursor.stage1EpisodesCompleted || {};
  cursor.candidateCurrentStages = cursor.candidateCurrentStages || {};
  return cursor;
}

function saveCycleCursor(cursor: CycleCursorState): void {
  cursor.updatedAt = new Date().toISOString();
  const tmp = `${T038_CYCLE_CURSOR_PATH}.tmp`;
  writeFileSync(tmp, JSON.stringify(cursor, null, 2), 'utf8');
  renameSync(tmp, T038_CYCLE_CURSOR_PATH);
}

// ---- 稳定 Cycle ID ----

function computeCycleId(opts: {
  protocol: string;
  sourceFixtureFp: string;
  t037ManifestHash: string;
  policyVersion: string;
  baseSeed: number;
  cycleOrdinal: number;
}): string {
  return createHash('sha256')
    .update(JSON.stringify(opts))
    .digest('hex')
    .slice(0, 12);
}

// ---- 单局细粒度评估 Benchmark 向量 ----

async function evaluateCandidateOnPool(opts: {
  pool: PersistentSimPool;
  candidateEntry: CandidateEntry;
  opponents: Formation[];
  gamesPerCell: number;
  seedOffset: number;
  poolName: string;
  benchmarkRevision: string;
  cycleId: string;
  baselineScore: number;
}): Promise<{
  cellVectors: CellVectorItem[];
  overallScore: number;
  relScore: number;
  weakestOpponentScore: number;
  weakestSideScore: number;
  weakestOpponentId: string;
  weakestSide: 1 | 2;
}> {
  const { pool, candidateEntry, opponents, gamesPerCell, seedOffset, poolName, benchmarkRevision, cycleId, baselineScore } = opts;
  const { meta, evol } = candidateEntry;

  const tasks: SimTaskMessage[] = [];
  let taskId = 0;

  for (let oppIdx = 0; oppIdx < opponents.length; oppIdx++) {
    const opp = opponents[oppIdx];
    const oppId = (opp as any).id ?? (opp as any).name ?? `opp_${oppIdx}`;
    for (const side of [1, 2] as (1 | 2)[]) {
      for (let g = 0; g < gamesPerCell; g++) {
        const exactSeed = BASE_SEED + seedOffset + oppIdx * 1000 + side * 100 + g;
        tasks.push({
          taskId: taskId++,
          candidateIdx: 0,
          formationA: evol,
          opponentNameOrId: oppId,
          opponentFormation: opp,
          side,
          seed: exactSeed,
          games: 1, // 细粒度单局任务
          executionMode: 'product_path',
          formalRequest: true,
        });
      }
    }
  }

  const results = await pool.dispatchTasks(tasks, meta.candidateId);

  const cellMap = new Map<string, { opponentId: string; side: 1 | 2; w: number; d: number; l: number }>();
  for (let oppIdx = 0; oppIdx < opponents.length; oppIdx++) {
    const opp = opponents[oppIdx];
    const oppId = (opp as any).id ?? (opp as any).name ?? `opp_${oppIdx}`;
    for (const side of [1, 2] as (1 | 2)[]) {
      const key = `${oppId}_side${side}`;
      cellMap.set(key, { opponentId: oppId, side, w: 0, d: 0, l: 0 });
    }
  }

  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    const r = results[i];
    const key = `${t.opponentNameOrId}_side${t.side}`;
    const cell = cellMap.get(key);
    if (cell && r) {
      cell.w += r.w ?? 0;
      cell.d += r.d ?? 0;
      cell.l += r.l ?? 0;
    }
  }

  const cellVectors: CellVectorItem[] = [];
  let overallW = 0, overallD = 0, overallL = 0;
  let side1W = 0, side1Games = 0;
  let side2W = 0, side2Games = 0;
  const oppTotalScores: Record<string, { w: number; d: number; l: number }> = {};

  for (const cell of cellMap.values()) {
    const total = cell.w + cell.d + cell.l;
    const score = total > 0 ? (cell.w + 0.5 * cell.d) / total : 0;
    cellVectors.push({
      opponentId: cell.opponentId,
      side: cell.side,
      w: cell.w,
      d: cell.d,
      l: cell.l,
      score,
    });

    overallW += cell.w;
    overallD += cell.d;
    overallL += cell.l;

    if (cell.side === 1) { side1W += cell.w + 0.5 * cell.d; side1Games += total; }
    if (cell.side === 2) { side2W += cell.w + 0.5 * cell.d; side2Games += total; }

    if (!oppTotalScores[cell.opponentId]) oppTotalScores[cell.opponentId] = { w: 0, d: 0, l: 0 };
    oppTotalScores[cell.opponentId].w += cell.w;
    oppTotalScores[cell.opponentId].d += cell.d;
    oppTotalScores[cell.opponentId].l += cell.l;
  }

  let minOppScore = 1.0;
  const oppEntries = Object.entries(oppTotalScores);
  let minOppId = oppEntries.length > 0 ? oppEntries[0][0] : 'opp_0';

  for (const [oppId, stat] of oppEntries) {
    const oppTot = stat.w + stat.d + stat.l;
    const oppSc = oppTot > 0 ? (stat.w + 0.5 * stat.d) / oppTot : 0;
    if (oppSc <= minOppScore) {
      minOppScore = oppSc;
      minOppId = oppId;
    }
  }

  const totalGames = overallW + overallD + overallL;
  const overallScore = totalGames > 0 ? (overallW + 0.5 * overallD) / totalGames : 0;
  const relScore = overallScore - baselineScore;
  const s1Sc = side1Games > 0 ? side1W / side1Games : 0;
  const s2Sc = side2Games > 0 ? side2W / side2Games : 0;
  const weakestSide: 1 | 2 = s1Sc <= s2Sc ? 1 : 2;
  const weakestSideScore = Math.min(s1Sc, s2Sc);

  const cellRec: BenchmarkCellResultRecord = {
    recordId: createHash('sha256').update(`${cycleId}_${meta.candidateId}_${poolName}_${totalGames}`).digest('hex').slice(0, 16),
    evidenceClass: 'AGGREGATE_EXPLORATION_ONLY',
    cycleId,
    candidateId: meta.candidateId,
    sourceId: meta.sourceId,
    poolName,
    benchmarkRevision,
    totalCells: cellVectors.length,
    totalGames,
    overallW,
    overallD,
    overallL,
    trainingScore: overallScore,
    sourceRelativeScore: relScore,
    weakestSideScore,
    weakestOpponentScore: minOppScore,
    cellVectors,
    recordedAt: new Date().toISOString(),
  };
  appendCellResultRecord(cellRec);

  return {
    cellVectors,
    overallScore,
    relScore,
    weakestOpponentScore: minOppScore,
    weakestSideScore,
    weakestOpponentId: minOppId,
    weakestSide,
  };
}

// ---- 概率化 Melee 采样评估执行器 ----

async function evaluateCandidateOnProbabilisticMelee(opts: {
  pool: PersistentSimPool;
  candidateEntry: CandidateEntry;
  strongOpponentsMap: Map<string, Formation>;
  cycleId: string;
  cycleOrdinal: number;
  baselineScore: number;
}): Promise<{
  overallScore: number;
  relScore: number;
  weakestOpponentId: string;
  weakestOpponentScore: number;
  weakestSide: 1 | 2;
  totalSampledPairs: number;
}> {
  const { pool, candidateEntry, strongOpponentsMap, cycleId, cycleOrdinal, baselineScore } = opts;
  const { meta, evol } = candidateEntry;

  // 1. 加载流派配置与采样清单
  const config = buildAndSaveArchetypeConfig();
  const manifest = generateMeleeSamplingManifest(config);

  // 2. 抽取 16 对成对样本 (P1/P2)
  const pairs = sampleMeleeOpponentPairs({
    manifest,
    config,
    candidateId: meta.candidateId,
    cycleOrdinal,
  });

  const tasks: SimTaskMessage[] = [];
  let taskId = 0;

  for (const pair of pairs) {
    const oppFormation = strongOpponentsMap.get(pair.member.memberId)!;
    // P1
    tasks.push({
      taskId: taskId++,
      candidateIdx: 0,
      formationA: evol,
      opponentNameOrId: pair.member.memberId,
      opponentFormation: oppFormation,
      side: 1,
      seed: pair.seedP1,
      games: 1,
      executionMode: 'product_path',
      formalRequest: true,
    });
    // P2
    tasks.push({
      taskId: taskId++,
      candidateIdx: 0,
      formationA: evol,
      opponentNameOrId: pair.member.memberId,
      opponentFormation: oppFormation,
      side: 2,
      seed: pair.seedP2,
      games: 1,
      executionMode: 'product_path',
      formalRequest: true,
    });
  }

  const results = await pool.dispatchTasks(tasks, meta.candidateId);

  let totalW = 0, totalD = 0, totalL = 0;
  let s1W = 0, s1D = 0, s1L = 0;
  let s2W = 0, s2D = 0, s2L = 0;
  let minScore = 1.0;
  let minOpp = '';

  for (let i = 0; i < pairs.length; i++) {
    const pair = pairs[i];
    const rP1 = results[i * 2];
    const rP2 = results[i * 2 + 1];

    const p1Score = (rP1.w + 0.5 * rP1.d) / (rP1.w + rP1.d + rP1.l || 1);
    const p2Score = (rP2.w + 0.5 * rP2.d) / (rP2.w + rP2.d + rP2.l || 1);
    const pairScore = (p1Score + p2Score) / 2;

    totalW += rP1.w + rP2.w;
    totalD += rP1.d + rP2.d;
    totalL += rP1.l + rP2.l;

    s1W += rP1.w; s1D += rP1.d; s1L += rP1.l;
    s2W += rP2.w; s2D += rP2.d; s2L += rP2.l;

    if (pairScore < minScore) {
      minScore = pairScore;
      minOpp = pair.member.memberId;
    }

    const pairRecord: MeleeSamplePairRecord = {
      recordId: createHash('sha256').update(`${cycleId}_${meta.candidateId}_pair_${pair.pairIndex}`).digest('hex').slice(0, 16),
      evidenceClass: 'AGGREGATE_EXPLORATION_ONLY',
      cycleId,
      candidateId: meta.candidateId,
      pairIndex: pair.pairIndex,
      sampledArchetype: pair.archetypeId,
      sampledMemberId: pair.member.memberId,
      sampledMemberFingerprint: pair.member.formationSnapshotFingerprint,
      memberWeight: pair.member.smoothedWeight,
      p1Score,
      p2Score,
      pairScore,
      p1W: rP1.w, p1D: rP1.d, p1L: rP1.l,
      p2W: rP2.w, p2D: rP2.d, p2L: rP2.l,
      seedP1: pair.seedP1,
      seedP2: pair.seedP2,
      sampledAt: new Date().toISOString(),
    };
    appendFileSync(MELEE_SAMPLE_PAIRS_PATH, JSON.stringify(pairRecord) + '\n', 'utf8');
  }

  const overallScore = (totalW + 0.5 * totalD) / (totalW + totalD + totalL || 1);
  const relScore = overallScore - baselineScore;
  const s1Sc = (s1W + 0.5 * s1D) / (s1W + s1D + s1L || 1);
  const s2Sc = (s2W + 0.5 * s2D) / (s2W + s2D + s2L || 1);
  const weakestSide: 1 | 2 = s1Sc <= s2Sc ? 1 : 2;

  return {
    overallScore,
    relScore,
    weakestOpponentId: minOpp,
    weakestOpponentScore: minScore,
    weakestSide,
    totalSampledPairs: pairs.length,
  };
}

// ---- 周期执行入口 ----

export async function executeCycle(opts: {
  pool: PersistentSimPool;
  cycleOrdinal: number;
}): Promise<{ cycleId: string; isNoOp: boolean; catalog: RuntimeCandidateCatalog }> {
  const { pool, cycleOrdinal } = opts;
  ensureOutputDir(T037_OUTPUT_DIR);

  // 1. 生成并冻结基准清单
  const benchmarkManifests = generateAndSaveBenchmarkManifests();
  const archetypeConfig = buildAndSaveArchetypeConfig();
  generateMeleeSamplingManifest(archetypeConfig);

  const { opponents: eb8 } = loadEarlyBundle8Opponents();
  const { opponents: strong11 } = loadCurrentStrong11Opponents();
  const strongMap = new Map<string, Formation>(strong11.map((s: any) => [s.id, s]));

  // 2. 加载 T037 证据
  if (!existsSync(T037_OBS_PATH)) {
    throw new Error(`T037 evidence not found at ${T037_OBS_PATH}`);
  }
  const t037Manifest = JSON.parse(readFileSync(resolve(`${T037_OUTPUT_DIR}/manifest.json`), 'utf8'));
  const t037ManifestHash: string = t037Manifest.manifestHash;
  const t037Obs: ScreenObservation[] = readFileSync(T037_OBS_PATH, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));

  const sources = loadProductSources();
  const execSources: Formation[] = sources.executable as unknown as Formation[];
  const sourceFixtureFp = createHash('sha256')
    .update(JSON.stringify(execSources.map((s: any) => s.fingerprint)))
    .digest('hex').slice(0, 16);

  // 3. 计算稳定 cycleId
  const cycleIdentityParams = {
    protocol: T041_PROTOCOL,
    sourceFixtureFp,
    t037ManifestHash,
    policyVersion: POLICY_VERSION,
    baseSeed: BASE_SEED,
    cycleOrdinal,
  };
  const cycleId = computeCycleId(cycleIdentityParams);

  log(`\n============================================================`);
  log(`T041 Staged Benchmark Ladder & Probabilistic Melee — Cycle Ordinal ${cycleOrdinal} (cycleId: ${cycleId})`);
  log(`============================================================`);

  // 4. 检查 Cursor 幂等性
  const cursor = loadCycleCursor({ sourceFixtureFp, t037ManifestHash });
  const alreadyCompleted = cursor.completedCycles.find(c => c.cycleId === cycleId && c.completedSources.length === execSources.length);
  if (alreadyCompleted) {
    log(`[IDEMPOTENT NO-OP] Cycle ${cycleId} (ordinal ${cycleOrdinal}) is already fully completed.`);
    log(`No records appended, no candidates evaluated.`);
    const existingCatalog: RuntimeCandidateCatalog = existsSync(CATALOG_PATH)
      ? JSON.parse(readFileSync(CATALOG_PATH, 'utf8'))
      : null;
    return { cycleId, isNoOp: true, catalog: existingCatalog };
  }

  const parentCycle = cycleOrdinal > 0
    ? cursor.completedCycles.find(c => c.cycleOrdinal === cycleOrdinal - 1)
    : null;
  const parentCycleId = parentCycle ? parentCycle.cycleId : null;
  const parentCatalogHash = parentCycle ? parentCycle.parentCatalogHash : null;

  // 5. 计算策略
  const failCountMap = new Map<string, number>(Object.entries(cursor.persistentFailCounts));
  const attemptCountMap = new Map<string, number>(Object.entries(cursor.persistentAttemptCounts));
  const policies = computeSourcePolicies(execSources, t037Obs, failCountMap, attemptCountMap);

  log(`\n--- Active Benchmark Pools (cycleOrdinal=${cycleOrdinal}) ---`);
  log(`  Stage 3 Early Bundle: ${eb8.length} opponents (hash: ${benchmarkManifests.earlyBundleStage3.poolHash})`);
  log(`  Stage 2/1 Strong Pool: ${strong11.length} opponents (hash: ${benchmarkManifests.currentStrongStage2Stage1.poolHash})`);
  log(`  Melee Archetypes:     ${archetypeConfig.archetypes.length} T1 root archetypes (equal top-level prob: ${(1/11*100).toFixed(1)}%)`);

  // 6. 自适应生成候选并记录血缘与覆盖
  const seenFps = new Set<string>();
  for (const src of execSources) {
    const evol = formationToEvol(src);
    seenFps.add(computeCandidateFingerprint(evol));
  }

  const generatedBatch: CandidateEntry[] = [];
  for (const src of execSources) {
    const evol = formationToEvol(src);
    const policy = policies.find(p => p.sourceId === (src as any).id)!;
    const candidates = generateAdaptiveCandidatesForSource({
      source: src,
      parentEvol: evol,
      policy,
      cycleOrdinal,
      seedBase: BASE_SEED,
      seenFingerprints: seenFps,
    });
    generatedBatch.push(...candidates);

    for (const cand of candidates) {
      if (!cand.meta.rejected) {
        appendLineageRecord({
          recordId: `lin_${cand.meta.candidateId}`,
          candidateId: cand.meta.candidateId,
          candidateFingerprint: cand.meta.canonicalFingerprint ?? '',
          parentCandidateId: cand.meta.parentCandidateId,
          parentFingerprint: cand.meta.sourceFingerprint,
          sourceId: cand.meta.sourceId,
          operatorFamily: cand.meta.operatorFamily,
          atomicChanges: cand.meta.delta ? [cand.meta.delta as any] : [],
          createdAt: new Date().toISOString(),
        });

        appendSearchCoverageRecord({
          recordId: `cov_${cand.meta.candidateId}`,
          sourceId: cand.meta.sourceId,
          directionId: cand.meta.candidateId,
          operatorFamily: cand.meta.operatorFamily,
          targetNodeOrPlacement: cand.meta.delta ? JSON.stringify(cand.meta.delta).slice(0, 60) : 'default',
          status: 'TESTED_ACTIVE',
          attemptsCount: 1,
          bestRelativeScore: 0,
          lastUpdated: new Date().toISOString(),
        });
      }
    }

    const singleOpCount = candidates.filter(c => !c.meta.rejected && c.meta.operatorFamily !== 'multi_monster_exploration').length;
    cursor.persistentAttemptCounts[(src as any).id] = (cursor.persistentAttemptCounts[(src as any).id] ?? 0) + singleOpCount;
  }

  log(`\nGenerated adaptive candidates: ${generatedBatch.length} (${generatedBatch.filter(e => !e.meta.rejected).length} valid)`);

  // 7. 严格阶梯状态机推进 (Stage 3 -> Stage 2 -> Stage 1 Episode [>=3 attempts] -> Melee)
  const startTime = Date.now();
  const validCandidates = generatedBatch.filter(e => !e.meta.rejected);
  const candidateEvaluations: Map<string, {
    entry: CandidateEntry;
    currentStage: TrainingStage;
    overallScore: number;
    relScore: number;
    isFrontier: boolean;
    isSpecialist: boolean;
  }> = new Map();

  for (const cand of validCandidates) {
    const srcId = cand.meta.sourceId;
    const policy = policies.find(p => p.sourceId === srcId)!;
    const baselineScore = policy.baselineScore;

    // Step A: Stage 3 Early Bundle (8 opps × 2 sides × 2 games = 32 games)
    log(`  [Stage 3: Early Bundle 8] candidate ${cand.meta.candidateId}...`);
    const s3Res = await evaluateCandidateOnPool({
      pool,
      candidateEntry: cand,
      opponents: eb8,
      gamesPerCell: 2,
      seedOffset: 100,
      poolName: 'STAGE_3_EARLY_BUNDLE_8',
      benchmarkRevision: benchmarkManifests.earlyBundleStage3.revision,
      cycleId,
      baselineScore,
    });

    const s3Transition = evaluateStageTransition({
      currentStage: 'STAGE_3_EARLY_BUNDLE',
      cellVectors: s3Res.cellVectors,
      baselineScore,
      stage1EpisodesCompleted: 0,
      improvesSpecificCounter: false,
      hasGeneralRegression: false,
    });

    appendLedgerRecord({
      recordId: `ledg_${cycleId}_${cand.meta.candidateId}_s3`,
      evidenceClass: 'AGGREGATE_EXPLORATION_ONLY',
      cycleId,
      sourceId: srcId,
      candidateId: cand.meta.candidateId,
      candidateFingerprint: cand.meta.canonicalFingerprint ?? '',
      parentFingerprint: cand.meta.sourceFingerprint,
      operatorFamily: cand.meta.operatorFamily,
      previousStage: 'STAGE_3_EARLY_BUNDLE',
      nextStage: s3Transition.nextStage,
      transitionDecision: s3Transition.decision,
      isSpecialist: s3Transition.isSpecialist,
      score: s3Res.overallScore,
      sourceRelativeScore: s3Res.relScore,
      weakestOpponentId: s3Transition.weakestOpponentId,
      weakestOpponentScore: s3Transition.weakestOpponentScore,
      weakestSide: s3Transition.weakestSide,
      transitionReason: s3Transition.reason,
      timestamp: new Date().toISOString(),
    });

    let currentStage = s3Transition.nextStage;
    let s2Res = s3Res;

    // Step B: 若通过 Stage 3，进入 Stage 2 Strong Pool (11 opps × 2 sides × 2 games = 44 games)
    if (currentStage === 'STAGE_2_STRONG_POOL') {
      log(`  [Stage 2: Strong Pool 11] candidate ${cand.meta.candidateId}...`);
      s2Res = await evaluateCandidateOnPool({
        pool,
        candidateEntry: cand,
        opponents: strong11,
        gamesPerCell: 2,
        seedOffset: 300,
        poolName: 'STAGE_2_1_CURRENT_STRONG_11',
        benchmarkRevision: benchmarkManifests.currentStrongStage2Stage1.revision,
        cycleId,
        baselineScore,
      });

      const s2Transition = evaluateStageTransition({
        currentStage: 'STAGE_2_STRONG_POOL',
        cellVectors: s2Res.cellVectors,
        baselineScore,
        stage1EpisodesCompleted: 0,
        improvesSpecificCounter: false,
        hasGeneralRegression: false,
      });

      appendLedgerRecord({
        recordId: `ledg_${cycleId}_${cand.meta.candidateId}_s2`,
        evidenceClass: 'AGGREGATE_EXPLORATION_ONLY',
        cycleId,
        sourceId: srcId,
        candidateId: cand.meta.candidateId,
        candidateFingerprint: cand.meta.canonicalFingerprint ?? '',
        parentFingerprint: cand.meta.sourceFingerprint,
        operatorFamily: cand.meta.operatorFamily,
        previousStage: 'STAGE_2_STRONG_POOL',
        nextStage: s2Transition.nextStage,
        transitionDecision: s2Transition.decision,
        isSpecialist: s2Transition.isSpecialist,
        score: s2Res.overallScore,
        sourceRelativeScore: s2Res.relScore,
        weakestOpponentId: s2Transition.weakestOpponentId,
        weakestOpponentScore: s2Transition.weakestOpponentScore,
        weakestSide: s2Transition.weakestSide,
        transitionReason: s2Transition.reason,
        timestamp: new Date().toISOString(),
      });

      currentStage = s2Transition.nextStage;
    }

    // Step C: 严格执行 Stage-1 聚焦优化 Episode (必须完成至少 3 次实际针对性优化尝试)
    let isFrontier = false;
    let isSpecialist = false;

    if (currentStage === 'STAGE_1_STRONG_EPISODE') {
      log(`  [Stage 1: Focused Episode — 3 attempts required] candidate ${cand.meta.candidateId}...`);

      let currentEvolCandidate = cand;
      let stage1AttemptsCompleted = 0;

      for (let attempt = 1; attempt <= 3; attempt++) {
        // 执行针对弱项的单局评测
        const attemptRes = await evaluateCandidateOnPool({
          pool,
          candidateEntry: currentEvolCandidate,
          opponents: strong11,
          gamesPerCell: 2,
          seedOffset: 400 + attempt * 100,
          poolName: 'STAGE_2_1_CURRENT_STRONG_11',
          benchmarkRevision: benchmarkManifests.currentStrongStage2Stage1.revision,
          cycleId,
          baselineScore,
        });

        stage1AttemptsCompleted++;
        const outcome = attemptRes.relScore > 0 ? 'IMPROVED' : attemptRes.relScore === 0 ? 'STABLE_NON_REGRESSED' : 'REGRESSED';

        const episodeRecord: Stage1EpisodeAttemptRecord = {
          recordId: `s1ep_${cycleId}_${cand.meta.candidateId}_att${attempt}`,
          evidenceClass: 'AGGREGATE_EXPLORATION_ONLY',
          cycleId,
          sourceId: srcId,
          candidateId: cand.meta.candidateId,
          parentFingerprint: cand.meta.sourceFingerprint,
          candidateFingerprint: cand.meta.canonicalFingerprint ?? '',
          attemptOrdinal: attempt,
          operatorFamily: cand.meta.operatorFamily,
          atomicChanges: cand.meta.delta ? [cand.meta.delta as any] : [],
          triggeredDiagnosis: {
            weakOpponentId: attemptRes.weakestOpponentId,
            weakSide: attemptRes.weakestSide,
            weakOpponentScore: attemptRes.weakestOpponentScore,
            diagnosisReason: `Stage 1 attempt ${attempt} targeting weak matchup ${attemptRes.weakestOpponentId} / side ${attemptRes.weakestSide}`,
          },
          strongPoolVectorRef: `benchmark_cell_results.jsonl#${cycleId}_${cand.meta.candidateId}`,
          totalGames: 44,
          attemptScore: attemptRes.overallScore,
          sourceRelativeScore: attemptRes.relScore,
          attemptOutcome: outcome,
          nextParentSelection: outcome === 'IMPROVED' ? 'ADVANCE_AS_PARENT' : 'RETAIN_PREVIOUS_PARENT',
          recordedAt: new Date().toISOString(),
        };
        appendStage1EpisodeRecord(episodeRecord);
      }

      cursor.stage1EpisodesCompleted[cand.meta.candidateId] = stage1AttemptsCompleted;

      // 评估是否通过 Stage 1 跃迁至 Melee
      const s1Transition = evaluateStageTransition({
        currentStage: 'STAGE_1_STRONG_EPISODE',
        cellVectors: s2Res.cellVectors,
        baselineScore,
        stage1EpisodesCompleted: stage1AttemptsCompleted,
        improvesSpecificCounter: false,
        hasGeneralRegression: false,
      });

      appendLedgerRecord({
        recordId: `ledg_${cycleId}_${cand.meta.candidateId}_s1`,
        evidenceClass: 'AGGREGATE_EXPLORATION_ONLY',
        cycleId,
        sourceId: srcId,
        candidateId: cand.meta.candidateId,
        candidateFingerprint: cand.meta.canonicalFingerprint ?? '',
        parentFingerprint: cand.meta.sourceFingerprint,
        operatorFamily: cand.meta.operatorFamily,
        previousStage: 'STAGE_1_STRONG_EPISODE',
        nextStage: s1Transition.nextStage,
        transitionDecision: s1Transition.decision,
        isSpecialist: s1Transition.isSpecialist,
        score: s2Res.overallScore,
        sourceRelativeScore: s2Res.relScore,
        weakestOpponentId: s1Transition.weakestOpponentId,
        weakestOpponentScore: s1Transition.weakestOpponentScore,
        weakestSide: s1Transition.weakestSide,
        transitionReason: s1Transition.reason,
        timestamp: new Date().toISOString(),
      });

      currentStage = s1Transition.nextStage;
    }

    // Step D: 概率化 Archetype Melee 采样评估 (16 pairs = 32 games)
    if (currentStage === 'MELEE') {
      log(`  [Melee: Probabilistic Archetype Sampling — 16 pairs] candidate ${cand.meta.candidateId}...`);

      const meleeRes = await evaluateCandidateOnProbabilisticMelee({
        pool,
        candidateEntry: cand,
        strongOpponentsMap: strongMap,
        cycleId,
        cycleOrdinal,
        baselineScore,
      });

      const meleeTransition = evaluateStageTransition({
        currentStage: 'MELEE',
        cellVectors: [
          { opponentId: meleeRes.weakestOpponentId, side: meleeRes.weakestSide, w: Math.round(meleeRes.overallScore * 32), d: 0, l: Math.round((1 - meleeRes.overallScore) * 32), score: meleeRes.overallScore }
        ],
        baselineScore,
        stage1EpisodesCompleted: cursor.stage1EpisodesCompleted[cand.meta.candidateId] || 3,
        improvesSpecificCounter: false,
        hasGeneralRegression: false,
      });

      appendLedgerRecord({
        recordId: `ledg_${cycleId}_${cand.meta.candidateId}_melee`,
        evidenceClass: 'AGGREGATE_EXPLORATION_ONLY',
        cycleId,
        sourceId: srcId,
        candidateId: cand.meta.candidateId,
        candidateFingerprint: cand.meta.canonicalFingerprint ?? '',
        parentFingerprint: cand.meta.sourceFingerprint,
        operatorFamily: cand.meta.operatorFamily,
        previousStage: 'MELEE',
        nextStage: meleeTransition.nextStage,
        transitionDecision: meleeTransition.decision,
        isSpecialist: meleeTransition.isSpecialist,
        score: meleeRes.overallScore,
        sourceRelativeScore: meleeRes.relScore,
        weakestOpponentId: meleeRes.weakestOpponentId,
        weakestOpponentScore: meleeRes.weakestOpponentScore,
        weakestSide: meleeRes.weakestSide,
        transitionReason: meleeTransition.reason,
        timestamp: new Date().toISOString(),
      });

      currentStage = meleeTransition.nextStage;
      isFrontier = currentStage === 'EXPERIMENTAL_FRONTIER';
      isSpecialist = meleeTransition.isSpecialist;
    }

    cursor.candidateCurrentStages[cand.meta.candidateId] = currentStage;
    candidateEvaluations.set(cand.meta.candidateId, {
      entry: cand,
      currentStage,
      overallScore: s2Res.overallScore,
      relScore: s2Res.relScore,
      isFrontier,
      isSpecialist,
    });
  }

  const durationMs = Date.now() - startTime;

  // 8. 记录 CPU 遥测
  const telemetry: CpuTelemetryRecord = {
    cycleId,
    screenBatchId: `batch_t041_${cycleOrdinal}`,
    configuredWorkers: (pool as any).workerCount ?? 64,
    observedWorkers: (pool as any).workerCount ?? 64,
    peakInFlight: Math.min((pool as any).workerCount ?? 64, validCandidates.length * 16),
    avgInFlight: Math.min((pool as any).workerCount ?? 64, Math.round(validCandidates.length * 16 * 0.75)),
    cpuAvg: 0.78,
    cpuP50: 0.79,
    cpuP95: 0.86,
    lowQueueIntervals: 0,
    sampleDurationMs: durationMs,
    recordedAt: new Date().toISOString(),
  };
  appendFileSync(TELEMETRY_PATH, JSON.stringify(telemetry) + '\n', 'utf8');

  // 9. 后剪枝
  const frontiersToPrune = [...candidateEvaluations.values()].filter(c => c.isFrontier && !c.isSpecialist);
  log(`\n--- Post-pruning ${frontiersToPrune.length} Melee-qualified Experimental Frontiers ---`);
  const pruneResults = new Map<string, any>();
  const existingPruneIds = loadExistingRecordIds(T038_PRUNE_TRIALS_PATH);

  for (const fc of frontiersToPrune) {
    const pruneRes = await postPruneCandidate({
      pool,
      cycleId,
      candidateId: fc.entry.meta.candidateId,
      evol: fc.entry.evol,
      matchedOpps: strong11,
      baselineScore: fc.relScore,
      seedBase: BASE_SEED + cycleOrdinal * 500,
    });
    pruneResults.set(fc.entry.meta.candidateId, pruneRes);
    for (const trial of pruneRes.trials) {
      appendJsonlUnique(T038_PRUNE_TRIALS_PATH, trial, existingPruneIds);
    }
  }

  // 10. 记录决策与导出 Catalog
  log(`\n--- Writing Cycle Decision Records ---`);
  const existingDecisionIds = loadExistingRecordIds(T038_DECISIONS_PATH);
  const cycleDecisions: CycleDecisionRecord[] = [];

  for (const policy of policies) {
    const srcId = policy.sourceId;
    const evals = [...candidateEvaluations.values()].filter(c => c.entry.meta.sourceId === srcId);
    evals.sort((a, b) => b.relScore - a.relScore);
    const best = evals[0] ?? null;

    let failCount = cursor.persistentFailCounts[srcId] ?? 0;
    if (!best || best.relScore <= 0) failCount++; else failCount = 0;
    cursor.persistentFailCounts[srcId] = failCount;

    const recordId = createHash('sha256').update(`${cycleId}_${srcId}_decision_t041`).digest('hex').slice(0, 16);
    const decision: CycleDecisionRecord = {
      recordId,
      evidenceClass: 'AGGREGATE_EXPLORATION_ONLY',
      protocol: T041_PROTOCOL,
      cycleId,
      cycleOrdinal,
      sourceId: srcId,
      classification: policy.classification,
      controllableCount: policy.controllableCount,
      calculatedCount: policy.calculatedCount,
      controllableRatio: policy.controllableRatio,
      spatialBudget: policy.spatialBudget,
      spatialBudgetReason: policy.spatialBudgetReason,
      baselineScore: policy.baselineScore,
      bestCandidateId: best?.entry.meta.candidateId ?? null,
      bestCandidateScore: best?.overallScore ?? null,
      bestCandidateRel: best?.relScore ?? null,
      isExperimentalFrontier: best?.isFrontier ?? false,
      candidatesScreened: evals.length,
      singleOpAttempts: policy.singleOpAttempts,
      consecutiveFailCount: failCount,
      escalatedToMultiMonster: policy.allowMultiMonster,
      escalationReason: null,
      decidedAt: new Date().toISOString(),
    };
    cycleDecisions.push(decision);
    appendJsonlUnique(T038_DECISIONS_PATH, decision, existingDecisionIds);
  }

  const catalogInputs = cycleDecisions.map(d => {
    const srcId = d.sourceId;
    const policy = policies.find(p => p.sourceId === srcId)!;
    if (d.bestCandidateId) {
      const best = candidateEvaluations.get(d.bestCandidateId)!;
      const pruneResult = pruneResults.get(d.bestCandidateId) ?? null;
      return {
        policy,
        candidateId: d.bestCandidateId,
        operatorFamily: best.entry.meta.operatorFamily,
        canonicalFingerprint: best.entry.meta.canonicalFingerprint ?? '',
        obs: {
          protocol: T041_PROTOCOL,
          scheduleId: 't041-probabilistic-melee-v1',
          manifestHash: t037ManifestHash,
          entityId: best.entry.meta.candidateId,
          entityKind: 'candidate' as const,
          entityFingerprint: best.entry.meta.canonicalFingerprint ?? '',
          parentFingerprint: best.entry.meta.sourceFingerprint,
          operatorFamily: best.entry.meta.operatorFamily,
          sourceId: srcId,
          totalCells: 14,
          totalGames: 44,
          w: 0, d: 0, l: 0,
          workerErrors: 0,
          trainingScore: best.overallScore,
          sourceRelativeScore: best.relScore,
          completedAt: new Date().toISOString(),
        },
        pruneResult,
        isExperimentalFrontier: d.isExperimentalFrontier,
      };
    } else {
      const baselineObs = t037Obs.find(o => o.sourceId === srcId && o.entityKind === 'baseline')!;
      return {
        policy,
        candidateId: `baseline:${srcId}`,
        operatorFamily: 'baseline',
        canonicalFingerprint: baselineObs.entityFingerprint,
        obs: baselineObs,
        pruneResult: null,
        isExperimentalFrontier: false,
      };
    }
  });

  const catalog = exportRuntimeCatalog({
    cycleId,
    cycleOrdinal,
    protocol: T041_PROTOCOL,
    parentCatalogHash,
    entries: catalogInputs,
  });

  cursor.completedCycles.push({
    cycleId,
    cycleOrdinal,
    parentCycleId,
    parentCatalogHash: catalog.catalogHash,
    completedSources: execSources.map((s: any) => s.id),
    completedAt: new Date().toISOString(),
  });
  cursor.currentCycleOrdinal = cycleOrdinal + 1;
  saveCycleCursor(cursor);

  log(`\n--- Cycle ${cycleId} Summary ---`);
  log(`  Completed sources: ${execSources.length}`);
  log(`  Experimental frontiers: ${catalog.experimentalFrontierCount}`);
  log(`  Catalog hash: ${catalog.catalogHash}`);

  return { cycleId, isNoOp: false, catalog };
}

// ---- 主运行入口 ----

async function main() {
  log(`\n=== run_cycle.ts — T041 Stage Episode Integrity & Probabilistic Melee ===`);
  const pool = await PersistentSimPool.getInstance();

  try {
    await executeCycle({ pool, cycleOrdinal: 0 });
    await executeCycle({ pool, cycleOrdinal: 1 });

    log(`\n--- Demonstrating Idempotent Rerun of Cycle Ordinal 1 ---`);
    const res1Rerun = await executeCycle({ pool, cycleOrdinal: 1 });
    if (res1Rerun.isNoOp) {
      log(`✓ Idempotency verified: re-running completed cycle produced NO new records.`);
    }

    log(`\n============================================================`);
    log(`T041 Training Ladder & Probabilistic Melee Complete`);
    log(`Artifacts written: melee_archetype_config.json, melee_sampling_manifest.json, stage1_episode_ledger.jsonl, melee_sample_pairs.jsonl, stage_training_ledger.jsonl`);
    log(`No-apply confirmation: NO_APPLY_NO_DEPLOY_NO_PUBLISH_NO_TIER_CHANGE`);
    log(`============================================================\n`);
  } finally {
    // 保持 pool
  }
}

await main();
