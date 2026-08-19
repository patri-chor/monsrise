// ============================================================
// T036 Phase-1 — branch_semantics.ts
// 侧感知分支选择和 R1 可观察性辅助器。
//
// - P1/P2 坐标语义：P2 直接用树坐标，P1 镜像 x → 10-x（与 product_tree_strategy 一致）
// - R1 可见：enemyRevealedHand IDs + revealed badges only
// - R2+：R1 可见 + enemy board IDs (当前回合可见)
// - side-only 分支和 side+opponent-feature 分支均合法
// - 要求不可见未来状态的条件非法
// ============================================================

import {
  type EvolNode,
  type EvolFormation,
  type FeatureMask,
  walkEvolNodes,
  matchMask,
  isEmptyMask,
  maskSpecificity,
  recognizeArchetype,
} from '../evol_gene';
import type { ArchetypeInput } from '../evol_gene';

/** R1 可观察状态（仅手牌/亮牌徽章） */
export interface R1Observable {
  enemyHandIds: Set<number>;
  enemyHandBadges: Set<number>;
}

/** R2+ 可观察状态（R1 可观察 + 当前场上 ID） */
export interface R2PlusObservable extends R1Observable {
  enemyBoardIds: Set<number>;
}

/** 条件分支可观察性类型 */
export type ObservabilityLevel = 'r1' | 'r2plus' | 'illegal_future_state';

/**
 * 判断分支条件的可观察性级别。
 * - side-only：r1（始终合法）
 * - main/subs/keys：依赖手牌识别，属于 r1
 * - 若条件标注 requiresBoardIds=true（未来扩展）：r2plus
 * - 若条件引用明确不可见的未来状态：illegal_future_state
 */
export function conditionObservabilityLevel(mask: FeatureMask, round: number): ObservabilityLevel {
  // 当前 FeatureMask 结构：side / main / subs / keys 均基于手牌可见，属于 r1 可观察
  // 未来扩展：(mask as any).requiresBoardIds 标志
  if ((mask as any).requiresBoardIds === true) {
    return round <= 1 ? 'illegal_future_state' : 'r2plus';
  }
  return 'r1';
}

/**
 * 检查给定 EvolNode 的条件是否在 round=1 时合法（R1 不允许 boardIds-only）。
 */
export function isR1Observable(mask: FeatureMask): boolean {
  return conditionObservabilityLevel(mask, 1) === 'r1';
}

/**
 * 将 R1Observable 转为 ArchetypeInput（boardIds 为空，因为 R1 看不到场上）。
 */
export function r1InputToArchetypeInput(obs: R1Observable): ArchetypeInput {
  return {
    handIds: obs.enemyHandIds,
    handBadges: obs.enemyHandBadges,
    boardIds: new Set<number>(),
  };
}

/**
 * 将 R2PlusObservable 转为 ArchetypeInput（包含 boardIds）。
 */
export function r2PlusInputToArchetypeInput(obs: R2PlusObservable): ArchetypeInput {
  return {
    handIds: obs.enemyHandIds,
    handBadges: obs.enemyHandBadges,
    boardIds: obs.enemyBoardIds,
  };
}

/**
 * 在给定回合和侧边选择对应的树分支节点。
 *
 * 分支选择语义（与 product_tree_strategy.selectBranchNodeAtRound 一致）：
 * - 每回合沿根向下
 * - 按条件特异性降序排列候选子节点
 * - 命中 mask 的优先；empty mask 为主分支兜底
 */
export function selectBranchForSideAndRound(
  root: EvolNode,
  round: number,
  archetypeInput: ArchetypeInput,
  mySide: 1 | 2,
): EvolNode | null {
  const rec = recognizeArchetype(archetypeInput);
  let current: EvolNode[] = [root];

  for (let r = 1; r <= round; r++) {
    const candidates: EvolNode[] = [];
    for (const n of current) {
      for (const c of n.children) {
        if (c.round === r) candidates.push(c);
      }
    }
    if (candidates.length === 0) break;

    const ranked = [...candidates].sort(
      (a, b) => maskSpecificity(b.condition) - maskSpecificity(a.condition),
    );

    let chosen: EvolNode | null = null;
    for (const c of ranked) {
      if (isEmptyMask(c.condition)) {
        if (!chosen) chosen = c;
        continue;
      }
      if (matchMask(c.condition, rec, mySide)) {
        chosen = c;
        break;
      }
    }
    if (!chosen) chosen = ranked[0];
    current = [chosen];
  }

  return current.length > 0 ? current[0] : null;
}

/** P2 视角 → 产品坐标（P1 侧镜像 x；P2 侧直接使用） */
export function treeXToProductX(treeX: number, mySide: 1 | 2): number {
  return mySide === 1 ? 10 - treeX : treeX;
}

/** 产品坐标 → P2 视角树坐标（P1 侧逆镜像） */
export function productXToTreeX(productX: number, mySide: 1 | 2): number {
  return mySide === 1 ? 10 - productX : productX;
}

/**
 * 获取阵型在 R1 时的分支选择结果（P1/P2 双侧）。
 * 返回 { side1: EvolNode|null, side2: EvolNode|null }。
 * 用于测试 R1 分支行为（含坐标镜像）。
 */
export function getR1BranchSelection(
  evol: EvolFormation,
  r1Obs: R1Observable,
): { side1: EvolNode | null; side2: EvolNode | null } {
  const inp = r1InputToArchetypeInput(r1Obs);
  return {
    side1: selectBranchForSideAndRound(evol.root, 1, inp, 1),
    side2: selectBranchForSideAndRound(evol.root, 1, inp, 2),
  };
}

/**
 * 返回 EvolFormation 中所有 R1 分支节点（round=1 子节点）的 id/label/condition。
 */
export function listR1Branches(evol: EvolFormation): Array<{
  nodeId: string;
  condition: FeatureMask;
  isFallback: boolean;
}> {
  const result: Array<{ nodeId: string; condition: FeatureMask; isFallback: boolean }> = [];
  for (const child of evol.root.children) {
    if (child.round === 1) {
      result.push({
        nodeId: child.id,
        condition: child.condition,
        isFallback: isEmptyMask(child.condition),
      });
    }
  }
  return result;
}

/**
 * 验证 side-only 条件（只有 side 非空，其余均空）。
 */
export function isSideOnlyCondition(mask: FeatureMask): boolean {
  return mask.side !== null && mask.main === null && mask.subs.length === 0 && mask.keys.length === 0;
}

/**
 * 验证 side+visible-opponent-feature 条件
 * （side 非空，且至少有一个 main/subs/keys 条件）。
 */
export function isSidePlusOpponentFeatureCondition(mask: FeatureMask): boolean {
  return mask.side !== null && (mask.main !== null || mask.subs.length > 0 || mask.keys.length > 0);
}

/**
 * 验证非法未来状态条件（任何 requiresBoardIds=true 且 round=1 的情况）。
 */
export function hasFutureStateCondition(evol: EvolFormation): boolean {
  for (const node of walkEvolNodes(evol.root)) {
    if (node.round === 1 && conditionObservabilityLevel(node.condition, 1) === 'illegal_future_state') {
      return true;
    }
  }
  return false;
}
