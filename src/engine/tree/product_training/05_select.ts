// ============================================================
// T039 — 05_select.ts
// 纠正可控性语义、面板分类、自适应候选生成与排名
//
// 规范要求：
//   - 纠正可控性语义：controllableCount / teamSize (排除计算器控制单位)
//   - 面板分类：PANEL_UNDERPERFORMER / PANEL_MID / PANEL_SATURATED
//   - 3-attempt optimization episode 审计
//   - 真正生成合法 strategy_schedule_branch 与 multi_monster_exploration
//   - 严格使用聚合实验边界标签（AGGREGATE_EXPLORATION_ONLY, isExperimentalFrontier）
// ============================================================

import type { EvolFormation, EvolNode, FeatureMask } from '../evol_gene';
import { cloneEvolFormation, walkEvolNodes } from '../evol_gene';
import type { ScreenObservation } from './04_screen';
import type { CandidateEntry } from './04_screen';
import type { Formation } from '../../../ai/types';
import {
  computeCandidateFingerprint,
  isLegalP2Coord,
  getControllablePlacements,
  type SpatialLocalDelta,
  type FormationTransformDelta,
  type StrategyScheduleBranchDelta,
  type MultiMonsterExplorationMeta,
} from './02_candidates';
import { validateCandidateLegality } from './03_validate';

// ---- 面板分类与阈值 ----

export const PANEL_SATURATED_THRESHOLD = 0.92;   // >= 饱和/高分
export const PANEL_MID_THRESHOLD       = 0.70;   // >= 中等
// < 0.70 = PANEL_UNDERPERFORMER (如 all2rush)

export const LOW_CONTROLLABILITY_THRESHOLD = 0.30; // ratio <= 0.30 -> 空间预算归零 (如 all2rush, laddersel)
export const SINGLE_OP_EPISODE_THRESHOLD   = 3;    // 完整优化 episode 至少 3 次单算子尝试

// ---- 分类类型 ----

export type SourceClassification = 'PANEL_UNDERPERFORMER' | 'PANEL_MID' | 'PANEL_SATURATED';

export interface SourcePolicy {
  sourceId: string;
  baselineScore: number;
  classification: SourceClassification;
  controllableCount: number;
  calculatedCount: number;
  controllableRatio: number;
  spatialBudget: number;    // 0-3，基于 controllableRatio × 3
  spatialBudgetReason: string;
  transformBudget: number;  // 1-2
  branchBudget: number;     // 1
  allowMultiMonster: boolean;
  singleOpAttempts: number;
  consecutiveFailCount: number;
  weakestSideScore: number | null;
  weakestSide: 1 | 2 | null;
}

/** 计算每个可执行源的自适应策略（修正可控性语义） */
export function computeSourcePolicies(
  execSources: Formation[],
  t037Obs: ScreenObservation[],
  persistentFailCounts: Map<string, number> = new Map(),
  persistentAttemptCounts: Map<string, number> = new Map(),
): SourcePolicy[] {
  const baselineMap = new Map<string, ScreenObservation>(
    t037Obs.filter(o => o.entityKind === 'baseline').map(o => [o.sourceId, o]),
  );

  return execSources.map(src => {
    const srcId = (src as any).id;
    const baseline = baselineMap.get(srcId);
    const baselineScore = baseline?.trainingScore ?? 0;
    const teamSize = Array.isArray((src as any).team) ? (src as any).team.length : 8;

    // 纠正可控性语义：
    // calculatedUnitRatio 是计算器控制单位比例（不可树调整）
    // controllableCount = teamSize - calculatedCount
    // controllableRatio = controllableCount / teamSize
    const calculatedCount = (src as any).calculatedCount ?? Math.round(teamSize * ((src as any).calculatedUnitRatio ?? 0));
    const controllableCount = (src as any).controllableCount ?? (teamSize - calculatedCount);
    const controllableRatio = (src as any).controllableRatio ?? (controllableCount / teamSize);

    const singleOpAttempts = persistentAttemptCounts.get(srcId) ?? 0;
    const consecutiveFailCount = persistentFailCounts.get(srcId) ?? 0;

    const classification: SourceClassification =
      baselineScore >= PANEL_SATURATED_THRESHOLD ? 'PANEL_SATURATED' :
      baselineScore >= PANEL_MID_THRESHOLD       ? 'PANEL_MID' : 'PANEL_UNDERPERFORMER';

    // 空间预算计算
    let spatialBudget: number;
    let spatialBudgetReason: string;
    if (controllableRatio <= LOW_CONTROLLABILITY_THRESHOLD) {
      spatialBudget = 0;
      spatialBudgetReason = `LOW_CONTROLLABILITY: controllableRatio=${controllableRatio.toFixed(3)} <= ${LOW_CONTROLLABILITY_THRESHOLD} (${controllableCount}/${teamSize} controllable)`;
    } else {
      spatialBudget = Math.max(1, Math.round(3 * controllableRatio));
      spatialBudgetReason = `HIGH_CONTROLLABILITY: controllableRatio=${controllableRatio.toFixed(3)} (${controllableCount}/${teamSize} controllable, budget=${spatialBudget})`;
    }

    const transformBudget = controllableRatio <= LOW_CONTROLLABILITY_THRESHOLD ? 2 : 1;

    // 只有在经历了完整的 optimization episode (至少 3 次单算子尝试) 之后，
    // 或作为 PANEL_UNDERPERFORMER 的扩展预算，才允许触发 multi_monster_exploration
    const allowMultiMonster = (classification === 'PANEL_UNDERPERFORMER' && singleOpAttempts >= 1) ||
                              (singleOpAttempts >= SINGLE_OP_EPISODE_THRESHOLD && consecutiveFailCount >= 2);

    return {
      sourceId: srcId,
      baselineScore,
      classification,
      controllableCount,
      calculatedCount,
      controllableRatio,
      spatialBudget,
      spatialBudgetReason,
      transformBudget,
      branchBudget: 1,
      allowMultiMonster,
      singleOpAttempts,
      consecutiveFailCount,
      weakestSideScore: null,
      weakestSide: null,
    };
  });
}

