// ============================================================
// 同流派不同阵型生成器 v2（模块库/标签驱动）
//
// 组装模型（用户定案）：
//   架构骨架（怪兽固定）× 核心（4费或全二）× 战术（必带）× 输出位（标签筛选）× 生存位（补槽）
//   → 校验（战术必带 + 预算≤18 + 槽≤8）→ mapRefTreeToDeck 映射树 → arena 分离测试 → 排序
//
// 运行：npx vite-node --script src/engine/tree/generate_variants.ts [每靶局数] [--arch halfrush] [--core all|savior|...] [--k 5] [--only 突突]
// ============================================================

import '../env';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { registerAllBadges } from '../../game/BadgeSystem';
import { FORMATION_LIBRARY } from '../../ai/formation_library';
import { formationToEvol } from './evol_gene';
import { mapRefTreeToDeck } from './deck_separation';
import { evaluateBatchParallel, type ParallelArenaResult } from './arena_parallel';
import {
  CORE_TABLE, BADGE_TEMPLATES, badgeLimit, costOf, templateNameFor,
  type CoreKey, type ArchKey,
} from './deck_ontology';
import { hasEffect, hasTactic, TACTIC_IDS } from './monster_taxonomy';
import { COMBO_MODULES } from './flow_library';

registerAllBadges();

// ---------- 组装配置 ----------

/** 架构骨架（怪兽固定；半冲=祈祷+帝国，祷徒=学徒+祈祷，全冲=帝国） */
export const ARCH_SKELETON: Record<string, number[]> = {
  prayer: [103, 105],
  halfrush: [105, 110],
  fullrush: [110],
};
export const ARCH_NAME: Record<string, string> = { prayer: '祷徒', halfrush: '半冲', fullrush: '全冲' };

export const CORE_SHORT: Record<string, string> = {
  savior: '救星', priest: '祭祀', suqing: '肃清', seri: '塞雷', golden: '金猴', digger: '铲土', all2: '全二',
};
export const MONSTER_NAME: Record<number, string> = {
  101: '肃清', 102: '祭祀', 103: '学徒', 104: '散弹', 105: '祈祷', 106: '冲锋', 107: '咒法',
  108: '救星', 109: '银狙', 110: '帝国', 111: '见习', 112: '大剑', 113: '矿爆', 114: '突突',
  115: '铲土', 116: '钻头', 117: '铁甲', 118: '塞雷', 119: '忍猴', 120: '金猴', 121: '僧猴',
  122: '丛林', 123: '棒球', 124: '三振', 125: '战壕',
};

export function badgesFor(id: number, hasElement: boolean): number[] {
  const tpls = BADGE_TEMPLATES[id];
  if (!tpls || tpls.length === 0) return [];
  if (hasElement) {
    // DOF 卡组（有元素手）：凋零变体优先（含徽章 2）
    const wither = tpls.find(t => t.includes(2));
    if (wither) return [...wither].slice(0, badgeLimit(id));
  }
  // 非 DOF：通用变体（避开凋零 2，因无元素手凋零无意义）
  const generic = tpls.find(t => !t.includes(2));
  return [...(generic ?? tpls[0])].slice(0, badgeLimit(id));
}

/** 元素手：自带元素的怪（肃清流血/三振寒冷/散弹燃烧） */
export const ELEMENT_IDS = [101, 104, 124];
export function hasElementHand(ids: number[]): boolean {
  return ids.some(id => ELEMENT_IDS.includes(id));
}

/** 输出位候选：2 费怪中带「输出/爆发」标签，排除战术怪、架构必带（组合怪由组合模块提供） */
export function outputCandidates(arch: string): number[] {
  const all2 = [104, 106, 107, 109, 110, 111, 112, 113, 114, 116, 117, 119, 121, 122, 123, 124, 125];
  const skeleton = ARCH_SKELETON[arch] ?? [];
  return all2.filter(id =>
    (hasEffect(id, '输出') || hasEffect(id, '爆发')) &&
    !TACTIC_IDS.includes(id) &&
    !skeleton.includes(id),
  );
}

