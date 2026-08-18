import '../src/engine/env';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Formation } from '../src/ai/types';
import { formationToEvol, type EvolFormation } from '../src/engine/tree/evol_gene';
import { generateMultiSourceCandidates } from '../src/engine/tree/experience_training_pipeline';
import { PersistentSimPool } from '../src/engine/tree/persistent_pool';
import { runFourCostFidelityGate } from '../src/engine/tree/four_cost_fidelity_gate';
import type { SimTaskMessage } from '../src/engine/tree/fine_grained_worker';

const PROTOCOL = 'PRODUCT_PATH_FORMAL_SCREEN_T035_V1';
const SCHEDULE_ID = 't035-heldout-7x2x10-seed-v1';
const OUT = resolve('tests/fixtures/tree/experience_library/product_path_t035');
const names = ['manifest.json', 'candidate_registry.jsonl', 'source_baselines.jsonl', 'candidate_cells.jsonl', 'candidate_observations.jsonl', 'four_cost_fidelity_ledger.jsonl', 'cursor.json', 'frontiers.json', 'traces.jsonl'];
const stable = (v: any): string => JSON.stringify(v, (_k, x) => x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map(k => [k, x[k]])) : x);
const hash = (v: any) => createHash('sha256').update(typeof v === 'string' ? v : stable(v)).digest('hex');
const atomic = (path: string, value: any) => { const t = `${path}.tmp`; writeFileSync(t, JSON.stringify(value, null, 2), 'utf8'); renameSync(t, path); };
const append = (path: string, row: any) => appendFileSync(path, `${JSON.stringify(row)}\n`, 'utf8');
const loadLines = (path: string) => existsSync(path) ? readFileSync(path, 'utf8').split(/\r?\n/).filter(Boolean).map(JSON.parse) : [];
const fp = (evol: EvolFormation) => hash({ team: evol.team.map(s => [s.monsterId, s.badgeIds]), root: evol.root });

