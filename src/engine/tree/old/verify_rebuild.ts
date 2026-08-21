// ============================================================
// 重建检查：验证组装器（generate_variants）的候选池能否覆盖 FORMATION_LIBRARY 的真实卡组。
// 组装模型（v3，用户定案）：架构骨架 ∪ 核心 ∪ 组合模块 ∪ 战术必带 ∪ 输出位 ∪ 生存位。
// 组合模块（flow_library.COMBO_MODULES）提供关键怪：盾炮=铁甲、秒杀=咒法+突突/钻头、
// 偷后排=钻头/忍猴、范围克制=矿爆+三振。
//
// 运行：npx vite-node --script src/engine/tree/verify_rebuild.ts
// ============================================================

import { FORMATION_LIBRARY } from '../../ai/formation_library';
import { CORE_TABLE, detectArch, detectCore, type ArchKey } from './deck_ontology';
import { hasEffect, TACTIC_IDS } from './monster_taxonomy';
import { COMBO_MODULES } from './flow_library';

const ARCH_SKELETON: Record<string, number[]> = {
  prayer: [103, 105],
  halfrush: [105, 110],
  fullrush: [110],
};

const NAME: Record<number, string> = {
  101: '肃清', 102: '祭祀', 103: '学徒', 104: '散弹', 105: '祈祷', 106: '冲锋', 107: '咒法',
  108: '救星', 109: '银狙', 110: '帝国', 111: '见习', 112: '大剑', 113: '矿爆', 114: '突突',
  115: '铲土', 116: '钻头', 117: '铁甲', 118: '塞雷', 119: '忍猴', 120: '金猴', 121: '僧猴',
  122: '丛林', 123: '棒球', 124: '三振', 125: '战壕',
};

const ALL2 = [104, 106, 107, 109, 110, 111, 112, 113, 114, 116, 117, 119, 121, 122, 123, 124, 125];

function outputPool(arch: ArchKey): number[] {
  const skeleton = ARCH_SKELETON[arch] ?? [];
  return ALL2.filter(id =>
    (hasEffect(id, '输出') || hasEffect(id, '爆发')) &&
    !TACTIC_IDS.includes(id) && !skeleton.includes(id),
  );
}

function survivalPool(arch: ArchKey): number[] {
  const skeleton = ARCH_SKELETON[arch] ?? [];
  return ALL2.filter(id =>
    hasEffect(id, '生存') && !TACTIC_IDS.includes(id) && !skeleton.includes(id),
  );
}

function main(): void {
  // 组合模块提供的怪（关键怪由组合生成）
  const comboIds = COMBO_MODULES.flatMap(c => [...c.required, ...c.combos.flat()]);

  let okCount = 0;
  for (const f of FORMATION_LIBRARY) {
    const ids = new Set(f.team.filter(s => s.monsterId > 0).map(s => s.monsterId));
    const arch = detectArch(ids);
    const core = detectCore(ids);
    if (core === 'multi') {
      console.log(`✗ ${f.name}: 多核心（双四费流，MVP 不支持）`);
      continue;
    }
    const pool = new Set<number>([
      ...(ARCH_SKELETON[arch] ?? []),
      ...(CORE_TABLE[core].monsterId !== null ? [CORE_TABLE[core].monsterId] : []),
      ...TACTIC_IDS,          // 战术必带（冲锋/钻头/铁甲/忍猴）
      ...outputPool(arch),    // 输出位
      ...survivalPool(arch),  // 生存位
      ...comboIds,            // 组合件（盾炮/秒杀/偷后排/范围克制）
    ]);
    const missing = [...ids].filter(id => !pool.has(id));
    if (missing.length === 0) {
      okCount++;
      console.log(`✓ ${f.name} (${arch}+${CORE_TABLE[core].name}) 可重建`);
    } else {
      console.log(`✗ ${f.name} (${arch}+${CORE_TABLE[core].name}) 缺: ${missing.map(id => `${id}${NAME[id]}`).join(', ')}`);
    }
  }
  console.log(`\n可重建 ${okCount}/${FORMATION_LIBRARY.length} 套真实卡组`);
}

main();
