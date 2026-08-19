// T047 audit script - read-only perfect-result scan
import { readFileSync } from 'node:fs';

function isPerfect(r: Record<string, unknown>): boolean {
  if (r.score === 1) return true;
  if (r.pureWinRate === 1) return true;
  if (r.winRate === 1) return true;
  if (r.w !== undefined && r.d === 0 && r.l === 0 && (r.w as number) > 0) return true;
  return false;
}

function getScore(r: Record<string, unknown>): number {
  if (r.score !== undefined) return r.score as number;
  if (r.pureWinRate !== undefined) return r.pureWinRate as number;
  if (r.winRate !== undefined) return r.winRate as number;
  const w = (r.w as number) ?? 0;
  const d = (r.d as number) ?? 0;
  const l = (r.l as number) ?? 0;
  const total = w + d + l;
  return total > 0 ? (w + 0.5 * d) / total : 0;
}

function getId(r: Record<string, unknown>): string {
  return (r.id ?? r.entityId ?? r.candidateId ?? r.formationId ?? r.sourceId ?? 'UNKNOWN') as string;
}

const filesToScan = [
  'tests/fixtures/tree/experience_library/product_path_t037/benchmark_cell_results.jsonl',
  'tests/fixtures/tree/experience_library/product_path_t037/learning_level_evaluations.jsonl',
  'tests/fixtures/tree/experience_library/product_path_t037/screen_cells.jsonl',
  'tests/fixtures/tree/experience_library/product_path_t037/screen_observations.jsonl',
  'tests/fixtures/tree/experience_library/product_path_t037/stage_screen_records.jsonl',
  'tests/fixtures/tree/experience_library/product_path_t037/melee_sample_pairs.jsonl',
  'tests/fixtures/tree/experience_library/product_path_t037/candidate_lineage.jsonl',
];

let totalPerfect = 0;

for (const f of filesToScan) {
  try {
    const lines = readFileSync(f, 'utf8').trim().split('\n').filter(Boolean);
    let perfectCount = 0;
    const perfects: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      const r = JSON.parse(lines[i]) as Record<string, unknown>;
      if (isPerfect(r)) {
        perfectCount++;
        const w = (r.w as number) ?? 0;
        const d = (r.d as number) ?? 0;
        const l = (r.l as number) ?? 0;
        const total = w + d + l;
        const id = getId(r);
        const score = getScore(r);
        let flags = '';
        if (total === 0) flags += ' ZERO_GAMES';
        if (total > 0 && Math.abs(score - ((w + 0.5 * d) / total)) > 0.001) {
          flags += ` ARITH_MISMATCH(reported=${score},computed=${((w + 0.5 * d) / total).toFixed(4)})`;
        }
        const opponentId = (r.opponentId ?? r.opponent ?? '') as string;
        if (opponentId && opponentId === id) flags += ' SELF_OPPONENT';
        perfects.push(`  #${i+1} id=${id} W=${w} D=${d} L=${l} score=${score} games=${total}${flags}`);
      }
    }
    totalPerfect += perfectCount;
    console.log(`\n[${f.split('/').pop()}] total=${lines.length}, perfect=${perfectCount}`);
    for (const p of perfects.slice(0, 10)) console.log(p);
    if (perfects.length > 10) console.log(`  ... and ${perfects.length - 10} more`);
  } catch (e: unknown) {
    console.log(`[${f.split('/').pop()}] ERROR - ${(e as Error).message}`);
  }
}

console.log(`\n=== TOTAL perfect results: ${totalPerfect} ===`);
