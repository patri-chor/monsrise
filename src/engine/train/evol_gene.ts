// ============================================================
// 进化基因 —— 树级阵型表示（区别于人工编辑用的 Formation.tree）
//
// 设计原则（用户确认）：
//   - 基因 = 固定卡组 + 放置树 + 特殊放置器（固定保留）
//   - 分支触发条件 = 可进化的体系标签 FeatureMask（识别系统学习化）
//   - 特殊怪兽索敌（矿爆锁祈祷行/铁甲贴队友/咒法安全位…）是已验证算法，
//     执行时复用 bundle 内部 special/aim calculator，不纳入基因
//
// FeatureMask = 分支的「体系标签」集合（精确还原原生 selectBranch 语义）：
//   - 原生 selectBranch 是两阶段分类器：
//       第一阶段（手牌）：suqing(124/凋零2/中毒25) > prayer(105) > fullrush(无105+冲怪)
//          suqing 匹配「全冲/三振/dof」标签；prayer 匹配「祷徒/祈祷」；fullrush 匹配「全冲」
//       第二阶段（场上）：三振王(124) > 钻头(116) > 祷徒(105) > 全冲(无105+107/113/117) > 冲锋(106)
//   - 因此每个分支的标签归属：
//       prayer  → 祷徒/祈祷
//       fullrush→ 全冲（含手牌 suqing 也命中「全冲」标签）
//       suqing  → 三振/三振王/dof
//       drill   → 钻头
//       rush    → 冲锋
//   - 空 tags（[]）= 主分支兜底（label 不含条件关键词）
// ============================================================

import type { Formation, FormationTeamSlot } from '../../ai/types';

// ---------- 体系标签 ----------

export type ArchetypeTag = 'prayer' | 'fullrush' | 'suqing' | 'drill' | 'rush';

export interface FeatureMask {
  /** 该分支匹配的体系标签集合；空 = 主分支兜底 */
  tags: ArchetypeTag[];
}

export function emptyMask(): FeatureMask {
  return { tags: [] };
}

export function isEmptyMask(m: FeatureMask): boolean {
  return m.tags.length === 0;
}

// ---------- 进化树节点 ----------

export interface EvolPlacement {
  monsterId: number;
  x: number;  // p2 视角 6-10
  y: number;  // 0-4
}

export interface EvolNode {
  id: string;
  round: number;            // 0=根, 1-5=局数
  condition: FeatureMask;   // 作为分支时的触发标签（根恒空）
  placements: EvolPlacement[]; // 本节点落子（有序 = 放置优先级）
  children: EvolNode[];
}

export interface EvolFormation {
  name: string;
  archetype: string;
  team: FormationTeamSlot[];   // 固定卡组（含徽章）
  root: EvolNode;
}

// ---------- 转换 ----------

/** 深拷贝进化树节点 */
export function cloneEvolNode(n: EvolNode): EvolNode {
  return {
    id: n.id,
    round: n.round,
    condition: { tags: [...n.condition.tags] },
    placements: n.placements.map(p => ({ monsterId: p.monsterId, x: p.x, y: p.y })),
    children: n.children.map(c => cloneEvolNode(c)),
  };
}

export function cloneEvolFormation(f: EvolFormation): EvolFormation {
  return {
    name: f.name,
    archetype: f.archetype,
    team: f.team.map(s => ({ monsterId: s.monsterId, badgeIds: [...s.badgeIds] })),
    root: cloneEvolNode(f.root),
  };
}

/** 前序遍历所有节点（含根） */
export function walkEvolNodes(n: EvolNode, out: EvolNode[] = []): EvolNode[] {
  out.push(n);
  for (const c of n.children) walkEvolNodes(c, out);
  return out;
}

/** 节点 id → FeatureMask 映射（供 patch selectBranch 时按 bundle node.id 查标签） */
export function buildConditionMap(root: EvolNode): Map<string, FeatureMask> {
  const map = new Map<string, FeatureMask>();
  for (const n of walkEvolNodes(root)) {
    map.set(n.id, n.condition);
  }
  return map;
}

/** 特征掩码 → 可读标签（调试/日志用）。必须用中文关键词，因为 bundle 内部
 *  getRoundPlan 有 isPrayerBranch = label.includes('祷徒') 的判断（祷徒分支跳过变体），
 *  selectVariant 也有 label 相关分支；用英文 tag 名会破坏这些内部逻辑 → 行为漂移。 */
