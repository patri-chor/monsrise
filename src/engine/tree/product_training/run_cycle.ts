// ============================================================
// src/engine/tree/product_training/run_cycle.ts
// 正统 Product Training 标准周期驱动器 (01->02->03->04->05->06 标准阶段架构)
//
// T053 升级：
//   1. 严格快照解析与隔离体系 (Fail-Closed)
//   2. 候选行为指纹去重 (Candidate De-Duplication)
//   3. 批次级 Payload 身份门禁 (Batch-Level Identity Gate)
//   4. T0 阵型全员纳入变异优化与双计数器体系 (totalAttemptsCount / effectiveAttemptsCount)
//   5. 动态 L2 难度对手池 (Dynamic L2 Strong Ladder Pool)
//   6. 三区分立标准报告输出 (带实时时间戳)
// ============================================================

import '../../env';
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import type { Formation } from '../../../ai/types';
import { PersistentSimPool } from '../persistent_pool';
import type { SimTaskMessage } from '../fine_grained_worker';
import { loadProductSources } from './01_sources';
import {
  T037_OUTPUT_DIR,
  type ScreenObservation,
  type CandidateEntry,
} from './04_screen';
import {
  computeSourcePolicies,
  generateAdaptiveCandidatesForSource,
} from './05_select';
import { formationToEvol, cloneEvolFormation, walkEvolNodes, type EvolFormation } from '../evol_gene';
import { computeCandidateFingerprint, isLegalP2Coord } from './02_candidates';
import {
  generateAndSaveBenchmarkManifests,
  loadEarlyBundle8Opponents,
  loadCurrentStrong11Opponents,
} from './benchmark_pools';
import {
  type FormationTier,
  saveTierPolicy,
  getDefaultTierPolicy,
} from './formation_tiers';
import {
  type EvalOpponentSpec,
  type EvalTargetSpec,
  verifyBatchPayloadIdentity,
} from './eval_engine';
import {
  computeScore70Metrics,
  type ActiveFormationV4,
  type DynamicTier,
  deduplicateActiveFormationsByBehavior,
} from './formation_tiers_v4';
import {
  routeLocalCandidate,
  appendLocalSolutionRoutingAudit,
  type MatchupObservation,
  type CandidateEvaluationData,
  type Score70Outcome,
} from './05_branch_routing';
import {
  FormationSnapshotResolver,
  resolveFormationSnapshot,
  registerFormationSnapshot,
  SnapshotResolutionError,
} from './snapshot_resolver';

const T045_PROTOCOL = 'PRODUCT_PATH_T045_V1';
const POLICY_VERSION = 't045-pyramid-tier-distribution-v1';
const BASE_SEED = 45000;
const T038_CYCLE_CURSOR_PATH = resolve(`${T037_OUTPUT_DIR}/t038_cycle_cursor.json`);
const T037_OBS_PATH = resolve(`${T037_OUTPUT_DIR}/screen_observations.jsonl`);
const WEB_CATALOG_PATH = resolve('public/data/l1_melee_challenge_catalog.json');
const FORMATION_LIBRARY_V4_PATH = resolve(`${T037_OUTPUT_DIR}/formation_strength_library.v4.json`);
const LEDGER_V4_PATH = resolve(`${T037_OUTPUT_DIR}/formation_winrate_audit_ledger.v4.jsonl`);
const USER_TXT_REPORT_PATH = resolve('winrate_report.txt');

function log(msg: string) { console.log(msg); }

// ---- Cycle Cursor 状态管理 ----

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
      updatedAt: new Date().toISOString(),
    };
  }
  return JSON.parse(readFileSync(T038_CYCLE_CURSOR_PATH, 'utf8'));
}

function saveCycleCursor(cursor: CycleCursorState): void {
  cursor.updatedAt = new Date().toISOString();
  const tmp = `${T038_CYCLE_CURSOR_PATH}.tmp`;
  writeFileSync(tmp, JSON.stringify(cursor, null, 2), 'utf8');
  renameSync(tmp, T038_CYCLE_CURSOR_PATH);
}

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

// ---- 阶段 04: 并发批量对战调度引擎 (含批次级 Payload 身份门禁) ----

