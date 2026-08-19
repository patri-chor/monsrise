// ============================================================
// src/engine/tree/calculator_policy.ts
// T049: Calculator Context-Policy 规范与纯函数计算适配器
//
// 架构约束：
//   1. 战局上下文（Runtime context: round, side, revealed enemy hand,
//      legal board snapshot, budget 等）必须纯只读，严禁修改。
//   2. CalculatorContextPolicy 属于阵型自身参数，类型受白名单约束、
//      版本化管理、确定性序列化并深度参与指纹计算。
//   3. 缺少或 null 的 Policy 严格规范化为与权威原版行为 100% 一致的默认值。
// ============================================================

import { sha256Hex } from './sha256_pure';
import { DB_MONSTERS } from '../../game/Database';

export const CALCULATOR_POLICY_SCHEMA_VERSION = 'T049_CALCULATOR_POLICY_V1';

export type ChargeTargetPriority = 'tank_first' | 'iron_first' | 'four_cost_first' | 'weakest_row' | 'default';
export type SpellTargetPriority = 'prayer_first' | 'four_cost_first' | 'most_enemies' | 'weakest_unit' | 'default';
export type TutuModePreference = 'voodoo_shield_first' | 'imperial_front' | 'prayer_flank' | 'default';
export type DrillTargetPriority = 'prayer_first' | 'spell_counter' | 'four_cost_first' | 'most_enemies' | 'default';
export type TiejiaProtectTarget = 'shield_badge_bearer' | 'highest_dps' | 'imperial_shield' | 'default';
export type MineBoomTargetPriority = 'prayer_first' | 'ranged_first' | 'four_cost_first' | 'default';
export type SeleiSidePreference = 'most_enemies_flank' | 'least_enemies_flank' | 'top_fixed' | 'bottom_fixed' | 'default';

export interface CalculatorContextPolicy {
  schemaVersion: 'T049_CALCULATOR_POLICY_V1';
  special?: {
    charge?: {
      targetPriority?: ChargeTargetPriority;
    };
    spell?: {
      targetPriority?: SpellTargetPriority;
      preferXOffset?: number; // 0, 5, 6
    };
    tutu?: {
      modePreference?: TutuModePreference;
    };
    drill?: {
      targetPriority?: DrillTargetPriority;
      yOffset?: number; // -1, 0, 1
    };
    tiejia?: {
      protectTarget?: TiejiaProtectTarget;
    };
  };
  aim?: {
    mineBoom?: {
      targetPriority?: MineBoomTargetPriority;
    };
    selei?: {
      sidePreference?: SeleiSidePreference;
    };
  };
}

export const DEFAULT_CALCULATOR_POLICY: Readonly<CalculatorContextPolicy> = Object.freeze({
  schemaVersion: CALCULATOR_POLICY_SCHEMA_VERSION,
  special: {
    charge: { targetPriority: 'default' },
    spell: { targetPriority: 'default', preferXOffset: 6 },
    tutu: { modePreference: 'default' },
    drill: { targetPriority: 'default', yOffset: 1 },
    tiejia: { protectTarget: 'default' },
  },
  aim: {
    mineBoom: { targetPriority: 'default' },
    selei: { sidePreference: 'default' },
  },
});

export const ALL2RUSH_USER_OPTIMIZED_POLICY: Readonly<CalculatorContextPolicy> = Object.freeze({
  schemaVersion: CALCULATOR_POLICY_SCHEMA_VERSION,
  special: {
    charge: { targetPriority: 'iron_first' },
    spell: { targetPriority: 'four_cost_first', preferXOffset: 6 },
    tutu: { modePreference: 'voodoo_shield_first' },
    drill: { targetPriority: 'spell_counter', yOffset: 1 },
    tiejia: { protectTarget: 'imperial_shield' },
  },
  aim: {
    mineBoom: { targetPriority: 'ranged_first' },
    selei: { sidePreference: 'most_enemies_flank' },
  },
});

