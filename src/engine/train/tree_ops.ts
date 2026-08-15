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
import type { EvolFormation, EvolNode, FeatureMask } from './evol_gene';
import { cloneEvolFormation, cloneEvolNode, walkEvolNodes, emptyMask, isEmptyMask } from './evol_gene';

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

/** 顺序提前：某怪从 fromRound 移到 toRound（同祖先链，toRound<fromRound） */
export function moveEarlier(f: EvolFormation, monsterId: number, fromRound: number, toRound: number): EvolFormation | null {
  if (fromRound <= toRound || toRound < 1) return null;
  const fromNode = walkEvolNodes(f.root).find(n => n.round === fromRound && n.placements.some(p => p.monsterId === monsterId));
  const toNode = walkEvolNodes(f.root).find(n => n.round === toRound);
  if (!fromNode || !toNode) return null;
  if (!isAncestor(toNode, fromNode)) return null;
  if (toRound >= 4 && FOUR_COST_IDS.has(monsterId)) return null;

  const out = cloneEvolFormation(f);
  const src = walkEvolNodes(out.root).find(n => n.round === fromRound && n.placements.some(p => p.monsterId === monsterId))!;
  const dst = walkEvolNodes(out.root).find(n => n.round === toRound)!;
  const idx = src.placements.findIndex(p => p.monsterId === monsterId);
  const [moved] = src.placements.splice(idx, 1);
  dst.placements.push(moved);
  return validateFormation(out) ? null : out;
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

// ---------- 特征掩码变异（识别学习化核心） ----------

/**
 * 变异某节点的特征掩码：随机加/删/改一个特征项。
 * 保证变异后仍为空（主分支）或非空（条件分支），不破坏"每层至少一个主分支"由调用方维护。
 */
export function mutateCondition(
  f: EvolFormation,
  nodeId: string,
  monsterPool: number[],
  badgePool: number[],
  rng: () => number,
): EvolFormation | null {
  const node = findNode(f.root, nodeId);
  if (!node) return null;
  const out = cloneEvolFormation(f);
  const target = findNode(out.root, nodeId)!;
  const m = target.condition;
  const FIELDS: (keyof FeatureMask)[] = ['handHas', 'handBadgeHas', 'handNotHas', 'boardHas', 'boardNotHas'];
  const nonEmptyFields = FIELDS.filter(k => m[k].length > 0);
  const isBadgeField = (k: keyof FeatureMask) => k === 'handBadgeHas';

  const roll = rng();
  if (roll < 0.35 && nonEmptyFields.length > 0) {
    // 删除：从非空字段里随机删一个元素
    const field = nonEmptyFields[Math.floor(rng() * nonEmptyFields.length)];
    const list = m[field];
    list.splice(Math.floor(rng() * list.length), 1);
  } else {
    // 增加：随机选一个字段，加入一个随机特征
    const field = FIELDS[Math.floor(rng() * FIELDS.length)];
    const pool = isBadgeField(field) ? badgePool : monsterPool;
    if (!pool.length) return null;
    const candidates = pool.filter(v => !m[field].includes(v));
    if (!candidates.length) return null;
    m[field].push(candidates[Math.floor(rng() * candidates.length)]);
  }
  // 去重 + 排序（保持确定性）
  for (const k of FIELDS) m[k] = [...new Set(m[k])].sort((a, b) => a - b);
  return validateFormation(out) ? null : out;
}

// ---------- 分支骨架进化 ----------

/**
 * 新增条件分支：选一个非叶子节点，复制其一个 child 子树作为新分支，
 * 给新分支一个随机非空条件（区别于已有兄弟分支的条件）。
 * 返回 null 表示无法新增（无合法模板或已满）。
 */
export function addBranch(
  f: EvolFormation,
  monsterPool: number[],
  badgePool: number[],
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
  // 给新分支一个非空条件（随机特征），并重命名 id 避免与 conditionMap 冲突
  newBranch.id = `${template.id}_b${Math.floor(rng() * 1e6)}`;
  newBranch.condition = emptyMask();
  const field = rng() < 0.5 ? 'handHas' : 'boardHas';
  const pool = field === 'handHas' ? monsterPool : monsterPool;
  const v = pool[Math.floor(rng() * pool.length)];
  newBranch.condition[field].push(v);
  p.children.push(newBranch);
  return validateFormation(out) ? null : out;
}

/**
 * 删除一个非主分支（condition 非空的叶子侧分支）。保留主分支（空 condition）。
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
