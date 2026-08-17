// ============================================================
// 卡组生成器 v2（修复关键怪缺失）
//
// 背景：旧 deck_candidates.json 里，祷徒/半冲卡组完全缺失冲锋106/钻头116/铁甲117
//   等关键怪（只有 fullrush 有），导致半冲被误判为"弱流派"。实测 bundle 的半冲
//   （坚果救星 95%、肃清 95%）都带冲锋(巫毒32)+钻头。
//
// 方案（用户定案：按流派差异化配置关键怪）：
//   以 bundle 参考阵型的完整卡组为模板（天然含关键怪），只替换"四费核心怪"，
//   再按辅助标签 aux 调整徽章。关键怪徽章沿用 bundle 标准。
//
//   参考模板：祷徒→泉水剑、半冲→坚果救星、全冲→全二冲
//   关键怪配置（bundle 标准）：
//     祷徒   冲锋106(巫毒32+炸弹24) + 钻头116(巫毒32+炸弹24)
//     半冲   冲锋106(32+24) + 钻头116(32+24) + 突突114(3+32)
//     全冲   铁甲117(8+3) + 钻头116(3+5) + 冲锋106(32+24) + 突突114(3+1) + 咒法107 + 矿爆113
//
// 运行：npx vite-node --script src/engine/tree/deck_gen.ts
// 产出：reports/deck_candidates_v2.json
// ============================================================

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { FORMATION_LIBRARY } from '../../ai/formation_library';

/** arch → 参考模板阵型名（同流派模板树） */
const ARCH_TEMPLATE: Record<string, string> = {
  prayer: '泉水剑',
  halfrush: '坚果救星',
  fullrush: '全二冲',
};

/** core → 模板阵型名（fullrush 按核心怪选模板，因为不同四费核心有不同开局架构） */
const CORE_TEMPLATE: Record<string, string> = {
  // fullrush 的四费核心有对应模板：救星→经典救星(R1救星开局)，塞雷→梯子塞雷(R3塞雷)
  savior: '经典救星',
  seri: '梯子塞雷',
  golden: '经典救星', // 金猴四费，套经典救星的救星四费位
  digger: '经典救星', // 铲土四费，套经典救星的救星四费位
  // prayer/halfrush 的核心都套各自 arch 模板
  priest: '',
  suqing: '',
};

/** 四费核心怪（core）定义：core 名 → 怪兽 ID */
const CORE_MONSTERS: Record<string, number> = {
  savior: 108,  // 救星骑士
  priest: 102,  // 大祭司哥
  suqing: 101,  // 肃清哥
  golden: 120,  // 金面猴王
  digger: 115,  // 铲土人
  seri: 118,    // 塞雷
};

/** 各 arch 支持的核心怪列表（与旧生成器的 core 取值对齐） */
const ARCH_CORES: Record<string, string[]> = {
  prayer: ['savior', 'priest', 'suqing', 'golden', 'digger'],
  halfrush: ['savior', 'priest', 'suqing', 'golden', 'digger'],
  fullrush: ['savior', 'seri', 'golden', 'digger'],
};

/** 辅助标签 aux */
const AUX_LIST = ['none', 'dof', 'shield', 'gift'];

/** 四费核心怪的标准徽章（bundle 已用配置；未出现的用通用四费徽章） */
const CORE_BADGES: Record<number, number[]> = {
  102: [3, 22, 21], // 大祭司
  108: [3, 22, 21], // 救星
  101: [23, 3, 2],  // 肃清
  118: [11, 28, 30],// 塞雷
  120: [3, 22, 21], // 金猴（通用四费）
  115: [3, 22, 21], // 铲土（通用四费）
};

/** 替换模板卡组里的四费核心怪为 targetCore；若无四费（如全二冲），替换一只 2 费填充怪 */
function replaceCore(
  templateTeam: { monsterId: number; badgeIds: number[] }[],
  targetCore: number,
): { monsterId: number; badgeIds: number[] }[] {
  const out = templateTeam.map(s => ({ monsterId: s.monsterId, badgeIds: [...s.badgeIds] }));
  const coreBadges = CORE_BADGES[targetCore] ?? [3, 22, 21];
  // 找模板里的四费怪（cost=4 需查 DB，这里用已知四费 ID 集合）
  const FOUR_COST_IDS = new Set([101, 102, 108, 115, 118, 120]);
  const idx = out.findIndex(s => FOUR_COST_IDS.has(s.monsterId));
  if (idx >= 0) {
    out[idx] = { monsterId: targetCore, badgeIds: coreBadges };
    return out;
  }
  // 模板无四费（全二冲）：替换最后一只 2 费填充怪为四费核心
  // 全二冲 team 最后是 104 散弹，替换它
  const fillIdx = out.findIndex(s => s.monsterId === 104);
  if (fillIdx >= 0) out[fillIdx] = { monsterId: targetCore, badgeIds: coreBadges };
  return out;
}

