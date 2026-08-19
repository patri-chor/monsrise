// ============================================================
// T036 Phase-1 — 03_validate.ts
// 深度合法性验证、精确八怪规则、规范指纹、重复/无操作拒绝。
// 不导入 arena / hill_climb / sequential_tree_optimization / branch_induct。
// ============================================================

import { computeCandidateFingerprint, isLegalP2Coord } from './02_candidates';
import type { FormationTransformDelta, SpatialLocalDelta } from './02_candidates';
import type { EvolFormation } from '../evol_gene';
import { walkEvolNodes, isEmptyMask } from '../evol_gene';

export interface ValidationResult {
  valid: boolean;
  reasons: string[];
}

/** LEGAL_X range for p2-perspective placements (6-10) */
const P2_X_MIN = 6;
const P2_X_MAX = 10;
const P2_Y_MIN = 0;
const P2_Y_MAX = 4;

/**
 * 深度合法性验证：
 * 1. 精确 8 怪规则（team.length === 8，无重复 monsterId）
 * 2. 所有放置坐标在合法 p2 范围内（6-10, 0-4）
 * 3. 无同节点同坐标重叠
 * 4. 规范指纹唯一（与已知指纹集比较）
 * 5. 阵型变换：no-op 检测
 */
export function validateCandidateLegality(
  evol: EvolFormation,
  opts: {
    knownFingerprints?: Set<string>;
    isFormationTransform?: FormationTransformDelta;
  } = {},
): ValidationResult {
  const reasons: string[] = [];

  // --- 规则 1：精确 8 怪 ---
  if (evol.team.length !== 8) {
    reasons.push(`TEAM_COUNT_INVALID: expected 8, got ${evol.team.length}`);
  }
  const teamIds = evol.team.map(s => s.monsterId);
  const teamIdSet = new Set(teamIds);
  if (teamIdSet.size !== teamIds.length) {
    reasons.push(`TEAM_DUPLICATE_MONSTER: duplicate monsterId found in team`);
  }

  // --- 规则 2 & 3：放置坐标合法且无重叠 ---
  for (const node of walkEvolNodes(evol.root)) {
    if (node.round === 0) continue;
    const coordsInNode = new Set<string>();
    for (const p of node.placements) {
      if (!isLegalP2Coord(p.x, p.y)) {
        reasons.push(`ILLEGAL_COORD: node ${node.id} monster ${p.monsterId} coord (${p.x},${p.y}) out of p2 range [${P2_X_MIN}-${P2_X_MAX}]x[${P2_Y_MIN}-${P2_Y_MAX}]`);
      }
      const key = `${p.x},${p.y}`;
      if (coordsInNode.has(key)) {
        reasons.push(`COORD_COLLISION: node ${node.id} has two placements at (${p.x},${p.y})`);
      }
      coordsInNode.add(key);
    }
  }

  // --- 规则 4：规范指纹唯一（去重） ---
  const fp = computeCandidateFingerprint(evol);
  if (opts.knownFingerprints?.has(fp)) {
    reasons.push(`DUPLICATE_FINGERPRINT: ${fp} already exists in known set`);
  }

  // --- 规则 5：阵型变换 no-op ---
  if (opts.isFormationTransform && opts.isFormationTransform.isNoOp) {
    reasons.push(`FORMATION_TRANSFORM_NOOP: transform produces no canonical behavior change`);
  }

  return { valid: reasons.length === 0, reasons };
}

/**
 * 验证特定源的 gift_jungle 修复约束：
 * - 仅与预修复指纹比较差异
 * - 团队只增加了 monsterId=116 / badgeIds=[3,5]
 * - 每个 R5 叶子仅新增了一个 116 的放置
 */
export function validateGiftJungleRepair(opts: {
  evol: EvolFormation;
  preRepairTeamSize: number;
  preRepairFingerprint: string;
}): ValidationResult {
  const reasons: string[] = [];
  const { evol, preRepairTeamSize, preRepairFingerprint } = opts;

  // team 增加了恰好 1 个
  if (evol.team.length !== preRepairTeamSize + 1) {
    reasons.push(`TEAM_SIZE_MISMATCH: expected ${preRepairTeamSize + 1}, got ${evol.team.length}`);
  }

  // 新增的 slot 是 116 [3,5]
  const added116 = evol.team.find(s => s.monsterId === 116);
  if (!added116) {
    reasons.push('MISSING_116: monster 116 not added to team');
  } else {
    const badges = [...added116.badgeIds].sort();
    if (badges.join(',') !== '3,5') {
      reasons.push(`WRONG_116_BADGES: expected [3,5], got [${badges.join(',')}]`);
    }
  }

  // 每个 R5 叶子都有 116 的放置
  const leaves5 = walkEvolNodes(evol.root).filter(n => n.children.length === 0 && n.round === 5);
  if (leaves5.length === 0) {
    reasons.push('NO_R5_LEAVES: no round-5 leaf nodes found');
  }
  for (const leaf of leaves5) {
    const p116 = leaf.placements.find(p => p.monsterId === 116);
    if (!p116) {
      reasons.push(`LEAF_MISSING_116: leaf ${leaf.id} (round 5) has no placement for monster 116`);
    } else if (!isLegalP2Coord(p116.x, p116.y)) {
      reasons.push(`LEAF_ILLEGAL_COORD: leaf ${leaf.id} monster 116 at (${p116.x},${p116.y}) is outside p2 range`);
    }
  }

  // 新指纹 != 旧指纹（有变化）
  const newFp = computeCandidateFingerprint(evol);
  if (newFp === preRepairFingerprint) {
    reasons.push('FINGERPRINT_UNCHANGED: canonical fingerprint did not change after repair');
  }

  return { valid: reasons.length === 0, reasons };
}

