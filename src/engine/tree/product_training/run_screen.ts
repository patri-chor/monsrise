// ============================================================
// src/engine/tree/product_training/run_screen.ts
// T037 Phase-2 产品路径筛选运行入口
//
// 运行：
//   npx vite-node src/engine/tree/product_training/run_screen.ts
//
// 调用链（严格约束）：
//   PersistentSimPool → fine_grained_worker(product_path) → playFullGame → product_tree_strategy
//
// 无 arena/sandbox/playSpecVsSpec/evaluateArena/hill_climb/sequential_tree_optimization/branch_induct
// ============================================================

import '../../env';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Formation } from '../../../ai/types';
import { PersistentSimPool } from '../persistent_pool';
import {
  T037_OUTPUT_DIR,
  T037_PROTOCOL,
  T037_SCHEDULE_ID,
  ensureOutputDir,
  generateCandidateBatch,
  loadCursor,
  saveCursor,
  screenEntity,
  computeManifestHash,
  appendJsonl,
  writeAtomic,
  GAMES_PER_CELL,
  CELLS_PER_ENTITY,
  type ScreenObservation,
} from './04_screen';
import { loadProductSources } from './01_sources';
import { createHash } from 'node:crypto';

// ---- 加载数据 ----

console.log(`\n=== run_screen.ts — T037 Product-Path Screen ===`);
console.log(`Protocol: ${T037_PROTOCOL}  Schedule: ${T037_SCHEDULE_ID}\n`);

const sources = loadProductSources();
const executableSources: Formation[] = sources.executable as unknown as Formation[];
console.log(`Executable sources: ${executableSources.length}`);

const bundlesRaw = JSON.parse(readFileSync(resolve('tests/fixtures/tree/early_seven_bundles.json'), 'utf8')) as any[];
const heldOutOpps: Formation[] = bundlesRaw.map(b => b.heldOutVariant as Formation);
console.log(`Held-out families: ${heldOutOpps.length}`);

// ---- manifest ----

const sourceFixtureFp = createHash('sha256')
  .update(JSON.stringify(executableSources.map((s: any) => s.fingerprint)))
  .digest('hex').slice(0, 16);
const manifest = {
  protocol: T037_PROTOCOL,
  scheduleId: T037_SCHEDULE_ID,
  createdAt: new Date().toISOString(),
  sourceFixtureRef: 'tests/fixtures/tree/eleven_frozen_sources.json',
  sourceFixtureFp,
  executableSourceCount: executableSources.length,
  heldOutFamilyCount: heldOutOpps.length,
  gamesPerCell: GAMES_PER_CELL,
  cellsPerEntity: CELLS_PER_ENTITY,
  totalGamesPerEntity: CELLS_PER_ENTITY * GAMES_PER_CELL,
  callChain: 'PersistentSimPool → fine_grained_worker(product_path) → playFullGame → product_tree_strategy',
};
const manifestHash = computeManifestHash(manifest);
(manifest as any).manifestHash = manifestHash;

// ---- 准备目录和文件路径 ----

const paths = ensureOutputDir(T037_OUTPUT_DIR);

// 写 manifest（若不存在）
if (!existsSync(paths.manifestPath)) {
  writeAtomic(paths.manifestPath, manifest);
  console.log(`  [manifest] written → ${paths.manifestPath}`);
} else {
  const existing = JSON.parse(readFileSync(paths.manifestPath, 'utf8'));
  if (existing.manifestHash !== manifestHash) {
    throw new Error(`MANIFEST_MISMATCH: existing=${existing.manifestHash} computed=${manifestHash}`);
  }
  console.log(`  [manifest] verified (hash match)`);
}

// 写 README
if (!existsSync(paths.readmePath)) {
  const readme = [
    `# T037 Product-Path Screen Evidence`,
    ``,
    `Protocol: ${T037_PROTOCOL}`,
    `Schedule: ${T037_SCHEDULE_ID}`,
    `Manifest hash: ${manifestHash}`,
    ``,
    `## Call chain`,
    `PersistentSimPool → fine_grained_worker(product_path) → playFullGame → product_tree_strategy`,
    ``,
    `## Files`,
    `- manifest.json: protocol/schedule identity`,
    `- sources.jsonl: executable source records`,
    `- candidate_registry.jsonl: accepted candidates`,
    `- rejected_candidates.jsonl: rejected candidates`,
    `- screen_cells.jsonl: per-opp×side cell W/D/L`,
    `- screen_observations.jsonl: per-entity summary`,
    `- traces.jsonl: branch deployment traces`,
    `- cursor.json: resume state`,
    ``,
    `## Protocol constraints`,
    `- No arena/sandbox/playSpecVsSpec`,
    `- No autonomous loop/promotion/apply/deploy`,
    `- gift_jungle 8-monster repaired baseline treated like any other executable source`,
    `- T035 seven-monster evidence remains in product_path_t035/ and is never merged here`,
  ].join('\n');
  writeFileSync(paths.readmePath, readme, 'utf8');
}

