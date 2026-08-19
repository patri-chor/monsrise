// ============================================================
// src/engine/tree/product_training/melee_archetypes.ts
// T041 流派治理、平滑权重分配与两层概率采样器
//
// 规范要求：
//   - primaryArchetype = root T1 sourceId (严格对应 11 个当前冻结强阵)
//   - 严禁在流派中加入历史快照
//   - 若缺少完整流派血缘配置，fail-closed 抛出 MELEE_ARCHETYPE_CONFIG_REQUIRED
//   - Top-level 流派等概率均匀采样
//   - In-archetype 按平滑强度加权采样 (平滑正数、非零下限、随强度单调不减)
//   - 每次采样对手必须成对运行 P1/P2
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

// ---- 流派成员与配置类型 ----

export interface ArchetypeMemberConfig {
  memberId: string;
  formationSnapshotFingerprint: string;
  primaryArchetype: string; // root T1 sourceId
  rootSourceId: string;     // 必须与 primaryArchetype 一致
  lineageProof: string;     // direct_source | parent_chain
  rawStrengthScore: number; // 0.0 - 1.0 历史/基准强度
  smoothedWeight: number;   // 归一化平滑权重
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
  schemaVersion: 'T041_ARCHETYPE_CONFIG_V1';
  evidenceClass: 'AGGREGATE_EXPLORATION_ONLY';
  revision: string;
  totalArchetypes: number;
  totalMembers: number;
  archetypes: ArchetypeConfig[];
}