/**
 * 拒绝 no-op 候选：canonical fingerprint 与父完全相同。
 */
export function rejectIfNoOp(
  candidate: EvolFormation,
  parent: EvolFormation,
): { isNoOp: boolean; reason: string | null } {
  const cf = computeCandidateFingerprint(candidate);
  const pf = computeCandidateFingerprint(parent);
  if (cf === pf) {
    return { isNoOp: true, reason: `NO_OP: candidate fingerprint ${cf} identical to parent ${pf}` };
  }
  return { isNoOp: false, reason: null };
}

/**
 * 验证空间局部变更合法性。
 * 1. 坐标在合法范围内
 * 2. 目标节点确实存在该怪兽的放置
 */
export function validateSpatialLocalDelta(
  evol: EvolFormation,
  delta: SpatialLocalDelta,
): ValidationResult {
  const reasons: string[] = [];
  if (!isLegalP2Coord(delta.toX, delta.toY)) {
    reasons.push(`SPATIAL_ILLEGAL_COORD: target coord (${delta.toX},${delta.toY}) out of p2 range`);
  }
  const node = walkEvolNodes(evol.root).find(n => n.id === delta.nodeId);
  if (!node) {
    reasons.push(`SPATIAL_NODE_NOT_FOUND: node ${delta.nodeId} not found in tree`);
  } else {
    const placement = node.placements.find(p => p.monsterId === delta.monsterId);
    if (!placement) {
      reasons.push(`SPATIAL_MONSTER_NOT_IN_NODE: monster ${delta.monsterId} has no placement in node ${delta.nodeId}`);
    }
    // 检查新坐标不与同节点其他怪兽冲突
    const conflict = node.placements.find(p => p.monsterId !== delta.monsterId && p.x === delta.toX && p.y === delta.toY);
    if (conflict) {
      reasons.push(`SPATIAL_COORD_COLLISION: (${delta.toX},${delta.toY}) already occupied by monster ${conflict.monsterId} in node ${delta.nodeId}`);
    }
  }
  return { valid: reasons.length === 0, reasons };
}

/**
 * 验证阵型变换合法性。
 * - 必须声明 transformKind 和 affectedNodeIds
 * - 映射后坐标全部合法
 * - 不为 no-op
 */
export function validateFormationTransformDelta(
  delta: FormationTransformDelta,
): ValidationResult {
  const reasons: string[] = [];
  if (!delta.transformKind) {
    reasons.push('TRANSFORM_KIND_MISSING');
  }
  if (!delta.affectedNodeIds || delta.affectedNodeIds.length === 0) {
    reasons.push('TRANSFORM_AFFECTED_NODES_EMPTY');
  }
  for (const mapping of delta.coordinateMapping) {
    if (!isLegalP2Coord(mapping.toX, mapping.toY)) {
      reasons.push(`TRANSFORM_ILLEGAL_COORD: ${mapping.nodeId} monster ${mapping.monsterId} → (${mapping.toX},${mapping.toY}) out of range`);
    }
  }
  if (delta.isNoOp) {
    reasons.push('TRANSFORM_NOOP: formation transform produces no behavior change');
  }
  return { valid: reasons.length === 0, reasons };
}

/**
 * 验证 R1 分支条件只使用 R1 可见状态（enemyRevealedHand + handBadges）。
 * R2+ 分支条件还可使用 enemyBoardIds。
 * 如果条件引用了不可见的未来状态则拒绝。
 */
export function validateBranchObservability(
  evol: EvolFormation,
): ValidationResult {
  const reasons: string[] = [];
  for (const node of walkEvolNodes(evol.root)) {
    if (node.round !== 1) continue;
    if (isEmptyMask(node.condition)) continue;
    // R1 只能用 side / main / subs / keys（手牌可见）
    // keys 中 drill(116)/rush(106)/iron(117)/ninja(119) 等在 R1 手牌可见是合法的
    // 当前 FeatureMask 结构本身已限制为可见信息，不支持"未来状态"
    // 未来如果引入 boardIds-only 条件则在此拒绝
    // 目前：凡条件有 side / main / subs / keys 均属于 R1 可见范围
    // 不合法示例（未来防护）：只依赖 R2 才可见的 boardIds
    // 当前结构无法直接表达此类条件，此验证为前瞻性 assertion
    if ((node.condition as any).requiresBoardIds === true) {
      reasons.push(`R1_BRANCH_REQUIRES_BOARD_IDS: node ${node.id} at round 1 requires board IDs which are not R1-observable`);
    }
  }
  return { valid: reasons.length === 0, reasons };
}