// 写 sources
if (!existsSync(paths.sourcesPath)) {
  for (const src of executableSources) {
    appendJsonl(paths.sourcesPath, {
      sourceId: (src as any).id,
      sourceName: (src as any).name,
      fingerprint: (src as any).fingerprint,
      teamSize: (src as any).team?.length,
      isLegacyBaseline: (src as any).isLegacyBaseline,
      sourceIndex: (src as any).sourceIndex,
    });
  }
  console.log(`  [sources] written ${executableSources.length} records`);
}

// ---- 生成候选批次 ----

const allEntries = generateCandidateBatch(executableSources);
const validEntries = allEntries.filter(e => !e.meta.rejected);
const rejectedEntries = allEntries.filter(e => e.meta.rejected);

console.log(`\nCandidate batch:`);
console.log(`  Total: ${allEntries.length} (${validEntries.length} valid, ${rejectedEntries.length} rejected)`);

// 写 registry 和 rejected（若不存在）
if (!existsSync(paths.registryPath)) {
  for (const e of validEntries) appendJsonl(paths.registryPath, e.meta);
  console.log(`  [registry] written ${validEntries.length} accepted candidates`);
}
if (!existsSync(paths.rejectedPath)) {
  for (const e of rejectedEntries) appendJsonl(paths.rejectedPath, e.meta);
  console.log(`  [rejected] written ${rejectedEntries.length} rejected candidates`);
}

// ---- 游标 ----

const cursor = loadCursor(paths.cursorPath, manifestHash);
const alreadyDone = new Set(cursor.completedEntityIds);
const toEvaluate = validEntries.filter(e => !alreadyDone.has(e.meta.candidateId));
console.log(`\nEntities to evaluate: ${toEvaluate.length} (${alreadyDone.size} already done)`);

// ---- pool ----

const pool = await PersistentSimPool.getInstance();
console.log(`\nPool initialized. Starting screen...\n`);

// ---- 筛选（串行；外部并发 <=2 由 T038 管理；Phase-2 串行） ----

const observations: ScreenObservation[] = [];
let entityNum = 0;

for (const entry of toEvaluate) {
  entityNum++;
  const kind = entry.meta.operatorFamily === 'baseline' ? 'baseline' : `candidate(${entry.meta.operatorFamily})`;
  console.log(`[${entityNum}/${toEvaluate.length}] ${entry.meta.candidateId}  [${kind}]  src=${entry.meta.sourceId}`);

  const obs = await screenEntity({ pool, entry, heldOutOpps, manifestHash, paths });
  observations.push(obs);

  cursor.completedEntityIds.push(entry.meta.candidateId);
  saveCursor(paths.cursorPath, cursor);

  const score = obs.trainingScore.toFixed(3);
  const err = obs.workerErrors > 0 ? `  ⚠ ${obs.workerErrors} errors` : '';
  console.log(`   W=${obs.w} D=${obs.d} L=${obs.l}  score=${score}${err}`);
}

// ---- 计算 source-relative score ----

const baselineObs = observations.filter(o => o.entityKind === 'baseline');
const baselineScoreMap = new Map(baselineObs.map(o => [o.sourceId, o.trainingScore]));

// 更新已有观察记录的相对分数（reconcile 文件）
const allObs: ScreenObservation[] = [];
if (existsSync(paths.observationsPath)) {
  const rawLines = readFileSync(paths.observationsPath, 'utf8').split('\n').filter(Boolean);
  for (const line of rawLines) {
    const o: ScreenObservation = JSON.parse(line);
    const baseScore = baselineScoreMap.get(o.sourceId);
    if (o.entityKind === 'candidate' && baseScore !== undefined) {
      o.sourceRelativeScore = o.trainingScore - baseScore;
    }
    allObs.push(o);
  }
  writeFileSync(paths.observationsPath, allObs.map(o => JSON.stringify(o)).join('\n') + '\n', 'utf8');
}

// ---- 汇总 ----

console.log(`\n${'='.repeat(50)}`);
console.log(`T037 Screen Complete`);
console.log(`${'='.repeat(50)}`);
console.log(`Evaluated: ${entityNum} entities`);
console.log(`Baselines: ${baselineObs.length}`);
if (baselineObs.length > 0) {
  console.log(`\n--- Baseline scores ---`);
  for (const o of baselineObs) {
    console.log(`  ${o.sourceId.padEnd(20)} W=${o.w} D=${o.d} L=${o.l}  score=${o.trainingScore.toFixed(3)}`);
  }
}
console.log(`\nEvidence: ${T037_OUTPUT_DIR}`);
console.log(`Cursor: ${cursor.completedEntityIds.length} entities complete`);
console.log('\n✓ run_screen DONE\n');
