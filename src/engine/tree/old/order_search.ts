// ============================================================
// 计算定位单位占比驱动的顺序优化引擎 (T014 Order Search)
//
// 核心原则：
//   1. calculatedUnitRatio = 计算定位单位 / 队伍总人数 (由 isPositionIrrelevant 定义)
//   2. 计算定位单位严禁生成任何坐标/站位候选
//   3. ratio >= 0.50: 全流程纯顺序搜索 (Sequence Only)
//   4. ratio < 0.50: R1/R2 仅对可控怪兽允许常规站位搜索，R3-R5 纯顺序搜索
//   5. 轮内排列枚举 (支持非相邻置换) 与跨相邻轮迁移 (严格遵循预算曲线与合法性)
// ============================================================

import type { EvolFormation, EvolNode, EvolPlacement } from './evol_gene';
import { cloneEvolFormation, walkEvolNodes } from './evol_gene';
import { isPositionIrrelevant, roleOf, costOf } from './tree_ops';
import { BUDGET_LIMITS } from './deck_ontology';

export interface BundleFamily {
  familyId: string;
  chineseName: string;
  archetype: string;
  archetypeDescription: string;
  trainingVariant: any;
  heldOutVariant: any;
}

const MONSTER_SHORT_NAMES: Record<number, string> = {
  101: '坚果',
  102: '大祭司',
  103: '学徒',
  104: '散弹',
  105: '祈祷',
  106: '冲锋',
  107: '咒法',
  108: '救星',
  109: '银狙',
  110: '帝国',
  111: '见习',
  112: '守卫',
  113: '矿爆',
  114: '突突',
  115: '铲土人',
  116: '钻头',
  117: '铁甲',
  118: '塞雷',
  119: '忍猴',
  120: '金猴',
  125: '战壕',
};

export function getMonsterDisplayName(monsterId: number): string {
  return MONSTER_SHORT_NAMES[monsterId] ?? `怪兽${monsterId}`;
}

export interface CoherenceCheckResult {
  valid: boolean;
  error?: 'MISSING_TEAM_MONSTER' | 'DUPLICATE_PATH_DEPLOYMENT' | 'BUDGET_EXCEEDED' | 'INVALID_COORDINATES' | 'INVALID_ROUND_ORDER';
  message?: string;
  detail?: { round: number; monsterId: number; nodeId?: string; x?: number; y?: number };
}

export function validateTreeDeckCoherence(formation: EvolFormation): CoherenceCheckResult {
  const teamMonsterIds = new Set(formation.team.map(s => s.monsterId));

  function checkNode(node: EvolNode, parentRound: number, seenMonsters: Set<number>, accumulatedCost: number): CoherenceCheckResult {
    if (node.round < parentRound) {
      return { valid: false, error: 'INVALID_ROUND_ORDER', message: `Round not monotonic: ${node.round} < ${parentRound}` };
    }

    let currentCost = accumulatedCost;
    for (const p of node.placements) {
      if (!teamMonsterIds.has(p.monsterId)) {
        return {
          valid: false,
          error: 'MISSING_TEAM_MONSTER',
          message: `Monster ${p.monsterId} placed in round ${node.round} is not present in candidate team [${Array.from(teamMonsterIds).join(',')}]`,
          detail: { round: node.round, monsterId: p.monsterId, nodeId: node.id, x: p.x, y: p.y },
        };
      }
      if (seenMonsters.has(p.monsterId)) {
        return {
          valid: false,
          error: 'DUPLICATE_PATH_DEPLOYMENT',
          message: `Monster ${p.monsterId} deployed more than once on path at round ${node.round}`,
          detail: { round: node.round, monsterId: p.monsterId, nodeId: node.id },
        };
      }
      if (p.x < 0 || p.x > 10 || p.y < 0 || p.y > 4) {
        return {
          valid: false,
          error: 'INVALID_COORDINATES',
          message: `Invalid placement coordinates (${p.x},${p.y}) for monster ${p.monsterId}`,
          detail: { round: node.round, monsterId: p.monsterId, x: p.x, y: p.y },
        };
      }
      seenMonsters.add(p.monsterId);
      currentCost += costOf(p.monsterId);
    }

    const maxBudget = BUDGET_LIMITS[node.round] ?? 16;
    if (currentCost > maxBudget) {
      return {
        valid: false,
        error: 'BUDGET_EXCEEDED',
        message: `Accumulated cost ${currentCost} exceeds budget ${maxBudget} at round ${node.round}`,
        detail: { round: node.round, monsterId: 0 },
      };
    }

    for (const child of node.children) {
      const res = checkNode(child, node.round, new Set(seenMonsters), currentCost);
      if (!res.valid) return res;
    }

    return { valid: true };
  }

  return checkNode(formation.root, 0, new Set(), 0);
}

