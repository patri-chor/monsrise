// ============================================================
// 进化基因 —— 树级阵型表示（区别于人工编辑用的 Formation.tree）
//
// 设计原则（用户确认）：
//   - 基因 = 固定卡组 + 放置树 + 特殊放置器（固定保留）
//   - 分支触发条件 = 可进化的特征掩码 FeatureMask（识别系统学习化），
//     不再用 formation_engine.selectBranch 里硬编码的 label 关键词
//   - 特殊怪兽索敌（矿爆锁祈祷行/铁甲贴队友/咒法安全位…）是已验证算法，
//     执行时复用 bundle 内部 special/aim calculator，不纳入基因
//
// EvolFormation = { team, root: EvolNode }
//   EvolNode = { id, round, condition: FeatureMask, placements, children }
//
// FeatureMask 匹配语义：
//   - 每个字段列表非空才参与判断；字段间 AND，列表内 OR
//   - handHas: 手牌含列表任一怪
//   - handBadgeHas: 手牌含列表任一徽章
//   - handNotHas: 手牌不含列表所有怪
//   - boardHas: 场上已部署含列表任一怪
//   - boardNotHas: 场上不含列表所有怪
//   - 空 mask（全空）= 无条件匹配 = 主分支兜底
// ============================================================

import type { Formation, FormationTeamSlot } from '../../ai/types';

// ---------- 特征掩码 ----------

export interface FeatureMask {
  /** 对手手牌含这些怪之一 */
  handHas: number[];
  /** 对手手牌含这些徽章之一 */
  handBadgeHas: number[];
  /** 对手手牌不含这些怪（全部满足"不含"） */
  handNotHas: number[];
  /** 对手场上已部署含这些怪之一 */
  boardHas: number[];
  /** 对手场上不含这些怪（全部满足"无"） */
  boardNotHas: number[];
}

export function emptyMask(): FeatureMask {
  return { handHas: [], handBadgeHas: [], handNotHas: [], boardHas: [], boardNotHas: [] };
}

export function isEmptyMask(m: FeatureMask): boolean {
  return m.handHas.length === 0
    && m.handBadgeHas.length === 0
    && m.handNotHas.length === 0
    && m.boardHas.length === 0
    && m.boardNotHas.length === 0;
}

/**
 * 特征掩码匹配：所有非空字段都满足（AND），字段内 OR。
 * handIds / handBadges：对手手牌（开局可见前 4 张）ID 集合。
 * boardIds：对手场上已部署怪 ID 集合。
 */
export function matchMask(
  m: FeatureMask,
  handIds: Set<number>,
  handBadges: Set<number>,
  boardIds: Set<number>,
): boolean {
  if (m.handHas.length > 0 && !m.handHas.some(id => handIds.has(id))) return false;
  if (m.handBadgeHas.length > 0 && !m.handBadgeHas.some(id => handBadges.has(id))) return false;
  if (m.handNotHas.length > 0 && m.handNotHas.some(id => handIds.has(id))) return false;
  if (m.boardHas.length > 0 && !m.boardHas.some(id => boardIds.has(id))) return false;
  if (m.boardNotHas.length > 0 && m.boardNotHas.some(id => boardIds.has(id))) return false;
  return true;
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
  condition: FeatureMask;   // 作为分支时的触发条件（根恒空）
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
    condition: {
      handHas: [...n.condition.handHas],
      handBadgeHas: [...n.condition.handBadgeHas],
      handNotHas: [...n.condition.handNotHas],
      boardHas: [...n.condition.boardHas],
      boardNotHas: [...n.condition.boardNotHas],
    },
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

/** 节点 id → FeatureMask 映射（供 patch selectBranch 时按 bundle node.id 查条件） */
export function buildConditionMap(root: EvolNode): Map<string, FeatureMask> {
  const map = new Map<string, FeatureMask>();
  for (const n of walkEvolNodes(root)) {
    map.set(n.id, n.condition);
  }
  return map;
}

/** 特征掩码 → 可读标签（调试/日志用） */
export function maskToLabel(m: FeatureMask): string {
  if (isEmptyMask(m)) return '主分支';
  const parts: string[] = [];
  if (m.handHas.length) parts.push(`手牌有[${m.handHas.join(',')}]`);
  if (m.handBadgeHas.length) parts.push(`手牌徽章[${m.handBadgeHas.join(',')}]`);
  if (m.handNotHas.length) parts.push(`手牌无[${m.handNotHas.join(',')}]`);
  if (m.boardHas.length) parts.push(`场上有[${m.boardHas.join(',')}]`);
  if (m.boardNotHas.length) parts.push(`场上无[${m.boardNotHas.join(',')}]`);
  return parts.join('&');
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

// ---------- 从 FORMATION_LIBRARY 转初始基因（label → FeatureMask 翻译） ----------

/**
 * 把人工编辑的 label 翻译成初始特征掩码（仅覆盖已知关键词，作为进化起点）。
 * 进化会通过 mutateCondition 探索更精确的掩码。
 */
export function labelToMask(label: string): FeatureMask {
  const m = emptyMask();
  if (!label) return m;
  // 主分支（局N / 开局 等无条件词）
  const isCondition = /祷徒|祈祷|钻头|三振|dof|全冲|冲锋|盾|铁甲/.test(label);
  if (!isCondition) return m;

  // 祷徒系：手牌或场上有祈祷(105)
  if (/祷徒|祈祷/.test(label)) {
    m.handHas.push(105);
    m.boardHas.push(105);
  }
  // 钻头反制：场上有钻头(116)
  if (/钻头/.test(label)) {
    m.boardHas.push(116);
  }
  // 全冲/dof/三振：手牌有三振王(124)或全冲特征怪
  if (/三振|dof|全冲|冲锋/.test(label)) {
    m.handHas.push(124, 107, 113, 117, 116);
    m.boardHas.push(124);
  }
  // 盾/铁甲系
  if (/盾|铁甲/.test(label)) {
    m.boardHas.push(117, 118);
  }
  return m;
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

/** 打印进化阵型摘要（含分支条件），人工检查用 */
export function summarizeEvolFormation(e: EvolFormation): string {
  const lines: string[] = [`阵型 ${e.name} (archetype=${e.archetype}) 卡组[${e.team.map(s => s.monsterId).join(',')}]`];
  for (const n of walkEvolNodes(e.root)) {
    if (n.round === 0) continue;
    const ps = n.placements.map(p => `${p.monsterId}@(${p.x},${p.y})`).join(', ');
    const cond = isEmptyMask(n.condition) ? '' : ` [条件: ${maskToLabel(n.condition)}]`;
    lines.push(`  R${n.round} ${ps}${cond}`);
  }
  return lines.join('\n');
}