export function maskToLabel(m: FeatureMask): string {
  if (isEmptyMask(m)) return '主分支';
  const TAG_LABEL: Record<ArchetypeTag, string> = {
    prayer: '祷徒',
    fullrush: '全冲',
    suqing: '三振/dof',
    drill: '钻头',
    rush: '冲锋',
  };
  return m.tags.map(t => TAG_LABEL[t]).join('/');
}

/** 进化树节点 → bundle 可注入的 tree 节点（loadCustomFormation 格式） */
export function evolNodeToBundleTree(n: EvolNode, team: FormationTeamSlot[]): any {
  const badgeOf = (monsterId: number) => team.find(s => s.monsterId === monsterId)?.badgeIds ?? [];
  return {
    id: n.id,
    round: n.round,
    label: maskToLabel(n.condition),
    comment: '',
    placement: n.placements.map(p => ({
      monsterId: p.monsterId,
      badgeIds: badgeOf(p.monsterId),
      x: p.x,
      y: p.y,
    })),
    children: n.children.map(c => evolNodeToBundleTree(c, team)),
  };
}

/** EvolFormation → bundle loadCustomFormation 注入格式 */
export function evolToBundleFormation(e: EvolFormation): {
  name: string;
  archetype: string;
  team: FormationTeamSlot[];
  tree: any;
} {
  return {
    name: e.name,
    archetype: e.archetype,
    team: e.team.map(s => ({ monsterId: s.monsterId, badgeIds: [...s.badgeIds] })),
    tree: evolNodeToBundleTree(e.root, e.team),
  };
}

// ---------- 从 FORMATION_LIBRARY 转初始基因（label → 体系标签翻译） ----------

/**
 * 把人工编辑的 label 精确翻译成体系标签。
 * 原生 selectBranch 的体系判定（见文件头注释）：
 *   祷徒/祈祷 → prayer；全冲 → fullrush；三振/三振王/dof → suqing；
 *   钻头 → drill；冲锋 → rush。
 * 注意「全冲」≠「冲锋」：/冲锋/ 不匹配"全冲"，/全冲/ 不匹配"冲锋"。
 */
export function labelToMask(label: string): FeatureMask {
  const tags: ArchetypeTag[] = [];
  if (!label) return { tags };
  if (/祷徒|祈祷/.test(label)) tags.push('prayer');
  if (/全冲/.test(label)) tags.push('fullrush');
  if (/三振|dof/.test(label)) tags.push('suqing');
  if (/钻头/.test(label)) tags.push('drill');
  if (/冲锋/.test(label)) tags.push('rush');
  return { tags };
}

/** 从 FormationLibrary 的 Formation 提取进化基因（含 tree 转 EvolNode） */
function bundleNodeToEvol(n: any): EvolNode {
  return {
    id: n.id,
    round: n.round,
    condition: labelToMask(n.label ?? ''),
    placements: (n.placement ?? []).map((p: any) => ({ monsterId: p.monsterId, x: p.x, y: p.y })),
    children: (n.children ?? []).map((c: any) => bundleNodeToEvol(c)),
  };
}

export function formationToEvol(f: Formation): EvolFormation {
  return {
    name: f.name,
    archetype: f.archetype,
    team: f.team.filter(s => s.monsterId > 0).map(s => ({ monsterId: s.monsterId, badgeIds: [...s.badgeIds] })),
    root: bundleNodeToEvol(f.tree),
  };
}

// ---------- 诊断 ----------

/** 打印进化阵型摘要（含分支标签），人工检查用 */
export function summarizeEvolFormation(e: EvolFormation): string {
  const lines: string[] = [`阵型 ${e.name} (archetype=${e.archetype}) 卡组[${e.team.map(s => s.monsterId).join(',')}]`];
  for (const n of walkEvolNodes(e.root)) {
    if (n.round === 0) continue;
    const ps = n.placements.map(p => `${p.monsterId}@(${p.x},${p.y})`).join(', ');
    const cond = isEmptyMask(n.condition) ? '' : ` [标签: ${maskToLabel(n.condition)}]`;
    lines.push(`  R${n.round} ${ps}${cond}`);
  }
  return lines.join('\n');
}