async function dispatchBatchSimulation(
  pool: PersistentSimPool,
  targets: EvalTargetSpec[],
  opponents: EvalOpponentSpec[],
  gamesPerCell: number,
  seedBase: number,
  phaseLabel: string,
): Promise<Map<string, Score70Outcome>> {
  const tasks: SimTaskMessage[] = [];
  let taskId = 0;
  const targetTaskRanges = new Map<string, { start: number; count: number }>();

  // T053 C: 批次级 Payload 身份门禁验证
  for (const target of targets) {
    const gateRes = verifyBatchPayloadIdentity(target.canonicalFingerprint || computeCandidateFingerprint(target.evol), {
      canonicalFingerprint: target.canonicalFingerprint || computeCandidateFingerprint(target.evol),
      evol: target.evol,
    });
    if (!gateRes.valid) {
      throw new Error(`[BatchPayloadIdentityGate] Target failed identity gate: ${target.id} - ${gateRes.error}`);
    }
  }

  for (const opp of opponents) {
    const gateRes = verifyBatchPayloadIdentity(opp.canonicalFingerprint || computeCandidateFingerprint(opp.evol), {
      canonicalFingerprint: opp.canonicalFingerprint || computeCandidateFingerprint(opp.evol),
      evol: opp.evol,
    });
    if (!gateRes.valid) {
      throw new Error(`[BatchPayloadIdentityGate] Opponent failed identity gate: ${opp.id} - ${gateRes.error}`);
    }
  }

  for (let tIdx = 0; tIdx < targets.length; tIdx++) {
    const target = targets[tIdx];
    const start = tasks.length;
    const eligibleOpponents = opponents.filter(o => o.name !== target.name && o.id !== target.id);

    for (let oppIdx = 0; oppIdx < eligibleOpponents.length; oppIdx++) {
      const opp = eligibleOpponents[oppIdx];
      for (const side of [1, 2] as (1 | 2)[]) {
        tasks.push({
          taskId: taskId++,
          formalRequest: true,
          executionMode: 'product_path',
          formationA: target.evol,
          candidateFp: target.canonicalFingerprint,
          opponentNameOrId: opp.id,
          opponentFormation: {
            id: opp.id,
            name: opp.name,
            team: opp.team,
            evol: opp.evol,
          } as any,
          side,
          seed: seedBase + oppIdx * 10 + (side === 1 ? 0 : 5),
          games: gamesPerCell,
        });
      }
    }
    targetTaskRanges.set(target.id, { start, count: tasks.length - start });
  }

  const totalSimGames = tasks.length * gamesPerCell;
  log(`  [Stage 04 并发调度: ${phaseLabel}] 分发 ${tasks.length} 组对战任务 (${totalSimGames} 局)...`);

  const tStart = Date.now();
  const rawResults = await pool.dispatchTasks(tasks, phaseLabel);
  const elapsedSec = ((Date.now() - tStart) / 1000).toFixed(1);
  log(`  ✓ [Stage 04 完成: ${phaseLabel}] 完成 ${totalSimGames} 局对战，耗时 ${elapsedSec}s`);

  const outcomes = new Map<string, Score70Outcome>();
  for (const target of targets) {
    const range = targetTaskRanges.get(target.id);
    if (!range || range.count === 0) {
      outcomes.set(target.id, { w: 0, d: 0, l: 0, total: 0, score70: 0, winRate: 0, drawRate: 0, lossRate: 0 });
      continue;
    }

    let w = 0, d = 0, l = 0;
    for (let i = range.start; i < range.start + range.count; i++) {
      const r = rawResults[i];
      if (r) {
        w += r.w;
        d += r.d;
        l += r.l;
      }
    }

    const total = w + d + l;
    const score70 = total > 0 ? Number(((w + 0.70 * d) / total).toFixed(6)) : 0;
    const winRate = total > 0 ? Number((w / total).toFixed(6)) : 0;
    const drawRate = total > 0 ? Number((d / total).toFixed(6)) : 0;
    const lossRate = total > 0 ? Number((l / total).toFixed(6)) : 0;

    outcomes.set(target.id, { w, d, l, total, score70, winRate, drawRate, lossRate });
  }

  return outcomes;
}

// ---- 主周期执行函数 ----

