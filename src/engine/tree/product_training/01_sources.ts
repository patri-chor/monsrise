// ============================================================
// T036 Phase-1 — 01_sources.ts
// 加载冻结源并验证 Gift Jungle 修复；提供源指纹。
//
// 约束：
//   - 只读加载，不写入，不修改任何源文件
//   - gift_jungle 必须 isLegacyBaseline=false，team=8，叶子有 116
//   - 不导入 arena / hill_climb / sequential_tree_optimization / branch_induct
// ============================================================

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Formation } from '../../../ai/types';
import { formationToEvol, walkEvolNodes } from '../evol_gene';
import type { EvolFormation } from '../evol_gene';

export const SOURCES_PATH = resolve('tests/fixtures/tree/eleven_frozen_sources.json');
export const GIFT_JUNGLE_ID = 'gift_jungle';

/** 源元数据（含修复溯源） */
export interface SourceRecord {
  sourceIndex: number;
  id: string;
  name: string;
  archetype: string;
  isLegacyBaseline: boolean;
  fingerprint: string;
  calculatedUnitRatio: number;
  calculatedCount: number;
  controllableCount: number;
  sourceMetadata?: {
    sourceId: string;
    repairKind: string;
    addedSlot: { monsterId: number; badgeIds: number[] };
    archiveReference: string;
    historicalEvidence: string;
    repairedAt: string;
  };
}

export interface LoadedSources {
  all: Formation[];
  executable: Formation[];
  legacy: Formation[];
  records: SourceRecord[];
  executableRecords: SourceRecord[];
}

/**
 * 从 eleven_frozen_sources.json 加载所有源，并验证 Gift Jungle 修复。
 * 如果验证失败，抛出描述性错误（fail-closed）。
 */
export function loadProductSources(): LoadedSources {
  if (!existsSync(SOURCES_PATH)) {
    throw new Error(`SOURCES_NOT_FOUND: ${SOURCES_PATH}`);
  }
  const raw: any[] = JSON.parse(readFileSync(SOURCES_PATH, 'utf8'));

  // 验证 gift_jungle 已修复
  const gj = raw.find((s: any) => s.id === GIFT_JUNGLE_ID);
  if (!gj) throw new Error('GIFT_JUNGLE_MISSING: gift_jungle source not found in eleven_frozen_sources.json');
  if (gj.isLegacyBaseline !== false) {
    throw new Error(`GIFT_JUNGLE_STILL_LEGACY: isLegacyBaseline=${gj.isLegacyBaseline}, expected false after T036 repair`);
  }
  if (!Array.isArray(gj.team) || gj.team.length !== 8) {
    throw new Error(`GIFT_JUNGLE_TEAM_COUNT: expected 8, got ${gj.team?.length}`);
  }
  const has116 = gj.team.some((s: any) => s.monsterId === 116);
  if (!has116) {
    throw new Error('GIFT_JUNGLE_MISSING_116: monster 116 not found in gift_jungle team');
  }

  // 验证所有 R5 叶子都部署了 116
  const gjevol = formationToEvol(gj as Formation);
  const leaves = walkEvolNodes(gjevol.root).filter(n => n.children.length === 0 && n.round === 5);
  for (const leaf of leaves) {
    const has116InLeaf = leaf.placements.some(p => p.monsterId === 116);
    if (!has116InLeaf) {
      throw new Error(`GIFT_JUNGLE_LEAF_MISSING_116: leaf node ${leaf.id} at round 5 has no placement for monster 116`);
    }
  }

  const all = raw as Formation[];
  const executable = all.filter((s: any) => !s.isLegacyBaseline);
  const legacy = all.filter((s: any) => s.isLegacyBaseline);

  const records: SourceRecord[] = raw.map((s: any) => ({
    sourceIndex: s.sourceIndex,
    id: s.id,
    name: s.name,
    archetype: s.archetype,
    isLegacyBaseline: s.isLegacyBaseline,
    fingerprint: s.fingerprint,
    calculatedUnitRatio: s.calculatedUnitRatio ?? 0,
    calculatedCount: s.calculatedCount ?? 0,
    controllableCount: s.controllableCount ?? 0,
    sourceMetadata: s.sourceMetadata,
  }));

  return {
    all,
    executable,
    legacy,
    records,
    executableRecords: records.filter(r => !r.isLegacyBaseline),
  };
}

/**
 * 对源计算规范指纹（SHA-256 of id+team+tree topology）。
 * 与 eleven_frozen_sources.json 中存储的 fingerprint 字段语义一致。
 */
export function computeSourceFingerprint(source: Formation): string {
  const evol = formationToEvol(source);
  const topology = extractTopology(evol);
  return createHash('sha256')
    .update(JSON.stringify({ id: source.id, team: source.team, topology }))
    .digest('hex')
    .slice(0, 12);
}

/** 提取树拓扑（id/round/placements，不含 label/comment 等展示字段） */
function extractTopology(evol: EvolFormation): any {
  function nodeTopology(n: any): any {
    return {
      id: n.id,
      round: n.round,
      condition: n.condition,
      placements: n.placements.map((p: any) => ({ monsterId: p.monsterId, x: p.x, y: p.y })),
      children: n.children.map(nodeTopology),
    };
  }
  return {
    team: evol.team,
    root: nodeTopology(evol.root),
  };
}

/** 验证 gift_jungle v2 不存在 */
export function assertNoGiftJungleV2(sources: LoadedSources): void {
  const hasV2 = sources.all.some(
    (s: any) => typeof s.id === 'string' && s.id.toLowerCase().includes('gift_jungle_v2'),
  );
  if (hasV2) {
    throw new Error('GIFT_JUNGLE_V2_EXISTS: gift_jungle_v2 source must not exist (T036 B.2)');
  }
}
