// ============================================================
// 候选动作特征编码 —— 训练器输入面
// 每个样本 = (候选动作上下文, 特征向量)；训练目标 = 该候选的搜索模拟评分
// 全确定性：特征只依赖快照/候选，无随机
// ============================================================

import { DB_MONSTERS } from '../../game/Database';
import type { BoardSnapshot } from '../placement/snapshot';
import type { Placement } from '../types';
import type { FormationTree, FormationTreePlacement } from '../../ai/types';

export interface CandidateCtx {
  /** 候选动作 */
  cand: Placement;
  /** 该候选的搜索模拟评分（单回合评估，存盘备用） */
  score: number;
  /** 回合与预算 */
  round: number;
  budget: number;
  /** 己方视角（判定对局胜负标签用） */
  side: 'p1' | 'p2';
  /** 己方场上存活数 / 敌方存活数 */
  myCount: number;
  enemyCount: number;
  /** 同排己方数 / 四邻友军数 */
  rowDensity: number;
  adjFriendly: number;
  /** 阵型分支树本回合计划（人工先验：开局坦克/按回合展开），决策时已知 */
  treePlan?: { monsterId: number; x: number; y: number }[];
  /** 该候选是否被搜索/树最终选中提交（标签加权：仅被选中的候选带对局胜负信号） */
  chosen?: boolean;
}

export const FEATURE_NAMES = [
  'cost',            // 费用
  'hp',              // 生命
  'atk',             // 攻击
  'ats',             // 攻速
  'range',           // 射程
  'speed',           // 移速
  'isMelee',         // 近战
  'isRanged',        // 远程
  'isRushLike',      // 冲锋106/钻头116 突进线
  'frontDist',       // 前向距离（到中线）
  'backDist',        // 后向距离（到己方底线）
  'rowDensity',      // 同排己方数
  'adjFriendly',     // 四邻友军数
  'wantsAdjacency',  // 邻接/光环需求（结阵12/13/29/16 徽章或光环核心怪）
  'badgeCount',      // 徽章数
  'round',           // 当前回合
  'budgetRatio',     // 剩余预算 / 回合预算上限
  'myCount',         // 己方场上存活数
  'enemyCount',      // 敌方场上存活数
  'inTreeThisRound', // 该怪是否在阵型树本回合计划内（坦克开局等人工先验）
  'treePosDist',     // 候选位置到树计划位置的曼哈顿距离（不在计划=4 惩罚）
  'treeRoundHasPlan',// 阵型树本回合是否有计划（0/1）
] as const;

export type FeatureVec = number[];

const ADJ_BADGES = new Set([12, 13, 29, 16]);
const AURA_IDS = new Set([110, 105, 120, 103]);
const RUSH_IDS = new Set([106, 116]);

/** 特征向量长度（训练/推理必须一致） */
export const FEATURE_DIM = FEATURE_NAMES.length;

export function encodeCandidate(ctx: CandidateCtx): FeatureVec {
  const snapSideP1 = true; // 特征全部相对"己方"归一化，两侧通用（前向=朝中线）
  void snapSideP1;

  const monster = DB_MONSTERS.find(m => m.id === ctx.cand.monsterId);
  if (!monster) throw new Error(`encodeCandidate: unknown monster ${ctx.cand.monsterId}`);

  const x = ctx.cand.x;
  const y = ctx.cand.y;
  // 前向距离：己方视角，无论 p1/p2 都取"到中线"的距离（0..4）
  // p1: x 越大越靠前；p2: x 越小越靠前（6..10 → 10-x）
  const frontDist = x <= 4 ? x : 10 - x;
  const backDist = x <= 4 ? 4 - x : x - 6;

  const isMelee = monster.type === 'melee';
  const isRanged = monster.type === 'ranged';
  const isRushLike = RUSH_IDS.has(monster.id);
  const wantsAdj = ctx.cand.badgeIds.some(b => ADJ_BADGES.has(b)) || AURA_IDS.has(monster.id);

  // 阵型树意图：该怪是否在树本回合计划内、候选位置与计划位置的偏差
  const plan = ctx.treePlan ?? [];
  const inTree = plan.find(p => p.monsterId === ctx.cand.monsterId);
  const inTreeThisRound = inTree ? 1 : 0;
  const treePosDist = inTree ? Math.abs(x - inTree.x) + Math.abs(y - inTree.y) : 4;
  const treeRoundHasPlan = plan.length > 0 ? 1 : 0;

  // 回合预算上限：4/8/12/14/16（与 GameEngine.getBudgetLimitForRound 一致）
  const BUDGET_LIMIT = [0, 4, 8, 12, 14, 16];
  const budgetLimit = BUDGET_LIMIT[Math.min(ctx.round, 5)] ?? 16;
  const budgetRatio = ctx.budget / Math.max(1, budgetLimit);

  return [
    monster.cost,
    monster.hp,
    monster.atk,
    monster.ats,
    monster.range,
    monster.speed,
    isMelee ? 1 : 0,
    isRanged ? 1 : 0,
    isRushLike ? 1 : 0,
    frontDist,
    backDist,
    ctx.rowDensity,
    ctx.adjFriendly,
    wantsAdj ? 1 : 0,
    ctx.cand.badgeIds.length,
    ctx.round,
    budgetRatio,
    ctx.myCount,
    ctx.enemyCount,
    inTreeThisRound,
    treePosDist,
    treeRoundHasPlan,
  ];
}

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

/** 快照辅助：统计同排/邻接/存活数（供收集器构造 ctx） */
export function snapCounts(snap: BoardSnapshot, x: number, y: number): { rowDensity: number; adjFriendly: number } {
  const my = snap.myMonsters;
  const rowDensity = my.filter(m => m.gridY === y).length;
  let adjFriendly = 0;
  const dx = [0, 0, -1, 1];
  const dy = [-1, 1, 0, 0];
  for (let i = 0; i < 4; i++) {
    const nx = x + dx[i];
    const ny = y + dy[i];
    if (nx < 0 || nx >= 11 || ny < 0 || ny >= 5) continue;
    if (my.some(m => m.gridX === nx && m.gridY === ny)) adjFriendly++;
  }
  return { rowDensity, adjFriendly };
}
