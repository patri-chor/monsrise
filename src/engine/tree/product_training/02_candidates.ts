// ============================================================
// T036 Phase-1 — 02_candidates.ts
// 候选类型定义与确定性候选元数据。
// 不包含长时间搜索；不导入 arena / hill_climb / sequential_tree_optimization。
// ============================================================

import { sha256Hex } from '../sha256_pure';
import type { EvolNode } from '../evol_gene';
import { walkEvolNodes } from '../evol_gene';
import type { EvolFormation } from '../evol_gene';

// ---- 运算符族 ----

/**
 * 产品路径候选运算符族（T036 D）。
 *
 * - spatial_local: 单个普通可控放置坐标变更
 * - formation_transform: 整体阵型变换（平移/镜像），必须声明 transformKind/affectedNodes
 * - strategy_schedule_branch: 跨回合时序/徽章/R1-R2+分支条件
 * - multi_monster_exploration: 多怪联合探索元数据（实际生成在 T038）
 */
export type OperatorFamily =
  | 'spatial_local'
  | 'formation_transform'
  | 'strategy_schedule_branch'
  | 'multi_monster_exploration';

// ---- 空间局部运算符 ----

export interface SpatialLocalDelta {
  operatorFamily: 'spatial_local';
  /** 目标节点 id */
  nodeId: string;
  /** 目标怪兽 id */
  monsterId: number;
  /** 原坐标（p2 视角） */
  fromX: number;
  fromY: number;
  /** 新坐标（p2 视角，6-10 范围） */
  toX: number;
  toY: number;
}

// ---- 阵型变换运算符 ----

export type FormationTransformKind = 'translate' | 'mirror_x' | 'flip_vertical';

export interface FormationTransformDelta {
  operatorFamily: 'formation_transform';
  transformKind: FormationTransformKind;
  /** 受影响的节点 id 列表 */
  affectedNodeIds: string[];
  /** 从旧坐标到新坐标的映射（p2 视角） */
  coordinateMapping: Array<{ nodeId: string; monsterId: number; fromX: number; fromY: number; toX: number; toY: number }>;
  /** 是否存在 calculator-controlled 例外（不被此变换覆盖） */
  calculatorControlledExceptions: number[];
  /** 若变换后行为等价（canonical fingerprint 相同）则为 true，拒绝为 no-op */
  isNoOp: boolean;
}

// ---- 策略调度分支运算符 ----

export interface StrategyScheduleBranchDelta {
  operatorFamily: 'strategy_schedule_branch';
  /** 涉及的回合列表 */
  rounds: number[];
  /** 是否含 R1 分支条件（R1 仅可使用 enemyRevealedHand/handBadges） */
  hasR1Branch: boolean;
  /** 是否含 R2+ 分支条件（可额外使用 enemyBoardIds） */
  hasR2PlusBranch: boolean;
  /** 描述性摘要 */
  description: string;
}

// ---- 多怪探索运算符 ----

export interface MultiMonsterExplorationMeta {
  operatorFamily: 'multi_monster_exploration';
  /** 随机种子（确定性） */
  seed: number;
  /** 父候选指纹 */
  parentFingerprint: string;
  /** 回滚父指纹 */
  rollbackParentFingerprint: string;
  /** 联合变更数（2-4） */
  changeCount: number;
  /** 具体原子变更清单 */
  atomicChanges: Array<{
    type: string;
    nodeId?: string;
    monsterId?: number;
    description: string;
  }>;
  /** 上报单运算符失败次数（触发 escalation 的阈值记录） */
  escalationReason: string;
  failedSingleOperatorCount: number;
}

export type CandidateDelta =
  | SpatialLocalDelta
  | FormationTransformDelta
  | StrategyScheduleBranchDelta
  | MultiMonsterExplorationMeta;

// ---- 候选元数据 ----

export interface CandidateMetadata {
  /** 全局唯一候选 id */
  candidateId: string;
  /** 来源 sourceId */
  sourceId: string;
  /** 来源名称 */
  sourceName: string;
  /** 来源指纹（来自 eleven_frozen_sources.json） */
  sourceFingerprint: string;
  /** 父候选 id（基线则为 null） */
  parentCandidateId: string | null;
  /** 运算符族 */
  operatorFamily: OperatorFamily | 'baseline';
  /** 变更描述 */
  delta: CandidateDelta | null;
  /** 候选规范指纹（由 03_validate 计算） */
  canonicalFingerprint: string | null;
  /** 是否被拒绝（no-op / 重复 / 不合法） */
  rejected: boolean;
  /** 拒绝原因 */
  rejectionReason: string | null;
  /** 创建时间 */
  createdAt: string;
}

/** 构造基线候选元数据（无 delta） */
export function makeBaselineMeta(opts: {
  sourceId: string;
  sourceName: string;
  sourceFingerprint: string;
  canonicalFingerprint: string;
}): CandidateMetadata {
  return {
    candidateId: `baseline:${opts.sourceId}`,
    sourceId: opts.sourceId,
    sourceName: opts.sourceName,
    sourceFingerprint: opts.sourceFingerprint,
    parentCandidateId: null,
    operatorFamily: 'baseline',
    delta: null,
    canonicalFingerprint: opts.canonicalFingerprint,
    rejected: false,
    rejectionReason: null,
    createdAt: new Date().toISOString(),
  };
}

/** 构造候选 id（sourceId + 运算符族 + 序号） */
export function makeCandidateId(sourceId: string, family: OperatorFamily, seq: number): string {
  return `cand:${sourceId}:${family}:${seq}`;
}

/** 判断坐标是否在合法 p2 视角范围（x=6-10，y=0-4） */
export function isLegalP2Coord(x: number, y: number): boolean {
  return x >= 6 && x <= 10 && y >= 0 && y <= 4;
}

/** 提取阵型中可控放置坐标（排除 calculatorControlled 怪兽） */
export function getControllablePlacements(
  evol: EvolFormation,
  calculatorControlledIds: Set<number>,
): Array<{ nodeId: string; monsterId: number; x: number; y: number }> {
  const result: Array<{ nodeId: string; monsterId: number; x: number; y: number }> = [];
  for (const node of walkEvolNodes(evol.root)) {
    for (const p of node.placements) {
      if (!calculatorControlledIds.has(p.monsterId)) {
        result.push({ nodeId: node.id, monsterId: p.monsterId, x: p.x, y: p.y });
      }
    }
  }
  return result;
}

/** 计算候选规范指纹（用于去重和无操作检测） */
export function computeCandidateFingerprint(evol: EvolFormation): string {
  // 提取对行为有意义的拓扑：team + 每节点的 condition + placements（坐标有序）
  function nodeSignature(n: EvolNode): any {
    return {
      id: n.id,
      round: n.round,
      condition: {
        side: n.condition.side,
        main: n.condition.main,
        subs: [...n.condition.subs].sort(),
        keys: [...n.condition.keys].sort(),
      },
      placements: n.placements
        .map(p => ({ monsterId: p.monsterId, x: p.x, y: p.y }))
        .sort((a, b) => a.monsterId - b.monsterId || a.x - b.x || a.y - b.y),
      children: n.children.map(nodeSignature),
    };
  }
  const sig = {
    team: evol.team
      .map(s => ({ monsterId: s.monsterId, badgeIds: [...s.badgeIds].sort() }))
      .sort((a, b) => a.monsterId - b.monsterId),
    root: nodeSignature(evol.root),
  };
  return sha256Hex(JSON.stringify(sig)).slice(0, 24);
}
