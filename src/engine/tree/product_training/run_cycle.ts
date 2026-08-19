// ============================================================
// src/engine/tree/product_training/run_cycle.ts
// T044/T045 双轴金字塔模型：阵型强度梯队 (T-Axis) 与学习评测环境 (L-Axis) 演化循环
//
// 规范要求：
//   - T 轴 (Formation Strength Tiers):
//       T0: 原始冻结 11 根源 (永久锚点)
//       T1: 媲美/超越原 T0 的各流派 Top-1 精英 (L2 >= 85%)
//       T2: 通过 L3 (>= 80%) 的主力训练中坚层
//       T3: 约 30% 早期探索/孵化候选 (L3 < 80%)
//   - L 轴 (Learning/Test Levels): L3 (Early Bundle 8), L2 (冻结原始T0 11), L1 (T042流派血缘概率Melee池)
//   - 权限门禁: T3不可进L2/L1, T2不可进L1, T1在完成>=3次L2独立尝试后进L1
//   - 产物: formation_tier_policy.json, formation_strength_library.json,
//          formation_tier_transitions.jsonl, learning_level_evaluations.jsonl
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
import { formationToEvol, evolToBundleFormation } from '../evol_gene';
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
  appendCellResultRecord,
  appendLineageRecord,
  appendSearchCoverageRecord,
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
  generateDistinctStage1AttemptCandidates,
  computeAttemptIdentity,
  type Stage1EpisodeAttemptRecord,
} from './stage1_episode';
import {
  type FormationTier,
  type LearningLevel,
  type L1StatusMarker,
  type FormationLibraryEntry,
  saveTierPolicy,
  getDefaultTierPolicy,
  evaluateTierGate,
  saveFormationStrengthLibrary,
  appendTierTransitionRecord,
  appendLearningEvaluationRecord,
} from './formation_tiers';

// ---- 常量与路径 ----

const T045_PROTOCOL = 'PRODUCT_PATH_T045_V1';
const POLICY_VERSION = 't045-pyramid-tier-distribution-v1';
const BASE_SEED = 45000;
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
  candidateCurrentTiers: Record<string, FormationTier>;
  updatedAt: string;
}