/** 校验 Policy 是否符合白名单与有限值域要求 */
export function validateCalculatorPolicy(raw: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!raw || typeof raw !== 'object') {
    return { valid: false, errors: ['Policy must be a non-null object'] };
  }
  const obj = raw as Record<string, any>;
  if (obj.schemaVersion !== CALCULATOR_POLICY_SCHEMA_VERSION) {
    errors.push(`Invalid schemaVersion: expected ${CALCULATOR_POLICY_SCHEMA_VERSION}, got ${obj.schemaVersion}`);
  }

  const allowedTopKeys = new Set(['schemaVersion', 'special', 'aim']);
  for (const k of Object.keys(obj)) {
    if (!allowedTopKeys.has(k)) {
      errors.push(`Unknown top-level field in policy: ${k}`);
    }
  }

  if (obj.special !== undefined) {
    if (typeof obj.special !== 'object' || obj.special === null) {
      errors.push('special must be an object');
    } else {
      const allowedSpecial = new Set(['charge', 'spell', 'tutu', 'drill', 'tiejia']);
      for (const k of Object.keys(obj.special)) {
        if (!allowedSpecial.has(k)) errors.push(`Unknown special calculator field: ${k}`);
      }
      const charge = obj.special.charge;
      if (charge !== undefined) {
        const allowed = ['tank_first', 'iron_first', 'four_cost_first', 'weakest_row', 'default'];
        if (charge.targetPriority && !allowed.includes(charge.targetPriority)) {
          errors.push(`Invalid charge.targetPriority: ${charge.targetPriority}`);
        }
      }
      const spell = obj.special.spell;
      if (spell !== undefined) {
        const allowed = ['prayer_first', 'four_cost_first', 'most_enemies', 'weakest_unit', 'default'];
        if (spell.targetPriority && !allowed.includes(spell.targetPriority)) {
          errors.push(`Invalid spell.targetPriority: ${spell.targetPriority}`);
        }
        if (spell.preferXOffset !== undefined && ![0, 5, 6].includes(spell.preferXOffset)) {
          errors.push(`Invalid spell.preferXOffset: ${spell.preferXOffset}`);
        }
      }
      const tutu = obj.special.tutu;
      if (tutu !== undefined) {
        const allowed = ['voodoo_shield_first', 'imperial_front', 'prayer_flank', 'default'];
        if (tutu.modePreference && !allowed.includes(tutu.modePreference)) {
          errors.push(`Invalid tutu.modePreference: ${tutu.modePreference}`);
        }
      }
      const drill = obj.special.drill;
      if (drill !== undefined) {
        const allowed = ['prayer_first', 'spell_counter', 'four_cost_first', 'most_enemies', 'default'];
        if (drill.targetPriority && !allowed.includes(drill.targetPriority)) {
          errors.push(`Invalid drill.targetPriority: ${drill.targetPriority}`);
        }
        if (drill.yOffset !== undefined && ![-1, 0, 1].includes(drill.yOffset)) {
          errors.push(`Invalid drill.yOffset: ${drill.yOffset}`);
        }
      }
      const tiejia = obj.special.tiejia;
      if (tiejia !== undefined) {
        const allowed = ['shield_badge_bearer', 'highest_dps', 'imperial_shield', 'default'];
        if (tiejia.protectTarget && !allowed.includes(tiejia.protectTarget)) {
          errors.push(`Invalid tiejia.protectTarget: ${tiejia.protectTarget}`);
        }
      }
    }
  }

  if (obj.aim !== undefined) {
    if (typeof obj.aim !== 'object' || obj.aim === null) {
      errors.push('aim must be an object');
    } else {
      const allowedAim = new Set(['mineBoom', 'selei']);
      for (const k of Object.keys(obj.aim)) {
        if (!allowedAim.has(k)) errors.push(`Unknown aim calculator field: ${k}`);
      }
      const mineBoom = obj.aim.mineBoom;
      if (mineBoom !== undefined) {
        const allowed = ['prayer_first', 'ranged_first', 'four_cost_first', 'default'];
        if (mineBoom.targetPriority && !allowed.includes(mineBoom.targetPriority)) {
          errors.push(`Invalid mineBoom.targetPriority: ${mineBoom.targetPriority}`);
        }
      }
      const selei = obj.aim.selei;
      if (selei !== undefined) {
        const allowed = ['most_enemies_flank', 'least_enemies_flank', 'top_fixed', 'bottom_fixed', 'default'];
        if (selei.sidePreference && !allowed.includes(selei.sidePreference)) {
          errors.push(`Invalid selei.sidePreference: ${selei.sidePreference}`);
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/** 规范化 Policy，缺省字段填入版本化默认值，返回排序好的稳定对象 */
export function canonicalizeCalculatorPolicy(policy?: CalculatorContextPolicy | null): CalculatorContextPolicy {
  if (!policy) return JSON.parse(JSON.stringify(DEFAULT_CALCULATOR_POLICY));
  const validation = validateCalculatorPolicy(policy);
  if (!validation.valid) {
    throw new Error(`Invalid CalculatorContextPolicy: ${validation.errors.join('; ')}`);
  }
  return {
    schemaVersion: CALCULATOR_POLICY_SCHEMA_VERSION,
    special: {
      charge: {
        targetPriority: policy.special?.charge?.targetPriority ?? 'default',
      },
      spell: {
        targetPriority: policy.special?.spell?.targetPriority ?? 'default',
        preferXOffset: policy.special?.spell?.preferXOffset ?? 6,
      },
      tutu: {
        modePreference: policy.special?.tutu?.modePreference ?? 'default',
      },
      drill: {
        targetPriority: policy.special?.drill?.targetPriority ?? 'default',
        yOffset: policy.special?.drill?.yOffset ?? 1,
      },
      tiejia: {
        protectTarget: policy.special?.tiejia?.protectTarget ?? 'default',
      },
    },
    aim: {
      mineBoom: {
        targetPriority: policy.aim?.mineBoom?.targetPriority ?? 'default',
      },
      selei: {
        sidePreference: policy.aim?.selei?.sidePreference ?? 'default',
      },
    },
  };
}

/** 计算 Policy 的确定性哈希指纹 */
export function computeCalculatorPolicyFingerprint(policy?: CalculatorContextPolicy | null): string {
  const canonical = canonicalizeCalculatorPolicy(policy);
  return sha256Hex(JSON.stringify(canonical)).slice(0, 16);
}

// ============================================================
// 计算器只读战局决策函数 (Special & Aim)
// ============================================================

export interface BoardUnitPosition {
  monsterId: number;
  dbId?: number;
  x: number;
  y: number;
  badgeIds?: number[];
}

export interface ReadonlyPlacementContext {
  round: number;
  side: 1 | 2;
  ownMonsters: BoardUnitPosition[];
  enemyMonsters: BoardUnitPosition[];
  enemyRevealedHand: Array<{ monsterId: number; badgeIds?: number[] }>;
}

function getMonsterCost(id: number): number {
  return DB_MONSTERS.find(m => m.id === id)?.cost ?? 2;
}

function getMonsterRole(id: number): string {
  return DB_MONSTERS.find(m => m.id === id)?.role ?? '战士';
}

function pickBestEnemyRow(opponents: BoardUnitPosition[], defaultY: number): number {
  if (opponents.length === 0) return defaultY;
  const rowCount = new Map<number, number>();
  for (const u of opponents) {
    rowCount.set(u.y, (rowCount.get(u.y) ?? 0) + 1);
  }
  let bestY = defaultY;
  let bestCount = -1;
  for (const [y, count] of rowCount) {
    if (count > bestCount) {
      bestCount = count;
      bestY = y;
    }
  }
  return bestY;
}

/**
 * 依据战局只读上下文与阵型 Policy 计算特殊怪（106, 107, 114, 116, 117）的落点意图
 * 坐标为 p2 视角（6-10，0-4），若 side=1 由外层统一镜像
 */
export function evaluateSpecialPlacementWithPolicy(
  monsterId: number,
  ctx: ReadonlyPlacementContext,
  defaultX: number,
  defaultY: number,
  myBadgeIds: number[] = [],
  rawPolicy?: CalculatorContextPolicy | null,
): { x: number; y: number } {
  const policy = canonicalizeCalculatorPolicy(rawPolicy);
  const opponents = ctx.enemyMonsters;
  const friendlies = ctx.ownMonsters;

  switch (monsterId) {
    case 106: { // 冲锋
      const prio = policy.special?.charge?.targetPriority ?? 'default';
      if (myBadgeIds.includes(35)) {
        const prayer = friendlies.find(u => u.monsterId === 105);
        if (prayer) {
          const tryY = prayer.y + 1 <= 4 ? prayer.y + 1 : prayer.y - 1;
          return { x: prayer.x, y: tryY };
        }
      }
      if (prio === 'four_cost_first') {
        const fourCost = opponents.find(u => getMonsterCost(u.monsterId) === 4);
        if (fourCost) return { x: defaultX, y: fourCost.y };
      }
      if (prio !== 'tank_first') {
        const enemyTiejia = opponents.find(u => u.monsterId === 117);
        if (enemyTiejia) return { x: defaultX, y: enemyTiejia.y };
      }
      const enemyTank = opponents.find(u => getMonsterRole(u.monsterId) === '坦克');
      if (enemyTank) return { x: defaultX, y: enemyTank.y };
      return { x: defaultX, y: defaultY };
    }

    case 107: { // 咒法
      if (opponents.length === 0) return { x: defaultX, y: defaultY };
      const prio = policy.special?.spell?.targetPriority ?? 'default';
      const preferOffset = policy.special?.spell?.preferXOffset ?? 6;

      let target: BoardUnitPosition | undefined;
      if (prio === 'four_cost_first') {
        target = opponents.find(u => getMonsterCost(u.monsterId) === 4) ?? opponents.find(u => u.monsterId === 105);
      } else {
        target = opponents.find(u => u.monsterId === 105) ?? opponents.find(u => getMonsterCost(u.monsterId) === 4);
      }

      if (target) {
        const targetY = target.y;
        const preferX = defaultX >= 6 && defaultX <= 10 ? defaultX : target.x + preferOffset;
        return { x: Math.max(6, Math.min(10, preferX)), y: targetY };
      }
      const bestY = pickBestEnemyRow(opponents, defaultY);
      return { x: defaultX, y: bestY };
    }

    case 114: { // 突突
      if (opponents.length === 0) return { x: defaultX, y: defaultY };
      const mode = policy.special?.tutu?.modePreference ?? 'default';
      const isVoodoo = myBadgeIds.includes(32) || mode === 'voodoo_shield_first';
      const SHIELD_BADGE_IDS = [11, 28, 30];

      if (isVoodoo) {
        const shieldBearer = opponents.find(u => (u.badgeIds ?? []).some(bid => SHIELD_BADGE_IDS.includes(bid)));
        if (shieldBearer) {
          return { x: Math.max(6, Math.min(10, shieldBearer.x + 6)), y: shieldBearer.y };
        }
        const tiejia = opponents.find(u => u.monsterId === 117);
        if (tiejia) {
          return { x: Math.max(6, Math.min(10, tiejia.x + 5)), y: tiejia.y };
        }
      }

      if (mode === 'imperial_front') {
        const imperial = friendlies.find(u => u.monsterId === 110);
        if (imperial) {
          return { x: Math.min(10, imperial.x + 1), y: imperial.y };
        }
      }

      const imperial = friendlies.find(u => u.monsterId === 110);
      if (imperial) {
        return { x: Math.min(10, imperial.x + 1), y: imperial.y };
      }
      const prayer = opponents.find(u => u.monsterId === 105);
      if (prayer) {
        return { x: defaultX, y: Math.max(0, prayer.y - 1) };
      }
      const fourCost = opponents.find(u => getMonsterCost(u.monsterId) === 4);
      if (fourCost) return { x: defaultX, y: fourCost.y };
      return { x: defaultX, y: pickBestEnemyRow(opponents, defaultY) };
    }

    case 116: { // 钻头
      if (opponents.length === 0) return { x: defaultX, y: defaultY };
      const prio = policy.special?.drill?.targetPriority ?? 'default';
      const dy = policy.special?.drill?.yOffset ?? 1;

      if (prio === 'spell_counter') {
        const enemySpell = opponents.find(u => u.monsterId === 107);
        if (enemySpell) {
          return { x: Math.max(6, Math.min(10, enemySpell.x + 6)), y: enemySpell.y };
        }
      }

      const prayer = opponents.find(u => u.monsterId === 105);
      if (prayer) {
        const drillX = Math.max(6, Math.min(10, prayer.x + 6));
        const drillY = Math.max(0, Math.min(4, prayer.y + dy));
        return { x: drillX, y: drillY };
      }

      const enemySpell = opponents.find(u => u.monsterId === 107);
      if (enemySpell) {
        return { x: Math.max(6, Math.min(10, enemySpell.x + 6)), y: enemySpell.y };
      }
      const fourCostRows = opponents.filter(u => getMonsterCost(u.monsterId) === 4).map(u => u.y);
      if (fourCostRows.length > 0) {
        return { x: defaultX, y: fourCostRows[0] };
      }
      return { x: defaultX, y: pickBestEnemyRow(opponents, defaultY) };
    }

    case 117: { // 铁甲猴
      const DEF_BADGE_IDS = [11, 28, 30];
      const deployedMate = friendlies.find(u => (u.badgeIds ?? []).some(bid => DEF_BADGE_IDS.includes(bid)));
      if (deployedMate) {
        return { x: Math.max(6, deployedMate.x - 1), y: deployedMate.y };
      }
      const imperial = friendlies.find(u => u.monsterId === 110);
      if (imperial) {
        return { x: Math.max(6, imperial.x - 1), y: imperial.y };
      }
      return { x: defaultX, y: defaultY };
    }

    default:
      return { x: defaultX, y: defaultY };
  }
}

/**
 * 依据战局只读上下文与阵型 Policy 计算瞄准怪（113 矿爆, 118 塞雷）的落点意图
 */
export function evaluateAimPlacementWithPolicy(
  monsterId: number,
  ctx: ReadonlyPlacementContext,
  defaultX: number,
  defaultY: number,
  rawPolicy?: CalculatorContextPolicy | null,
): { x: number; y: number } {
  const policy = canonicalizeCalculatorPolicy(rawPolicy);
  const opponents = ctx.enemyMonsters;
  const friendlies = ctx.ownMonsters;

  switch (monsterId) {
    case 113: { // 矿爆
      const prio = policy.aim?.mineBoom?.targetPriority ?? 'default';
      if (prio === 'four_cost_first') {
        const fourCost = opponents.find(u => getMonsterCost(u.monsterId) === 4);
        if (fourCost) return { x: Math.max(6, Math.min(10, fourCost.x + 6)), y: fourCost.y };
      }
      const prayer = opponents.find(u => u.monsterId === 105);
      if (prayer) {
        return { x: Math.max(6, Math.min(10, prayer.x + 6)), y: prayer.y };
      }
      const backline = opponents.find(u => getMonsterRole(u.monsterId) === '射手' || getMonsterRole(u.monsterId) === '法师');
      if (backline) {
        return { x: Math.max(6, Math.min(10, backline.x + 6)), y: backline.y };
      }
      return { x: defaultX, y: defaultY };
    }

    case 118: { // 塞雷
      const imperial = friendlies.find(u => u.monsterId === 110);
      if (!imperial) return { x: defaultX, y: defaultY };
      const baseX = Math.max(6, Math.min(10, imperial.x));
      const impY = imperial.y;

      const pref = policy.aim?.selei?.sidePreference ?? 'default';
      if (pref === 'top_fixed') {
        return { x: baseX, y: Math.max(0, impY - 1) };
      }
      if (pref === 'bottom_fixed') {
        return { x: baseX, y: Math.min(4, impY + 1) };
      }

      const candidates: Array<{ x: number; y: number }> = [];
      for (const dy of [1, -1]) {
        const y = impY + dy;
        if (y >= 0 && y <= 4) candidates.push({ x: baseX, y });
      }
      if (candidates.length === 0) candidates.push({ x: baseX, y: impY });

      const countEnemies = (x: number, y: number) => {
        let count = 0;
        for (const u of opponents) {
          const dx = Math.abs(u.x - (x + 5)); // 估计碰撞/威胁区
          const dy = Math.abs(u.y - y);
          if (dx <= 2 && dy <= 1) count++;
        }
        return count;
      };

      let best = candidates[0];
      let bestCount = -1;
      for (const c of candidates) {
        const n = countEnemies(c.x, c.y);
        if (pref === 'least_enemies_flank') {
          if (bestCount === -1 || n < bestCount) {
            bestCount = n;
            best = c;
          }
        } else {
          if (n > bestCount) {
            bestCount = n;
            best = c;
          }
        }
      }
      return { x: best.x, y: best.y };
    }

    default:
      return { x: defaultX, y: defaultY };
  }
}
