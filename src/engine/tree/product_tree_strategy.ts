// ============================================================
// 树策略适配器（T032 B）—— 把进化阵型树转成产品入口可执行的声明式策略
//
// 约束：
//   1) 只产出声明式意图（DeploymentIntent），绝不调 placeMonster / 算扣费 / 改游戏状态；
//   2) 禁止 import/调用 arena.ts / playSpecVsSpec / bundle custom-formation / 直接放置 API；
//   3) 直接走产品坐标约定（树坐标是 p2/AI 视角 6-10；source side=1 在本适配器内镜像 x'=10-x，
//      产品入口不再做任何隐藏镜像/偏移）；
//   4) 缺失期望分支时返回 []（由产品入口如实记录；绝无合成 PASS）。
//
// 分支选择语义与 arena 的 patchBranchSelection 一致：每回合沿根向下，按对手识别结果
// 逐层选择命中分支（mask 特异性降序，空 mask 为主分支兜底）。
// ============================================================

import type {
  DeploymentIntent,
  DeploymentStrategy,
  DeploymentStrategyContext,
} from '../play_full_game';
import type { EvolFormation, EvolNode } from './evol_gene';
import {
  walkEvolNodes,
  matchMask,
  recognizeArchetype,
  isEmptyMask,
  maskSpecificity,
  maskToLabel,
} from './evol_gene';

/** T032 D.1：策略适配器版本（进入 manifest） */
export const STRATEGY_ADAPTER_VERSION = 'tree-strategy-v1';

/** 沿根向下选择某回合的分支节点（每回合按识别结果重新选，支持局中切换分支） */
export function selectBranchNodeAtRound(
  root: EvolNode,
  round: number,
  rec: ReturnType<typeof recognizeArchetype>,
  mySide: 1 | 2,
): EvolNode | null {
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

import {
  evaluateSpecialPlacementWithPolicy,
  evaluateAimPlacementWithPolicy,
  type ReadonlyPlacementContext,
  type BoardUnitPosition,
} from './calculator_policy';

const SPECIAL_MONSTER_IDS = new Set([106, 107, 114, 116, 117]);
const AIM_MONSTER_IDS = new Set([113, 118]);

/**
 * 由进化阵型构造产品入口策略。
 * 返回策略对每个回合上下文产出声明式意图（含分支溯源）；已上场怪跳过，预算/占位由产品入口校验。
 */
export function treeStrategyFor(f: EvolFormation): DeploymentStrategy {
  return (ctx: DeploymentStrategyContext): DeploymentIntent[] => {
    const rec = recognizeArchetype({
      handIds: new Set(ctx.enemyRevealedHand.map(s => s.monsterId)),
      handBadges: new Set(ctx.enemyRevealedHand.flatMap(s => s.badgeIds ?? [])),
      boardIds: new Set(ctx.enemyMonsters.map(m => m.dbId)),
    });
    const node = selectBranchNodeAtRound(f.root, ctx.round, rec, ctx.side);
    if (!node) return [];
    const placedIds = new Set(ctx.ownMonsters.map(m => m.dbId));
    const intents: DeploymentIntent[] = [];

    // 构造纯只读上下文（坐标统一标准化为 p2 视角以便计算器计算）
    const isSide1 = ctx.side === 1;
    const ownP2: BoardUnitPosition[] = ctx.ownMonsters.map(m => ({
      monsterId: m.dbId,
      dbId: m.dbId,
      x: isSide1 ? 10 - m.gridX : m.gridX,
      y: m.gridY,
      badgeIds: m.badges.map(b => b.id),
    }));
    const enemyP2: BoardUnitPosition[] = ctx.enemyMonsters.map(m => ({
      monsterId: m.dbId,
      dbId: m.dbId,
      x: isSide1 ? 10 - m.gridX : m.gridX,
      y: m.gridY,
      badgeIds: m.badges.map(b => b.id),
    }));

    const readonlyCtx: ReadonlyPlacementContext = {
      round: ctx.round,
      side: ctx.side,
      ownMonsters: ownP2,
      enemyMonsters: enemyP2,
      enemyRevealedHand: ctx.enemyRevealedHand.map(s => ({
        monsterId: s.monsterId,
        badgeIds: s.badgeIds ?? [],
      })),
    };

    for (const p of node.placements) {
      if (placedIds.has(p.monsterId)) continue;
      const mySlot = f.team.find(s => s.monsterId === p.monsterId);
      const myBadgeIds = mySlot?.badgeIds ?? [];

      let rawX = p.x;
      let rawY = p.y;

      if (SPECIAL_MONSTER_IDS.has(p.monsterId)) {
        const specialPos = evaluateSpecialPlacementWithPolicy(
          p.monsterId,
          readonlyCtx,
          p.x,
          p.y,
          myBadgeIds,
          f.calculatorPolicy,
        );
        rawX = specialPos.x;
        rawY = specialPos.y;
      } else if (AIM_MONSTER_IDS.has(p.monsterId)) {
        const aimPos = evaluateAimPlacementWithPolicy(
          p.monsterId,
          readonlyCtx,
          p.x,
          p.y,
          f.calculatorPolicy,
        );
        rawX = aimPos.x;
        rawY = aimPos.y;
      }

      // 产品坐标约定：树/计算器坐标为 p2/AI 视角(6-10)；source side=1 在此镜像（产品入口不做隐藏偏移）
      const x = isSide1 ? 10 - rawX : rawX;
      intents.push({
        monsterId: p.monsterId,
        plannedX: x,
        plannedY: rawY,
        branch: {
          branchId: node.id,
          branchLabel: isEmptyMask(node.condition) ? '主分支' : maskToLabel(node.condition),
        },
      });
    }
    return intents;
  };
}

/** 树节点/分支总数（manifest 溯源用） */
export function countEvolNodes(f: EvolFormation): number {
  return walkEvolNodes(f.root).length;
}