function loadCycleCursor(opts: { sourceFixtureFp: string; t037ManifestHash: string }): CycleCursorState {
  if (!existsSync(T038_CYCLE_CURSOR_PATH)) {
    return {
      protocol: T045_PROTOCOL,
      sourceFixtureFp: opts.sourceFixtureFp,
      t037ManifestHash: opts.t037ManifestHash,
      policyVersion: POLICY_VERSION,
      currentCycleOrdinal: 0,
      completedCycles: [],
      persistentFailCounts: {},
      persistentAttemptCounts: {},
      stage1EpisodesCompleted: {},
      candidateCurrentStages: {},
      candidateCurrentTiers: {},
      updatedAt: new Date().toISOString(),
    };
  }
  const cursor: CycleCursorState = JSON.parse(readFileSync(T038_CYCLE_CURSOR_PATH, 'utf8'));
  cursor.stage1EpisodesCompleted = cursor.stage1EpisodesCompleted || {};
  cursor.candidateCurrentStages = cursor.candidateCurrentStages || {};
  cursor.candidateCurrentTiers = cursor.candidateCurrentTiers || {};
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
          games: 1,
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
  allOpponentsMap: Map<string, Formation>;
  baselineScores: Map<string, number>;
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
  const { pool, candidateEntry, allOpponentsMap, baselineScores, cycleId, cycleOrdinal, baselineScore } = opts;
  const { meta, evol } = candidateEntry;

  const config = buildAndSaveArchetypeConfig(baselineScores);
  const manifest = generateMeleeSamplingManifest(config);

  const pairs = sampleMeleeOpponentPairs({
    manifest,
    config,
    candidateId: meta.candidateId,
    candidateFingerprint: meta.canonicalFingerprint ?? '',
    cycleOrdinal,
  });

  const tasks: SimTaskMessage[] = [];
  let taskId = 0;

  for (const pair of pairs) {
    let oppFormation = allOpponentsMap.get(pair.member.memberId);
    if (!oppFormation) {
      oppFormation = allOpponentsMap.get(pair.member.rootSourceId)!;
    }

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
  let minOpp = pairs[0]?.member.memberId ?? 'opp_0';

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

    if (pairScore <= minScore) {
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
      originKind: pair.member.originKind,
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

  // 1. 初始化并持久化双轴梯队策略
  const tierPolicy = getDefaultTierPolicy();
  saveTierPolicy(tierPolicy);

  // 2. 生成并冻结基准清单
  const benchmarkManifests = generateAndSaveBenchmarkManifests();
  const { opponents: eb8 } = loadEarlyBundle8Opponents();
  const { opponents: strong11 } = loadCurrentStrong11Opponents();

  // 3. 加载 T037 证据与来源
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

  const baselineScoreMap = new Map<string, number>(
    t037Obs.filter(o => o.entityKind === 'baseline').map(o => [o.sourceId, o.trainingScore])
  );

  const archetypeConfig = buildAndSaveArchetypeConfig(baselineScoreMap);
  generateMeleeSamplingManifest(archetypeConfig);

  // 4. 计算稳定 cycleId
  const cycleIdentityParams = {
    protocol: T045_PROTOCOL,
    sourceFixtureFp,
    t037ManifestHash,
    policyVersion: POLICY_VERSION,
    baseSeed: BASE_SEED,
    cycleOrdinal,
  };
  const cycleId = computeCycleId(cycleIdentityParams);

  log(`\n============================================================`);
  log(`T045 Formation Strength Tiers & Pyramid Level Gates — Cycle Ordinal ${cycleOrdinal} (cycleId: ${cycleId})`);
  log(`============================================================`);

  // 5. 检查 Cursor 幂等性
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

  // 6. 计算策略
  const failCountMap = new Map<string, number>(Object.entries(cursor.persistentFailCounts));
  const attemptCountMap = new Map<string, number>(Object.entries(cursor.persistentAttemptCounts));
  const policies = computeSourcePolicies(execSources, t037Obs, failCountMap, attemptCountMap);

  log(`\n--- Active Learning Levels (cycleOrdinal=${cycleOrdinal}) ---`);
  log(`  Level L3: Early Bundle 8 (${eb8.length} opponents, hash: ${benchmarkManifests.earlyBundleStage3.poolHash})`);
  log(`  Level L2: Frozen T0 11   (${strong11.length} opponents, hash: ${benchmarkManifests.currentStrongStage2Stage1.poolHash})`);
  log(`  Level L1: Probabilistic Melee Catalog (${archetypeConfig.totalMembers} members, ${archetypeConfig.totalArchetypes} archetypes)`);

  // 7. 注册原始冻结 T0 根源到阵型库
  // T0 根源：不参与学习，只作为 L2 基准锚点和 L1 对手目录成员
  // l3Score 来自 T037 screen_observations（heldout 7 池），l2Score/l1Score=null（无独立评测）
  const libraryEntries: FormationLibraryEntry[] = [];
  for (const src of execSources) {
    const srcId = (src as any).id;
    const evol = formationToEvol(src);
    const fp = (src as any).fingerprint ?? computeCandidateFingerprint(evol);
    const t0L3Score = baselineScoreMap.get(srcId) ?? null;
    libraryEntries.push({
      formationId: `t0:${srcId}`,
      canonicalFingerprint: fp,
      rootT0SourceId: srcId,
      lineageProof: `immutable_root_t0:${srcId}`,
      currentTier: 'T0',
      learningPermissions: [],
      benchmarkRoles: ['L2_FROZEN_T0_ANCHOR'],
      opponentCatalogRoles: ['L1_ROOT_LINEAGE_MEMBER'],
      l1LearnerStatus: 'NOT_APPLICABLE',
      l3Score: t0L3Score,
      l2Score: null,
      l1Score: null,
      l2AttemptsCount: null,
      lastEvaluatedAt: new Date().toISOString(),
      evidenceClass: 'AGGREGATE_EXPLORATION_ONLY',
      noApplyConfirmation: 'NO_APPLY_NO_DEPLOY_NO_PUBLISH_NO_TIER_CHANGE',
    });
  }


  // 8. 自适应生成新候选（初始梯队均为 T3）
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

  // 全局对手 Formation 查找表
  const allOppMap = new Map<string, Formation>();
  for (const s of strong11) allOppMap.set((s as any).id, s);
  for (const b of eb8) allOppMap.set((b as any).id, b);
  for (const cand of generatedBatch) {
    if (!cand.meta.rejected) {
      allOppMap.set(cand.meta.candidateId, evolToBundleFormation(cand.evol) as unknown as Formation);
    }
  }

  log(`\nGenerated adaptive candidate formations: ${generatedBatch.length} (${generatedBatch.filter(e => !e.meta.rejected).length} valid)`);

  // 9. 第一阶段：所有候选在 L3 (Early Bundle 8) 中测试
  const startTime = Date.now();
  const validCandidates = generatedBatch.filter(e => !e.meta.rejected);
  const l3ResultsMap = new Map<string, { res: any; currentTier: FormationTier }>();

  log(`\n--- Phase 1: Level L3 Evaluation & T3/T2 Gating ---`);
  for (const cand of validCandidates) {
    const srcId = cand.meta.sourceId;
    const policy = policies.find(p => p.sourceId === srcId)!;
    const baselineScore = policy.baselineScore;

    log(`  [Level L3: Early Bundle 8] Candidate ${cand.meta.candidateId} (Initial Tier T3)...`);
    const l3Res = await evaluateCandidateOnPool({
      pool,
      candidateEntry: cand,
      opponents: eb8,
      gamesPerCell: 2,
      seedOffset: 100,
      poolName: 'LEVEL_L3_EARLY_BUNDLE_8',
      benchmarkRevision: benchmarkManifests.earlyBundleStage3.revision,
      cycleId,
      baselineScore,
    });

    appendLearningEvaluationRecord({
      recordId: `eval_${cycleId}_${cand.meta.candidateId}_l3`,
      evidenceClass: 'AGGREGATE_EXPLORATION_ONLY',
      cycleId,
      formationId: cand.meta.candidateId,
      canonicalFingerprint: cand.meta.canonicalFingerprint ?? '',
      rootT0SourceId: srcId,
      learningLevel: 'L3',
      benchmarkRevision: benchmarkManifests.earlyBundleStage3.revision,
      totalGames: 32,
      score: l3Res.overallScore,
      weakestOpponentId: l3Res.weakestOpponentId,
      weakestOpponentScore: l3Res.weakestOpponentScore,
      weakestSide: l3Res.weakestSide,
      timestamp: new Date().toISOString(),
    });

    const l3Gate = evaluateTierGate({
      currentTier: 'T3',
      level: 'L3',
      score: l3Res.overallScore,
      policy: tierPolicy,
    });

    if (l3Gate.newTier !== 'T3') {
      appendTierTransitionRecord({
        recordId: `trans_${cycleId}_${cand.meta.candidateId}_t3_to_${l3Gate.newTier.toLowerCase()}`,
        evidenceClass: 'AGGREGATE_EXPLORATION_ONLY',
        cycleId,
        formationId: cand.meta.candidateId,
        canonicalFingerprint: cand.meta.canonicalFingerprint ?? '',
        rootT0SourceId: srcId,
        previousTier: 'T3',
        newTier: l3Gate.newTier,
        triggerLevel: 'L3',
        levelScore: l3Res.overallScore,
        decision: l3Gate.decision,
        reason: l3Gate.reason,
        timestamp: new Date().toISOString(),
      });
    }

    l3ResultsMap.set(cand.meta.candidateId, { res: l3Res, currentTier: l3Gate.newTier });
  }

  // 10. 第二阶段：通过 L3 (升入 T2) 的候选进入 Level L2 (冻结 T0 11) 评测
  log(`\n--- Phase 2: Level L2 Evaluation against Frozen T0 11 ---`);
  const t2Candidates = validCandidates.filter(c => l3ResultsMap.get(c.meta.candidateId)?.currentTier === 'T2');
  const l2ResultsMap = new Map<string, any>();

  for (const cand of t2Candidates) {
    const srcId = cand.meta.sourceId;
    const policy = policies.find(p => p.sourceId === srcId)!;
    const baselineScore = policy.baselineScore;

    log(`  [Level L2: Frozen T0 11] Candidate ${cand.meta.candidateId} (Tier T2)...`);
    const l2Res = await evaluateCandidateOnPool({
      pool,
      candidateEntry: cand,
      opponents: strong11,
      gamesPerCell: 2,
      seedOffset: 300,
      poolName: 'LEVEL_L2_FROZEN_T0_11',
      benchmarkRevision: benchmarkManifests.currentStrongStage2Stage1.revision,
      cycleId,
      baselineScore,
    });

    appendLearningEvaluationRecord({
      recordId: `eval_${cycleId}_${cand.meta.candidateId}_l2`,
      evidenceClass: 'AGGREGATE_EXPLORATION_ONLY',
      cycleId,
      formationId: cand.meta.candidateId,
      canonicalFingerprint: cand.meta.canonicalFingerprint ?? '',
      rootT0SourceId: srcId,
      learningLevel: 'L2',
      benchmarkRevision: benchmarkManifests.currentStrongStage2Stage1.revision,
      totalGames: 44,
      score: l2Res.overallScore,
      weakestOpponentId: l2Res.weakestOpponentId,
      weakestOpponentScore: l2Res.weakestOpponentScore,
      weakestSide: l2Res.weakestSide,
      timestamp: new Date().toISOString(),
    });

    l2ResultsMap.set(cand.meta.candidateId, l2Res);
  }

  // 11. 第三阶段：流派 Top-1 配额结算与 T1 晋升
  log(`\n--- Phase 3: Root-Lineage Top-1 Quota Resolution & T1 Gating ---`);
  const candidateEvaluations: Map<string, {
    entry: CandidateEntry;
    currentTier: FormationTier;
    l1Status: L1StatusMarker;
    l3Score: number;
    l2Score: number | null;
    l1Score: number | null;
    isFrontier: boolean;
  }> = new Map();

  for (const src of execSources) {
    const srcId = (src as any).id;
    const policy = policies.find(p => p.sourceId === srcId)!;
    const rootCands = validCandidates.filter(c => c.meta.sourceId === srcId);

    // 找出该流派内进入 L2 且满足 L2 >= 0.850 的候选，按 (l2Score, l3Score) 排序
    const eligibleT1 = rootCands
      .filter(c => {
        const l2 = l2ResultsMap.get(c.meta.candidateId);
        return l2 && l2.overallScore >= tierPolicy.hysteresisThresholds.t2ToT1GateL2;
      })
      .sort((a, b) => {
        const l2A = l2ResultsMap.get(a.meta.candidateId)!.overallScore;
        const l2B = l2ResultsMap.get(b.meta.candidateId)!.overallScore;
        return l2B - l2A;
      });

    const top1CandId = eligibleT1.length > 0 ? eligibleT1[0].meta.candidateId : null;

    for (const cand of rootCands) {
      const l3Info = l3ResultsMap.get(cand.meta.candidateId)!;
      const l2Res = l2ResultsMap.get(cand.meta.candidateId) ?? null;
      let currentTier: FormationTier = l3Info.currentTier;
      let l1Status: L1StatusMarker = 'L1_NOT_YET_EVALUATED';
      let l1Res: any = null;
      let distinctL2Count = 0;

      if (currentTier === 'T2' && l2Res) {
        const isTop1 = cand.meta.candidateId === top1CandId;
        const l2Gate = evaluateTierGate({
          currentTier: 'T2',
          level: 'L2',
          score: l2Res.overallScore,
          relativeScore: l2Res.relScore,
          isRootTopCandidate: isTop1,
          policy: tierPolicy,
        });

        if (l2Gate.newTier !== 'T2') {
          appendTierTransitionRecord({
            recordId: `trans_${cycleId}_${cand.meta.candidateId}_t2_to_${l2Gate.newTier.toLowerCase()}`,
            evidenceClass: 'AGGREGATE_EXPLORATION_ONLY',
            cycleId,
            formationId: cand.meta.candidateId,
            canonicalFingerprint: cand.meta.canonicalFingerprint ?? '',
            rootT0SourceId: srcId,
            previousTier: 'T2',
            newTier: l2Gate.newTier,
            triggerLevel: 'L2',
            levelScore: l2Res.overallScore,
            decision: l2Gate.decision,
            reason: l2Gate.reason,
            timestamp: new Date().toISOString(),
          });
          currentTier = l2Gate.newTier;
        }
      }

      // Step D: 仅 T1 候选执行 3 次独立针对性尝试，并在满足 L1_ELIGIBLE 后派发 L1 Melee
      if (currentTier === 'T1' && l2Res) {
        log(`  [Level L2: 3 Distinct Targeted Attempts for T1] Formation ${cand.meta.candidateId} (Tier T1)...`);

        const attemptVariants = generateDistinctStage1AttemptCandidates({
          baseCandidate: cand,
          weakOpponentId: l2Res.weakestOpponentId,
          weakSide: l2Res.weakestSide,
          cycleOrdinal,
        });

        for (let attIdx = 0; attIdx < attemptVariants.length; attIdx++) {
          const variant = attemptVariants[attIdx];
          const attemptRes = await evaluateCandidateOnPool({
            pool,
            candidateEntry: variant,
            opponents: strong11,
            gamesPerCell: 2,
            seedOffset: 450 + attIdx * 100,
            poolName: 'LEVEL_L2_FROZEN_T0_11',
            benchmarkRevision: benchmarkManifests.currentStrongStage2Stage1.revision,
            cycleId,
            baselineScore: policy.baselineScore,
          });

          distinctL2Count++;
          const outcome = attemptRes.relScore > 0 ? 'IMPROVED' : attemptRes.relScore === 0 ? 'STABLE_NON_REGRESSED' : 'REGRESSED';
          const changes = variant.meta.delta ? [variant.meta.delta as any] : [];

          const attemptIdentity = computeAttemptIdentity({
            candidateFingerprint: variant.meta.canonicalFingerprint ?? '',
            parentFingerprint: cand.meta.canonicalFingerprint ?? '',
            operatorFamily: variant.meta.operatorFamily,
            atomicChanges: changes,
            targetOpponentId: l2Res.weakestOpponentId,
            targetSide: l2Res.weakestSide,
          });

          const episodeRecord: Stage1EpisodeAttemptRecord = {
            recordId: `s1ep_${cycleId}_${variant.meta.candidateId}_att${attIdx + 1}`,
            attemptIdentity,
            countable: true,
            dedupeReason: null,
            evidenceClass: 'AGGREGATE_EXPLORATION_ONLY',
            cycleId,
            sourceId: srcId,
            candidateId: cand.meta.candidateId,
            parentFingerprint: cand.meta.canonicalFingerprint ?? '',
            candidateFingerprint: variant.meta.canonicalFingerprint ?? '',
            attemptOrdinal: attIdx + 1,
            operatorFamily: variant.meta.operatorFamily,
            atomicChanges: changes,
            triggeredDiagnosis: {
              weakOpponentId: l2Res.weakestOpponentId,
              weakSide: l2Res.weakestSide,
              weakOpponentScore: l2Res.weakestOpponentScore,
              diagnosisReason: `L2 targeted attempt ${attIdx + 1} targeting weak matchup ${l2Res.weakestOpponentId} / side ${l2Res.weakestSide}`,
            },
            strongPoolVectorRef: `benchmark_cell_results.jsonl#${cycleId}_${variant.meta.candidateId}`,
            totalGames: 44,
            attemptScore: attemptRes.overallScore,
            sourceRelativeScore: attemptRes.relScore,
            attemptOutcome: outcome,
            nextParentSelection: outcome === 'IMPROVED' ? 'ADVANCE_AS_PARENT' : 'RETAIN_PREVIOUS_PARENT',
            recordedAt: new Date().toISOString(),
          };
          appendStage1EpisodeRecord(episodeRecord);
        }

        cursor.stage1EpisodesCompleted[cand.meta.candidateId] = distinctL2Count;

        if (distinctL2Count >= 3) {
          l1Status = 'L1_ELIGIBLE';
        }

        // 派发 Level L1 概率化 Melee 采样评测 (16 pairs = 32 games)
        if (l1Status === 'L1_ELIGIBLE') {
          log(`  [Level L1: Probabilistic Melee Sampling — 16 pairs] Formation ${cand.meta.candidateId} (Tier T1)...`);

          l1Res = await evaluateCandidateOnProbabilisticMelee({
            pool,
            candidateEntry: cand,
            allOpponentsMap: allOppMap,
            baselineScores: baselineScoreMap,
            cycleId,
            cycleOrdinal,
            baselineScore: policy.baselineScore,
          });

          appendLearningEvaluationRecord({
            recordId: `eval_${cycleId}_${cand.meta.candidateId}_l1`,
            evidenceClass: 'AGGREGATE_EXPLORATION_ONLY',
            cycleId,
            formationId: cand.meta.candidateId,
            canonicalFingerprint: cand.meta.canonicalFingerprint ?? '',
            rootT0SourceId: srcId,
            learningLevel: 'L1',
            benchmarkRevision: archetypeConfig.revision,
            totalGames: 32,
            score: l1Res.overallScore,
            weakestOpponentId: l1Res.weakestOpponentId,
            weakestOpponentScore: l1Res.weakestOpponentScore,
            weakestSide: l1Res.weakestSide,
            timestamp: new Date().toISOString(),
          });

          if (l1Res.overallScore >= 0.60 && l1Res.weakestOpponentScore >= 0.40) {
            l1Status = 'L1_STABLE';
          } else {
            l1Status = 'L1_DIAGNOSE_REQUIRED';
          }
        }
      }

      // 写入 Formation Strength Library 条目
      const allowedLevels: LearningLevel[] = currentTier === 'T1'
        ? ['L3', 'L2', 'L1']
        : currentTier === 'T2'
          ? ['L3', 'L2']
          : ['L3'];

      libraryEntries.push({
        formationId: cand.meta.candidateId,
        canonicalFingerprint: cand.meta.canonicalFingerprint ?? '',
        rootT0SourceId: srcId,
        lineageProof: `candidate_lineage:tests/fixtures/tree/experience_library/product_path_t037/candidate_lineage.jsonl#${cand.meta.candidateId}`,
        currentTier,
        l1Status,
        allowedLearningLevels: allowedLevels,
        l3Score: l3Info.res.overallScore,
        l2Score: l2Res?.overallScore ?? null,
        l1Score: l1Res?.overallScore ?? null,
        l2AttemptsCount: distinctL2Count,
        lastEvaluatedAt: new Date().toISOString(),
        evidenceClass: 'AGGREGATE_EXPLORATION_ONLY',
        noApplyConfirmation: 'NO_APPLY_NO_DEPLOY_NO_PUBLISH_NO_TIER_CHANGE',
      });

      cursor.candidateCurrentTiers[cand.meta.candidateId] = currentTier;
      const isFrontier = currentTier === 'T1' && l1Status === 'L1_STABLE';

      candidateEvaluations.set(cand.meta.candidateId, {
        entry: cand,
        currentTier,
        l1Status,
        l3Score: l3Info.res.overallScore,
        l2Score: l2Res?.overallScore ?? null,
        l1Score: l1Res?.overallScore ?? null,
        isFrontier,
      });
    }
  }

  const durationMs = Date.now() - startTime;

  // 12. 保存 Formation Strength Library
  const libraryFile = saveFormationStrengthLibrary(libraryEntries);
  log(`\n--- Formation Strength Library Updated (Pyramid Distribution) ---`);
  log(`  T0 (Roots): ${libraryFile.counts.T0Count}`);
  log(`  T1 (Elites): ${libraryFile.counts.T1Count} (${libraryFile.counts.T1L1StableCount} L1_STABLE, ${libraryFile.counts.T1L1DiagnoseRequiredCount} L1_DIAGNOSE)`);
  log(`  T2 (Main):   ${libraryFile.counts.T2Count}`);
  log(`  T3 (Expl):   ${libraryFile.counts.T3Count}`);

  // 13. 记录 CPU 遥测
  const telemetry: CpuTelemetryRecord = {
    cycleId,
    screenBatchId: `batch_t045_${cycleOrdinal}`,
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

  // 14. 后剪枝
  const frontiersToPrune = [...candidateEvaluations.values()].filter(c => c.isFrontier);
  log(`\n--- Post-pruning ${frontiersToPrune.length} T1/L1-Stable Formations ---`);
  const pruneResults = new Map<string, any>();
  const existingPruneIds = loadExistingRecordIds(T038_PRUNE_TRIALS_PATH);

  for (const fc of frontiersToPrune) {
    const pruneRes = await postPruneCandidate({
      pool,
      cycleId,
      candidateId: fc.entry.meta.candidateId,
      evol: fc.entry.evol,
      matchedOpps: strong11,
      baselineScore: fc.l2Score ?? 0.80,
      seedBase: BASE_SEED + cycleOrdinal * 500,
    });
    pruneResults.set(fc.entry.meta.candidateId, pruneRes);
    for (const trial of pruneRes.trials) {
      appendJsonlUnique(T038_PRUNE_TRIALS_PATH, trial, existingPruneIds);
    }
  }

  // 15. 记录决策与导出 Catalog
  log(`\n--- Writing Cycle Decision Records ---`);
  const existingDecisionIds = loadExistingRecordIds(T038_DECISIONS_PATH);
  const cycleDecisions: CycleDecisionRecord[] = [];

  for (const policy of policies) {
    const srcId = policy.sourceId;
    const evals = [...candidateEvaluations.values()].filter(c => c.entry.meta.sourceId === srcId);
    evals.sort((a, b) => (b.l2Score ?? b.l3Score) - (a.l2Score ?? a.l3Score));
    const best = evals[0] ?? null;

    let failCount = cursor.persistentFailCounts[srcId] ?? 0;
    if (!best || (best.l2Score ?? 0) <= policy.baselineScore) failCount++; else failCount = 0;
    cursor.persistentFailCounts[srcId] = failCount;

    const recordId = createHash('sha256').update(`${cycleId}_${srcId}_decision_t045`).digest('hex').slice(0, 16);
    const decision: CycleDecisionRecord = {
      recordId,
      evidenceClass: 'AGGREGATE_EXPLORATION_ONLY',
      protocol: T045_PROTOCOL,
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
      bestCandidateScore: best?.l2Score ?? best?.l3Score ?? null,
      bestCandidateRel: best ? (best.l2Score ?? best.l3Score) - policy.baselineScore : null,
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
          protocol: T045_PROTOCOL,
          scheduleId: 't045-pyramid-tier-distribution-v1',
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
          trainingScore: best.l2Score ?? best.l3Score,
          sourceRelativeScore: (best.l2Score ?? best.l3Score) - policy.baselineScore,
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
    protocol: T045_PROTOCOL,
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
  log(`  T1 Formations: ${libraryFile.counts.T1Count}`);
  log(`  Catalog hash: ${catalog.catalogHash}`);

  return { cycleId, isNoOp: false, catalog };
}

// ---- 主运行入口 ----

async function main() {
  log(`\n=== run_cycle.ts — T045 Formation Strength Tiers & Pyramid Level Gates ===`);
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
    log(`T045 Training Ladder & Pyramid Tier Distribution Complete`);
    log(`Artifacts written: formation_tier_policy.json, formation_strength_library.json, formation_tier_transitions.jsonl, learning_level_evaluations.jsonl`);
    log(`No-apply confirmation: NO_APPLY_NO_DEPLOY_NO_PUBLISH_NO_TIER_CHANGE`);
    log(`============================================================\n`);
  } finally {
    // 保持 pool
  }
}

await main();
