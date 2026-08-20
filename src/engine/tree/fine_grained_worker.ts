// ============================================================
// 细粒度对局仿真工作线程 (Fine-grained Simulation Worker)
// 支持 requestId 路由隔离与零状态污染
//
// T032 C.2：产品路径（默认用于正式评估）—— 每任务通过 playFullGame + 产品树策略执行
// T032 C.4：旧 arena 路径仅保留为 SANDBOX_ONLY_DEPRECATED（正式请求在 pool 层 fail-closed）
// ============================================================

import { parentPort, threadId } from 'node:worker_threads';
import { readFileSync } from 'node:fs';
import { sha256Hex } from './sha256_pure';
import { FORMATION_LIBRARY } from '../../ai/formation_library';
import { playSpecVsSpec, type SideSpec, type BranchDecision, type RoundObservation } from './arena';
import { playFullGame, EXECUTION_SEMANTICS_VERSION } from '../play_full_game';
import { treeStrategyFor } from './product_tree_strategy';
import { AUTHORITY_ARTIFACT_ABSOLUTE_PATH, assertAuthorityArtifact } from './independent_real_entry_parity';
import type { Formation } from '../../ai/types';
import type { EvolFormation } from './evol_gene';
import type { ProductDeploymentTrace } from '../play_full_game';

export type ExecutionMode = 'product_path' | 'arena_sandbox_deprecated';

export interface SimTaskMessage {
  taskId: number | string;
  candidateIdx?: number;
  candidateFp?: string;
  targetPayloadFp?: string;
  targetPolicyFp?: string;
  formationA: EvolFormation | Formation;
  isNativeA?: boolean;
  opponentNameOrId: string;
  opponentFormation?: Formation;
  opponentPayloadFp?: string;
  opponentPolicyFp?: string;
  side: 1 | 2;
  seed: number;
  games: number;
  collectObservations?: boolean;
  collectDeploymentTraces?: boolean;
  /** 执行模式：product_path（T032 产品路径）| arena_sandbox_deprecated（旧沙盒，仅历史测试/标记废弃） */
  executionMode?: ExecutionMode;
  /** 正式请求标记：true 且 executionMode=arena 时在 pool 层 fail-closed（T032 C.4） */
  formalRequest?: boolean;
}

export interface SimResultMessage {
  taskId: number | string;
  workerId?: string;
  candidateIdx?: number;
  candidateFp?: string;
  targetPayloadFp?: string;
  targetPolicyFp?: string;
  opponentNameOrId?: string;
  opponentPayloadFp?: string;
  opponentPolicyFp?: string;
  w: number;
  d: number;
  l: number;
  roundResults?: (1 | 2 | 0)[];
  traceDigest?: string;
  observationDigest?: string;
  error?: string;
  executionMode?: ExecutionMode;
  deploymentTraces?: any[];
  traces?: Array<{
    seed: number;
    side: 1 | 2;
    oppId: string;
    roundScores: number[];
    observations: Array<[number, RoundObservation]>;
    decisions: Array<[number, BranchDecision]>;
    w: number;
    d: number;
    l: number;
  }>;
}

// 权威制品：绝对路径 + 哈希校验（fail-closed）。仅在 arena_sandbox_deprecated 模式惰性加载。
let BundleAI: any = null;

function loadBundleAuthoritative(): any {
  if (BundleAI) return BundleAI;
  assertAuthorityArtifact(); // 缺失/相对/哈希错配在此 fail-closed（T031/T032）
  const w = globalThis as any;
  const code = readFileSync(AUTHORITY_ARTIFACT_ABSOLUTE_PATH, 'utf8');
  const factory = new Function('window', 'globalThis', '"use strict";\n' + code + '\n;return BattleAI;');
  const b = factory(w, w);
  BundleAI = b?.BattleAI ?? w.BattleAI;
  return BundleAI;
}

const oppMap = new Map<string, Formation>();
for (const f of FORMATION_LIBRARY) {
  oppMap.set(f.id ?? f.name, f);
  oppMap.set(f.name, f);
}

function toTeamSlots(team: Array<{ monsterId: number; badgeIds: number[] }>) {
  return (team ?? []).filter(s => s.monsterId > 0).map(s => ({ monsterId: s.monsterId, badgeIds: [...(s.badgeIds ?? [])] }));
}

