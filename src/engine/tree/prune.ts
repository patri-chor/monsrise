// ============================================================
// 后剪枝（post-pruning，可复用）—— 删掉对全局不败率无贡献的冗余分支
//
// 判据：逐个测试「删掉某条件分支」后全局不败率（先手+后手 vs 全部对手）
//   不降 → 剪掉该分支（冗余）。只剪 condition 非空的分支（主分支兜底不剪）。
// 贪心迭代：每剪掉一个就重测基线，直到无冗余。
//
// 被 apply_optimized 在覆盖后自动调用（定期剪枝）。
// ============================================================

import { FORMATION_LIBRARY } from '../../ai/formation_library';
import type { EvolFormation, EvolNode } from './evol_gene';
import { maskToLabel, isEmptyMask, walkEvolNodes, cloneEvolFormation } from './evol_gene';
import { playSpecVsSpec, type SideSpec } from './arena';

/** 全局整局不败率：先手+后手 vs 全部对手（双 side，用户定案） */
function evalGlobal(BundleAI: any, f: EvolFormation, games: number): { win: number; draw: number; loss: number; undefeated: number } {
  const specA: SideSpec = { kind: 'evol', f };
  let win = 0, draw = 0, loss = 0;
  let seed = 90000;
  for (const opp of FORMATION_LIBRARY) {
    const specB: SideSpec = { kind: 'native', f: opp };
    for (const side of [1, 2] as const) {
      for (let i = 0; i < games; i++) {
        const r = playSpecVsSpec(BundleAI, specA, specB, side, seed++);
        win += r.w; draw += r.d; loss += r.l;
      }
    }
  }
  const total = win + draw + loss;
  return { win, draw, loss, undefeated: total ? (win + draw) / total : 0 };
}

/** 移除指定 id 的分支节点（从父节点 children 删掉）；主分支（condition 空）不剪 */
function removeBranchById(f: EvolFormation, id: string): EvolFormation | null {
  const out = cloneEvolFormation(f);
  const nodes = walkEvolNodes(out.root);
  const target = nodes.find(n => n.id === id);
  if (!target || isEmptyMask(target.condition)) return null;
  for (const n of nodes) {
    const idx = n.children.findIndex(c => c.id === id);
    if (idx >= 0) {
      n.children.splice(idx, 1);
      return out;
    }
  }
  return null;
}

/** 收集所有条件分支节点（condition 非空） */
function conditionBranches(f: EvolFormation): EvolNode[] {
  return walkEvolNodes(f.root).filter(n => !isEmptyMask(n.condition));
}

export interface PruneResult {
  pruned: EvolFormation;
  prunedCount: number;   // 剪掉的分支数
  before: { win: number; draw: number; loss: number; undefeated: number };
  after: { win: number; draw: number; loss: number; undefeated: number };
  log: string[];         // 中文剪枝日志
}

/**
 * 后剪枝：对给定进化阵型删冗余分支（先手+后手全局不败率判据）。
 * games 建议小（2~3），剪枝只需判断「不降」而非精确胜率，省算力。
 */
export function pruneFormation(BundleAI: any, evolved: EvolFormation, games: number): PruneResult {
  const log: string[] = [];
  const base = evalGlobal(BundleAI, evolved, games);
  log.push(`当前整局不败率: ${base.win}胜/${base.draw}平/${base.loss}负 (${(base.undefeated * 100).toFixed(1)}%)`);

  const branches = conditionBranches(evolved);
  log.push(`条件分支共 ${branches.length} 个：${branches.map(b => `[${b.id}]R${b.round}「${maskToLabel(b.condition)}」`).join(' ') || '无'}`);

  let pruned = evolved;
  let pass = 0;
  let changed = true;

  while (changed) {
    changed = false;
    const cands = conditionBranches(pruned);
    for (const b of cands) {
      const without = removeBranchById(pruned, b.id);
      if (!without) continue;
      const e = evalGlobal(BundleAI, without, games);
      const delta = e.undefeated - base.undefeated;
      const label = maskToLabel(b.condition);
      if (e.undefeated >= base.undefeated - 0.001) {
        pruned = without;
        changed = true;
        pass++;
        log.push(`✂ 剪掉 [${b.id}] R${b.round}「${label}」: ${(base.undefeated * 100).toFixed(1)}% → ${(e.undefeated * 100).toFixed(1)}% (Δ${(delta * 100).toFixed(1)}%) ✅ 冗余`);
        break;
      } else {
        log.push(`✕ 保留 [${b.id}] R${b.round}「${label}」: ${(base.undefeated * 100).toFixed(1)}% → ${(e.undefeated * 100).toFixed(1)}% (Δ${(delta * 100).toFixed(1)}%) 有效`);
      }
    }
  }

  const after = evalGlobal(BundleAI, pruned, games);
  log.push(`剪枝结果：${pass > 0 ? `剪掉 ${pass} 个冗余分支` : '无冗余分支，全部保留'}，最终 ${(after.undefeated * 100).toFixed(1)}%`);
  return { pruned, prunedCount: pass, before: base, after, log };
}
