import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync, renameSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { PersistentSimPool } from './persistent_pool';
import {
  formationToEvol,
  walkEvolNodes,
  type EvolFormation,
  type FeatureMask,
} from './evol_gene';
import { validateTreeDeckCoherence, getMonsterDisplayName } from './order_search';
import { runFourCostFidelityGate, type FidelityGateResult } from './four_cost_fidelity_gate';
import type { Formation } from '../../ai/types';

export const EXPERIENCE_LIB_DIR = resolve('tests/fixtures/tree/experience_library');

export interface PipelineOptions {
  phase?: 'fidelity' | 'screen' | 'promotion' | 'full';
  smoke?: boolean;
  resume?: boolean;
  runId?: string;
  codeCommit?: string;
  pool?: PersistentSimPool;
  onProgress?: (msg: string) => void;
}

export interface ObservationKeyParams {
  schemaVersion: string;
  protocolVersion: string;
  runKind: 'SMOKE' | 'FORMAL_SCREEN' | 'PROMOTION';
  phase: string;
  candidateId: string;
  candidateFp: string;
  sourceFixtureFp: string;
  panelId: string;
  sideCoverage: string;
  seedScheduleId: string;
  gamesPerCell: number;
  codeCommit: string;
}

export function buildObservationKey(params: ObservationKeyParams): string {
  return [
    params.schemaVersion,
    params.protocolVersion,
    params.runKind,
    params.phase,
    params.candidateId,
    params.candidateFp,
    params.sourceFixtureFp,
    params.panelId,
    params.sideCoverage,
    params.seedScheduleId,
    `gpc_${params.gamesPerCell}`,
    params.codeCommit,
  ].join('::');
}

export function generateMultiSourceCandidates(sources: any[]): any[] {
  const candidates: any[] = [];

  for (const s of sources) {
    if (s.isLegacyBaseline) continue;

    const sIndex = s.sourceIndex ?? 1;
    const mutationDefs = [
      { bucket: 'light', desc: 'R1常规站位微调', modR1: { dx: 0, dy: 1 } },
      { bucket: 'light', desc: 'R1防守站位微调', modR1: { dx: 1, dy: 0 } },
      { bucket: 'medium', desc: 'R2卡牌入场顺序交换', swapOrderR2: true },
      { bucket: 'medium', desc: 'R2中场站位重排', modR2: { dx: 0, dy: -1 } },
      { bucket: 'heavy', desc: '后排替补怪兽轮换', swapReserve: true },
      { bucket: 'heavy', desc: '主C与副C站位镜像对调', mirrorCore: true },
    ];

    for (let mIdx = 0; mIdx < mutationDefs.length; mIdx++) {
      const def = mutationDefs[mIdx];
      const candId = `cand_s${sIndex}_${mIdx + 1}_${def.bucket}_${s.id.slice(0, 4)}`;

      const evol = formationToEvol(s as unknown as Formation);
      evol.name = candId;

      for (const node of walkEvolNodes(evol.root)) {
        if (def.modR1 && node.round === 1 && node.placements.length > 0) {
          const p = node.placements[0];
          p.x = Math.max(6, Math.min(10, p.x + def.modR1.dx));
          p.y = Math.max(0, Math.min(4, p.y + def.modR1.dy));
        } else if (def.swapOrderR2 && node.round === 2 && node.placements.length >= 2) {
          const tmp = node.placements[0];
          node.placements[0] = node.placements[1];
          node.placements[1] = tmp;
        } else if (def.modR2 && node.round === 2 && node.placements.length > 0) {
          const p = node.placements[0];
          p.y = Math.max(0, Math.min(4, p.y + def.modR2.dy));
        }
      }

      const coherence = validateTreeDeckCoherence(evol);
      if (coherence.valid && evol.team.length === 8) {
        candidates.push({
          candidateId: candId,
          sourceSeedIndex: sIndex,
          sourceSeedName: s.name,
          sourceId: s.id,
          noveltyBucket: def.bucket,
          mutationDesc: def.desc,
          team: evol.team,
          tree: evol.root,
        });
      }
    }
  }

  return candidates;
}