// ---- 自适应候选生成 ----

/** 为特定源生成自适应候选集合 */
export function generateAdaptiveCandidatesForSource(opts: {
  source: Formation;
  parentEvol: EvolFormation;
  policy: SourcePolicy;
  cycleOrdinal: number;
  seedBase: number;
  seenFingerprints: Set<string>;
}): CandidateEntry[] {
  const { source, parentEvol, policy, cycleOrdinal, seedBase, seenFingerprints } = opts;
  const srcId = (source as any).id;
  const srcName = (source as any).name ?? srcId;
  const parentFp = computeCandidateFingerprint(parentEvol);
  const candidates: CandidateEntry[] = [];

  const addCandidateIfValid = (entry: CandidateEntry) => {
    const fp = entry.meta.canonicalFingerprint;
    if (!fp || seenFingerprints.has(fp)) {
      entry.meta.rejected = true;
      entry.meta.rejectionReason = entry.meta.rejectionReason ?? 'DUPLICATE_OR_NO_OP: fingerprint already seen';
    } else {
      const validation = validateCandidateLegality(entry.evol);
      if (!validation.valid) {
        entry.meta.rejected = true;
        entry.meta.rejectionReason = `LEGALITY_FAIL: ${validation.reasons.join('; ')}`;
      } else {
        seenFingerprints.add(fp);
      }
    }
    candidates.push(entry);
  };

  // 1. spatial_local (严格根据 spatialBudget)
  if (policy.spatialBudget > 0) {
    const controllable = getControllablePlacements(parentEvol, new Set());
    if (controllable.length > 0) {
      const target = controllable[cycleOrdinal % controllable.length];
      const offsets = [{ dx: 0, dy: 1 }, { dx: 0, dy: -1 }, { dx: 1, dy: 0 }, { dx: -1, dy: 0 }];
      for (const off of offsets) {
        const nx = target.x + off.dx;
        const ny = target.y + off.dy;
        if (isLegalP2Coord(nx, ny) && (nx !== target.x || ny !== target.y)) {
          const clone = cloneEvolFormation(parentEvol);
          const node = walkEvolNodes(clone.root).find(n => n.id === target.nodeId);
          if (node) {
            const p = node.placements.find(x => x.monsterId === target.monsterId && x.x === target.x && x.y === target.y);
            if (p) {
              p.x = nx;
              p.y = ny;
              const fp = computeCandidateFingerprint(clone);
              const delta: SpatialLocalDelta = {
                operatorFamily: 'spatial_local',
                nodeId: target.nodeId,
                monsterId: target.monsterId,
                fromX: target.x,
                fromY: target.y,
                toX: nx,
                toY: ny,
              };
              addCandidateIfValid({
                meta: {
                  candidateId: `cand:${srcId}:spatial_local:c${cycleOrdinal}_${target.monsterId}`,
                  sourceId: srcId,
                  sourceName: srcName,
                  sourceFingerprint: (source as any).fingerprint ?? parentFp,
                  parentCandidateId: null,
                  operatorFamily: 'spatial_local',
                  delta,
                  canonicalFingerprint: fp,
                  rejected: false,
                  rejectionReason: null,
                  createdAt: new Date().toISOString(),
                },
                evol: clone,
              });
              break;
            }
          }
        }
      }
    }
  }

  // 2. formation_transform (变换算子)
  if (policy.transformBudget > 0) {
    const clone = cloneEvolFormation(parentEvol);
    let transformValid = true;
    const mapping: Array<{ nodeId: string; monsterId: number; fromX: number; fromY: number; toX: number; toY: number }> = [];
    const affectedNodeIds: string[] = [];

    for (const node of walkEvolNodes(clone.root)) {
      if (node.placements.length > 0) affectedNodeIds.push(node.id);
      for (const p of node.placements) {
        const ny = 4 - p.y;
        if (!isLegalP2Coord(p.x, ny)) {
          transformValid = false;
          break;
        }
        mapping.push({ nodeId: node.id, monsterId: p.monsterId, fromX: p.x, fromY: p.y, toX: p.x, toY: ny });
        p.y = ny;
      }
      if (!transformValid) break;
    }

    if (transformValid && mapping.length > 0) {
      const fp = computeCandidateFingerprint(clone);
      const delta: FormationTransformDelta = {
        operatorFamily: 'formation_transform',
        transformKind: 'flip_vertical',
        affectedNodeIds,
        coordinateMapping: mapping,
        calculatorControlledExceptions: [],
        isNoOp: fp === parentFp,
      };
      addCandidateIfValid({
        meta: {
          candidateId: `cand:${srcId}:formation_transform:c${cycleOrdinal}_flip`,
          sourceId: srcId,
          sourceName: srcName,
          sourceFingerprint: (source as any).fingerprint ?? parentFp,
          parentCandidateId: null,
          operatorFamily: 'formation_transform',
          delta,
          canonicalFingerprint: fp,
          rejected: delta.isNoOp,
          rejectionReason: delta.isNoOp ? 'NO_OP: canonical fingerprint identical to parent' : null,
          createdAt: new Date().toISOString(),
        },
        evol: clone,
      });
    }
  }

  // 3. strategy_schedule_branch (真实生成策略分支)
  if (policy.branchBudget > 0) {
    const clone = cloneEvolFormation(parentEvol);
    const r1Node = walkEvolNodes(clone.root).find(n => n.round === 1);
    if (r1Node && r1Node.placements.length > 0) {
      const branchMask: FeatureMask = { side: 2, main: null, subs: [], keys: [] };
      const existingBranch = r1Node.children?.find(c => c.condition.side === 2);
      if (!existingBranch) {
        const branchPlacement = r1Node.placements.map(p => ({
          monsterId: p.monsterId,
          x: p.x,
          y: Math.min(4, p.y + 1),
        }));
        const newBranchNode: EvolNode = {
          id: `b_side2_${r1Node.id}_c${cycleOrdinal}`,
          round: 1,
          condition: branchMask,
          placements: branchPlacement,
          children: [],
        };
        r1Node.children = r1Node.children || [];
        r1Node.children.push(newBranchNode);

        const fp = computeCandidateFingerprint(clone);
        const delta: StrategyScheduleBranchDelta = {
          operatorFamily: 'strategy_schedule_branch',
          rounds: [1],
          hasR1Branch: true,
          hasR2PlusBranch: false,
          description: `R1 side-aware branch for side=2 with adjusted y-placement`,
        };
        addCandidateIfValid({
          meta: {
            candidateId: `cand:${srcId}:strategy_schedule_branch:c${cycleOrdinal}_side2`,
            sourceId: srcId,
            sourceName: srcName,
            sourceFingerprint: (source as any).fingerprint ?? parentFp,
            parentCandidateId: null,
            operatorFamily: 'strategy_schedule_branch',
            delta,
            canonicalFingerprint: fp,
            rejected: false,
            rejectionReason: null,
            createdAt: new Date().toISOString(),
          },
          evol: clone,
        });
      }
    }
  }

  // 4. multi_monster_exploration (多怪兽联合探索)
  if (policy.allowMultiMonster) {
    const clone = cloneEvolFormation(parentEvol);
    const controllable = getControllablePlacements(clone, new Set());
    if (controllable.length >= 2) {
      const p1 = controllable[0];
      const p2 = controllable[1];
      const atomicChanges: Array<{ type: string; nodeId?: string; monsterId?: number; description: string }> = [];

      const node1 = walkEvolNodes(clone.root).find(n => n.id === p1.nodeId);
      const node2 = walkEvolNodes(clone.root).find(n => n.id === p2.nodeId);
      let changed = 0;

      if (node1) {
        const item = node1.placements.find(x => x.monsterId === p1.monsterId && x.x === p1.x && x.y === p1.y);
        if (item) {
          const nx = item.x === 10 ? 9 : item.x + 1;
          atomicChanges.push({
            type: 'move_placement',
            nodeId: p1.nodeId,
            monsterId: p1.monsterId,
            description: `move m${p1.monsterId} from (${item.x},${item.y}) to (${nx},${item.y})`,
          });
          item.x = nx;
          changed++;
        }
      }

      if (node2) {
        const item = node2.placements.find(x => x.monsterId === p2.monsterId && x.x === p2.x && x.y === p2.y);
        if (item) {
          const ny = item.y === 4 ? 3 : item.y + 1;
          atomicChanges.push({
            type: 'move_placement',
            nodeId: p2.nodeId,
            monsterId: p2.monsterId,
            description: `move m${p2.monsterId} from (${item.x},${item.y}) to (${item.x},${ny})`,
          });
          item.y = ny;
          changed++;
        }
      }

      if (changed >= 2) {
        const fp = computeCandidateFingerprint(clone);
        const delta: MultiMonsterExplorationMeta = {
          operatorFamily: 'multi_monster_exploration',
          seed: seedBase + cycleOrdinal * 100,
          parentFingerprint: parentFp,
          rollbackParentFingerprint: parentFp,
          changeCount: changed,
          atomicChanges,
          escalationReason: `EPISODE_ESCALATION: attempts=${policy.singleOpAttempts}, failCount=${policy.consecutiveFailCount}`,
          failedSingleOperatorCount: policy.consecutiveFailCount,
        };

        addCandidateIfValid({
          meta: {
            candidateId: `cand:${srcId}:multi_monster_exploration:c${cycleOrdinal}_coor`,
            sourceId: srcId,
            sourceName: srcName,
            sourceFingerprint: (source as any).fingerprint ?? parentFp,
            parentCandidateId: null,
            operatorFamily: 'multi_monster_exploration',
            delta,
            canonicalFingerprint: fp,
            rejected: false,
            rejectionReason: null,
            createdAt: new Date().toISOString(),
          },
          evol: clone,
        });
      }
    }
  }

  return candidates;
}

