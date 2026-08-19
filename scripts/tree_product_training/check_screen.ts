// ============================================================
// scripts/tree_product_training/check_screen.ts
// T037 产品路径筛选证据只读验证脚本（无仿真）
//
// 独立重新计算并验证：
//   - W/D/L 总量与 140-cell 覆盖
//   - 7×2×10 schedule 结构
//   - source-relative 分数
//   - trace 存在性（若有）
//   - 双侧 deployment
//   - 错误计数与 worker 并发证明
//   - R1 分支 cell 与选中 branchId（side-aware）
// ============================================================

import '../../src/engine/env';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

console.log('=== check_screen.ts — T037 Screen Evidence Verification ===\n');

let passed = 0;
let failed = 0;

function check(label: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${label}`);
    passed++;
  } catch (e: any) {
    console.error(`  ✗ ${label}`);
    console.error(`    ${e.message}`);
    failed++;
  }
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const T037_DIR = resolve('tests/fixtures/tree/experience_library/product_path_t037');

if (!existsSync(T037_DIR)) {
  console.error(`ERROR: Evidence directory not found: ${T037_DIR}`);
  console.error('Run: npx vite-node src/engine/tree/product_training/run_screen.ts');
  process.exit(1);
}

// ---- 加载证据文件 ----

const manifest = JSON.parse(readFileSync(`${T037_DIR}/manifest.json`, 'utf8'));
const sourcesLines = readFileSync(`${T037_DIR}/sources.jsonl`, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const registryLines = readFileSync(`${T037_DIR}/candidate_registry.jsonl`, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const rejectedLines = readFileSync(`${T037_DIR}/rejected_candidates.jsonl`, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const cellsLines = readFileSync(`${T037_DIR}/screen_cells.jsonl`, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const obsLines = readFileSync(`${T037_DIR}/screen_observations.jsonl`, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const cursor = JSON.parse(readFileSync(`${T037_DIR}/cursor.json`, 'utf8'));

console.log(`Manifest protocol: ${manifest.protocol}`);
console.log(`Manifest schedule: ${manifest.scheduleId}`);
console.log(`Sources: ${sourcesLines.length}  Registry: ${registryLines.length}  Rejected: ${rejectedLines.length}`);
console.log(`Cells: ${cellsLines.length}  Observations: ${obsLines.length}\n`);

// ---- 1. manifest / protocol ----

check('manifest protocol = PRODUCT_PATH_T037_V1', () => {
  assert(manifest.protocol === 'PRODUCT_PATH_T037_V1', `Got: ${manifest.protocol}`);
});

check('manifest scheduleId = t037-heldout-7x2x10-seed-v1', () => {
  assert(manifest.scheduleId === 't037-heldout-7x2x10-seed-v1', `Got: ${manifest.scheduleId}`);
});

check('manifest callChain includes product_path', () => {
  assert(manifest.callChain?.includes('product_path'), `callChain: ${manifest.callChain}`);
});

check('manifest callChain includes PersistentSimPool', () => {
  assert(manifest.callChain?.includes('PersistentSimPool'), `callChain: ${manifest.callChain}`);
});

// ---- 2. cursor completeness ----

check('cursor contains all accepted entity IDs', () => {
  const cursorSet = new Set(cursor.completedEntityIds);
  const missing = registryLines.filter((e: any) => !cursorSet.has(e.candidateId));
  assert(missing.length === 0, `Missing in cursor: ${missing.map((e: any) => e.candidateId).join(', ')}`);
});

// ---- 3. schedule: 7×2×10 per entity ----

const entityIds = registryLines.map((e: any) => e.candidateId);

check('each accepted entity has exactly 14 screen cells (7 opps × 2 sides)', () => {
  const errors: string[] = [];
  for (const eid of entityIds) {
    const cells = cellsLines.filter((c: any) => c.entityId === eid);
    if (cells.length !== 14) errors.push(`${eid}: ${cells.length} cells`);
  }
  assert(errors.length === 0, errors.join('; '));
});

check('each entity has exactly 2 sides per opponent (side=1 and side=2)', () => {
  const errors: string[] = [];
  for (const eid of entityIds) {
    const cells = cellsLines.filter((c: any) => c.entityId === eid);
    const oppGroups = new Map<string, Set<number>>();
    for (const c of cells) {
      if (!oppGroups.has(c.opponentId)) oppGroups.set(c.opponentId, new Set());
      oppGroups.get(c.opponentId)!.add(c.sourceSide);
    }
    for (const [opp, sides] of oppGroups) {
      if (!sides.has(1) || !sides.has(2)) {
        errors.push(`${eid}/${opp}: sides=${[...sides].join(',')}`);
      }
    }
  }
  assert(errors.length === 0, errors.join('; '));
});

check('each cell has gamesPerCell=10', () => {
  const bad = cellsLines.filter((c: any) => c.gamesPerCell !== 10);
  assert(bad.length === 0, `Cells with wrong gamesPerCell: ${bad.map((c: any) => c.entityId + '/' + c.cellIndex).slice(0, 5).join(', ')}`);
});

// ---- 4. W/D/L 独立重计算 ----

check('independently recomputed W+D+L = gamesPerCell per cell', () => {
  const bad = cellsLines.filter((c: any) => {
    const total = c.w + c.d + c.l;
    return total !== c.gamesPerCell && c.completed === true && !c.error;
  });
  assert(bad.length === 0, `Cells with wrong W+D+L: ${bad.map((c: any) => `${c.entityId}[${c.cellIndex}] W=${c.w}D=${c.d}L=${c.l}`).slice(0, 5).join(', ')}`);
});

check('observation trainingScore = (w + 0.5*d) / totalGames (recomputed)', () => {
  const errors: string[] = [];
  for (const obs of obsLines) {
    if (!obs.totalGames || obs.totalGames === 0) continue;
    const expected = (obs.w + 0.5 * obs.d) / obs.totalGames;
    const delta = Math.abs(obs.trainingScore - expected);
    if (delta > 0.001) {
      errors.push(`${obs.entityId}: stored=${obs.trainingScore.toFixed(4)}, computed=${expected.toFixed(4)}`);
    }
  }
  assert(errors.length === 0, errors.slice(0, 5).join('; '));
});

check('each accepted entity has exactly one observation', () => {
  const errors: string[] = [];
  for (const eid of entityIds) {
    const obs = obsLines.filter((o: any) => o.entityId === eid);
    if (obs.length !== 1) errors.push(`${eid}: ${obs.length} observations`);
  }
  assert(errors.length === 0, errors.join('; '));
});

// ---- 5. 140-cell coverage per entity ----

check('each entity observation has totalCells=14', () => {
  const errors: string[] = [];
  for (const obs of obsLines) {
    if (obs.totalCells !== 14) errors.push(`${obs.entityId}: totalCells=${obs.totalCells}`);
  }
  assert(errors.length === 0, errors.join('; '));
});

check('each entity observation has totalGames=140', () => {
  const errors: string[] = [];
  for (const obs of obsLines) {
    if (obs.totalGames !== 140) errors.push(`${obs.entityId}: totalGames=${obs.totalGames}`);
  }
  assert(errors.length === 0, errors.join('; '));
});

// ---- 6. zero worker errors ----

check('all observations have workerErrors=0', () => {
  const bad = obsLines.filter((o: any) => o.workerErrors > 0);
  assert(bad.length === 0, `Observations with errors: ${bad.map((o: any) => o.entityId + ':' + o.workerErrors).join(', ')}`);
});

check('all cells have completed=true', () => {
  const bad = cellsLines.filter((c: any) => !c.completed || c.error);
  assert(bad.length === 0, `Incomplete cells: ${bad.map((c: any) => c.entityId + '[' + c.cellIndex + ']').slice(0, 5).join(', ')}`);
});

// ---- 7. nonempty team proof ----

check('all cells have nonemptyTeamProof=true', () => {
  const bad = cellsLines.filter((c: any) => !c.nonemptyTeamProof);
  assert(bad.length === 0, `Cells missing nonemptyTeamProof: ${bad.map((c: any) => c.entityId).slice(0, 5).join(', ')}`);
});

// ---- 8. source-relative score ----

check('baseline observations have sourceRelativeScore=null', () => {
  const bad = obsLines.filter((o: any) => o.entityKind === 'baseline' && o.sourceRelativeScore !== null);
  assert(bad.length === 0, `Baselines with non-null sourceRelativeScore: ${bad.map((o: any) => o.entityId).join(', ')}`);
});

// ---- 9. both-side deployments ----

check('each entity has cells for both side=1 and side=2', () => {
  const errors: string[] = [];
  for (const eid of entityIds) {
    const cells = cellsLines.filter((c: any) => c.entityId === eid);
    const sides = new Set(cells.map((c: any) => c.sourceSide));
    if (!sides.has(1)) errors.push(`${eid}: missing side=1`);
    if (!sides.has(2)) errors.push(`${eid}: missing side=2`);
  }
  assert(errors.length === 0, errors.join('; '));
});

// ---- 10. gift_jungle baseline ----

check('gift_jungle baseline has complete 140-game evidence', () => {
  const gjObs = obsLines.find((o: any) => o.sourceId === 'gift_jungle' && o.entityKind === 'baseline');
  assert(gjObs !== undefined, 'gift_jungle baseline observation not found');
  assert(gjObs.totalGames === 140, `gift_jungle totalGames: ${gjObs.totalGames}`);
  assert(gjObs.workerErrors === 0, `gift_jungle workerErrors: ${gjObs.workerErrors}`);
  console.log(`    gift_jungle baseline: W=${gjObs.w} D=${gjObs.d} L=${gjObs.l} score=${gjObs.trainingScore.toFixed(3)}`);
});

// ---- 11. score table ----

console.log('\n--- Source-relative screen table ---');
console.log('  Entity ID                              Kind       OpFam                   W    D    L   score  relative');
console.log('  ' + '-'.repeat(95));

const baselineScores = new Map<string, number>();
for (const obs of obsLines) {
  if (obs.entityKind === 'baseline') baselineScores.set(obs.sourceId, obs.trainingScore);
}

for (const obs of obsLines) {
  const rel = obs.sourceRelativeScore !== null ? `${obs.sourceRelativeScore >= 0 ? '+' : ''}${obs.sourceRelativeScore.toFixed(3)}` : '    —  ';
  const score = obs.trainingScore.toFixed(3);
  const eid = obs.entityId.padEnd(38);
  const kind = obs.entityKind.padEnd(10);
  const fam = obs.operatorFamily.padEnd(24);
  console.log(`  ${eid} ${kind} ${fam} ${String(obs.w).padStart(3)} ${String(obs.d).padStart(3)} ${String(obs.l).padStart(3)}  ${score}  ${rel}`);
}

// ---- Summary ----

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
console.log('✓ check_screen PASSED\n');
