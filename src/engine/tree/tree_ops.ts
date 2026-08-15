// ============================================================
// P0 — 进化树算子（作用于 EvolFormation，非人工编辑的 Formation）
// 所有算子返回克隆后的新对象；非法变异返回 null（GA 层拒绝）。
//
// 算子：
//   swapMonsters     —— 怪兽顺序互换（两只怪交换全部放置角色）
//   moveEarlier      —— 顺序提前（某怪从 fromRound 提前到 toRound，同祖先链）
//   swapRoundOrder   —— 同节点内两 placement 顺序互换
//   shiftPosition    —— 位置改变（某怪全部放置平移 dx/dy）
//   mutateBadge      —— 改徽章（卡组固定阶段可禁用）
//   mutateCondition  —— 特征掩码变异（识别系统学习化的核心算子）
//   addBranch        —— 新增条件分支（骨架进化）
//   removeBranch     —— 删除非主分支（骨架瘦身）
// ============================================================

import { DB_MONSTERS, DB_BADGES } from '../../game/Database';
import { FORMATION_LIBRARY } from '../../ai/formation_library';
import type { EvolFormation, EvolNode, MainArchetype, SubArchetype, KeyMonster } from './evol_gene';
import {
  cloneEvolFormation, cloneEvolNode, walkEvolNodes, emptyMask, isEmptyMask,
} from './evol_gene';

export const P2_X_MIN = 6;
export const P2_X_MAX = 10;
export const BOARD_Y_MIN = 0;
export const BOARD_Y_MAX = 4;

const FOUR_COST_IDS: ReadonlySet<number> = new Set(
  DB_MONSTERS.filter(m => m.cost === 4).map(m => m.id),
);

export function costOf(monsterId: number): number {
  return DB_MONSTERS.find(m => m.id === monsterId)?.cost ?? 2;
}

export function badgeLimitForCost(cost: number): number {
  return cost >= 4 ? 3 : 2;
}

// ---------- 特征候选池（识别体系关键特征：7 阵型实际用到的怪/徽章） ----------

export function monsterFeaturePool(): number[] {
  const ids = new Set<number>();
  for (const f of FORMATION_LIBRARY) {
    for (const s of f.team) if (s.monsterId > 0) ids.add(s.monsterId);
    // 树里也出现过（含分支）
    const walk = (n: any) => { for (const p of n.placement ?? []) ids.add(p.monsterId); (n.children ?? []).forEach(walk); };
    walk(f.tree);
  }
  return [...ids].sort((a, b) => a - b);
}

export function badgeFeaturePool(): number[] {
  const ids = new Set<number>();
  for (const f of FORMATION_LIBRARY) {
    for (const s of f.team) for (const b of s.badgeIds) ids.add(b);
  }
  // 补充全部已实现徽章（识别对手可能带池外徽章）
  for (const b of DB_BADGES) if (![14, 15, 19, 31, 34].includes(b.id)) ids.add(b.id);
  return [...ids].sort((a, b) => a - b);
}

// ---------- 合法性校验 ----------

export function validateEvol(root: EvolNode, teamIds: Set<number>): string | null {
  for (const n of walkEvolNodes(root)) {
    for (const p of n.placements) {
      if (!teamIds.has(p.monsterId)) return `怪兽${p.monsterId} 不在卡组`;
      if (p.x < P2_X_MIN || p.x > P2_X_MAX) return `怪兽${p.monsterId} x=${p.x} 越界`;
      if (p.y < BOARD_Y_MIN || p.y > BOARD_Y_MAX) return `怪兽${p.monsterId} y=${p.y} 越界`;
      if (n.round >= 4 && FOUR_COST_IDS.has(p.monsterId)) return `四费怪${p.monsterId} 在 round=${n.round}`;
      const dup = n.placements.filter(q => q.monsterId === p.monsterId).length;
      if (dup > 1) return `节点 ${n.id} 重复放怪${p.monsterId}`;
    }
    // round 单调：child.round = parent.round + 1
    for (const c of n.children) {
      if (c.round !== n.round + 1) return `节点 ${c.id} round=${c.round} 应=${n.round + 1}`;
    }
  }
  return null;
}

function validateFormation(f: EvolFormation): string | null {
  return validateEvol(f.root, new Set(f.team.map(s => s.monsterId)));
}

// ---------- 树遍历工具 ----------

function findNode(root: EvolNode, id: string): EvolNode | null {
  for (const n of walkEvolNodes(root)) if (n.id === id) return n;
  return null;
}

function isAncestor(ancestor: EvolNode, descendant: EvolNode): boolean {
  return walkEvolNodes(ancestor).some(n => n === descendant);
}

function collectMonsterNodes(root: EvolNode, monsterId: number): { node: EvolNode; idx: number }[] {
  const out: { node: EvolNode; idx: number }[] = [];
  for (const n of walkEvolNodes(root)) {
    n.placements.forEach((p, idx) => { if (p.monsterId === monsterId) out.push({ node: n, idx }); });
  }
  return out;
}

// ---------- 变异算子 ----------

