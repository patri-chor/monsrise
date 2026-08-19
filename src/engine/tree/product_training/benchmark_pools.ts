// ============================================================
// src/engine/tree/product_training/benchmark_pools.ts
// T040 三大基准池定义、冻结与 Manifest 导出
//
// 规范要求：
//   1. Stage 3 Early Bundle: 7 个现有早期变体 + 1 个明确的历史较弱 Gift Jungle 快照 (7 怪版本)
//      - 严禁静默替换为当前修复后的 8 怪 gift_jungle
//   2. Stage 2 & 1 Current Strong Pool: 11 个当前冻结强阵
//   3. Melee Pool: 扩展版本化混合池 (包含 Early Bundle 代表 + Current Strong 代表 + 历史候选)
// ============================================================

import { readFileSync, existsSync, writeFileSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import type { Formation } from '../../../ai/types';
import { formationToEvol } from '../evol_gene';
import { computeCandidateFingerprint } from './02_candidates';
import { T037_OUTPUT_DIR } from './04_screen';

export const BENCHMARK_MANIFEST_PATH = resolve(`${T037_OUTPUT_DIR}/benchmark_manifests.json`);

export interface BenchmarkMember {
  id: string;
  sourcePool: 'EARLY_BUNDLE' | 'CURRENT_STRONG' | 'HISTORICAL_SNAPSHOT' | 'EXPERIMENTAL_PREV';
  fingerprint: string;
  provenance: string;
  teamSize: number;
  selectionReason: string;
}

export interface BenchmarkPoolManifest {
  poolName: string;
  revision: string;
  opponentCount: number;
  poolHash: string;
  members: BenchmarkMember[];
}

export interface AllBenchmarkManifests {
  schemaVersion: 'T040_BENCHMARK_MANIFEST_V1';
  evidenceClass: 'AGGREGATE_EXPLORATION_ONLY';
  createdAt: string;
  earlyBundleStage3: BenchmarkPoolManifest;
  currentStrongStage2Stage1: BenchmarkPoolManifest;
  meleePool: BenchmarkPoolManifest;
}

/** 辅助函数：计算阵型指纹 */
function getFormationFp(f: Formation): string {
  try {
    const evol = formationToEvol(f);
    return computeCandidateFingerprint(evol);
  } catch {
    return createHash('sha256').update(JSON.stringify(f)).digest('hex').slice(0, 16);
  }
}

/** 加载历史未修复的 Gift Jungle 快照 (7 怪版本) */
export function loadHistoricalGiftJungle(): Formation {
  const archivePath = resolve('tests/fixtures/tree/t016_training_archive/source_snapshot.json');
  if (!existsSync(archivePath)) {
    throw new Error(`HISTORICAL_GIFT_JUNGLE_ARCHIVE_NOT_FOUND: ${archivePath}`);
  }
  const archive = JSON.parse(readFileSync(archivePath, 'utf8')) as Formation[];
  const gj = archive.find((s: any) => s.id === 'gift_jungle');
  if (!gj) {
    throw new Error('HISTORICAL_GIFT_JUNGLE_NOT_FOUND_IN_T016_ARCHIVE');
  }
  if (Array.isArray(gj.team) && gj.team.length === 8) {
    throw new Error('HISTORICAL_GIFT_JUNGLE_INVALID: Expected historical 7-monster snapshot, got 8 monsters');
  }
  // 设置独立 ID 与属性，杜绝与当前 8 怪 gift_jungle 混淆
  const copy: Formation = JSON.parse(JSON.stringify(gj));
  (copy as any).id = 'historical_gift_jungle_t016';
  (copy as any).name = 'Historical Gift Jungle (T016 7-Unit Snapshot)';
  return copy;
}

/** 加载 Early Bundle 8 对手 (7 个 heldOutVariant + 1 个 historical Gift Jungle) */
export function loadEarlyBundle8Opponents(): { opponents: Formation[]; members: BenchmarkMember[] } {
  const bundlePath = resolve('tests/fixtures/tree/early_seven_bundles.json');
  const bundles = JSON.parse(readFileSync(bundlePath, 'utf8')) as any[];

  const opponents: Formation[] = [];
  const members: BenchmarkMember[] = [];

  // 1. 7 个 Early Bundle held-out 变体
  for (const b of bundles) {
    const opp = b.heldOutVariant as Formation;
    const oppId = (opp as any).id ?? `${b.sourceId}_heldout`;
    (opp as any).id = oppId;
    opponents.push(opp);
    members.push({
      id: oppId,
      sourcePool: 'EARLY_BUNDLE',
      fingerprint: getFormationFp(opp),
      provenance: `tests/fixtures/tree/early_seven_bundles.json#${b.sourceId}`,
      teamSize: Array.isArray(opp.team) ? opp.team.length : 8,
      selectionReason: `Early Bundle held-out variant for archetype ${b.sourceId}`,
    });
  }

  // 2. 加上第 8 个：明确的历史 7 怪版本 Gift Jungle 快照
  const histGj = loadHistoricalGiftJungle();
  opponents.push(histGj);
  members.push({
    id: (histGj as any).id,
    sourcePool: 'HISTORICAL_SNAPSHOT',
    fingerprint: getFormationFp(histGj),
    provenance: 'tests/fixtures/tree/t016_training_archive/source_snapshot.json#gift_jungle',
    teamSize: Array.isArray(histGj.team) ? histGj.team.length : 7,
    selectionReason: 'Historical 7-monster Gift Jungle snapshot to test legacy baseline pattern recognition',
  });

  return { opponents, members };
}

/** 加载当前强阵池 (11 个冻结源) */
export function loadCurrentStrong11Opponents(): { opponents: Formation[]; members: BenchmarkMember[] } {
  const srcPath = resolve('tests/fixtures/tree/eleven_frozen_sources.json');
  const sources = JSON.parse(readFileSync(srcPath, 'utf8')) as any[];
  const execSources = sources.filter((s: any) => !s.isLegacyBaseline) as Formation[];

  const opponents: Formation[] = [];
  const members: BenchmarkMember[] = [];

  for (const s of execSources) {
    opponents.push(s);
    members.push({
      id: (s as any).id,
      sourcePool: 'CURRENT_STRONG',
      fingerprint: (s as any).fingerprint ?? getFormationFp(s),
      provenance: `tests/fixtures/tree/eleven_frozen_sources.json#${(s as any).id}`,
      teamSize: Array.isArray(s.team) ? s.team.length : 8,
      selectionReason: `Current strong formation source ${(s as any).id} (${(s as any).archetype})`,
    });
  }

  return { opponents, members };
}

/** 加载 Melee 混合池 (包含 Early Bundle 代表 + Current Strong 代表 + 历史候选) */
export function loadMeleePoolOpponents(): { opponents: Formation[]; members: BenchmarkMember[] } {
  const { opponents: eb8, members: ebMembers } = loadEarlyBundle8Opponents();
  const { opponents: str11, members: strMembers } = loadCurrentStrong11Opponents();

  // 选取混合阵容：5 个 Early Bundle 代表 + 8 个 Current Strong 代表 + 3 个历史候选代表 = 16 个对手
  const opponents: Formation[] = [];
  const members: BenchmarkMember[] = [];

  // Early Bundle 代表
  const ebSample = eb8.slice(0, 5);
  for (let i = 0; i < ebSample.length; i++) {
    opponents.push(ebSample[i]);
    members.push({
      ...ebMembers[i],
      selectionReason: `Melee representative: Early Bundle ${ebMembers[i].id}`,
    });
  }

  // Current Strong 代表
  const strSample = str11.slice(0, 8);
  for (let i = 0; i < strSample.length; i++) {
    opponents.push(strSample[i]);
    members.push({
      ...strMembers[i],
      selectionReason: `Melee representative: Strong Pool ${strMembers[i].id}`,
    });
  }

  // 历史候选快照代表 (从 four_frozen_candidates 加载 3 个)
  const candPath = resolve('tests/fixtures/tree/four_frozen_candidates.jsonl');
  if (existsSync(candPath)) {
    const lines = readFileSync(candPath, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    const candSample = lines.slice(0, 3);
    for (const c of candSample) {
      const form = (c.formation || c.evol || c) as Formation;
      const id = c.id ?? c.candidateId ?? `melee_cand_${members.length}`;
      (form as any).id = id;
      opponents.push(form);
      members.push({
        id,
        sourcePool: 'EXPERIMENTAL_PREV',
        fingerprint: getFormationFp(form),
        provenance: `tests/fixtures/tree/four_frozen_candidates.jsonl#${id}`,
        teamSize: Array.isArray(form.team) ? form.team.length : 8,
        selectionReason: `Melee representative: Prior experimental candidate ${id}`,
      });
    }
  }

  return { opponents, members };
}

/** 生成并写入所有 Benchmark 清单 */
export function generateAndSaveBenchmarkManifests(): AllBenchmarkManifests {
  const { members: ebMembers } = loadEarlyBundle8Opponents();
  const { members: strMembers } = loadCurrentStrong11Opponents();
  const { members: meleeMembers } = loadMeleePoolOpponents();

  const ebHash = createHash('sha256').update(JSON.stringify(ebMembers)).digest('hex').slice(0, 16);
  const strHash = createHash('sha256').update(JSON.stringify(strMembers)).digest('hex').slice(0, 16);
  const meleeHash = createHash('sha256').update(JSON.stringify(meleeMembers)).digest('hex').slice(0, 16);

  const manifests: AllBenchmarkManifests = {
    schemaVersion: 'T040_BENCHMARK_MANIFEST_V1',
    evidenceClass: 'AGGREGATE_EXPLORATION_ONLY',
    createdAt: new Date().toISOString(),
    earlyBundleStage3: {
      poolName: 'STAGE_3_EARLY_BUNDLE_8',
      revision: 'v1.0.0-t040',
      opponentCount: ebMembers.length,
      poolHash: ebHash,
      members: ebMembers,
    },
    currentStrongStage2Stage1: {
      poolName: 'STAGE_2_1_CURRENT_STRONG_11',
      revision: 'v1.0.0-t040',
      opponentCount: strMembers.length,
      poolHash: strHash,
      members: strMembers,
    },
    meleePool: {
      poolName: 'MELEE_MIXED_POOL_16',
      revision: 'v1.0.0-t040',
      opponentCount: meleeMembers.length,
      poolHash: meleeHash,
      members: meleeMembers,
    },
  };

  const tmp = `${BENCHMARK_MANIFEST_PATH}.tmp`;
  writeFileSync(tmp, JSON.stringify(manifests, null, 2), 'utf8');
  renameSync(tmp, BENCHMARK_MANIFEST_PATH);

  return manifests;
}