/** 生存位候选：带「生存」标签的 2 费怪，排除战术/架构/核心 */
export function survivalCandidates(arch: string): number[] {
  const all2 = [104, 106, 107, 109, 110, 111, 112, 113, 114, 116, 117, 119, 121, 122, 123, 124, 125];
  const skeleton = ARCH_SKELETON[arch] ?? [];
  return all2.filter(id =>
    hasEffect(id, '生存') &&
    !TACTIC_IDS.includes(id) &&
    !skeleton.includes(id),
  );
}

// ---------- 组装 ----------

export interface Deck {
  label: string;
  team: { monsterId: number; badgeIds: number[] }[];
  cost: number;
  valid: boolean;
  reason?: string;
}

export function assemble(arch: string, core: CoreKey, outputPair: number[], comboIds: number[] = []): Deck {
  const ids: number[] = [];

  // 1) 架构骨架（用户 MD：祷徒=学徒+祈祷、半冲=祈祷+帝国、全冲=帝国）
  for (const id of ARCH_SKELETON[arch] ?? []) ids.push(id);
  // 2) 核心（4 费或全二）
  const coreId = CORE_TABLE[core].monsterId;
  if (coreId !== null) ids.push(coreId);
  // 3) 组合件（组合模块的怪：盾炮=铁甲、秒杀=咒法+突突/钻头、偷后排=钻头/忍猴、范围克制=矿爆+三振）
  for (const id of comboIds) if (!ids.includes(id)) ids.push(id);
  // 4) 战术必带（若组合件没提供战术怪，补默认巫毒冲锋106）
  if (!ids.some(id => TACTIC_IDS.includes(id))) ids.push(106);
  // 5) 输出位
  for (const id of outputPair) if (!ids.includes(id)) ids.push(id);
  // 6) 生存位补槽（预算 ≤18、槽 ≤8）
  for (const id of survivalCandidates(arch)) {
    if (ids.length >= 8) break;
    const total = ids.reduce((s, x) => s + costOf(x), 0);
    if (total + costOf(id) > 18) continue;
    if (ids.includes(id)) continue;
    ids.push(id);
  }

  const totalCost = ids.reduce((s, x) => s + costOf(x), 0);
  const hasTac = ids.some(id => TACTIC_IDS.includes(id));
  const valid = totalCost <= 18 && ids.length <= 8 && hasTac && ids.length >= 6;
  let reason = '';
  if (totalCost > 18) reason = `Cost ${totalCost} > 18`;
  else if (ids.length > 8) reason = `Size ${ids.length} > 8`;
  else if (!hasTac) reason = 'Missing tactic monster';
  else if (ids.length < 6) reason = `Size ${ids.length} < 6`;

  // 7) 徽章（感知元素手：有元素手→凋零变体，否则→通用变体避开凋零）
  const hasEl = hasElementHand(ids);
  const team = ids.map(id => ({ monsterId: id, badgeIds: badgesFor(id, hasEl) }));

  // label：组合件里去重、去掉骨架/输出位已有的怪，只标新增组合怪
  const comboOnly = comboIds.filter(id => !ARCH_SKELETON[arch]?.includes(id) && !outputPair.includes(id));
  const comboLabel = comboOnly.length ? '+' + comboOnly.map(id => MONSTER_NAME[id]).join('') : '';
  const label = `${ARCH_NAME[arch] ?? arch}+${CORE_SHORT[core] ?? core}+${outputPair.map(id => MONSTER_NAME[id]).join('')}${comboLabel}`;
  return { label, team, cost: totalCost, valid, reason };
}

// ---------- 主流程 ----------