export interface MeleeSamplingManifest {
  schemaVersion: 'T041_MELEE_SAMPLING_MANIFEST_V1';
  evidenceClass: 'AGGREGATE_EXPLORATION_ONLY';
  meleeRevision: string;
  manifestHash: string;
  baseSeed: number;
  eligibleArchetypes: string[];
  archetypeCount: number;
  topLevelArchetypeProbability: number; // 1 / eligibleArchetypes.length
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

/** 平滑强度权重计算：非零下限 (floor = 0.20)，随 rawStrength 单调不减 */
export function calculateSmoothedWeight(rawScore: number): number {
  const floor = 0.20;
  const scaled = Math.max(0, Math.min(1.0, rawScore));
  return floor + (1.0 - floor) * Math.pow(scaled, 1.5);
}

/** 生成并验证流派治理配置 (严格 11 个当前 T1 强阵，无历史快照) */
export function buildAndSaveArchetypeConfig(): MeleeArchetypeConfigFile {
  const sources = loadProductSources();
  const execSources = sources.executable as unknown as Formation[];

  const archetypes: ArchetypeConfig[] = [];
  let totalMembers = 0;

  for (const src of execSources) {
    const srcId = (src as any).id;
    const srcName = (src as any).name ?? srcId;
    const evol = formationToEvol(src);
    const fp = (src as any).fingerprint ?? computeCandidateFingerprint(evol);
    const baselineScore = (src as any).calculatedUnitRatio !== undefined ? 0.85 : 0.80;

    // 严禁包含历史快照，仅包含 T1 根来源及衍生变体
    const rawWeight = calculateSmoothedWeight(baselineScore);

    const directMember: ArchetypeMemberConfig = {
      memberId: srcId,
      formationSnapshotFingerprint: fp,
      primaryArchetype: srcId,
      rootSourceId: srcId,
      lineageProof: `direct_root_source:${srcId}`,
      rawStrengthScore: baselineScore,
      smoothedWeight: rawWeight,
      auxiliaryTags: [`archetype_root`, (src as any).archetype ?? 'general'],
      selectionReason: `Primary T1 representative for archetype ${srcId}`,
    };

    archetypes.push({
      archetypeId: srcId,
      rootSourceId: srcId,
      archetypeName: srcName,
      description: `Root T1 archetype governed by source ${srcId}`,
      members: [directMember],
    });
    totalMembers += 1;
  }

  // 归一化每个流派内部成员的权重
  for (const arch of archetypes) {
    const sum = arch.members.reduce((acc, m) => acc + m.smoothedWeight, 0);
    for (const m of arch.members) {
      m.smoothedWeight = sum > 0 ? m.smoothedWeight / sum : 1.0;
    }
  }

  const config: MeleeArchetypeConfigFile = {
    schemaVersion: 'T041_ARCHETYPE_CONFIG_V1',
    evidenceClass: 'AGGREGATE_EXPLORATION_ONLY',
    revision: 'v1.0.0-t041-lineage',
    totalArchetypes: archetypes.length,
    totalMembers,
    archetypes,
  };

  const tmp = `${MELEE_ARCHETYPE_CONFIG_PATH}.tmp`;
  writeFileSync(tmp, JSON.stringify(config, null, 2), 'utf8');
  renameSync(tmp, MELEE_ARCHETYPE_CONFIG_PATH);

  return config;
}

/** 校验流派配置完整性，若缺少则 fail-closed 抛出 MELEE_ARCHETYPE_CONFIG_REQUIRED */
export function validateArchetypeConfigOrFail(): MeleeArchetypeConfigFile {
  if (!existsSync(MELEE_ARCHETYPE_CONFIG_PATH)) {
    throw new Error('MELEE_ARCHETYPE_CONFIG_REQUIRED: Missing melee_archetype_config.json');
  }
  const config: MeleeArchetypeConfigFile = JSON.parse(readFileSync(MELEE_ARCHETYPE_CONFIG_PATH, 'utf8'));

  if (!config.archetypes || config.archetypes.length !== 11) {
    throw new Error(`MELEE_ARCHETYPE_CONFIG_REQUIRED: Expected exactly 11 T1 archetypes, found ${config.archetypes?.length}`);
  }

  for (const arch of config.archetypes) {
    if (!arch.archetypeId || !arch.rootSourceId || arch.archetypeId !== arch.rootSourceId) {
      throw new Error(`MELEE_ARCHETYPE_CONFIG_REQUIRED: Invalid archetype root mapping for ${arch.archetypeId}`);
    }
    if (!arch.members || arch.members.length === 0) {
      throw new Error(`MELEE_ARCHETYPE_CONFIG_REQUIRED: Archetype ${arch.archetypeId} has no eligible members`);
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
    schemaVersion: 'T041_MELEE_SAMPLING_MANIFEST_V1' as const,
    evidenceClass: 'AGGREGATE_EXPLORATION_ONLY' as const,
    meleeRevision: config.revision,
    baseSeed: 41000,
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

/** 伪随机数生成器 (确定性采样) */
function makePRNG(seed: number) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return function next() {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

/** 对指定候选进行概率化 Archetype Melee 对手配对采样 */
export function sampleMeleeOpponentPairs(opts: {
  manifest: MeleeSamplingManifest;
  config: MeleeArchetypeConfigFile;
  candidateId: string;
  cycleOrdinal: number;
}): Array<{
  pairIndex: number;
  archetypeId: string;
  member: ArchetypeMemberConfig;
  seedP1: number;
  seedP2: number;
}> {
  const { manifest, config, candidateId, cycleOrdinal } = opts;
  const hashVal = parseInt(createHash('sha256').update(`${candidateId}_c${cycleOrdinal}`).digest('hex').slice(0, 8), 16);
  const rand = makePRNG(manifest.baseSeed + hashVal);

  const pairs: Array<{ pairIndex: number; archetypeId: string; member: ArchetypeMemberConfig; seedP1: number; seedP2: number }> = [];
  let pairIdx = 0;

  // 1. 满足每个流派的最低配额 (minimumPairsPerArchetype = 1 pair = 2 games)
  for (const arch of config.archetypes) {
    const r = rand();
    let acc = 0;
    let chosen = arch.members[0];
    for (const m of arch.members) {
      acc += m.smoothedWeight;
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

  // 2. 剩余预算按 Top-level 均匀采样 Archetype
  while (pairs.length < manifest.samplePairBudget) {
    const archIdx = Math.floor(rand() * config.archetypes.length);
    const arch = config.archetypes[archIdx];
    const r = rand();
    let acc = 0;
    let chosen = arch.members[0];
    for (const m of arch.members) {
      acc += m.smoothedWeight;
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
