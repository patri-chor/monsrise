import '../src/engine/env';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { FORMATION_LIBRARY } from '../src/ai/formation_library';
import type { Formation } from '../src/ai/types';

export interface BundleFamily {
  familyId: string;
  chineseName: string;
  archetype: string;
  archetypeDescription: string;
  trainingVariant: Formation;
  heldOutVariant: Formation;
}

const ARCH_DESCS: Record<string, string> = {
  prayer: '祷徒体系：学徒103+祈祷105 保射手核心输出，阵型依靠前排承伤与后排高额法术/物理持续伤害。',
  halfrush: '半冲体系：祈祷105+帝国110 形成前战士后射手的稳固推线节奏，兼具单点爆发与阵地拉扯。',
  fullrush: '全冲体系：爆发型速攻，前中期投入高机动刺客与快速破盾手，追求早期压制与敌方后排秒杀。',
};

export function buildEarlySevenBundlesFixture(): BundleFamily[] {
  const families: BundleFamily[] = [];
  const baseSeven = FORMATION_LIBRARY.slice(0, 7);

  for (const f of baseSeven) {
    const familyId = f.id ?? f.name;
    const chineseName = f.name;
    const archetype = f.archetype || 'prayer';
    const archetypeDescription = ARCH_DESCS[archetype] ?? `${chineseName} 基础战术体系`;

    const trainingVariant: Formation = JSON.parse(JSON.stringify(f));
    trainingVariant.id = `${familyId}_train`;
    trainingVariant.name = `${chineseName} (训练变体)`;

    // 构造确定性的 Held-Out 变体（保持队伍怪兽不变，调整徽章搭配或确定性先验）
    const heldOutVariant: Formation = JSON.parse(JSON.stringify(f));
    heldOutVariant.id = `${familyId}_heldout`;
    heldOutVariant.name = `${chineseName} (保留验证变体)`;
    
    // 微调 heldOut 的徽章或站位以形成合法泛化变体
    if (heldOutVariant.team.length > 0) {
      heldOutVariant.team = heldOutVariant.team.map((slot, sIdx) => {
        const badges = [...slot.badgeIds];
        // 确定性微调徽章顺序或合法徽章替换
        if (badges.length >= 2) {
          const tmp = badges[0];
          badges[0] = badges[1];
          badges[1] = tmp;
        }
        return {
          monsterId: slot.monsterId,
          badgeIds: badges,
        };
      });
    }

    families.push({
      familyId,
      chineseName,
      archetype,
      archetypeDescription,
      trainingVariant,
      heldOutVariant,
    });
  }

  return families;
}

const fixture = buildEarlySevenBundlesFixture();
const targetPath = resolve('tests/fixtures/tree/early_seven_bundles.json');
writeFileSync(targetPath, JSON.stringify(fixture, null, 2), 'utf8');
console.log(`Successfully generated 7 early bundle families fixture at ${targetPath}`);
