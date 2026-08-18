// ============================================================
// 细粒度对局仿真工作线程 (Fine-grained Simulation Worker)
// 支持 requestId 路由隔离与零状态污染
// ============================================================

import { parentPort } from 'node:worker_threads';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { FORMATION_LIBRARY } from '../../ai/formation_library';
import { playSpecVsSpec, type SideSpec, type BranchDecision, type RoundObservation } from './arena';
import type { Formation } from '../../ai/types';
import type { EvolFormation } from './evol_gene';

export interface SimTaskMessage {
  taskId: number;
  candidateIdx?: number;
  candidateFp?: string;
  formationA: EvolFormation | Formation;
  isNativeA?: boolean;
  opponentNameOrId: string;
  opponentFormation?: Formation;
  side: 1 | 2;
  seed: number;
  games: number;
  collectObservations?: boolean;
}

export interface SimResultMessage {
  taskId: number;
  candidateIdx?: number;
  candidateFp?: string;
  w: number;
  d: number;
  l: number;
  error?: string;
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

function loadBundle(): any {
  const w = globalThis as any;
  const code = readFileSync(resolve('public/ai-bundle.iife.js'), 'utf8');
  const factory = new Function('window', 'globalThis', '"use strict";\n' + code + '\n;return BattleAI;');
  const b = factory(w, w);
  return b?.BattleAI ?? w.BattleAI;
}

const BundleAI = loadBundle();

const oppMap = new Map<string, Formation>();
for (const f of FORMATION_LIBRARY) {
  oppMap.set(f.id ?? f.name, f);
  oppMap.set(f.name, f);
}

function executeTask(task: SimTaskMessage): SimResultMessage {
  try {
    const opp = task.opponentFormation
      ?? oppMap.get(task.opponentNameOrId)
      ?? FORMATION_LIBRARY.find(f => f.name === task.opponentNameOrId || f.id === task.opponentNameOrId);
    if (!opp) {
      return { taskId: task.taskId, candidateIdx: task.candidateIdx, candidateFp: task.candidateFp, w: 0, d: 0, l: 0, error: `Opponent not found: ${task.opponentNameOrId}` };
    }

    const specA: SideSpec = task.isNativeA
      ? { kind: 'native', f: task.formationA as Formation }
      : { kind: 'evol', f: task.formationA as EvolFormation };
    const specB: SideSpec = { kind: 'native', f: opp };

    let w = 0, d = 0, l = 0;
    const traces: SimResultMessage['traces'] = task.collectObservations ? [] : undefined;

    for (let i = 0; i < task.games; i++) {
      const seed = task.seed + i;
      const decisions = new Map<number, BranchDecision>();

      const r = playSpecVsSpec(BundleAI, specA, specB, task.side, seed, (dec) => {
        decisions.set(dec.round, dec);
      });

      w += r.w;
      d += r.d;
      l += r.l;

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

    return {
      taskId: task.taskId,
      candidateIdx: task.candidateIdx,
      candidateFp: task.candidateFp,
      w,
      d,
      l,
      traces,
    };
  } catch (err: any) {
    return {
      taskId: task.taskId,
      candidateIdx: task.candidateIdx,
      candidateFp: task.candidateFp,
      w: 0,
      d: 0,
      l: 0,
      error: `Simulation exception on side ${task.side}, seed ${task.seed}: ${err?.message ?? String(err)}`,
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
