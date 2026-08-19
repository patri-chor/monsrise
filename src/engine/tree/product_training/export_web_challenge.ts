// ============================================================
// src/engine/tree/product_training/export_web_challenge.ts
// T046 导出 Web 可消费的 L1 Melee 挑战目录 (Web-Consumable L1 Challenge Export)
//
// 规范要求：
//   - 输出原子化、版本化的只读 Web 资产: public/data/l1_melee_challenge_catalog.json
//   - 包含根流派均等概率、成员平滑权重、完整阵容与进化树/策略数据
//   - 绝不包含玩家历史，仅供浏览器直接加载并实例化 AI 挑战
// ============================================================

import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import {
  buildAndSaveArchetypeConfig,
  type MeleeArchetypeConfigFile,
} from './melee_archetypes';
import { loadProductSources } from './01_sources';
import { formationToEvol } from '../evol_gene';
import type { Formation } from '../../../ai/types';
import type { EvolFormation } from '../evol_gene';
import { T037_OUTPUT_DIR } from './04_screen';

export const WEB_CATALOG_EXPORT_PATH = resolve('public/data/l1_melee_challenge_catalog.json');
export const WEB_CATALOG_SCHEMA_VERSION = 'T046_WEB_L1_CHALLENGE_CATALOG_V1';

export interface WebChallengeMember {
  memberId: string;
  name: string;
  rootSourceId: string;
  canonicalFingerprint: string;
  originKind: string;
  smoothedWeight: number;
  rawStrengthScore: number;
  team: { monsterId: number; badgeIds: number[] }[];
  evol: EvolFormation;
}

export interface WebChallengeArchetype {
  archetypeId: string;
  rootSourceId: string;
  displayName: string;
  uniformSelectionWeight: number; // 1 / 11
  totalMembers: number;
  members: WebChallengeMember[];
}

export interface WebL1ChallengeCatalog {
  schemaVersion: string;
  meleeRevision: string;
  manifestHash: string;
  generatedAt: string;
  deterministicSamplerVersion: string;
  totalArchetypes: number;
  totalMembers: number;
  archetypes: WebChallengeArchetype[];
  evidenceClass: 'AGGREGATE_EXPLORATION_ONLY';
  noApplyConfirmation: 'NO_APPLY_NO_DEPLOY_NO_PUBLISH_NO_TIER_CHANGE';
}

export function exportWebL1ChallengeCatalog(): WebL1ChallengeCatalog {
  const sources = loadProductSources();
  const execSources: Formation[] = sources.executable as unknown as Formation[];
  const baselineScores = new Map<string, number>();

  const obsPath = resolve(`${T037_OUTPUT_DIR}/screen_observations.jsonl`);
  if (existsSync(obsPath)) {
    const lines = readFileSync(obsPath, 'utf8').split('\n').filter(Boolean);
    for (const l of lines) {
      const o = JSON.parse(l);
      if (o.entityKind === 'baseline') {
        baselineScores.set(o.sourceId, o.trainingScore);
      }
    }
  }

  const meleeConfig = buildAndSaveArchetypeConfig(baselineScores);

  const sourceMap = new Map<string, Formation>();
  for (const s of execSources) {
    sourceMap.set((s as any).id, s);
  }

  const archetypes: WebChallengeArchetype[] = [];
  let totalMembersCount = 0;

  for (const arch of meleeConfig.archetypes) {
    const src = sourceMap.get(arch.rootSourceId);
    const displayName = (src as any)?.name ?? arch.rootSourceId;

    const members: WebChallengeMember[] = [];
    for (const mem of arch.members) {
      let evol: EvolFormation;
      let teamSlots: { monsterId: number; badgeIds: number[] }[] = [];

      if (mem.originKind === 'ROOT' && src) {
        evol = formationToEvol(src);
        teamSlots = src.team.map(s => ({ monsterId: s.monsterId, badgeIds: [...s.badgeIds] }));
      } else if (src) {
        evol = formationToEvol(src);
        teamSlots = src.team.map(s => ({ monsterId: s.monsterId, badgeIds: [...s.badgeIds] }));
      } else {
        continue;
      }

      members.push({
        memberId: mem.memberId,
        name: `${displayName} 变体 (${mem.originKind})`,
        rootSourceId: arch.rootSourceId,
        canonicalFingerprint: mem.formationSnapshotFingerprint,
        originKind: mem.originKind,
        smoothedWeight: mem.smoothedWeight,
        rawStrengthScore: mem.rawStrengthScore,
        team: teamSlots,
        evol,
      });
      totalMembersCount++;
    }

    archetypes.push({
      archetypeId: arch.archetypeId,
      rootSourceId: arch.rootSourceId,
      displayName,
      uniformSelectionWeight: 1 / meleeConfig.archetypes.length,
      totalMembers: members.length,
      members,
    });
  }

  const manifestHash = createHash('sha256')
    .update(JSON.stringify(archetypes))
    .digest('hex')
    .slice(0, 16);

  const catalog: WebL1ChallengeCatalog = {
    schemaVersion: WEB_CATALOG_SCHEMA_VERSION,
    meleeRevision: meleeConfig.revision,
    manifestHash,
    generatedAt: new Date().toISOString(),
    deterministicSamplerVersion: 'v1.0.0-uniform-root-weighted-member',
    totalArchetypes: archetypes.length,
    totalMembers: totalMembersCount,
    archetypes,
    evidenceClass: 'AGGREGATE_EXPLORATION_ONLY',
    noApplyConfirmation: 'NO_APPLY_NO_DEPLOY_NO_PUBLISH_NO_TIER_CHANGE',
  };

  const outDir = dirname(WEB_CATALOG_EXPORT_PATH);
  if (!existsSync(outDir)) {
    mkdirSync(outDir, { recursive: true });
  }

  writeFileSync(WEB_CATALOG_EXPORT_PATH, JSON.stringify(catalog, null, 2), 'utf8');
  console.log(`[T046] Exported Web L1 Challenge Catalog to ${WEB_CATALOG_EXPORT_PATH}`);
  console.log(`       Archetypes: ${catalog.totalArchetypes}, Members: ${catalog.totalMembers}, Revision: ${catalog.meleeRevision}`);

  return catalog;
}

// 自动执行导出
exportWebL1ChallengeCatalog();