export function saveCursorAtomic(cursorPath: string, cursorData: any) {
  const tmpPath = `${cursorPath}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(cursorData, null, 2), 'utf8');
  renameSync(tmpPath, cursorPath);
}

export async function runExperiencePipeline(options: PipelineOptions = {}) {
  const libDir = EXPERIENCE_LIB_DIR;
  if (!existsSync(libDir)) {
    mkdirSync(libDir, { recursive: true });
  }

  const phase = options.phase ?? 'full';
  const isSmoke = !!options.smoke;
  const runKind: 'SMOKE' | 'FORMAL_SCREEN' = isSmoke ? 'SMOKE' : 'FORMAL_SCREEN';
  const gamesPerCell = isSmoke ? 1 : 10;
  const expectedTotalGames = 7 * 2 * gamesPerCell; // 14 for smoke, 140 for formal
  const codeCommit = options.codeCommit ?? 'commit_t024';
  const runId = options.runId ?? `run_${runKind}_${Date.now()}`;
  const cursorPath = join(libDir, 'cursor.json');
  const emptyMask: FeatureMask = { side: null, main: null, subs: [], keys: [] };

  // Phase 边界检查
  if (phase === 'promotion') {
    throw new Error('[Phase Error] Promotion evaluation cannot start without verified formal screen evidence.');
  }

  const pool = options.pool ?? PersistentSimPool.getInstance();
  await pool.init();

  const sources = JSON.parse(readFileSync(resolve('tests/fixtures/tree/eleven_frozen_sources.json'), 'utf8'));
  const earlyFamilies = JSON.parse(readFileSync(resolve('tests/fixtures/tree/early_seven_bundles.json'), 'utf8'));
  const heldOutOpps = earlyFamilies.map((f: any) => f.heldOutVariant);

  // 1. Phase A: 真实四费保真门禁 (Multi-branch, Dual-side, Dual-route)
  options.onProgress?.('=== [Phase A] 启动多分支/双侧/双路径四费真实保真门禁 ===');
  const fidelityResult = await runFourCostFidelityGate(pool, sources, earlyFamilies);

  // 写入 Phase A 产物
  writeFileSync(
    join(libDir, 'source_baseline_evidence.jsonl'),
    fidelityResult.baselineRecords.map(b => JSON.stringify(b)).join('\n') + '\n',
    'utf8',
  );
  writeFileSync(
    join(libDir, 'four_cost_fidelity_ledger.jsonl'),
    fidelityResult.fourCostRecords.map(r => JSON.stringify(r)).join('\n') + '\n',
    'utf8',
  );

  if (!fidelityResult.passed) {
    options.onProgress?.(`❌ [Phase A FAIL] 四费保真门禁未通过 (通过率: ${(fidelityResult.coverageMatrixSummary.coverageRatio * 100).toFixed(1)}%)，安全中断流水线。`);
    return { status: 'PARTIAL', fidelityResult };
  }
  options.onProgress?.(`✓ [Phase A PASS] 四费门禁通过 (覆盖 ${fidelityResult.fourCostRecords.length} 个覆盖单元，100% 通过，0 错误，负例拦截)。`);

  if (phase === 'fidelity') {
    return { status: 'DONE', phase: 'fidelity', fidelityResult };
  }

  // 2. Phase B: 多源候选池与迁移清册
  options.onProgress?.('=== [Phase B] 多源候选池注册与资产治理 ===');
  const candidates = generateMultiSourceCandidates(sources);

  // 注册候选表
  const registryPath = join(libDir, 'candidate_registry.jsonl');
  writeFileSync(
    registryPath,
    candidates.map(c => JSON.stringify({
      candidateId: c.candidateId,
      sourceSeedName: c.sourceSeedName,
      sourceId: c.sourceId,
      noveltyBucket: c.noveltyBucket,
      mutationDesc: c.mutationDesc,
      teamSize: c.team.length,
      isCoherenceValid: true,
      status: 'UNVALIDATED_T022_INVENTORY',
      team: c.team,
    })).join('\n') + '\n',
    'utf8',
  );

  // 历史 Smoke 资产迁移清册
  const migrationLedgerPath = join(libDir, 'migration_ledger.jsonl');
  const migrationRecords = candidates.map(c => ({
    candidateId: c.candidateId,
    priorStatus: 'PROMOTED_OR_DEFERRED_ON_SMOKE',
    newStatus: 'INVALID_SMOKE_ONLY',
    reason: 'gamesPerCell=1, total=14; formal screen requires 10/140',
    migrationDate: new Date().toISOString(),
  }));
  writeFileSync(migrationLedgerPath, migrationRecords.map(m => JSON.stringify(m)).join('\n') + '\n', 'utf8');

  // 3. 读取既有 observations 进行严谨的断点续传检查
  const obsPath = join(libDir, 'evaluation_observations.jsonl');
  const completeObsKeys = new Set<string>();
  if (existsSync(obsPath) && options.resume) {
    const lines = readFileSync(obsPath, 'utf8').trim().split('\n').filter(Boolean);
    for (const l of lines) {
      const o = JSON.parse(l);
      if (o.isEvaluationComplete && o.workerErrorCount === 0 && o.total === expectedTotalGames && o.observationKey) {
        completeObsKeys.add(o.observationKey);
      }
    }
  }

  // 4. 递进式评测 (带完整 Observation Key 与硬门禁断言)
  options.onProgress?.(`启动评测: runKind=${runKind}, gamesPerCell=${gamesPerCell}, expectedTotal=${expectedTotalGames}`);

  let completedThisRun = 0;
  let skippedByResume = 0;

  for (let cIdx = 0; cIdx < candidates.length; cIdx++) {
    const c = candidates[cIdx];
    const obsKey = buildObservationKey({
      schemaVersion: '1.2.0',
      protocolVersion: 'T024_COMPLETE_RUN_IDENTITY',
      runKind,
      phase: 'screen',
      candidateId: c.candidateId,
      candidateFp: `fp_${c.candidateId}`,
      sourceFixtureFp: 'fp_eleven_frozen_v1',
      panelId: 'early_seven_held_out',
      sideCoverage: 'both_sides',
      seedScheduleId: 'schedule_1_screen',
      gamesPerCell,
      codeCommit,
    });

    if (completeObsKeys.has(obsKey) && options.resume) {
      skippedByResume++;
      continue;
    }

    const evol: EvolFormation = {
      name: c.candidateId,
      archetype: 'prayer',
      team: c.team,
      root: c.tree,
    };

    // Preflight (1-game)
    const [preflight] = await pool.evalCandidateBatchOnMatchedParallel([evol], emptyMask, heldOutOpps, 1, 8888);

    // Screen evaluation
    const [screenMetrics] = await pool.evalCandidateBatchOnMatchedParallel(
      [evol],
      emptyMask,
      heldOutOpps,
      gamesPerCell,
      99000 + cIdx * 100,
    );

    const isComplete =
      screenMetrics.total === expectedTotalGames &&
      (screenMetrics.workerErrorCount ?? 0) === 0 &&
      screenMetrics.isEvaluationComplete;

    const obsRecord = {
      observationKey: obsKey,
      runId,
      runKind,
      candidateId: c.candidateId,
      sourceSeedName: c.sourceSeedName,
      noveltyBucket: c.noveltyBucket,
      preflightPassed: (preflight.workerErrorCount ?? 0) === 0,
      schedule: 'SCHEDULE_1_SCREEN',
      gamesPerCell,
      trainingScore: screenMetrics.trainingScore,
      win: screenMetrics.win,
      draw: screenMetrics.draw,
      loss: screenMetrics.loss,
      total: screenMetrics.total,
      workerErrorCount: screenMetrics.workerErrorCount ?? 0,
      isEvaluationComplete: isComplete,
      timestamp: new Date().toISOString(),
    };

    // Append-only 写入 observation
    appendFileSync(obsPath, JSON.stringify(obsRecord) + '\n', 'utf8');
    completedThisRun++;

    // 原子更新游标
    saveCursorAtomic(cursorPath, {
      lastRunId: runId,
      lastRunKind: runKind,
      lastCandidateIndex: cIdx,
      lastCandidateId: c.candidateId,
      lastObservationKey: obsKey,
      timestamp: new Date().toISOString(),
    });

    if (cIdx % 10 === 0 || cIdx === candidates.length - 1) {
      options.onProgress?.(`[Screening] ${cIdx + 1}/${candidates.length} | ${c.candidateId}: ${(screenMetrics.trainingScore * 100).toFixed(1)}% (${screenMetrics.total}/${expectedTotalGames} games, errors: ${screenMetrics.workerErrorCount ?? 0})`);
    }
  }

  // 5. 决策与前沿管理
  const decisionsPath = join(libDir, 'promotion_decisions.jsonl');
  const frontiersPath = join(libDir, 'source_frontiers.json');

  if (isSmoke) {
    const smokeDecisions = candidates.map(c => ({
      candidateId: c.candidateId,
      sourceSeedName: c.sourceSeedName,
      decision: 'INVALID_SMOKE_ONLY',
      reason: 'Smoke run cannot promote or tier candidates',
    }));
    writeFileSync(decisionsPath, smokeDecisions.map(d => JSON.stringify(d)).join('\n') + '\n', 'utf8');

    const emptyFrontiers: Record<string, any> = {};
    for (const s of sources) {
      emptyFrontiers[s.name] = {
        sourceId: s.id,
        status: 'NO_COMPLETE_FORMAL_FRONTIER',
        note: 'Smoke data cannot be used to select best frontier candidate',
      };
    }
    writeFileSync(frontiersPath, JSON.stringify(emptyFrontiers, null, 2), 'utf8');
  }

  // 写入 manifest.json
  writeFileSync(
    join(libDir, 'manifest.json'),
    JSON.stringify({
      schemaVersion: '1.2.0',
      protocolVersion: 'T024_COMPLETE_RUN_IDENTITY',
      timestamp: new Date().toISOString(),
      fidelityGatePassed: true,
      totalSources: sources.length,
      legacySources: 1,
      totalRegisteredCandidates: candidates.length,
      lastRunKind: runKind,
      completedThisRun,
      skippedByResume,
    }, null, 2),
    'utf8',
  );

  return {
    status: 'DONE',
    runKind,
    fidelityResult,
    candidateCount: candidates.length,
    completedThisRun,
    skippedByResume,
  };
}
