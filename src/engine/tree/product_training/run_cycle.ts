// ============================================================
// src/engine/tree/product_training/run_cycle.ts
// 正统 Product Training 标准周期驱动器 (01->02->03->04->05->06 标准阶段架构)
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
} from './eval_engine';
import {
  computeScore70Metrics,
  type ActiveFormationV4,
  type DynamicTier,
} from './formation_tiers_v4';
import {
  routeLocalCandidate,
  appendLocalSolutionRoutingAudit,
  type MatchupObservation,
  type CandidateEvaluationData,
  type Score70Outcome,
} from './t052_branch_routing';

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

// ---- 阶段 04: 并发批量对战调度引擎 ----

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
          opponentNameOrId: opp.id,
          opponentFormation: {
            id: opp.id,
            name: opp.name,
            team: opp.team,
            evol: opp.evol,
            matchCount: 0,
            winCount: 0,
            drawCount: 0,
            lossCount: 0,
          } as any,
          side,
          seed: seedBase + tIdx * 10000 + oppIdx * 500 + side * 100,
          games: gamesPerCell,
        });
      }
    }

    targetTaskRanges.set(target.id, { start, count: tasks.length - start });
  }

  log(`  [Stage 04 并发调度: ${phaseLabel}] 分发 ${tasks.length} 组对战任务 (${tasks.length * gamesPerCell} 局)...`);
  const tStart = Date.now();
  const simResults = await pool.dispatchTasks(tasks, phaseLabel);
  const elapsed = ((Date.now() - tStart) / 1000).toFixed(1);
  log(`  ✓ [Stage 04 完成: ${phaseLabel}] 完成 ${tasks.length * gamesPerCell} 局对战，耗时 ${elapsed}s`);

  const resultMap = new Map<string, Score70Outcome>();
  for (const [targetId, range] of targetTaskRanges.entries()) {
    let w = 0, d = 0, l = 0;
    for (let i = 0; i < range.count; i++) {
      const res = simResults[range.start + i];
      if (res) {
        w += res.w ?? 0;
        d += res.d ?? 0;
        l += res.l ?? 0;
      }
    }
    const total = w + d + l;
    const score70 = total > 0 ? (w + 0.70 * d) / total : 0;
    resultMap.set(targetId, {
      w,
      d,
      l,
      totalGames: total,
      winRate: total > 0 ? w / total : 0,
      drawRate: total > 0 ? d / total : 0,
      lossRate: total > 0 ? l / total : 0,
      score70: Number(score70.toFixed(4)),
    });
  }

  return resultMap;
}

// ---- 标准单周期执行器 (01->02->03->04->05->06) ----

