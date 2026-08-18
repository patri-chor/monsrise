import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const sourceDir = resolve('reports/t032-product-path-formal');
const recoveredDir = resolve('tests/fixtures/tree/experience_library/product_path_t032');
const outDir = resolve('reports/t034-audit');
const required = ['manifest.json', 'observations.jsonl', 'cursor.json', 'product_path_frontiers.json'];

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
const files = required.map(name => ({ name, path: join(sourceDir, name), exists: existsSync(join(sourceDir, name)) }));
for (const file of files) if (!file.exists) throw new Error(`Missing recovered file: ${file.name}`);

const manifest = JSON.parse(readFileSync(join(sourceDir, 'manifest.json'), 'utf8'));
const cursor = JSON.parse(readFileSync(join(sourceDir, 'cursor.json'), 'utf8'));
const frontiers = JSON.parse(readFileSync(join(sourceDir, 'product_path_frontiers.json'), 'utf8'));
const rows = readFileSync(join(sourceDir, 'observations.jsonl'), 'utf8').trim().split(/\r?\n/).map(line => JSON.parse(line));
const seen = new Set<string>();
const duplicateIds: string[] = [];
const invalidRows: Array<{ candidateId?: string; issues: string[] }> = [];
const sourceRows = new Map<string, any[]>();
let perfectRows = 0;

for (const row of rows) {
  const issues: string[] = [];
  if (seen.has(row.candidateId)) duplicateIds.push(row.candidateId);
  seen.add(row.candidateId);
  if (row.protocol !== 'PRODUCT_PATH_FORMAL_SCREEN_T032_V1') issues.push('protocol');
  if (row.manifestHash !== manifest.manifestHash) issues.push('manifestHash');
  const m = row.metrics ?? {};
  if (m.total !== 140 || row.gamesExpected !== 140) issues.push('coverage140');
  if ((m.win ?? 0) + (m.draw ?? 0) + (m.loss ?? 0) !== m.total) issues.push('wdlTotal');
  const score = m.total ? (m.win + 0.5 * m.draw) / m.total : 0;
  if (Math.abs(score - m.trainingScore) > 1e-12) issues.push('trainingScore');
  if (m.workerErrorCount !== 0 || m.isEvaluationComplete !== true) issues.push('workerCompletion');
  if (m.win === 140 && m.draw === 0 && m.loss === 0) perfectRows++;
  if (issues.length) invalidRows.push({ candidateId: row.candidateId, issues });
  const list = sourceRows.get(row.sourceId) ?? [];
  list.push(row);
  sourceRows.set(row.sourceId, list);
}

const recomputedFrontiers = [...sourceRows.entries()].map(([sourceId, values]) => {
  const best = [...values].sort((a, b) => b.metrics.trainingScore - a.metrics.trainingScore || a.candidateId.localeCompare(b.candidateId))[0];
  return { sourceId, sourceName: best.sourceSeedName, candidateId: best.candidateId, metrics: best.metrics };
}).sort((a, b) => b.metrics.trainingScore - a.metrics.trainingScore || a.candidateId.localeCompare(b.candidateId));

const expectedFrontier = [...frontiers.frontiers].sort((a: any, b: any) => b.metrics.trainingScore - a.metrics.trainingScore || a.candidateId.localeCompare(b.candidateId));
const frontierMatches = JSON.stringify(recomputedFrontiers) === JSON.stringify(expectedFrontier);
const cursorIds = new Set<string>(cursor.completedCandidateIds ?? []);
const cursorMatchesRows = cursorIds.size === seen.size && [...seen].every(id => cursorIds.has(id));

const audit = {
  auditVersion: 'T034_READ_ONLY_AUDIT_V1',
  noSimulationPerformed: true,
  sourceDir,
  files: files.map(file => {
    const recoveredPath = join(recoveredDir, file.name);
    const sourceSHA256 = sha256(file.path);
    const recoveredSHA256 = existsSync(recoveredPath) ? sha256(recoveredPath) : null;
    return {
      name: file.name,
      sha256: sourceSHA256,
      recoveredSHA256,
      recoveryHashMatches: sourceSHA256 === recoveredSHA256,
      bytes: readFileSync(file.path).byteLength,
    };
  }),
  rawCandidateRecords: rows.length,
  aggregateCandidateGames: rows.reduce((sum, row) => sum + (row.metrics?.total ?? 0), 0),
  uniqueCandidateIds: seen.size,
  duplicateIds,
  invalidRows,
  sourcesWithRecords: sourceRows.size,
  rowsPerSource: Object.fromEntries([...sourceRows.entries()].map(([id, values]) => [id, values.length])),
  cursorCompletedIds: cursorIds.size,
  cursorMatchesRows,
  manifestHash: manifest.manifestHash,
  gamesPerCell: cursor.gamesPerCell,
  perfectRows,
  recomputedFrontiers,
  frontierMatches,
  rawBaselineRecordsPresent: false,
  rawFourCostLedgerPresent: false,
  perCellSideSeedRecordsPresent: false,
  candidateContentFingerprintsPresent: false,
  opposingDeploymentTracesPresent: false,
  classification: 'PARTIAL_RAW_AGGREGATES_ONLY',
  blockers: [
    'No product-path baseline raw records were persisted.',
    'No product-path individual four-cost trace ledger was persisted.',
    'Candidate observations are aggregate W/D/L only: no per-family/side/seed cell records.',
    'Candidate content/team/tree fingerprints are absent from raw records.',
    'No candidate/opponent deployment traces exist to audit 100% outcomes.',
  ],
};
writeFileSync(join(outDir, 'audit.json'), JSON.stringify(audit, null, 2), 'utf8');
console.log(JSON.stringify(audit, null, 2));