export function validateTreePlacements(formation: EvolFormation): boolean {
  return validateTreeDeckCoherence(formation).valid;
}

export interface CalculatedUnitAnalysis {
  ratio: number;
  calculatedCount: number;
  totalCount: number;
  calculatedMonsterIds: number[];
  controllableMonsterIds: number[];
}

export function computeCalculatedUnitRatio(team: { monsterId: number }[]): CalculatedUnitAnalysis {
  const calculatedMonsterIds: number[] = [];
  const controllableMonsterIds: number[] = [];
  for (const slot of team) {
    if (slot.monsterId <= 0) continue;
    if (isPositionIrrelevant(slot.monsterId)) {
      calculatedMonsterIds.push(slot.monsterId);
    } else {
      controllableMonsterIds.push(slot.monsterId);
    }
  }
  const totalCount = calculatedMonsterIds.length + controllableMonsterIds.length;
  const ratio = totalCount > 0 ? calculatedMonsterIds.length / totalCount : 0;
  return {
    ratio,
    calculatedCount: calculatedMonsterIds.length,
    totalCount,
    calculatedMonsterIds,
    controllableMonsterIds,
  };
}

/** 辅助生成数组全排列（限制最多 24 个排列） */
export function generatePermutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  const results: T[][] = [];
  function permute(arr: T[], m: T[] = []) {
    if (arr.length === 0) {
      results.push(m);
    } else {
      for (let i = 0; i < arr.length; i++) {
        if (results.length >= 24) break;
        const curr = arr.slice();
        const next = curr.splice(i, 1);
        permute(curr.slice(), m.concat(next));
      }
    }
  }
  permute(items);
  return results;
}

export interface OrderMutationCandidate {
  child: EvolFormation;
  desc: string;
  key: string;
  operatorType: 'within_round_reorder' | 'round_shift_earlier' | 'round_shift_later' | 'controllable_reposition';
  monsterId: number;
}