/** 产品路径执行（T032 C.2）：playFullGame + 候选侧产品树策略，收集产品轨迹 */
function executeProductPathTask(task: SimTaskMessage): SimResultMessage {
  const opp = task.opponentFormation
    ?? oppMap.get(task.opponentNameOrId)
    ?? FORMATION_LIBRARY.find(f => f.name === task.opponentNameOrId || f.id === task.opponentNameOrId);
  if (!opp) {
    return { taskId: task.taskId, candidateIdx: task.candidateIdx, candidateFp: task.candidateFp, w: 0, d: 0, l: 0, error: `Opponent not found: ${task.opponentNameOrId}`, executionMode: 'product_path' };
  }

  const isNativeA = task.isNativeA === true;
  const cand = task.formationA;
  const candTeam = toTeamSlots((cand as any).team ?? []);
  const oppTeam = toTeamSlots(opp.team ?? []);
  const candStrategy = isNativeA ? undefined : treeStrategyFor(cand as EvolFormation);
  let oppStrategy: any = undefined;
  if (opp) {
    try {
      oppStrategy = (opp as any).evol ? treeStrategyFor((opp as any).evol) : treeStrategyFor(formationToEvol(opp));
    } catch {
      oppStrategy = undefined;
    }
  }
  const candName = (cand as any).name ?? 'candidate';
  const oppName = (opp as any).name ?? (opp as any).id ?? 'opponent';

  let w = 0, d = 0, l = 0;
  let roundResults: (1 | 2 | 0)[] | undefined = undefined;
  const traces: SimResultMessage['traces'] = task.collectObservations ? [] : undefined;
  const deploymentTraces: any[] = [];

  for (let i = 0; i < task.games; i++) {
    const seed = task.seed + i;
    const productObservations: RoundObservation[] = [];
    const branchRounds = new Map<number, { branchId: string; branchLabel: string }>();

    const collect = task.collectDeploymentTraces || task.collectObservations;

    const match = playFullGame(
      task.side === 1 ? candTeam : oppTeam,
      task.side === 1 ? oppTeam : candTeam,
      {
        seed,
        strategyA: task.side === 1 ? candStrategy : oppStrategy,
        strategyB: task.side === 1 ? oppStrategy : candStrategy,
        strategyIdentityA: task.side === 1 ? candName : oppName,
        strategyIdentityB: task.side === 1 ? oppName : candName,
        onDeploymentTrace: collect
          ? (e: ProductDeploymentTrace) => {
              deploymentTraces.push({ seed, oppId: opp.id ?? opp.name, ...e });
              if (e.sourceSide === task.side && e.accepted && e.branch) {
                if (!branchRounds.has(e.round)) {
                  branchRounds.set(e.round, { branchId: e.branch.branchId, branchLabel: e.branch.branchLabel ?? '' });
                }
              }
            }
          : undefined,
        onRoundObservation: task.collectObservations
          ? (o) => { if (o.side === task.side) productObservations.push(o); }
          : undefined,
      },
    );

    const sourceWon = (task.side === 1 && match.winner === 1) || (task.side === 2 && match.winner === 2);
    const sourceLost = (task.side === 1 && match.winner === 2) || (task.side === 2 && match.winner === 1);
    w += sourceWon ? 1 : 0;
    d += match.winner === 0 ? 1 : 0;
    l += sourceLost ? 1 : 0;

    if (task.collectObservations && traces) {
      const roundScores: number[] = match.roundResults.map(r => {
        if (r === 0) return 0;
        const win = (task.side === 1 && r === 1) || (task.side === 2 && r === 2);
        return win ? 1 : -1;
      });
      const obsList: Array<[number, RoundObservation]> = productObservations.map(o => [o.round, o]);
      const decList: Array<[number, BranchDecision]> = [];
      for (const obs of productObservations) {
        const br = branchRounds.get(obs.round);
        if (br) {
          decList.push([obs.round, {
            round: obs.round,
            handIds: obs.handIds,
            handBadges: obs.handBadges,
            boardIds: obs.boardIds,
            chosenBranchId: br.branchId,
            branchLabels: [br.branchLabel],
          }]);
        }
      }
      traces.push({
        seed,
        side: task.side,
        oppId: opp.id ?? opp.name,
        roundScores,
        observations: obsList,
        decisions: decList,
        w: sourceWon ? 1 : 0,
        d: match.winner === 0 ? 1 : 0,
        l: sourceLost ? 1 : 0,
      });
    }

    if (task.games === 1) {
      roundResults = [...match.roundResults];
    }
  }

  const traceDigest = deploymentTraces.length > 0
    ? sha256Hex(JSON.stringify(deploymentTraces)).slice(0, 16)
    : undefined;

  return {
    taskId: task.taskId,
    workerId: `worker_tid_${threadId}`,
    candidateIdx: task.candidateIdx,
    candidateFp: task.candidateFp,
    targetPayloadFp: task.targetPayloadFp ?? task.candidateFp,
    targetPolicyFp: task.targetPolicyFp,
    opponentNameOrId: task.opponentNameOrId,
    opponentPayloadFp: task.opponentPayloadFp,
    opponentPolicyFp: task.opponentPolicyFp,
    w, d, l,
    roundResults,
    traceDigest,
    executionMode: 'product_path',
    deploymentTraces: task.collectDeploymentTraces ? deploymentTraces : undefined,
    traces,
  };
}

