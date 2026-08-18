import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const dir = resolve('tests/fixtures/tree/experience_library/product_path_t035');
const lines = (n: string) => readFileSync(join(dir, n), 'utf8').split(/\r?\n/).filter(Boolean).map(JSON.parse);
const sha = (n: string) => createHash('sha256').update(readFileSync(join(dir, n))).digest('hex');
const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
const registry = lines('candidate_registry.jsonl');
const baselines = lines('source_baselines.jsonl');
const cells = lines('candidate_cells.jsonl');
const observations = lines('candidate_observations.jsonl');
const fourCost = lines('four_cost_fidelity_ledger.jsonl');
const traces = lines('traces.jsonl');
const errors: string[] = [];
const check = (ok: boolean, msg: string) => { if (!ok) errors.push(msg); };
const expected = new Set([...baselines.map((x: any) => `baseline:${x.entityId}`), ...observations.map((x: any) => `candidate:${x.entityId}`)]);
check(registry.length === 60, 'registry count');
check(baselines.length === 10, 'baseline count');
check(observations.length === 60, 'candidate observation count');
check(cells.length === 9800, 'cell count');
check(traces.length === 9800, 'trace count');
check(fourCost.length === 64 && fourCost.every((x: any) => x.status === 'PASS' && x.rawTraceEvent && x.traceHash), 'four-cost trace coverage');
const grouped = new Map<string, any[]>();
for (const c of cells) { const key = `${c.kind}:${c.entityId}`; const v = grouped.get(key) ?? []; v.push(c); grouped.set(key, v); check(c.complete && !c.workerError && c.candidateTeamSize > 0 && c.opponentTeamSize > 0 && c.candidatePlacementCount > 0 && c.opponentPlacementCount > 0 && c.traceHash, `invalid cell ${key}`); }
for (const key of expected) { const v = grouped.get(key) ?? []; check(v.length === 140, `coverage ${key}`); check(new Set(v.map(x => x.actualSourceSide)).size === 2, `sides ${key}`); check(new Set(v.map(x => x.opponentId)).size === 7, `opponents ${key}`); }
for (const r of [...baselines, ...observations]) { const v = grouped.get(`${r.kind}:${r.entityId}`) ?? []; const w = v.reduce((a, x) => a + x.w, 0), d = v.reduce((a, x) => a + x.d, 0), l = v.reduce((a, x) => a + x.l, 0); check(w === r.win && d === r.draw && l === r.loss && Math.abs((w + .5 * d) / 140 - r.trainingScore) < 1e-12, `aggregate ${r.entityId}`); }
const duplicateGroups = Object.values(registry.reduce((a: any, x: any) => ((a[x.fingerprint] ??= []).push(x.candidateId), a), {})).filter((v: any) => v.length > 1);
const files = ['manifest.json', 'candidate_registry.jsonl', 'source_baselines.jsonl', 'candidate_cells.jsonl', 'candidate_observations.jsonl', 'four_cost_fidelity_ledger.jsonl', 'cursor.json', 'frontiers.json', 'traces.jsonl'];
console.log(JSON.stringify({ protocol: manifest.protocol, manifestHash: manifest.manifestHash, files: files.map(n => ({ name: n, sha256: sha(n) })), registry: registry.length, baselines: baselines.length, candidates: observations.length, cells: cells.length, traces: traces.length, fourCost: fourCost.length, duplicateGroups, integrityPassed: errors.length === 0, errors }, null, 2));
if (errors.length) process.exitCode = 1;