async function map2<T>(items: T[], fn: (v: T, i: number) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: 2 }, async () => { for (;;) { const i = next++; if (i >= items.length) return; await fn(items[i], i); } }));
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const pool = new PersistentSimPool({ enableCpuMonitor: false });
  try {
    await pool.init();
    const productManifest = pool.getProductPathManifest();
    const manifestHash = hash({ protocol: PROTOCOL, scheduleId: SCHEDULE_ID, productManifest });
    const paths = Object.fromEntries(names.map(n => [n, join(OUT, n)])) as Record<string, string>;
    const previous = existsSync(paths['cursor.json']) ? JSON.parse(readFileSync(paths['cursor.json'], 'utf8')) : null;
    if (previous && (previous.protocol !== PROTOCOL || previous.manifestHash !== manifestHash || previous.scheduleId !== SCHEDULE_ID)) throw new Error('T035_CURSOR_IDENTITY_MISMATCH');
    atomic(paths['manifest.json'], { protocol: PROTOCOL, scheduleId: SCHEDULE_ID, manifestHash, productManifest, noPromotionApplyDeploy: true, historicT032Untouched: true });

    const sources: any[] = JSON.parse(readFileSync(resolve('tests/fixtures/tree/eleven_frozen_sources.json'), 'utf8'));
    const executable = sources.filter(s => !s.isLegacyBaseline);
    const families: any[] = JSON.parse(readFileSync(resolve('tests/fixtures/tree/early_seven_bundles.json'), 'utf8'));
    const opponents: Formation[] = families.map(f => f.heldOutVariant);
    const candidateRaw = generateMultiSourceCandidates(sources);
    if (executable.length !== 10 || candidateRaw.length !== 60 || opponents.length !== 7) throw new Error('T035_FIXED_INVENTORY_INVALID');

    const registry = loadLines(paths['candidate_registry.jsonl']);
    if (!registry.length) {
      const firstByFingerprint = new Map<string, string>();
      for (const c of candidateRaw) {
        const evol: EvolFormation = { name: c.candidateId, archetype: c.archetype ?? 'unknown', team: c.team, root: c.tree };
        const fingerprint = fp(evol);
        const duplicateOf = firstByFingerprint.get(fingerprint) ?? null;
        if (!duplicateOf) firstByFingerprint.set(fingerprint, c.candidateId);
        append(paths['candidate_registry.jsonl'], { protocol: PROTOCOL, manifestHash, candidateId: c.candidateId, sourceId: c.sourceId, fingerprint, noveltyBucket: c.noveltyBucket, mutationDesc: c.mutationDesc, duplicateOf, teamSize: evol.team.length });
      }
    }

    // Individual product trace-backed four-cost records; any missing/fail blocks the formal screen.
    const fidelity = await runFourCostFidelityGate(pool, sources, families, 'product_path');
    if (!loadLines(paths['four_cost_fidelity_ledger.jsonl']).length) for (const unit of fidelity.fourCostRecords) append(paths['four_cost_fidelity_ledger.jsonl'], { protocol: PROTOCOL, manifestHash, ...unit, traceHash: unit.rawTraceEvent ? hash(unit.rawTraceEvent) : null });
    if (!fidelity.passed || fidelity.fourCostRecords.some(r => r.status !== 'PASS')) throw new Error('T035_FOUR_COST_GATE_FAILED');

    const done = new Set<string>((previous?.completedEntities ?? []));
    const runEntity = async (kind: 'baseline' | 'candidate', id: string, sourceId: string, evol: EvolFormation, entityIndex: number) => {
      if (done.has(`${kind}:${id}`)) return;
      if (!evol.team.length) throw new Error(`T035_EMPTY_CANDIDATE_TEAM:${id}`);
      const fingerprint = fp(evol);
      const tasks: SimTaskMessage[] = [];
      let taskId = 0;
      for (let familyIndex = 0; familyIndex < opponents.length; familyIndex++) for (const side of [1, 2] as const) for (let gameIndex = 0; gameIndex < 10; gameIndex++) {
        const opponent = opponents[familyIndex];
        if (!opponent.team?.length) throw new Error(`T035_EMPTY_OPPONENT_TEAM:${opponent.id}`);
        tasks.push({ taskId: taskId++, formationA: evol, opponentNameOrId: opponent.id, opponentFormation: opponent, side, seed: 100_000 + entityIndex * 10_000 + familyIndex * 100 + side * 10 + gameIndex, games: 1, collectObservations: true, collectDeploymentTraces: true, executionMode: 'product_path', formalRequest: true });
      }
      const results = await pool.dispatchTasks(tasks, id);
      if (results.length !== 140 || results.some(r => r.error || r.executionMode !== 'product_path')) throw new Error(`T035_WORKER_ERROR:${id}`);
      let w = 0, d = 0, l = 0;
      for (let i = 0; i < results.length; i++) {
        const result = results[i]; const task = tasks[i]; const traces = result.deploymentTraces ?? [];
        const sourceTraces = traces.filter((t: any) => t.sourceSide === task.side);
        const opponentTraces = traces.filter((t: any) => t.sourceSide !== task.side);
        const traceRecord = { protocol: PROTOCOL, manifestHash, entityId: id, taskId: task.taskId, seed: task.seed, side: task.side, sourceTraces, opponentTraces, workerTrace: result.traces ?? [] };
        const traceHash = hash(traceRecord); append(paths['traces.jsonl'], { ...traceRecord, traceHash });
        const raw = result.traces?.[0];
        const cell = { protocol: PROTOCOL, manifestHash, scheduleId: SCHEDULE_ID, kind, entityId: id, sourceId, candidateFingerprint: fingerprint, opponentId: task.opponentFormation!.id, actualSourceSide: task.side, seed: task.seed, gameIndex: task.seed % 10, w: result.w, d: result.d, l: result.l, complete: true, workerError: null, candidateTeamSize: evol.team.length, opponentTeamSize: task.opponentFormation!.team.length, candidatePlacementCount: sourceTraces.filter((t: any) => t.accepted).length, opponentPlacementCount: opponentTraces.filter((t: any) => t.accepted).length, roundCount: raw?.roundScores?.length ?? 0, roundScores: raw?.roundScores ?? [], earlyTerminationReason: null, traceHash };
        if (!cell.candidatePlacementCount || !cell.opponentPlacementCount) throw new Error(`T035_MISSING_DEPLOYMENT:${id}:${task.taskId}`);
        append(paths['candidate_cells.jsonl'], cell); w += result.w; d += result.d; l += result.l;
      }
      if (w + d + l !== 140) throw new Error(`T035_CELL_COUNT_INVALID:${id}`);
      const summary = { protocol: PROTOCOL, manifestHash, kind, entityId: id, sourceId, candidateFingerprint: fingerprint, win: w, draw: d, loss: l, total: 140, trainingScore: (w + 0.5 * d) / 140, workerErrorCount: 0, isEvaluationComplete: true };
      append(paths[kind === 'baseline' ? 'source_baselines.jsonl' : 'candidate_observations.jsonl'], summary);
      done.add(`${kind}:${id}`); atomic(paths['cursor.json'], { protocol: PROTOCOL, manifestHash, scheduleId: SCHEDULE_ID, completedEntities: [...done].sort(), updatedAt: new Date().toISOString() });
    };
    await map2(executable, async (s, i) => runEntity('baseline', s.id, s.id, formationToEvol(s as Formation), i));
    await map2(candidateRaw, async (c, i) => runEntity('candidate', c.candidateId, c.sourceId, { name: c.candidateId, archetype: c.archetype ?? 'unknown', team: c.team, root: c.tree } as EvolFormation, i + 10));
    const candidates = loadLines(paths['candidate_observations.jsonl']);
    const frontiers = Object.values(candidates.reduce((acc: any, row: any) => (!acc[row.sourceId] || row.trainingScore > acc[row.sourceId].trainingScore ? (acc[row.sourceId] = row, acc) : acc), {}));
    atomic(paths['frontiers.json'], { protocol: PROTOCOL, manifestHash, signalOnly: true, tierPromotion: 'NOT_PERFORMED', frontiers });
    console.log(JSON.stringify({ protocol: PROTOCOL, baselines: loadLines(paths['source_baselines.jsonl']).length, candidates: candidates.length, cells: loadLines(paths['candidate_cells.jsonl']).length, fourCost: fidelity.fourCostRecords.length, output: OUT }, null, 2));
  } finally { pool.destroy(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