export async function executeCycle(cycleOrdinal: number, pool: PersistentSimPool): Promise<void> {
  const sourcesData = loadProductSources();
  const execSources = sourcesData.executable;
  const t037Obs: ScreenObservation[] = existsSync(T037_OBS_PATH)
    ? readFileSync(T037_OBS_PATH, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
    : [];
  const policies = computeSourcePolicies(execSources, t037Obs);

  // 初始化权威快照解析器
  const resolver = FormationSnapshotResolver.getInstance();
  resolver.init();

  const sourcesHash = createHash('sha256')
    .update(JSON.stringify(sourcesData.executable))
    .digest('hex')
    .slice(0, 16);

  const cycleId = computeCycleId({
    protocol: T045_PROTOCOL,
    sourceFixtureFp: sourcesHash,
    t037ManifestHash: sourcesHash,
    policyVersion: POLICY_VERSION,
    baseSeed: BASE_SEED,
    cycleOrdinal,
  });

  log(`\n============================================================`);
  log(`Product Training Standard Pipeline — Cycle ${cycleOrdinal} (cycleId: ${cycleId})`);
  log(`============================================================`);

  // 加载存量阵型库
  let currentLibFormations: ActiveFormationV4[] = [];
  if (existsSync(FORMATION_LIBRARY_V4_PATH)) {
    const raw = JSON.parse(readFileSync(FORMATION_LIBRARY_V4_PATH, 'utf8'));
    currentLibFormations = raw.formations ?? [];
  } else {
    // 初始加载 11 个 R0 原阵
    for (const src of execSources) {
      const srcId = (src as any).id;
      const snap = resolveFormationSnapshot({ formationId: `t0:${srcId}`, rootR0SourceId: srcId });
      currentLibFormations.push({
        formationId: `t0:${srcId}`,
        rootR0SourceId: srcId,
        displayName: (src as any).name ?? srcId,
        canonicalFingerprint: snap.canonicalFingerprint,
        calculatorPolicyFingerprint: 'calc_pol_default_v1',
        activeRoles: ['CURRENT_ROOT_MAIN', 'ACTIVE_TRAINING_PARENT', 'ACTIVE_COMPETITOR'],
        currentDynamicTier: 'T0',
        previousTier: 'T0',
        activeLibraryRevision: `v4.7.0-cycle-${cycleOrdinal}`,
        activeL2ManifestHash: '5f9556d0b3990743',
        activeL2Metrics: null,
        l1Metrics: null,
        l3Metrics: null,
        verificationState: 'INDEPENDENT_VERIFIED',
        l2AttemptsCount: 0,
        totalAttemptsCount: 0,
        effectiveAttemptsCount: 0,
        regradeReason: 'Initial Root Main Anchor',
        updatedAt: new Date().toISOString(),
      });
    }
  }

  // -------------------------------------------------------------
  // Stage 00: T053 身份隔离与行为指纹去重 (Lineage Quarantine & Deduplication)
  // -------------------------------------------------------------
  const quarantinedLineage = resolver.getQuarantinedRecords();
  const quarantinedIds = new Set(quarantinedLineage.map(q => q.candidateId));

  for (const f of currentLibFormations) {
    if (quarantinedIds.has(f.formationId) || !resolver.hasSnapshot(f.formationId)) {
      f.activeRoles = ['SNAPSHOT_IDENTITY_INVALID_PRE_T053'];
      f.verificationState = 'SNAPSHOT_IDENTITY_INVALID';
      const qRec = quarantinedLineage.find(q => q.candidateId === f.formationId);
      f.regradeReason = qRec
        ? `Quarantined by T053: ${qRec.failureReason}`
        : `Quarantined by T053: No valid lineage or exact snapshot recoverable (fp: ${f.canonicalFingerprint})`;
    }
  }

  const { activeUnique, duplicates } = deduplicateActiveFormationsByBehavior(currentLibFormations);
  const totalQuarantined = currentLibFormations.filter(f => f.activeRoles.includes('SNAPSHOT_IDENTITY_INVALID_PRE_T053')).length;
  log(`  [Stage 00 身份门禁与去重] 总记录: ${currentLibFormations.length}, 活跃唯一参评: ${activeUnique.length}, 行为重复归档: ${duplicates.length}, 异常隔离: ${totalQuarantined}`);

  // -------------------------------------------------------------
  // Stage 01: 构建动态 L2 难度对手池 (Dynamic L2 Strong Ladder Pool)
  // 动态采用当前各根系最强的 T0 演化主阵 (不足时由顶尖 T1 补充至 11 套)
  // -------------------------------------------------------------
  const t0Active = activeUnique.filter(f => f.currentDynamicTier === 'T0');
  const t1Active = activeUnique.filter(f => f.currentDynamicTier === 'T1').sort((a, b) => {
    const sA = a.l1Metrics?.primaryScore70 ?? a.activeL2Metrics?.primaryScore70 ?? 0;
    const sB = b.l1Metrics?.primaryScore70 ?? b.activeL2Metrics?.primaryScore70 ?? 0;
    return sB - sA;
  });

  const dynamicStrongPool: ActiveFormationV4[] = [...t0Active];
  if (dynamicStrongPool.length < 11) {
    for (const t1 of t1Active) {
      if (dynamicStrongPool.length >= 11) break;
      if (!dynamicStrongPool.some(x => x.formationId === t1.formationId)) {
        dynamicStrongPool.push(t1);
      }
    }
  }

  const strong11Specs: EvalOpponentSpec[] = [];
  for (const strongF of dynamicStrongPool.slice(0, 11)) {
    const snap = resolveFormationSnapshot({
      formationId: strongF.formationId,
      canonicalFingerprint: strongF.canonicalFingerprint,
      rootR0SourceId: strongF.rootR0SourceId,
    });
    strong11Specs.push({
      id: strongF.formationId,
      name: strongF.displayName || strongF.formationId,
      team: snap.team,
      evol: snap.evol,
      canonicalFingerprint: snap.canonicalFingerprint,
      calculatorPolicyFingerprint: snap.calculatorPolicyFingerprint,
    });
  }

  log(`  [Stage 01 动态L2强池] 已构建 ${strong11Specs.length} 套天梯强阵 (随演化动态增强)`);

  // -------------------------------------------------------------
  // Stage 02: 全员对战优化 (仅以 T0 根系主阵作为亲本变体源生成新探索候选)
  // -------------------------------------------------------------
  const optimizeTargets: EvalTargetSpec[] = [];
  const candidateParentMap = new Map<string, string>();

  // 1. 全部活跃阵型 (T0、T1、T2、T3 等) 加入对战评测队列
  for (const f of activeUnique) {
    const snap = resolveFormationSnapshot({
      formationId: f.formationId,
      canonicalFingerprint: f.canonicalFingerprint,
      rootR0SourceId: f.rootR0SourceId,
    });

    optimizeTargets.push({
      id: f.formationId,
      name: f.displayName || f.formationId,
      team: snap.team,
      evol: snap.evol,
      canonicalFingerprint: snap.canonicalFingerprint,
      calculatorPolicyFingerprint: snap.calculatorPolicyFingerprint,
    });

    f.totalAttemptsCount = (f.totalAttemptsCount ?? 0) + 1;
  }

  // 2. 仅以 T0 主阵作为变体源，生成针对性局部变异体
  const t0Parents = activeUnique.filter(f => f.currentDynamicTier === 'T0');
  for (const parent of t0Parents) {
    const parentSnap = resolveFormationSnapshot({
      formationId: parent.formationId,
      canonicalFingerprint: parent.canonicalFingerprint,
      rootR0SourceId: parent.rootR0SourceId,
    });

    const evolMut = cloneEvolFormation(parentSnap.evol);
    const r1Node = walkEvolNodes(evolMut.root).find(n => n.round === 1) || evolMut.root;
    if (r1Node.placements.length > 0) {
      const p = r1Node.placements[0];
      p.x = Math.min(10, p.x + 1);
    }

    const mutFp = computeCandidateFingerprint(evolMut);
    const mutId = `cand:${parent.rootR0SourceId}:mut_c${cycleOrdinal}_${mutFp.slice(0, 6)}`;
    evolMut.name = mutId;

    const mutSnap: ResolvedFormationSnapshot = {
      formationId: mutId,
      displayName: mutId,
      canonicalFingerprint: mutFp,
      calculatorPolicyFingerprint: 'calc_pol_default_v1',
      team: parentSnap.team.map(s => ({ monsterId: s.monsterId, badgeIds: [...s.badgeIds] })),
      evol: evolMut,
      provenance: `mutation_c${cycleOrdinal}#${parent.formationId}`,
      rootR0SourceId: parent.rootR0SourceId,
    };
    registerFormationSnapshot(mutSnap);

    optimizeTargets.push({
      id: mutId,
      name: mutId,
      team: mutSnap.team,
      evol: mutSnap.evol,
      canonicalFingerprint: mutFp,
      calculatorPolicyFingerprint: mutSnap.calculatorPolicyFingerprint,
    });
    candidateParentMap.set(mutId, parent.formationId);
  }

  log(`  [Stage 02 亲本演化] 生成评测对战队列共 ${optimizeTargets.length} 套 (含 ${activeUnique.length} 套活跃受测阵型 + ${t0Parents.length} 套 T0 亲本衍生变体)`);

  // -------------------------------------------------------------
  // Stage 03: 动态构建 L1 混战池 (按 11 根系区分与胜率加权)
  // -------------------------------------------------------------
  const poolMembers = activeUnique.filter(f => 
    f.currentDynamicTier === 'T0' || f.currentDynamicTier === 'T1' || f.currentDynamicTier === 'T2'
  );

  const membersByRoot = new Map<string, ActiveFormationV4[]>();
  for (const f of poolMembers) {
    const rootId = f.rootR0SourceId || f.formationId;
    if (!membersByRoot.has(rootId)) membersByRoot.set(rootId, []);
    membersByRoot.get(rootId)!.push(f);
  }

  const dynamicMeleeOpponents: EvalOpponentSpec[] = [];
  for (const src of execSources) {
    const srcId = (src as any).id;
    const candidatesInRoot = membersByRoot.get(srcId) ?? [];

    if (candidatesInRoot.length > 0) {
      const sorted = [...candidatesInRoot].sort((a, b) => {
        const scoreA = a.l1Metrics?.primaryScore70 ?? a.activeL2Metrics?.primaryScore70 ?? 0.50;
        const scoreB = b.l1Metrics?.primaryScore70 ?? b.activeL2Metrics?.primaryScore70 ?? 0.50;
        return scoreB - scoreA;
      });

      for (const chosen of sorted.slice(0, 2)) {
        const snap = resolveFormationSnapshot({
          formationId: chosen.formationId,
          canonicalFingerprint: chosen.canonicalFingerprint,
          rootR0SourceId: chosen.rootR0SourceId,
        });
        dynamicMeleeOpponents.push({
          id: chosen.formationId,
          name: chosen.displayName || chosen.formationId,
          team: snap.team,
          evol: snap.evol,
          canonicalFingerprint: snap.canonicalFingerprint,
          calculatorPolicyFingerprint: snap.calculatorPolicyFingerprint,
        });
      }
    } else {
      const snap = resolveFormationSnapshot({ formationId: `t0:${srcId}`, rootR0SourceId: srcId });
      dynamicMeleeOpponents.push({
        id: `t0:${srcId}`,
        name: (src as any).name ?? srcId,
        team: snap.team,
        evol: snap.evol,
        canonicalFingerprint: snap.canonicalFingerprint,
        calculatorPolicyFingerprint: snap.calculatorPolicyFingerprint,
      });
    }
  }

  // -------------------------------------------------------------
  // Stage 04: 多层级对战评测 (Level L2 动态强池 & Level L1 动态混战池)
  // 每 side 5 局 (每个对战单元共 10 局)
  // -------------------------------------------------------------
  const l2Results = await dispatchBatchSimulation(
    pool,
    optimizeTargets,
    strong11Specs,
    5, // 5 局/side
    BASE_SEED + cycleOrdinal * 1000 + 200,
    `Cycle_${cycleOrdinal}_L2_StrongPool`,
  );

  const needL1Specs: EvalTargetSpec[] = [];
  for (const target of optimizeTargets) {
    const l2Res = l2Results.get(target.id);
    const isMainTier = activeUnique.some(f => f.formationId === target.id && (f.currentDynamicTier === 'T0' || f.currentDynamicTier === 'T1' || f.currentDynamicTier === 'T2'));
    const isPromisingCand = l2Res && l2Res.score70 >= 0.50;
    if (isMainTier || isPromisingCand) {
      needL1Specs.push(target);
    }
  }

  const l1Results = await dispatchBatchSimulation(
    pool,
    needL1Specs,
    dynamicMeleeOpponents,
    5, // 5 局/side
    BASE_SEED + cycleOrdinal * 1000 + 800,
    `Cycle_${cycleOrdinal}_L1_DynamicMelee`,
  );

  // -------------------------------------------------------------
  // Stage 05: 突破吸收、双计数器演化与动态天梯判定
  // -------------------------------------------------------------
  for (const f of activeUnique) {
    const currL2 = l2Results.get(f.formationId);
    const currL1 = l1Results.get(f.formationId);

    const optVariants = Array.from(candidateParentMap.entries())
      .filter(([candId, pId]) => pId === f.formationId)
      .map(([candId]) => ({
        id: candId,
        l2: l2Results.get(candId),
        l1: l1Results.get(candId),
      }))
      .filter(v => v.l2 !== undefined);

    if (optVariants.length > 0) {
      optVariants.sort((a, b) => (b.l2?.score70 ?? 0) - (a.l2?.score70 ?? 0));
      const bestOpt = optVariants[0];

      if (currL2 && bestOpt.l2 && bestOpt.l2.score70 > currL2.score70 + 0.005) {
        // GLOBAL_IMPROVEMENT: 全局突破，吸收变体快照
        const bestSnap = resolveFormationSnapshot({ formationId: bestOpt.id });
        f.canonicalFingerprint = bestSnap.canonicalFingerprint;
        f.activeLibraryRevision = `v4.7.0-cycle-${cycleOrdinal}`;
        f.activeL2Metrics = computeScore70Metrics(bestOpt.l2.w, bestOpt.l2.d, bestOpt.l2.l);
        if (bestOpt.l1) f.l1Metrics = computeScore70Metrics(bestOpt.l1.w, bestOpt.l1.d, bestOpt.l1.l);
        f.regradeReason = `Global Improvement via c${cycleOrdinal} (L2: ${(bestOpt.l2.score70 * 100).toFixed(1)}%)`;
        f.effectiveAttemptsCount = (f.effectiveAttemptsCount ?? 0) + 1;

        // 重新绑定 parent 快照
        registerFormationSnapshot({
          ...bestSnap,
          formationId: f.formationId,
          displayName: f.displayName,
        });
      } else {
        if (currL2) f.activeL2Metrics = computeScore70Metrics(currL2.w, currL2.d, currL2.l);
        if (currL1) f.l1Metrics = computeScore70Metrics(currL1.w, currL1.d, currL1.l);
      }
    } else {
      if (currL2) f.activeL2Metrics = computeScore70Metrics(currL2.w, currL2.d, currL2.l);
      if (currL1) f.l1Metrics = computeScore70Metrics(currL1.w, currL1.d, currL1.l);
    }

    const scoreL1 = f.l1Metrics?.primaryScore70 ?? null;
    const scoreL2 = f.activeL2Metrics?.primaryScore70 ?? null;

    if (f.currentDynamicTier !== 'T0') {
      if (scoreL1 !== null && scoreL1 >= 0.70) f.currentDynamicTier = 'T1';
      else if (scoreL2 !== null && scoreL2 >= 0.85) f.currentDynamicTier = 'T1';
      else if (scoreL1 !== null && scoreL1 >= 0.45) f.currentDynamicTier = 'T2';
      else if (scoreL2 !== null && scoreL2 >= 0.45) f.currentDynamicTier = 'T2';
      else f.currentDynamicTier = 'T3';
    }

    f.updatedAt = new Date().toISOString();
  }

  // -------------------------------------------------------------
  // Stage 06: 数据落盘与三区分立汇总报告
  // -------------------------------------------------------------
  exportStandardLibraryAndReport(currentLibFormations, cycleOrdinal);

  const cursor = loadCycleCursor({
    sourceFixtureFp: sourcesHash,
    t037ManifestHash: sourcesHash,
  });
  cursor.currentCycleOrdinal = cycleOrdinal + 1;
  cursor.completedCycles.push({
    cycleId,
    cycleOrdinal,
    parentCycleId: null,
    parentCatalogHash: null,
    completedSources: execSources.map((s: any) => s.id),
    completedAt: new Date().toISOString(),
  });
  saveCycleCursor(cursor);

  log(`✓ [Cycle ${cycleOrdinal} 全部阶段完成] 阵型库与报告已权威同步更新。\n`);
}

// ---- 标准制品导出与中文分层报告生成 ----

function exportStandardLibraryAndReport(formations: ActiveFormationV4[], cycleOrdinal: number): void {
  const activeOnly = formations.filter(x => !x.activeRoles.includes('DUPLICATE_BEHAVIOR_FINGERPRINT_HISTORICAL') && !x.activeRoles.includes('SNAPSHOT_IDENTITY_INVALID_PRE_T053'));
  const duplicates = formations.filter(x => x.activeRoles.includes('DUPLICATE_BEHAVIOR_FINGERPRINT_HISTORICAL'));
  const quarantined = formations.filter(x => x.activeRoles.includes('SNAPSHOT_IDENTITY_INVALID_PRE_T053'));

  const t0Count = activeOnly.filter(x => x.currentDynamicTier === 'T0').length;
  const t1Count = activeOnly.filter(x => x.currentDynamicTier === 'T1').length;
  const t2Count = activeOnly.filter(x => x.currentDynamicTier === 'T2').length;
  const t3Count = activeOnly.filter(x => x.currentDynamicTier === 'T3').length;

  const libraryPayload = {
    schemaVersion: 'T051_FORMATION_LIBRARY_V4',
    libraryRevision: `v4.7.0-cycle-${cycleOrdinal}`,
    updatedAt: new Date().toISOString(),
    counts: {
      activeTotal: activeOnly.length,
      T0Count: t0Count,
      T1Count: t1Count,
      T2Count: t2Count,
      T3Count: t3Count,
      duplicatesCount: duplicates.length,
      quarantinedCount: quarantined.length,
    },
    formations,
  };

  writeFileSync(FORMATION_LIBRARY_V4_PATH, JSON.stringify(libraryPayload, null, 2), 'utf8');

  // 生成三区分立格式报告
  const now = new Date();
  const timeStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

  const txtLines: string[] = [];
  txtLines.push('========================================================================================================================');
  txtLines.push(`                          MONSRISE 阵型胜率与优化次数汇总报告 (Cycle ${cycleOrdinal} 正统系统训练同步版)                  `);
  txtLines.push(`                                         更新时间: ${timeStr}                                            `);
  txtLines.push('========================================================================================================================');

  // 1. 活跃参评阵型
  txtLines.push('【板块一：活跃参评阵型 (Active Evaluated Formations)】');
  txtLines.push(
    '阵型名称 (Formation ID)'.padEnd(42) + ' | ' +
    'R0 根谱系'.padEnd(12) + ' | ' +
    '层级 (Tier)'.padEnd(10) + ' | ' +
    'L3 胜率'.padEnd(10) + ' | ' +
    'L2 胜率'.padEnd(10) + ' | ' +
    'L1 实测胜率'.padEnd(14) + ' | ' +
    '优化尝试(生效)'
  );
  txtLines.push('------------------------------------------------------------------------------------------------------------------------');

  const tierOrder: Record<string, number> = { T0: 5, T1: 4, T2: 3, T3: 2, T4: 1 };
  const sortedActive = [...activeOnly].sort((a, b) => {
    if (tierOrder[b.currentDynamicTier] !== tierOrder[a.currentDynamicTier]) {
      return (tierOrder[b.currentDynamicTier] ?? 0) - (tierOrder[a.currentDynamicTier] ?? 0);
    }
    const aScore = a.l1Metrics?.primaryScore70 ?? a.activeL2Metrics?.primaryScore70 ?? 0;
    const bScore = b.l1Metrics?.primaryScore70 ?? b.activeL2Metrics?.primaryScore70 ?? 0;
    return bScore - aScore;
  });

  for (const f of sortedActive) {
    const idStr = f.formationId.length > 42 ? f.formationId.slice(0, 39) + '...' : f.formationId.padEnd(42);
    const r0Str = f.rootR0SourceId.padEnd(12);
    const tierStr = f.currentDynamicTier.padEnd(10);
    
    let l3Str = '-';
    if (f.l3Metrics && f.l3Metrics.n > 0) l3Str = `${(f.l3Metrics.primaryScore70 * 100).toFixed(1)}%`;
    let l2Str = '-';
    if (f.activeL2Metrics && f.activeL2Metrics.n > 0) l2Str = `${(f.activeL2Metrics.primaryScore70 * 100).toFixed(1)}%`;
    let l1Str = '-';
    if (f.l1Metrics && f.l1Metrics.n > 0) l1Str = `${(f.l1Metrics.primaryScore70 * 100).toFixed(1)}%`;

    const totalAtt = f.totalAttemptsCount ?? f.l2AttemptsCount ?? 0;
    const effAtt = f.effectiveAttemptsCount ?? 0;
    const attemptsStr = `${totalAtt} (${effAtt})`.padStart(12);

    txtLines.push(
      `${idStr} | ${r0Str} | ${tierStr} | ${l3Str.padStart(8)}   | ${l2Str.padStart(8)}   | ${l1Str.padStart(10)}   | ${attemptsStr}`
    );
  }

  // 2. 行为重复归档阵型
  if (duplicates.length > 0) {
    txtLines.push('\n------------------------------------------------------------------------------------------------------------------------');
    txtLines.push('【板块二：行为重复归档阵型 (Duplicate Behavior Formations - Excluded from Active Play)】');
    txtLines.push(
      '阵型名称 (Formation ID)'.padEnd(42) + ' | ' +
      '行为代表阵型 (Duplicate Of)'.padEnd(30) + ' | ' +
      '精确指纹 (Canonical Fingerprint)'
    );
    txtLines.push('------------------------------------------------------------------------------------------------------------------------');
    for (const d of duplicates) {
      const idStr = d.formationId.length > 42 ? d.formationId.slice(0, 39) + '...' : d.formationId.padEnd(42);
      const repStr = (d.duplicateOfFormationId ?? 'N/A').padEnd(30);
      txtLines.push(`${idStr} | ${repStr} | ${d.canonicalFingerprint}`);
    }
  }

  // 3. 身份异常隔离阵型
  if (quarantined.length > 0) {
    txtLines.push('\n------------------------------------------------------------------------------------------------------------------------');
    txtLines.push('【板块三：身份异常隔离阵型 (Quarantined Formations - T053 Fail Closed)】');
    txtLines.push(
      '阵型名称 (Formation ID)'.padEnd(42) + ' | ' +
      '隔离原因 (Quarantine Reason)'
    );
    txtLines.push('------------------------------------------------------------------------------------------------------------------------');
    for (const q of quarantined) {
      const idStr = q.formationId.length > 42 ? q.formationId.slice(0, 39) + '...' : q.formationId.padEnd(42);
      txtLines.push(`${idStr} | ${q.regradeReason}`);
    }
  }

  txtLines.push('========================================================================================================================');
  txtLines.push(`统计总数: 活跃参评阵型共 ${activeOnly.length} 套 (T0: ${t0Count}, T1: ${t1Count}, T2: ${t2Count}, T3: ${t3Count}) | 行为重复归档: ${duplicates.length} 套 | 身份异常隔离: ${quarantined.length} 套`);
  txtLines.push('规则与演化说明:');
  txtLines.push('  - 对战参数: 每 side 5 局（每个 pair 完整镜像共 10 局）');
  txtLines.push('  - T0 全员优化: 全部 T0 根系主阵与活跃阵型均参与变异爬山优化');
  txtLines.push('  - 动态 L2 难度: L2 对手池由当前最新演化后的 T0/T1 顶尖战力构成，随演化水涨船高');
  txtLines.push('  - 优化次数: 严格分离为【总优化尝试次数】与【产生全局突破的生效次数】');
  txtLines.push('========================================================================================================================\n');

  writeFileSync(USER_TXT_REPORT_PATH, txtLines.join('\n'), 'utf8');
}

// ---- 主程序入口 ----

async function main() {
  const args = process.argv.slice(2);
  const cyclesArg = args.find(a => a.startsWith('--cycles='));
  const targetCycles = cyclesArg ? parseInt(cyclesArg.split('=')[1], 10) : 1;

  log(`\n=== run_cycle.ts — Product Training Multi-Cycle Standard Engine ===`);
  log(`  Target Cycles: ${targetCycles} | Dynamic Pool Capacity: 32 Workers | Target CPU Load: 80%\n`);

  const pool = PersistentSimPool.getInstance({
    workerCount: 32,
    enableCpuMonitor: true,
    targetCpuUsage: 0.80,
  });
  await pool.init();

  for (let c = 0; c < targetCycles; c++) {
    await executeCycle(c, pool);
  }

  await pool.terminate();
  log(`All ${targetCycles} product training cycles finished successfully.`);
  process.exit(0);
}

if (process.argv[1] && process.argv[1].includes('run_cycle')) {
  main().catch(err => {
    console.error('Fatal Pipeline Execution Error:', err);
    process.exit(1);
  });
}