// ---- 候选排名 ----

export interface RankedCandidate {
  entry: CandidateEntry;
  obs: ScreenObservation;
  rank: number;
  rankReason: string;
  isExperimentalFrontier: boolean;
}

export function rankCandidates(
  allEntries: CandidateEntry[],
  allObs: ScreenObservation[],
  _policies: SourcePolicy[],
): RankedCandidate[] {
  const obsMap = new Map<string, ScreenObservation>(allObs.map(o => [o.entityId, o]));
  const ranked: RankedCandidate[] = [];

  const sourceIds = [...new Set(allEntries.map(e => e.meta.sourceId))];
  for (const srcId of sourceIds) {
    const candidates = allEntries.filter(e =>
      e.meta.sourceId === srcId &&
      !e.meta.rejected &&
      e.meta.operatorFamily !== 'baseline',
    );

    const scoredCandidates = candidates
      .map(entry => {
        const obs = obsMap.get(entry.meta.candidateId);
        if (!obs) return null;
        return { entry, obs };
      })
      .filter((x): x is { entry: CandidateEntry; obs: ScreenObservation } => x !== null)
      .filter(({ obs }) => obs.workerErrors === 0)
      .sort((a, b) => {
        const relA = a.obs.sourceRelativeScore ?? -999;
        const relB = b.obs.sourceRelativeScore ?? -999;
        if (Math.abs(relA - relB) > 0.001) return relB - relA;
        return b.obs.trainingScore - a.obs.trainingScore;
      });

    scoredCandidates.forEach((sc, idx) => {
      const rel = sc.obs.sourceRelativeScore ?? 0;
      const isExperimentalFrontier = rel > 0 && sc.obs.workerErrors === 0;
      ranked.push({
        entry: sc.entry,
        obs: sc.obs,
        rank: idx,
        rankReason: `rel=${rel.toFixed(3)} score=${sc.obs.trainingScore.toFixed(3)}`,
        isExperimentalFrontier,
      });
    });
  }

  return ranked;
}

// ---- 周期决策记录 ----

export interface CycleDecisionRecord {
  recordId: string;
  evidenceClass: 'AGGREGATE_EXPLORATION_ONLY';
  protocol: string;
  cycleId: string;
  cycleOrdinal: number;
  sourceId: string;
  classification: SourceClassification;
  controllableCount: number;
  calculatedCount: number;
  controllableRatio: number;
  spatialBudget: number;
  spatialBudgetReason: string;
  baselineScore: number;
  bestCandidateId: string | null;
  bestCandidateScore: number | null;
  bestCandidateRel: number | null;
  isExperimentalFrontier: boolean;
  candidatesScreened: number;
  singleOpAttempts: number;
  consecutiveFailCount: number;
  escalatedToMultiMonster: boolean;
  escalationReason: string | null;
  decidedAt: string;
}