/** 旧 arena 沙盒路径（SANDBOX_ONLY_DEPRECATED，仅历史测试/取证；正式请求已由 pool fail-closed） */
function executeArenaDeprecatedTask(task: SimTaskMessage): SimResultMessage {
  const opp = task.opponentFormation
    ?? oppMap.get(task.opponentNameOrId)
    ?? FORMATION_LIBRARY.find(f => f.name === task.opponentNameOrId || f.id === task.opponentNameOrId);
  if (!opp) {
    return { taskId: task.taskId, candidateIdx: task.candidateIdx, candidateFp: task.candidateFp, w: 0, d: 0, l: 0, error: `Opponent not found: ${task.opponentNameOrId}`, executionMode: 'arena_sandbox_deprecated' };
  }

  const specA: SideSpec = task.isNativeA
    ? { kind: 'native', f: task.formationA as Formation }
    : { kind: 'evol', f: task.formationA as EvolFormation };
  const specB: SideSpec = { kind: 'native', f: opp };

  let w = 0, d = 0, l = 0;
  const traces: SimResultMessage['traces'] = task.collectObservations ? [] : undefined;
  const deploymentTraces: any[] = [];

  try {
    const ai = loadBundleAuthoritative();
    for (let i = 0; i < task.games; i++) {
      const seed = task.seed + i;
      const decisions = new Map<number, BranchDecision>();

      const r = playSpecVsSpec(
        ai,
        specA,
        specB,
        task.side,
        seed,
        (dec) => { decisions.set(dec.round, dec); },
        task.collectDeploymentTraces,
      );

      w += r.w;
      d += r.d;
      l += r.l;

      if (task.collectDeploymentTraces && r.deploymentTraces) {
        deploymentTraces.push(...r.deploymentTraces.map(dt => ({ seed, oppId: opp.id ?? opp.name, ...dt })));
      }

      if (task.collectObservations && traces) {
        const obsList: Array<[number, RoundObservation]> = (r.observations ?? []).map(o => [o.round, o]);
        const decList: Array<[number, BranchDecision]> = Array.from(decisions.entries());
        traces.push({
          seed,
          side: task.side,
          oppId: opp.id ?? opp.name,
          roundScores: r.roundScores,
          observations: obsList,
          decisions: decList,
          w: r.w,
          d: r.d,
          l: r.l,
        });
      }
    }
  } catch (err: any) {
    return {
      taskId: task.taskId,
      candidateIdx: task.candidateIdx,
      candidateFp: task.candidateFp,
      w: 0, d: 0, l: 0,
      executionMode: 'arena_sandbox_deprecated',
      error: `Arena sandbox deprecated task failed: ${err?.message ?? String(err)}`,
    };
  }

  return {
    taskId: task.taskId,
    candidateIdx: task.candidateIdx,
    candidateFp: task.candidateFp,
    w, d, l,
    executionMode: 'arena_sandbox_deprecated',
    deploymentTraces: task.collectDeploymentTraces ? deploymentTraces : undefined,
    traces,
  };
}

function executeTask(task: SimTaskMessage): SimResultMessage {
  try {
    const mode: ExecutionMode = task.executionMode ?? 'arena_sandbox_deprecated';
    if (mode === 'product_path') {
      return executeProductPathTask(task);
    }
    return executeArenaDeprecatedTask(task);
  } catch (err: any) {
    return {
      taskId: task.taskId,
      candidateIdx: task.candidateIdx,
      candidateFp: task.candidateFp,
      w: 0,
      d: 0,
      l: 0,
      error: `Simulation exception on side ${task.side}, seed ${task.seed}, mode ${task.executionMode ?? 'arena_sandbox_deprecated'}: ${err?.message ?? String(err)}`,
    };
  }
}

if (parentPort) {
  parentPort.on('message', (msg: { type: 'batch'; requestId: string; tasks: SimTaskMessage[] } | { type: 'single'; requestId: string; task: SimTaskMessage }) => {
    try {
      if (msg.type === 'batch') {
        const results = msg.tasks.map(t => executeTask(t));
        parentPort!.postMessage({ type: 'batch_result', requestId: msg.requestId, results });
      } else if (msg.type === 'single') {
        const result = executeTask(msg.task);
        parentPort!.postMessage({ type: 'single_result', requestId: msg.requestId, result });
      }
    } catch (err: any) {
      parentPort!.postMessage({ type: 'error', requestId: (msg as any).requestId, error: err?.message ?? String(err) });
    }
  });
}

export { EXECUTION_SEMANTICS_VERSION };