/** 怪兽顺序互换：交换两只怪在树中的全部放置角色（卡组徽章不动，仅改 placement.monsterId） */
export function swapMonsters(f: EvolFormation, m1: number, m2: number): EvolFormation | null {
  if (m1 === m2) return null;
  const teamIds = new Set(f.team.map(s => s.monsterId));
  if (!teamIds.has(m1) || !teamIds.has(m2)) return null;
  const out = cloneEvolFormation(f);
  for (const n of walkEvolNodes(out.root)) {
    for (const p of n.placements) {
      if (p.monsterId === m1) p.monsterId = m2;
      else if (p.monsterId === m2) p.monsterId = m1;
    }
  }
  return validateFormation(out) ? null : out;
}

/** 顺序提前：某怪从 fromRound 移到 toRound（沿祖先链定位，toRound<fromRound）。
 *  分支树里同一回合有多个节点，不能按回合号 find，必须从"含该怪的节点"沿祖先链向上找。 */
export function moveEarlier(f: EvolFormation, monsterId: number, fromRound: number, toRound: number): EvolFormation | null {
  if (fromRound <= toRound || toRound < 1) return null;
  if (toRound >= 4 && FOUR_COST_IDS.has(monsterId)) return null;

  // 找到所有含该怪且 round===fromRound 的节点
  const fromNodes = walkEvolNodes(f.root).filter(n => n.round === fromRound && n.placements.some(p => p.monsterId === monsterId));
  if (fromNodes.length === 0) return null;

  // 对每个 fromNode，沿祖先链向上找 round===toRound 的祖先
  for (const fromNode of fromNodes) {
    const toNode = findAncestorByRound(f.root, fromNode, toRound);
    if (!toNode) continue;

    const out = cloneEvolFormation(f);
    const src = walkEvolNodes(out.root).find(n => n.id === fromNode.id)!;
    const dst = walkEvolNodes(out.root).find(n => n.id === toNode.id)!;
    const idx = src.placements.findIndex(p => p.monsterId === monsterId);
    const [moved] = src.placements.splice(idx, 1);
    dst.placements.push(moved);
    if (validateFormation(out) === null) return out;
  }
  return null;
}

/** 从 root 出发，找 descendant 在祖先链上 round===targetRound 的祖先节点 */
function findAncestorByRound(root: EvolNode, descendant: EvolNode, targetRound: number): EvolNode | null {
  // 沿父指针回溯需要 parent 指针；这里用递归：若 ancestor 的子树包含 descendant 且 ancestor.round===targetRound
  let result: EvolNode | null = null;
  const dfs = (n: EvolNode): boolean => {
    if (n === descendant) return true;
    for (const c of n.children) {
      if (dfs(c)) {
        if (result === null && n.round === targetRound) result = n;
        return true;
      }
    }
    return false;
  };
  dfs(root);
  return result;
}

/** 同节点内两 placement 顺序互换（影响放置优先级） */
export function swapRoundOrder(f: EvolFormation, nodeId: string, i: number, j: number): EvolFormation | null {
  const node = findNode(f.root, nodeId);
  if (!node) return null;
  if (i < 0 || j < 0 || i >= node.placements.length || j >= node.placements.length || i === j) return null;
  const out = cloneEvolFormation(f);
  const target = findNode(out.root, nodeId)!;
  const tmp = target.placements[i];
  target.placements[i] = target.placements[j];
  target.placements[j] = tmp;
  return validateFormation(out) ? null : out;
}

/** 位置改变：某怪全部放置平移 (dx,dy)，clamp 后仍越界则拒绝 */
export function shiftPosition(f: EvolFormation, monsterId: number, dx: number, dy: number): EvolFormation | null {
  if (dx === 0 && dy === 0) return null;
  const out = cloneEvolFormation(f);
  let touched = false;
  for (const n of walkEvolNodes(out.root)) {
    for (const p of n.placements) {
      if (p.monsterId !== monsterId) continue;
      p.x = Math.max(P2_X_MIN, Math.min(P2_X_MAX, p.x + dx));
      p.y = Math.max(BOARD_Y_MIN, Math.min(BOARD_Y_MAX, p.y + dy));
      touched = true;
    }
  }
  if (!touched) return null;
  return validateFormation(out) ? null : out;
}

/** 改徽章：某怪一枚徽章换成池内另一枚（保持槽数），同步到 team */
export function mutateBadge(f: EvolFormation, monsterId: number, badgePool: number[], rng: () => number): EvolFormation | null {
  const slot = f.team.find(s => s.monsterId === monsterId);
  if (!slot) return null;
  const maxBadges = badgeLimitForCost(costOf(monsterId));
  const out = cloneEvolFormation(f);
  const s = out.team.find(x => x.monsterId === monsterId)!;
  if (s.badgeIds.length >= maxBadges) {
    const idx = Math.floor(rng() * s.badgeIds.length);
    const candidates = badgePool.filter(b => !s.badgeIds.includes(b));
    if (!candidates.length) return null;
    s.badgeIds[idx] = candidates[Math.floor(rng() * candidates.length)];
  } else {
    const candidates = badgePool.filter(b => !s.badgeIds.includes(b));
    if (!candidates.length) return null;
    s.badgeIds.push(candidates[Math.floor(rng() * candidates.length)]);
  }
  return out;
}

