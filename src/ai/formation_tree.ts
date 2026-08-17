// ============================================================
// 阵型树查询辅助（决策树侧通用）
// 从 train/features.ts 迁出：planForRound 是"从 FormationTree 提取某回合计划"，
// 本质是树操作而非 RL 训练特征，被 play_full_game / BattleUI 等产品代码依赖。
// ============================================================

import type { FormationTree, FormationTreePlacement } from './types';

/**
 * 提取阵型分支树在指定回合的计划（主分支优先：DFS 先命中第一个含放置的子节点）
 * 决策时已知的先验：开局坦克、按回合展开、分支应变
 */
export function planForRound(tree: FormationTree | undefined, round: number): FormationTreePlacement[] {
  if (!tree) return [];
  if (tree.round === round && tree.placement.length > 0) return tree.placement;
  for (const c of tree.children) {
    const r = planForRound(c, round);
    if (r.length > 0) return r;
  }
  return [];
}