/** 生成合法的顺序与时机候选变体 */
export function generateOrderCandidates(
  formation: EvolFormation,
  formationId: string,
  fingerprint: string,
): {
  candidates: OrderMutationCandidate[];
  analysis: CalculatedUnitAnalysis;
  stats: {
    withinRoundReorders: number;
    roundShiftsEarlier: number;
    roundShiftsLater: number;
    controllablePositions: number;
    calculatorPositionsBlocked: number;
  };
} {
  const analysis = computeCalculatedUnitRatio(formation.team);
  const candidates: OrderMutationCandidate[] = [];
  const stats = {
    withinRoundReorders: 0,
    roundShiftsEarlier: 0,
    roundShiftsLater: 0,
    controllablePositions: 0,
    calculatorPositionsBlocked: 0,
  };

  const allNodes = walkEvolNodes(formation.root);

  // 1. 轮内放置重排 (Within-round reordering: 支持非相邻全排列)
  for (const node of allNodes) {
    if (node.placements.length >= 2) {
      const perms = generatePermutations(node.placements);
      const originalSig = node.placements.map(p => p.monsterId).join(',');
      for (const perm of perms) {
        const permSig = perm.map(p => p.monsterId).join(',');
        if (permSig === originalSig) continue;

        const cloned = cloneEvolFormation(formation);
        const targetNode = walkEvolNodes(cloned.root).find(n => n.id === node.id);
        if (!targetNode) continue;
        targetNode.placements = perm.map(p => ({ ...p }));

        if (validateTreePlacements(cloned)) {
          stats.withinRoundReorders++;
          candidates.push({
            child: cloned,
            desc: `[轮内重排 R${node.round}] 节点 ${node.id}: [${permSig}] (原: [${originalSig}])`,
            key: `order_perm::${node.id}::${permSig}::${fingerprint}`,
            operatorType: 'within_round_reorder',
            monsterId: perm[0].monsterId,
          });
        }
      }
    }
  }

  // 2. 跨相邻轮时机调整 (Adjacent Round Shifts)
  for (let rIdx = 0; rIdx < allNodes.length; rIdx++) {
    const node = allNodes[rIdx];
    if (node.round <= 0 || node.placements.length === 0) continue;

    for (const slot of node.placements) {
      // 尝试提前 1 轮 (Shift Earlier)
      if (node.round > 1) {
        const targetRound = node.round - 1;
        const parentNodes = allNodes.filter(n => n.round === targetRound);
        for (const pNode of parentNodes) {
          const cloned = cloneEvolFormation(formation);
          const clonedSrc = walkEvolNodes(cloned.root).find(n => n.id === node.id);
          const clonedDest = walkEvolNodes(cloned.root).find(n => n.id === pNode.id);
          if (!clonedSrc || !clonedDest) continue;

          clonedSrc.placements = clonedSrc.placements.filter(p => p.monsterId !== slot.monsterId);
          clonedDest.placements.push({ ...slot });

          // 校验预算曲线
          if (validateTreePlacements(cloned)) {
            stats.roundShiftsEarlier++;
            candidates.push({
              child: cloned,
              desc: `[入场提前] 怪兽 ${slot.monsterId} 从 R${node.round} 提前至 R${targetRound}`,
              key: `shift_earlier::${node.id}::${pNode.id}::${slot.monsterId}::${fingerprint}`,
              operatorType: 'round_shift_earlier',
              monsterId: slot.monsterId,
            });
          }
        }
      }

      // 尝试延后 1 轮 (Shift Later)
      if (node.round < 5) {
        const targetRound = node.round + 1;
        for (const childNode of node.children) {
          if (childNode.round === targetRound) {
            const cloned = cloneEvolFormation(formation);
            const clonedSrc = walkEvolNodes(cloned.root).find(n => n.id === node.id);
            const clonedDest = walkEvolNodes(cloned.root).find(n => n.id === childNode.id);
            if (!clonedSrc || !clonedDest) continue;

            clonedSrc.placements = clonedSrc.placements.filter(p => p.monsterId !== slot.monsterId);
            clonedDest.placements.push({ ...slot });

            if (validateTreePlacements(cloned)) {
              stats.roundShiftsLater++;
              candidates.push({
                child: cloned,
                desc: `[入场延后] 怪兽 ${slot.monsterId} 从 R${node.round} 延后至 R${targetRound}`,
                key: `shift_later::${node.id}::${childNode.id}::${slot.monsterId}::${fingerprint}`,
                operatorType: 'round_shift_later',
                monsterId: slot.monsterId,
              });
            }
          }
        }
      }
    }
  }

  // 3. 严格受控的位置调整 (仅 ratio < 0.50 且仅 R1/R2 对非计算单位允许)
  if (analysis.ratio < 0.50) {
    for (const node of allNodes) {
      if (node.round === 1 || node.round === 2) {
        for (const slot of node.placements) {
          if (isPositionIrrelevant(slot.monsterId)) {
            stats.calculatorPositionsBlocked++;
            continue; // 严格拦截计算怪兽位置变异
          }

          const role = roleOf(slot.monsterId);
          const isBackline = role === '法师' || role === '射手';
          const cols = isBackline ? [8, 9, 10] : [6, 7, 8];
          for (const x of cols) {
            for (let y = 0; y < 5; y++) {
              if (x === slot.x && y === slot.y) continue;
              const cloned = cloneEvolFormation(formation);
              const targetNode = walkEvolNodes(cloned.root).find(n => n.id === node.id);
              const pSlot = targetNode?.placements.find(p => p.monsterId === slot.monsterId);
              if (!targetNode || !pSlot) continue;
              pSlot.x = x;
              pSlot.y = y;

              if (validateTreePlacements(cloned)) {
                stats.controllablePositions++;
                candidates.push({
                  child: cloned,
                  desc: `[常规站位 R${node.round}] 可控怪兽 ${slot.monsterId} → (${x},${y})`,
                  key: `ctrl_pos::${node.id}::${slot.monsterId}::${x},${y}::${fingerprint}`,
                  operatorType: 'controllable_reposition',
                  monsterId: slot.monsterId,
                });
              }
            }
          }
        }
      }
    }
  } else {
    // ratio >= 0.50，记录所有被拦截的计算单位
    for (const node of allNodes) {
      for (const slot of node.placements) {
        if (isPositionIrrelevant(slot.monsterId)) {
          stats.calculatorPositionsBlocked++;
        }
      }
    }
  }

  return { candidates, analysis, stats };
}