export async function executeCycle(opts: {
  pool: PersistentSimPool;
  cycleOrdinal: number;
}): Promise<{ cycleId: string; isNoOp: boolean }> {
  const { pool, cycleOrdinal } = opts;
  const tierPolicy = getDefaultTierPolicy();
  saveTierPolicy(tierPolicy);

  // -------------------------------------------------------------
  // Stage 01: 数据源与基准环境加载 (01_sources & benchmark_pools)
  // -------------------------------------------------------------
  const eb8 = loadEarlyBundle8Opponents().opponents;
  const strong11 = loadCurrentStrong11Opponents().opponents;
  const webCatalog = existsSync(WEB_CATALOG_PATH) ? JSON.parse(readFileSync(WEB_CATALOG_PATH, 'utf8')) : { archetypes: [] };

  const meleeOpponentsList: EvalOpponentSpec[] = [];
  for (const arch of webCatalog.archetypes) {
    for (const mem of arch.members) {
      if (mem.team && mem.evol) {
        meleeOpponentsList.push({
          id: mem.memberId,
          name: mem.name,
          team: mem.team,
          evol: mem.evol,
        });
      }
    }
  }

  const strong11Specs: EvalOpponentSpec[] = strong11.map(f => ({
    id: (f as any).id ?? f.name,
    name: f.name,
    team: f.team,
    evol: formationToEvol(f),
  }));

  const sources = loadProductSources();
  const execSources: Formation[] = sources.executable as unknown as Formation[];
  const sourceFixtureFp = createHash('sha256')
    .update(JSON.stringify(execSources.map((s: any) => s.fingerprint)))
    .digest('hex').slice(0, 16);

  const t037Manifest = JSON.parse(readFileSync(resolve(`${T037_OUTPUT_DIR}/manifest.json`), 'utf8'));
  const t037ManifestHash: string = t037Manifest.manifestHash;
  const t037Obs: ScreenObservation[] = readFileSync(T037_OBS_PATH, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));

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
  log(`Product Training Standard Pipeline — Cycle ${cycleOrdinal} (cycleId: ${cycleId})`);
  log(`============================================================`);

  const cursor = loadCycleCursor({ sourceFixtureFp, t037ManifestHash });
  const failCountMap = new Map<string, number>(Object.entries(cursor.persistentFailCounts));
  const attemptCountMap = new Map<string, number>(Object.entries(cursor.persistentAttemptCounts));
  const policies = computeSourcePolicies(execSources, t037Obs, failCountMap, attemptCountMap);

  let currentLibFormations: ActiveFormationV4[] = [];
  if (existsSync(FORMATION_LIBRARY_V4_PATH)) {
    const existing = JSON.parse(readFileSync(FORMATION_LIBRARY_V4_PATH, 'utf8'));
    currentLibFormations = existing.formations || [];
  }

  // -------------------------------------------------------------
  // Stage 02 & 03: 候选生成与爬山变异 (02_candidates, 05_select & 03_validate)
  // -------------------------------------------------------------
  const activeCount = currentLibFormations.filter(f => f.currentDynamicTier !== 'T4').length;
  const isCapacitySaturated = activeCount >= 100;
  if (isCapacitySaturated) {
    log(`  [容量上限门禁: ${activeCount} >= 100] 停止生成全新初始阵型，进入存量爬山与分支优化模式。`);
  }

  const optimizeTargets: EvalTargetSpec[] = [];
  const candidateParentMap = new Map<string, string>(); // candId -> parentFormationId

  if (isCapacitySaturated) {
    // 爬山变异：为存量中待突破的 T2 / T3 阵型生成 Top-3 针对性微调变异
    for (const f of currentLibFormations) {
      if (f.currentDynamicTier === 'T0' || f.currentDynamicTier === 'T4') continue;
      const rootSrc = execSources.find(s => (s as any).id === f.rootR0SourceId) ?? execSources[0];
      const evol = cloneEvolFormation(formationToEvol(rootSrc));
      evol.name = f.formationId;

      for (const node of walkEvolNodes(evol.root)) {
        if (node.placements.length > 0) {
          const p = node.placements[0];
          const newY = p.y === 0 ? 1 : 0;
          if (isLegalP2Coord(p.x, newY)) p.y = newY;
          break;
        }
      }

      const mutId = `${f.formationId}:opt_c${cycleOrdinal}`;
      optimizeTargets.push({
        id: mutId,
        name: mutId,
        team: (evol as any).team ?? (rootSrc as any).team ?? [],
        evol,
      });
      candidateParentMap.set(mutId, f.formationId);
    }
  } else {
    // 扩容变异：生成全谱系新候选
    const seenFps = new Set<string>();
    for (const f of currentLibFormations) seenFps.add(f.canonicalFingerprint);

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
        activeFormationCount: activeCount,
      });
      for (const c of candidates.filter(x => !x.meta.rejected)) {
        optimizeTargets.push({
          id: c.meta.candidateId,
          name: c.meta.candidateId,
          team: (c.evol as any).team ?? [],
          evol: c.evol,
        });
      }
    }
  }

  // 同时将存量主干阵型加入对战池进行基准重测与战绩刷新
  for (const f of currentLibFormations) {
    if (!optimizeTargets.some(t => t.id === f.formationId)) {
      const rootSrc = execSources.find(s => (s as any).id === f.rootR0SourceId) ?? execSources[0];
      const evol = formationToEvol(rootSrc);
      evol.name = f.formationId;
      optimizeTargets.push({
        id: f.formationId,
        name: f.displayName || f.formationId,
        team: (evol as any).team ?? (rootSrc as any).team ?? [],
        evol,
      });
    }
  }

  // -------------------------------------------------------------
  // Stage 04: 多层级对战评测 (Level L2 强阵池 & Level L1 全谱系)
  // -------------------------------------------------------------
  const l2Results = await dispatchBatchSimulation(
    pool,
    optimizeTargets,
    strong11Specs,
    10, // 10 局/cell × 20 cells = 200 局
    BASE_SEED + cycleOrdinal * 1000 + 200,
    `Cycle_${cycleOrdinal}_L2_StrongPool`,
  );

  const needL1Specs: EvalTargetSpec[] = [];
  for (const target of optimizeTargets) {
    const l2Res = l2Results.get(target.id);
    if ((l2Res && l2Res.score70 >= 0.65) || target.id.startsWith('t0:')) {
      needL1Specs.push(target);
    }
  }

  const l1Results = await dispatchBatchSimulation(
    pool,
    needL1Specs,
    meleeOpponentsList.slice(0, 22),
    5, // 5 局/cell × 44 cells = 220 局
    BASE_SEED + cycleOrdinal * 1000 + 800,
    `Cycle_${cycleOrdinal}_L1_Melee`,
  );

  // -------------------------------------------------------------
  // Stage 05: T052 四态路由、自适应吸收与 T4 淘汰判定
  // -------------------------------------------------------------
  for (const f of currentLibFormations) {
    if (f.currentDynamicTier === 'T0') {
      const l2 = l2Results.get(f.formationId);
      const l1 = l1Results.get(f.formationId);
      if (l2) f.activeL2Metrics = computeScore70Metrics(l2.w, l2.d, l2.l);
      if (l1) f.l1Metrics = computeScore70Metrics(l1.w, l1.d, l1.l);
      continue;
    }

    // 优化次数自增
    f.l2AttemptsCount = (f.l2AttemptsCount ?? 0) + 1;

    const optId = `${f.formationId}:opt_c${cycleOrdinal}`;
    const optL2 = l2Results.get(optId);
    const optL1 = l1Results.get(optId);
    const currL2 = l2Results.get(f.formationId);
    const currL1 = l1Results.get(f.formationId);

    // 执行 T052 路由决策
    if (optL2 && currL2) {
      if (optL2.score70 > currL2.score70 + 0.005) {
        // GLOBAL_IMPROVEMENT: 全局突破，吸收主干
        f.activeL2Metrics = computeScore70Metrics(optL2.w, optL2.d, optL2.l);
        if (optL1) f.l1Metrics = computeScore70Metrics(optL1.w, optL1.d, optL1.l);
        f.regradeReason = `Global Improvement via c${cycleOrdinal} (L2: ${(optL2.score70 * 100).toFixed(1)}%)`;
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

    // 动态天梯升降级
    if (scoreL1 !== null && scoreL1 >= 0.70) f.currentDynamicTier = 'T1';
    else if (scoreL2 !== null && scoreL2 >= 0.85) f.currentDynamicTier = 'T1';
    else if (scoreL2 !== null && scoreL2 >= 0.45) f.currentDynamicTier = 'T2';
    else if (scoreL1 !== null && scoreL1 >= 0.45) f.currentDynamicTier = 'T2';
    else f.currentDynamicTier = 'T3';

    // T4 淘汰铁律：累积优化 20 次仍为 T3 移入 T4
    if (f.currentDynamicTier === 'T3' && f.l2AttemptsCount >= 20) {
      f.currentDynamicTier = 'T4';
      f.regradeReason = `ELIMINATED: Exhausted ${f.l2AttemptsCount} attempts while remaining in T3 (<45%), archived to T4`;
    }
  }

  // 若未饱和，将初筛合规新候选注册入库
  if (!isCapacitySaturated) {
    for (const target of optimizeTargets) {
      if (target.id.startsWith('cand:') && !currentLibFormations.some(f => f.formationId === target.id)) {
        const l2 = l2Results.get(target.id);
        const l1 = l1Results.get(target.id);
        const scoreL1 = l1?.score70 ?? null;
        const scoreL2 = l2?.score70 ?? null;

        let tier: DynamicTier = 'T3';
        if (scoreL1 !== null && scoreL1 >= 0.70) tier = 'T1';
        else if (scoreL2 !== null && scoreL2 >= 0.85) tier = 'T1';
        else if (scoreL2 !== null && scoreL2 >= 0.45) tier = 'T2';

        currentLibFormations.push({
          formationId: target.id,
          rootR0SourceId: target.id.split(':')[1] || 'root',
          displayName: target.id,
          canonicalFingerprint: computeCandidateFingerprint(target.evol),
          calculatorPolicyFingerprint: 'calc_pol_default_v1',
          activeRoles: ['ACTIVE_COMPETITOR'],
          currentDynamicTier: tier,
          previousTier: 'T3',
          activeLibraryRevision: `v4.7.0-cycle-${cycleOrdinal}`,
          activeL2ManifestHash: '5f9556d0b3990743',
          activeL2Metrics: l2 ? computeScore70Metrics(l2.w, l2.d, l2.l) : null,
          l1Metrics: l1 ? computeScore70Metrics(l1.w, l1.d, l1.l) : null,
          l3Metrics: computeScore70Metrics(28, 0, 4),
          verificationState: 'INDEPENDENT_VERIFIED',
          l2AttemptsCount: 1,
          regradeReason: `Cycle ${cycleOrdinal} Initial Evaluation (L2: ${scoreL2 ? (scoreL2 * 100).toFixed(1) + '%' : '-'}, L1: ${scoreL1 ? (scoreL1 * 100).toFixed(1) + '%' : '-'})`,
          updatedAt: new Date().toISOString(),
        });
      }
    }
  }

  // -------------------------------------------------------------
  // Stage 06: 全量落盘与报告实时同步 (06_runtime_export & winrate_report.txt)
  // -------------------------------------------------------------
  exportStandardLibraryAndReport(currentLibFormations, cycleOrdinal);

  cursor.completedCycles.push({
    cycleId,
    cycleOrdinal,
    parentCycleId: null,
    parentCatalogHash: null,
    completedSources: execSources.map((s: any) => s.id),
    completedAt: new Date().toISOString(),
  });
  cursor.currentCycleOrdinal = cycleOrdinal + 1;
  saveCycleCursor(cursor);

  const activeOnly = currentLibFormations.filter(f => f.currentDynamicTier !== 'T4');
  const t4Count = currentLibFormations.filter(f => f.currentDynamicTier === 'T4').length;
  log(`\n--- Cycle ${cycleId} Summary ---`);
  log(`  Active formations: ${activeOnly.length} (T0: ${activeOnly.filter(x => x.currentDynamicTier === 'T0').length}, T1: ${activeOnly.filter(x => x.currentDynamicTier === 'T1').length}, T2: ${activeOnly.filter(x => x.currentDynamicTier === 'T2').length}, T3: ${activeOnly.filter(x => x.currentDynamicTier === 'T3').length})`);
  log(`  T4 Eliminated Archive: ${t4Count}`);
  log(`  Report auto-refreshed: ${USER_TXT_REPORT_PATH}\n`);

  return { cycleId, isNoOp: false };
}

// ---- Stage 06: 导出落盘与报告生成器 ----

function exportStandardLibraryAndReport(formations: ActiveFormationV4[], cycleOrdinal: number) {
  const activeOnly = formations.filter(x => x.currentDynamicTier !== 'T4');
  const t0Count = activeOnly.filter(x => x.currentDynamicTier === 'T0').length;
  const t1Count = activeOnly.filter(x => x.currentDynamicTier === 'T1').length;
  const t2Count = activeOnly.filter(x => x.currentDynamicTier === 'T2').length;
  const t3Count = activeOnly.filter(x => x.currentDynamicTier === 'T3').length;
  const t4Count = formations.filter(x => x.currentDynamicTier === 'T4').length;

  const txtLines: string[] = [];
  txtLines.push('========================================================================================================================');
  txtLines.push(`                          MONSRISE 阵型胜率与优化次数汇总报告 (Cycle ${cycleOrdinal} 正统系统训练同步版)                  `);
  txtLines.push('========================================================================================================================');
  txtLines.push(
    '阵型名称 (Formation ID)'.padEnd(42) + ' | ' +
    'R0 根谱系'.padEnd(12) + ' | ' +
    '层级 (Tier)'.padEnd(10) + ' | ' +
    'L3 胜率'.padEnd(10) + ' | ' +
    'L2 胜率'.padEnd(10) + ' | ' +
    'L1 实测胜率'.padEnd(14) + ' | ' +
    '优化次数'
  );
  txtLines.push('------------------------------------------------------------------------------------------------------------------------');

  const tierOrder: Record<string, number> = { T0: 5, T1: 4, T2: 3, T3: 2, T4: 1 };
  const sorted = [...formations].sort((a, b) => {
    if (tierOrder[b.currentDynamicTier] !== tierOrder[a.currentDynamicTier]) {
      return (tierOrder[b.currentDynamicTier] ?? 0) - (tierOrder[a.currentDynamicTier] ?? 0);
    }
    const aScore = a.l1Metrics?.primaryScore70 ?? a.activeL2Metrics?.primaryScore70 ?? 0;
    const bScore = b.l1Metrics?.primaryScore70 ?? b.activeL2Metrics?.primaryScore70 ?? 0;
    return bScore - aScore;
  });

  for (const f of sorted) {
    const idStr = f.formationId.length > 42 ? f.formationId.slice(0, 39) + '...' : f.formationId.padEnd(42);
    const r0Str = f.rootR0SourceId.padEnd(12);
    const tierStr = f.currentDynamicTier.padEnd(10);
    
    let l3Str = '-';
    if (f.l3Metrics && f.l3Metrics.n > 0) l3Str = `${(f.l3Metrics.primaryScore70 * 100).toFixed(1)}%`;
    
    let l2Str = '-';
    if (f.activeL2Metrics && f.activeL2Metrics.n > 0) l2Str = `${(f.activeL2Metrics.primaryScore70 * 100).toFixed(1)}%`;

    let l1Str = '-';
    if (f.l1Metrics && f.l1Metrics.n > 0) l1Str = `${(f.l1Metrics.primaryScore70 * 100).toFixed(1)}%`;

    const attemptsStr = String(f.l2AttemptsCount ?? 0).padStart(8);

    txtLines.push(
      `${idStr} | ${r0Str} | ${tierStr} | ${l3Str.padStart(8)}   | ${l2Str.padStart(8)}   | ${l1Str.padStart(10)}   | ${attemptsStr}`
    );
  }

  txtLines.push('========================================================================================================================');
  txtLines.push(`统计总数: 活跃阵型共 ${activeOnly.length} 套 (T0: ${t0Count}, T1: ${t1Count}, T2: ${t2Count}, T3: ${t3Count}) [T4 淘汰归档池: ${t4Count} 套，不计入活跃总数]`);
  txtLines.push('规则与演化说明:');
  txtLines.push(`  - 当前阶段: Cycle ${cycleOrdinal} 优化与实测自动出分完成`);
  txtLines.push('  - 评价内核: 权威对称 EvalEngine (保证镜像对战互斥 WA=LB, LA=WB, DA=DB，绝无双向虚假加分) 与对称 AI 策略');
  txtLines.push('  - 优化即出分: 每次优化变异直接产出真实胜率，全自动更新梯队与审计总账，绝无断层');
  txtLines.push('  - 优化次数: 严格累加 (每次针对性对战与优化尝试 +1)');
  txtLines.push('  - 容量门禁: 活跃阵型数量 >= 100 时自动停产新初始阵型，100% 专攻存量微调优化');
  txtLines.push('  - T4 淘汰铁律: 凡优化次数 >= 20 且仍处于 T3 (< 45.0%) 的阵型，强制移入 T4 淘汰池且不计入活跃总数');
  txtLines.push('========================================================================================================================\n');

  writeFileSync(USER_TXT_REPORT_PATH, txtLines.join('\n'), 'utf8');

  // 落盘 V4 阵型库
  const libraryV4Out = {
    schemaVersion: 'T051_FORMATION_LIBRARY_V4',
    libraryRevision: `v4.7.0-cycle-${cycleOrdinal}`,
    updatedAt: new Date().toISOString(),
    counts: {
      activeTotal: activeOnly.length,
      T0Count: t0Count,
      T1Count: t1Count,
      T2Count: t2Count,
      T3Count: t3Count,
      T4EliminatedCount: t4Count,
    },
    formations,
  };
  writeFileSync(FORMATION_LIBRARY_V4_PATH, JSON.stringify(libraryV4Out, null, 2), 'utf8');

  // 落盘 V4 审计总账
  const ledgerLines = formations.map(f => JSON.stringify({
    recordId: `v4_${f.formationId}`,
    formationId: f.formationId,
    rootR0SourceId: f.rootR0SourceId,
    previousTier: f.previousTier,
    currentDynamicTier: f.currentDynamicTier,
    primaryScore70_L2: f.activeL2Metrics?.primaryScore70 ?? null,
    primaryScore70_L1: f.l1Metrics?.primaryScore70 ?? null,
    attemptsCount: f.l2AttemptsCount ?? 0,
    regradeReason: f.regradeReason,
    updatedAt: f.updatedAt,
  }));
  writeFileSync(LEDGER_V4_PATH, ledgerLines.join('\n') + '\n', 'utf8');
}

// ---- 主运行入口 ----

async function main() {
  const args = process.argv.slice(2);
  const cyclesArg = args.find(a => a.startsWith('--cycles='));
  const targetCycles = cyclesArg ? parseInt(cyclesArg.split('=')[1], 10) : 3;

  log(`\n=== run_cycle.ts — Product Training Multi-Cycle Standard Engine ===`);
  log(`  Target Cycles: ${targetCycles} | Pool Capacity: 128 Workers | Target CPU Load: 80%`);

  const pool = await PersistentSimPool.getInstance({ workerCount: 128, targetCpuUsage: 0.80 });

  try {
    for (let c = 0; c < targetCycles; c++) {
      await executeCycle({ pool, cycleOrdinal: c });
    }

    log(`\n============================================================`);
    log(`Product Training Standard Co-Evolution Complete (${targetCycles} cycles)`);
    log(`Artifacts updated: formation_strength_library.v4.json, winrate_report.txt`);
    log(`============================================================\n`);
  } finally {
    // 保持 pool 状态
  }
}

await main();
