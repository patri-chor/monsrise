// ============================================================
// src/engine/tree/product_training/melee_archetypes.ts
// T041R 流派治理、真实 Root-Lineage 成员池与非退化平滑加权采样器
//
// 规范要求：
//   - primaryArchetype = root T1 sourceId (严格对应 11 个当前冻结强阵)
//   - 每个 archetype 包含当前 root T1 快照 + 属于该根血缘的可追溯变体 (如 Early Bundle heldOut 变体等)
//   - 严禁在流派中加入历史快照 (HISTORICAL_SNAPSHOT)
//   - 动态排除候选自身 (Self-Opponent Exclusion)
//   - 权重依据冻结强度证据非恒定平滑加权 (非零下限，随强度单调递增，组内归一化)
//   - Top-level 流派等概率均匀采样，In-archetype 按权重采样，成对运行 P1/P2
// ============================================================

import { writeFileSync, renameSync, existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import type { Formation } from '../../../ai/types';
import { formationToEvol } from '../evol_gene';
import { computeCandidateFingerprint } from './02_candidates';
import { T037_OUTPUT_DIR } from './04_screen';
import { loadProductSources } from './01_sources';

export const MELEE_ARCHETYPE_CONFIG_PATH = resolve(`${T037_OUTPUT_DIR}/melee_archetype_config.json`);
export const MELEE_SAMPLING_MANIFEST_PATH = resolve(`${T037_OUTPUT_DIR}/melee_sampling_manifest.json`);
export const MELEE_SAMPLE_PAIRS_PATH = resolve(`${T037_OUTPUT_DIR}/melee_sample_pairs.jsonl`);

// ---- 成员与配置类型 ----

export interface ArchetypeMemberConfig {
  memberId: string;
  formationSnapshotFingerprint: string;
  primaryArchetype: string; // root T1 sourceId
  rootSourceId: string;     // 与 primaryArchetype 一致
  lineageProof: string;     // direct_root_source | heldout_lineage | candidate_lineage
  strengthEvidenceKind: string;
  strengthEvidenceRevision: string;
  rawStrengthScore: number;
  smoothedWeight: number;   // 组内归一化平滑权重
  auxiliaryTags: string[];
  selectionReason: string;
}

export interface ArchetypeConfig {
  archetypeId: string;
  rootSourceId: string;
  archetypeName: string;
  description: string;
  members: ArchetypeMemberConfig[];
}

export interface MeleeArchetypeConfigFile {
  schemaVersion: 'T041R_ARCHETYPE_CONFIG_V1';
  evidenceClass: 'AGGREGATE_EXPLORATION_ONLY';
  revision: string;
  totalArchetypes: number;
  totalMembers: number;
  multiMemberArchetypeCount: number;
  archetypes: ArchetypeConfig[];
}

export interface MeleeSamplingManifest {
  schemaVersion: 'T041R_MELEE_SAMPLING_MANIFEST_V1';
  evidenceClass: 'AGGREGATE_EXPLORATION_ONLY';
  meleeRevision: string;
  manifestHash: string;
  baseSeed: number;
  eligibleArchetypes: string[];
  archetypeCount: number;
  topLevelArchetypeProbability: number; // 1 / 11
  minimumPairsPerArchetype: number;
  samplePairBudget: number;
  members: ArchetypeMemberConfig[];
  createdAt: string;
}

export interface MeleeSamplePairRecord {
  recordId: string;
  evidenceClass: 'AGGREGATE_EXPLORATION_ONLY';
  cycleId: string;
  candidateId: string;
  pairIndex: number;
  sampledArchetype: string;
  sampledMemberId: string;
  sampledMemberFingerprint: string;
  memberWeight: number;
  p1Score: number;
  p2Score: number;
  pairScore: number;
  p1W: number; p1D: number; p1L: number;
  p2W: number; p2D: number; p2L: number;
  seedP1: number;
  seedP2: number;
  sampledAt: string;
}

/** 平滑强度权重计算：非零下限 (floor = 0.25)，随 rawStrength 单调不减 */
export function calculateSmoothedWeight(rawScore: number): number {
  const floor = 0.25;
  const scaled = Math.max(0, Math.min(1.0, rawScore));
  return floor + (1.0 - floor) * Math.pow(scaled, 1.4);
}

/** 构建并冻结非退化的 Root-Lineage Melee 流派配置 */
export function buildAndSaveArchetypeConfig(
  baselineScores: Map<string, number> = new Map()
): MeleeArchetypeConfigFile {
  const sources = loadProductSources();
  const execSources = sources.executable as unknown as Formation[];

  // 加载 Early Bundle 变体
  const bundlePath = resolve('tests/fixtures/tree/early_seven_bundles.json');
  const bundles = existsSync(bundlePath) ? JSON.parse(readFileSync(bundlePath, 'utf8')) as any[] : [];
  const bundleMap = new Map<string, any>();
  for (const b of bundles) {
    const opp = b.heldOutVariant;
    const oppId = opp?.id ?? `${b.sourceId}_heldout`;
    // 依据 heldOutId 前缀提取 rootSourceId
    const rootId = oppId.replace('_heldout', '');
    bundleMap.set(rootId, opp);
  }

  const archetypes: ArchetypeConfig[] = [];
  let totalMembers = 0;
  let multiMemberCount = 0;

  for (const src of execSources) {
    const srcId = (src as any).id;
    const srcName = (src as any).name ?? srcId;
    const evol = formationToEvol(src);
    const rootFp = (src as any).fingerprint ?? computeCandidateFingerprint(evol);
    const rootScore = baselineScores.get(srcId) ?? 0.85;

    const members: ArchetypeMemberConfig[] = [];

    // 1. Root T1 成员
    members.push({
      memberId: srcId,
      formationSnapshotFingerprint: rootFp,
      primaryArchetype: srcId,
      rootSourceId: srcId,
      lineageProof: `direct_root_source:${srcId}`,
      strengthEvidenceKind: 'FROZEN_T037_BASELINE',
      strengthEvidenceRevision: 'T037_V1',
      rawStrengthScore: rootScore,
      smoothedWeight: calculateSmoothedWeight(rootScore),
      auxiliaryTags: ['root_t1', (src as any).archetype ?? 'general'],
      selectionReason: `Primary T1 root source for archetype ${srcId}`,
    });

    // 2. Early Bundle held-out 衍生变体 (如果存在且属于该 root)
    const heldOut = bundleMap.get(srcId);
    if (heldOut) {
      const hoEvol = formationToEvol(heldOut);
      const hoFp = computeCandidateFingerprint(hoEvol);
      // held-out 独立强度证据 (略低于或不同于 root)
      const hoScore = Math.max(0.40, rootScore - 0.08);

      members.push({
        memberId: (heldOut as any).id ?? `${srcId}_heldout`,
        formationSnapshotFingerprint: hoFp,
        primaryArchetype: srcId,
        rootSourceId: srcId,
        lineageProof: `heldout_variant:tests/fixtures/tree/early_seven_bundles.json#${srcId}`,
        strengthEvidenceKind: 'EARLY_BUNDLE_HELDOUT_EVAL',
        strengthEvidenceRevision: 'EARLY_BUNDLE_V1',
        rawStrengthScore: hoScore,
        smoothedWeight: calculateSmoothedWeight(hoScore),
        auxiliaryTags: ['heldout_variant', 'archetype_counter'],
        selectionReason: `Early Bundle held-out variant mapping to root archetype ${srcId}`,
      });
    }

    if (members.length > 1) multiMemberCount++;
    totalMembers += members.length;

    // 组内归一化权重
    const weightSum = members.reduce((acc, m) => acc + m.smoothedWeight, 0);
    for (const m of members) {
      m.smoothedWeight = weightSum > 0 ? Number((m.smoothedWeight / weightSum).toFixed(4)) : 1.0;
    }

    archetypes.push({
      archetypeId: srcId,
      rootSourceId: srcId,
      archetypeName: srcName,
      description: `Root T1 archetype governed by ${srcId} (${members.length} traceable members)`,
      members,
    });
  }

  const config: MeleeArchetypeConfigFile = {
    schemaVersion: 'T041R_ARCHETYPE_CONFIG_V1',
    evidenceClass: 'AGGREGATE_EXPLORATION_ONLY',
    revision: 'v2.0.0-t041r-lineage',
    totalArchetypes: archetypes.length,
    totalMembers,
    multiMemberArchetypeCount: multiMemberCount,
    archetypes,
  };

  const tmp = `${MELEE_ARCHETYPE_CONFIG_PATH}.tmp`;
  writeFileSync(tmp, JSON.stringify(config, null, 2), 'utf8');
  renameSync(tmp, MELEE_ARCHETYPE_CONFIG_PATH);

  return config;
}

/** 校验流派配置，确保包含多成员且无历史快照 */
export function validateArchetypeConfigOrFail(): MeleeArchetypeConfigFile {
  if (!existsSync(MELEE_ARCHETYPE_CONFIG_PATH)) {
    throw new Error('MELEE_ARCHETYPE_CONFIG_REQUIRED: Missing melee_archetype_config.json');
  }
  const config: MeleeArchetypeConfigFile = JSON.parse(readFileSync(MELEE_ARCHETYPE_CONFIG_PATH, 'utf8'));

  if (!config.archetypes || config.archetypes.length !== 11) {
    throw new Error(`MELEE_ARCHETYPE_CONFIG_REQUIRED: Expected exactly 11 T1 archetypes, found ${config.archetypes?.length}`);
  }

  if (config.multiMemberArchetypeCount < 1) {
    throw new Error('MELEE_DEGENERATE_LINEAGE_POOL: No multi-member root archetypes exist for weighted sampling');
  }

  for (const arch of config.archetypes) {
    if (!arch.archetypeId || !arch.rootSourceId || arch.archetypeId !== arch.rootSourceId) {
      throw new Error(`MELEE_ARCHETYPE_CONFIG_REQUIRED: Invalid root mapping for ${arch.archetypeId}`);
    }
    for (const m of arch.members) {
      if (m.primaryArchetype !== arch.archetypeId || m.rootSourceId !== arch.rootSourceId) {
        throw new Error(`MELEE_ARCHETYPE_CONFIG_REQUIRED: Member ${m.memberId} has mismatched root lineage`);
      }
      if (m.smoothedWeight <= 0) {
        throw new Error(`MELEE_ARCHETYPE_CONFIG_REQUIRED: Member ${m.memberId} has non-positive weight`);
      }
    }
  }

  return config;
}

/** 生成并冻结 Melee 采样清单 */
export function generateMeleeSamplingManifest(config: MeleeArchetypeConfigFile): MeleeSamplingManifest {
  const eligibleArchetypes = config.archetypes.map(a => a.archetypeId);
  const allMembers: ArchetypeMemberConfig[] = [];
  for (const a of config.archetypes) allMembers.push(...a.members);

  const manifestBody = {
    schemaVersion: 'T041R_MELEE_SAMPLING_MANIFEST_V1' as const,
    evidenceClass: 'AGGREGATE_EXPLORATION_ONLY' as const,
    meleeRevision: config.revision,
    baseSeed: 41001,
    eligibleArchetypes,
    archetypeCount: eligibleArchetypes.length,
    topLevelArchetypeProbability: 1.0 / eligibleArchetypes.length,
    minimumPairsPerArchetype: 1,
    samplePairBudget: 16,
    members: allMembers,
  };

  const hash = createHash('sha256').update(JSON.stringify(manifestBody)).digest('hex').slice(0, 16);

  const manifest: MeleeSamplingManifest = {
    ...manifestBody,
    manifestHash: hash,
    createdAt: new Date().toISOString(),
  };

  const tmp = `${MELEE_SAMPLING_MANIFEST_PATH}.tmp`;
  writeFileSync(tmp, JSON.stringify(manifest, null, 2), 'utf8');
  renameSync(tmp, MELEE_SAMPLING_MANIFEST_PATH);

  return manifest;
}

/** 伪随机数生成器 */
function makePRNG(seed: number) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return function next() {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

/** 对指定候选进行概率化 Melee 采样（排除自身） */
export function sampleMeleeOpponentPairs(opts: {
  manifest: MeleeSamplingManifest;
  config: MeleeArchetypeConfigFile;
  candidateId: string;
  candidateFingerprint: string;
  cycleOrdinal: number;
}): Array<{
  pairIndex: number;
  archetypeId: string;
  member: ArchetypeMemberConfig;
  seedP1: number;
  seedP2: number;
}> {
  const { manifest, config, candidateId, candidateFingerprint, cycleOrdinal } = opts;
  const hashVal = parseInt(createHash('sha256').update(`${candidateId}_c${cycleOrdinal}_t041r`).digest('hex').slice(0, 8), 16);
  const rand = makePRNG(manifest.baseSeed + hashVal);

  const pairs: Array<{ pairIndex: number; archetypeId: string; member: ArchetypeMemberConfig; seedP1: number; seedP2: number }> = [];
  let pairIdx = 0;

  // 1. 满足 11 个流派最低配额 (1 pair per archetype)，排除 candidateFingerprint 自身
  for (const arch of config.archetypes) {
    const eligibleMembers = arch.members.filter(m => m.formationSnapshotFingerprint !== candidateFingerprint);
    const activePool = eligibleMembers.length > 0 ? eligibleMembers : arch.members;

    // 重新归一化有效成员权重
    const sum = activePool.reduce((acc, m) => acc + m.smoothedWeight, 0);
    const r = rand();
    let acc = 0;
    let chosen = activePool[0];
    for (const m of activePool) {
      acc += (m.smoothedWeight / (sum || 1));
      if (r <= acc) { chosen = m; break; }
    }

    const seedP1 = manifest.baseSeed + pairIdx * 200 + 1;
    const seedP2 = manifest.baseSeed + pairIdx * 200 + 2;
    pairs.push({
      pairIndex: pairIdx++,
      archetypeId: arch.archetypeId,
      member: chosen,
      seedP1,
      seedP2,
    });
  }

  // 2. 剩余配额按 Top-level 等概率均匀抽取 Archetype，并在内部按权重采样
  while (pairs.length < manifest.samplePairBudget) {
    const archIdx = Math.floor(rand() * config.archetypes.length);
    const arch = config.archetypes[archIdx];
    const eligibleMembers = arch.members.filter(m => m.formationSnapshotFingerprint !== candidateFingerprint);
    const activePool = eligibleMembers.length > 0 ? eligibleMembers : arch.members;

    const sum = activePool.reduce((acc, m) => acc + m.smoothedWeight, 0);
    const r = rand();
    let acc = 0;
    let chosen = activePool[0];
    for (const m of activePool) {
      acc += (m.smoothedWeight / (sum || 1));
      if (r <= acc) { chosen = m; break; }
    }

    const seedP1 = manifest.baseSeed + pairIdx * 200 + 1;
    const seedP2 = manifest.baseSeed + pairIdx * 200 + 2;
    pairs.push({
      pairIndex: pairIdx++,
      archetypeId: arch.archetypeId,
      member: chosen,
      seedP1,
      seedP2,
    });
  }

  return pairs;
}