/** 按 aux 调整徽章：给相关怪加对应标签徽章（保持 8 怪不变，只动徽章） */
function applyAux(team: { monsterId: number; badgeIds: number[] }[], aux: string): void {
  if (aux === 'none') return;
  // dof：凋零2 / 中毒25 / 肃清哥101 —— 给带元素来源的怪加中毒/凋零
  // shield：预防11 / 反甲30 / 加固28 —— 给坦克/战士加盾徽章
  // gift：礼物33 —— 给高攻怪加礼物
  if (aux === 'dof') {
    // 找三振王124 或 散弹104，把一枚徽章换成中毒25
    for (const s of team) {
      if (s.monsterId === 124 || s.monsterId === 104) {
        if (!s.badgeIds.includes(25)) s.badgeIds = [25, ...s.badgeIds].slice(0, 2);
        break;
      }
    }
  } else if (aux === 'shield') {
    // 找坦克110 或 铁甲117，加反甲30
    for (const s of team) {
      if (s.monsterId === 110 || s.monsterId === 117) {
        if (!s.badgeIds.includes(30)) s.badgeIds = [...s.badgeIds, 30].slice(-2);
        break;
      }
    }
  } else if (aux === 'gift') {
    // 找高攻怪（109银狙 或 107咒法），加礼物33
    for (const s of team) {
      if (s.monsterId === 109 || s.monsterId === 107) {
        if (!s.badgeIds.includes(33)) s.badgeIds = [...s.badgeIds, 33].slice(-2);
        break;
      }
    }
  }
}

function main(): void {
  const candidates: any[] = [];

  for (const arch of Object.keys(ARCH_TEMPLATE)) {
    for (const core of ARCH_CORES[arch]) {
      const targetCore = CORE_MONSTERS[core];
      // 模板选择：fullrush 按 core 选（救星→经典救星、塞雷→梯子塞雷），其他按 arch
      const templateName = CORE_TEMPLATE[core] || ARCH_TEMPLATE[arch];
      const template = FORMATION_LIBRARY.find(f => f.name === templateName)!;
      const templateTeam = template.team.filter(s => s.monsterId > 0);

      for (const aux of AUX_LIST) {
        const team = replaceCore(templateTeam, targetCore);
        applyAux(team, aux);
        candidates.push({
          template: `${archLabel(arch)}+${coreLabel(core)}${aux === 'none' ? '' : '+' + auxLabel(aux)}`,
          arch,
          core,
          aux,
          templateName,
          team: team.map(s => ({ monsterId: s.monsterId, badgeIds: [...s.badgeIds] })),
        });
      }
    }
  }

  writeFileSync(resolve('reports/deck_candidates_v2.json'), JSON.stringify({ candidates }, null, 2));
  console.log(`生成 ${candidates.length} 个卡组 → reports/deck_candidates_v2.json`);

  // 验证关键怪覆盖率
  const check = (arch: string) => {
    const cs = candidates.filter(c => c.arch === arch);
    let with106 = 0, with116 = 0, with117 = 0;
    for (const c of cs) {
      const ids = c.team.map((s: any) => s.monsterId);
      if (ids.includes(106)) with106++;
      if (ids.includes(116)) with116++;
      if (ids.includes(117)) with117++;
    }
    console.log(`  ${arch}: ${cs.length} 卡组，有冲锋106=${with106} 有钻头116=${with116} 有铁甲117=${with117}`);
  };
  check('prayer');
  check('halfrush');
  check('fullrush');
}

function archLabel(a: string): string {
  return { prayer: '祷徒', halfrush: '半冲', fullrush: '全冲' }[a] ?? a;
}
function coreLabel(c: string): string {
  return { savior: '救星', priest: '祭祀', suqing: '肃清', golden: '金猴', digger: '铲土', seri: '塞雷' }[c] ?? c;
}
function auxLabel(a: string): string {
  return { none: '', dof: 'dof', shield: '盾流', gift: '礼物' }[a] ?? a;
}

main();