async function main(): Promise<void> {
  const games = Number(process.argv[2] || 2);
  const arch = process.argv.includes('--arch') ? process.argv[process.argv.indexOf('--arch') + 1] : 'halfrush';
  const coreArg = process.argv.includes('--core') ? process.argv[process.argv.indexOf('--core') + 1] : 'all';
  const kArg = process.argv.indexOf('--k');
  const k = kArg >= 0 ? Number(process.argv[kArg + 1]) : 5;
  const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : undefined;
  const wArg = process.argv.indexOf('--workers');
  const workers = wArg >= 0 ? Number(process.argv[wArg + 1]) : undefined;

  const cores: CoreKey[] = coreArg === 'all'
    ? Object.keys(CORE_TABLE) as CoreKey[]
    : [coreArg as CoreKey];

  // 组装候选：架构骨架 × 核心 × 组合模块（可选 0~1 个）× 输出位组合
  const comboOptions: number[][] = [[]];  // 无组合 + 各组合模块（取第一个完整 combo）
  for (const c of COMBO_MODULES) {
    comboOptions.push([...(c.combos[0] ?? c.required)]);
  }
  const decks: Deck[] = [];
  let pairTotal = 0;
  for (const core of cores) {
    const outPool = outputCandidates(arch);
    for (let i = 0; i < outPool.length; i++) {
      for (let j = i + 1; j < outPool.length; j++) {
        const pair = [outPool[i], outPool[j]];
        for (const combo of comboOptions) {
          decks.push(assemble(arch, core, pair, combo));
        }
        pairTotal++;
      }
    }
  }
  const list = only ? decks.filter(d => d.label.includes(only)) : decks;

  // 校验：战术必带 + 预算/槽位
  const valid = list.filter(d => {
    if (!hasTactic(d.team.map(s => s.monsterId))) return false;
    if (d.team.length > 8) return false;
    const total = d.team.reduce((s, x) => s + costOf(x.monsterId), 0);
    return total <= 18;
  });

  console.log(`=== ${ARCH_NAME[arch]} 变体组装：核心 ${cores.length} × 输出位组合 ~${pairTotal}，有效 ${valid.length} 个，每靶 ${games} 局${workers ? `，${workers} worker` : ''} ===\n`);

  // --list：只打印组装结果（去重），跳过评估，快速验证组装逻辑/候选规模
  if (process.argv.includes('--list')) {
    const seen = new Set<string>();
    for (const d of valid) {
      const key = d.team.map(s => s.monsterId).sort((a, b) => a - b).join(',');
      if (seen.has(key)) continue;
      seen.add(key);
      console.log(`  ${d.label.padEnd(24)} ${d.team.map(s => `${s.monsterId}[${s.badgeIds.join(',')}]`).join(' ')}`);
    }
    console.log(`\n去重后 ${seen.size} 套候选卡组`);
    return;
  }

  // 参考树（按架构选）
  const refName = templateNameFor(arch as ArchKey, 'savior');
  const refEvol = formationToEvol(FORMATION_LIBRARY.find(f => f.name === refName)!);

  // 映射树 + 并行评估
  const candidates = valid.map(d => ({ name: d.label, f: mapRefTreeToDeck(refEvol, d.team) }));
  const pResults = await evaluateBatchParallel(candidates, games, workers);

  interface VariantResult { label: string; team: { monsterId: number; badgeIds: number[] }[]; arena: ParallelArenaResult }
  const results: VariantResult[] = valid.map((d, i) => ({
    label: d.label, team: d.team, arena: pResults[i],
  }));

  results.sort((a, b) => b.arena.adScore - a.arena.adScore);
  for (const r of results) {
    console.log(`  ${r.label.padEnd(18)} 分离分 ${(r.arena.adScore * 100).toFixed(1)}% 最弱格 ${(r.arena.weakest * 100).toFixed(1)}%`);
  }

  console.log(`\n=== top-${Math.min(k, results.length)}（按分离分） ===`);
  for (let i = 0; i < Math.min(k, results.length); i++) {
    const r = results[i];
    const a = r.arena;
    const pct = (s: { w: number; d: number; l: number }) => ((s.w + s.d) / Math.max(1, s.w + s.d + s.l) * 100).toFixed(0) + '%';
    console.log(`\n${i + 1}. ${r.label} 卡组: ${r.team.map(s => `${s.monsterId}[${s.badgeIds.join(',')}]`).join(' ')}`);
    console.log(`  攻击 ${pct(a.attack)} 生存 ${pct(a.survival)} 综合 ${pct(a.comprehensive)} 泛化 ${pct(a.vsAll)} | 分离分 ${(a.adScore * 100).toFixed(0)}% 最弱格 ${(a.weakest * 100).toFixed(0)}%`);
  }

  writeFileSync(resolve('reports/halfrush_variants.json'), JSON.stringify(
    results.map(r => ({ label: r.label, team: r.team, adScore: r.arena.adScore, weakest: r.arena.weakest })), null, 2));
  console.log(`\n结果 → reports/halfrush_variants.json`);
}

if (process.argv[1] && process.argv[1].endsWith('generate_variants.ts')) {
  main().catch(e => { console.error(e); process.exit(1); });
}