// ---------- 三层识别标签变异（识别学习化核心） ----------

const ALL_MAINS: MainArchetype[] = ['prayer', 'halfrush', 'fullrush'];
const ALL_SUBS: SubArchetype[] = ['dof', 'shield', 'gift'];
const ALL_KEYS: KeyMonster[] = ['drill', 'rush', 'iron', 'ninja', 'tutu', 'spell', 'mine'];

/**
 * 变异某节点的三层识别标签：随机加/删一个标签项。
 * 空标签 = 主分支；非空 = 条件分支（应对某对手特征或先后手）。
 * 注意：主标签互斥，变异时只保留一个；side 可加可删。
 */
export function mutateCondition(
  f: EvolFormation,
  nodeId: string,
  _monsterPool: number[],
  _badgePool: number[],
  rng: () => number,
): EvolFormation | null {
  const node = findNode(f.root, nodeId);
  if (!node) return null;
  const out = cloneEvolFormation(f);
  const target = findNode(out.root, nodeId)!;
  const m = target.condition;
  const roll = rng();

  if (roll < 0.35) {
    // 删除：随机删一个已有标签项（side/main/subs/keys）
    const removable: ('side' | 'main' | 'sub' | 'key')[] = [];
    if (m.side !== null) removable.push('side');
    if (m.main) removable.push('main');
    if (m.subs.length) removable.push('sub');
    if (m.keys.length) removable.push('key');
    if (removable.length === 0) return null;
    const kind = removable[Math.floor(rng() * removable.length)];
    if (kind === 'side') m.side = null;
    else if (kind === 'main') m.main = null;
    else if (kind === 'sub') m.subs.splice(Math.floor(rng() * m.subs.length), 1);
    else m.keys.splice(Math.floor(rng() * m.keys.length), 1);
  } else {
    // 增加：随机加一个标签项
    const kindRoll = rng();
    if (kindRoll < 0.25) {
      m.side = rng() < 0.5 ? 1 : 2;
    } else if (kindRoll < 0.60) {
      m.main = ALL_MAINS[Math.floor(rng() * ALL_MAINS.length)];
    } else if (kindRoll < 0.80) {
      const cand = ALL_SUBS.filter(s => !m.subs.includes(s));
      if (!cand.length) return null;
      m.subs.push(cand[Math.floor(rng() * cand.length)]);
    } else {
      const cand = ALL_KEYS.filter(k => !m.keys.includes(k));
      if (!cand.length) return null;
      m.keys.push(cand[Math.floor(rng() * cand.length)]);
    }
  }
  return validateFormation(out) ? null : out;
}

// ---------- 分支骨架进化 ----------

/**
 * 新增条件分支：选一个非叶子节点，复制其一个 child 子树作为新分支，
 * 给新分支一个随机非空标签（区别于已有兄弟分支）。
 * 返回 null 表示无法新增（无合法模板或已满）。
 */
export function addBranch(
  f: EvolFormation,
  _monsterPool: number[],
  _badgePool: number[],
  rng: () => number,
): EvolFormation | null {
  // 候选：有 children 的节点（可新增兄弟分支给其 children）
  const parents = walkEvolNodes(f.root).filter(n => n.children.length > 0 && n.round < 5);
  if (parents.length === 0) return null;
  // 限制分支数上限（防爆炸）
  const candidates = parents.filter(n => n.children.length < 3);
  if (candidates.length === 0) return null;
  const parent = candidates[Math.floor(rng() * candidates.length)];

  const out = cloneEvolFormation(f);
  const p = walkEvolNodes(out.root).find(n => n.id === parent.id)!;
  const template = p.children[Math.floor(rng() * p.children.length)];
  const newBranch = cloneEvolNode(template);
  // 给新分支一个随机非空标签，并重命名 id 避免与 conditionMap 冲突
  newBranch.id = `${template.id}_b${Math.floor(rng() * 1e6)}`;
  newBranch.condition = { side: null, main: ALL_MAINS[Math.floor(rng() * ALL_MAINS.length)], subs: [], keys: [] };
  p.children.push(newBranch);
  return validateFormation(out) ? null : out;
}

/**
 * 删除一个非主分支（condition 非空的分支）。保留主分支（空 condition）。
 */
export function removeBranch(f: EvolFormation, rng: () => number): EvolFormation | null {
  const out = cloneEvolFormation(f);
  const parents = walkEvolNodes(out.root).filter(n => n.children.length > 1);
  if (parents.length === 0) return null;
  // 选一个含非主分支的父节点
  const withCond = parents.filter(n => n.children.some(c => !isEmptyMask(c.condition)));
  if (withCond.length === 0) return null;
  const p = withCond[Math.floor(rng() * withCond.length)];
  const idx = p.children.findIndex(c => !isEmptyMask(c.condition));
  if (idx < 0) return null;
  p.children.splice(idx, 1);
  return validateFormation(out) ? null : out;
}
