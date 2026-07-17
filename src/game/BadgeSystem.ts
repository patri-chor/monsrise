import { PlacedMonster } from './GameEngine';
import { vfx } from './VfxManager';

/**
 * 徽章效果的上下文参数，用于在各个钩子之间传递战斗状态信息。
 * 字段按需使用，大部分钩子只用到其中一部分。
 */
export interface BadgeContext {
  // --- 伤害相关 ---
  /** 伤害来源 */
  attacker?: PlacedMonster | null;
  /** 伤害目标 */
  target?: PlacedMonster;
  /** 原始/当前伤害值 */
  damage?: number;
  /** 是否触发暴击 */
  isCrit?: boolean;
  /** 是否来自破盾者（一次破4层盾） */
  isShieldBreaker?: boolean;

  // --- 治疗/护盾相关 ---
  /** 治疗量 */
  healAmount?: number;
  /** 治疗来源（用于光环类徽章扩散治疗） */
  healSource?: PlacedMonster;
  /** 护盾层数 */
  shieldLayers?: number;
  /** 扣减的护盾层数 */
  shieldReduced?: number;

  // --- 穿透相关 ---
  /** 已命中的目标 ID 集合（穿透徽章防止帧伤） */
  hitTargetIds?: Set<string>;

  // --- 战斗对象 ---
  /** BattleSystem 实例引用 */
  battle?: any;
  /** GameEngine 实例引用 */
  engine?: any;
}

/**
 * 徽章基类 —— 与 BaseSkill 设计模式一致。
 * 每个具体徽章继承此类，重写需要参与的生命周期钩子。
 * 钩子全部默认为空操作，不强制子类实现。
 */
export abstract class BaseBadge {
  abstract readonly id: number;
  abstract readonly name: string;
  abstract readonly desc: string;

  // ==================== 放置阶段 ====================

  /**
   * 怪兽被放置到棋盘上时调用（含重置棋盘）
   * 用于永久性属性修正，如 badge 8 厚皮 +1000HP
   */
  public onPlace(_monster: PlacedMonster, _ctx?: BadgeContext): void {
    void _monster;
    void _ctx;
  }

  // ==================== 战斗开始阶段 ====================

  /**
   * 战斗开始时调用（一次性效果）
   * 如 badge 11 预防（12护盾）、badge 24 炸弹（-80%HP）
   */
  public onStartOfBattle(_monster: PlacedMonster, _ctx?: BadgeContext): void {
    void _monster;
    void _ctx;
  }

  // ==================== 伤害计算阶段 ====================

  /**
   * 攻击者造成伤害前，修改伤害值
   * 返回修改后的伤害值
   * 如 badge 2 凋零、badge 3 破盾、badge 20 狙击
   */
  public modifyDamage(_monster: PlacedMonster, _dmg: number, _ctx: BadgeContext): number {
    return _dmg;
  }

  /**
   * 目标承受伤害前，修改受到的伤害值（如减伤类徽章）
   * 返回修改后的伤害值
   * 如 badge 12 结阵守、badge 14 独狼守
   */
  public modifyIncomingDamage(_monster: PlacedMonster, _dmg: number, _ctx: BadgeContext): number {
    return _dmg;
  }

  /**
   * 攻击命中后触发（伤害已结算）
   * 如 badge 1 穿透、badge 7 吸血、badge 25 中毒
   */
  public onAfterDealDamage(_monster: PlacedMonster, _ctx: BadgeContext): void {
    void _monster;
    void _ctx;
  }

  /**
   * 承受伤害后触发
   * 如 badge 21 反击、badge 30 反应装甲
   */
  public onAfterTakeDamage(_monster: PlacedMonster, _ctx: BadgeContext): void {
    void _monster;
    void _ctx;
  }

  // ==================== 治疗/护盾阶段 ====================

  /**
   * 受到治疗时，修改治疗量
   * 如 badge 17 大厨 +50%
   */
  public modifyHeal(_monster: PlacedMonster, _amount: number, _ctx?: BadgeContext): number {
    return _amount;
  }

  /**
   * 治疗完成后触发（用于光环扩散等效果）
   * 如 badge 6 回复光环：治疗自身后扩散 30% 治疗给范围2队友
   */
  public onAfterHeal(_monster: PlacedMonster, _ctx: BadgeContext): void {
    void _monster;
    void _ctx;
  }

  /**
   * 获得护盾时，修改护盾层数
   * 如 badge 28 加固 +50%
   */
  public modifyShield(_monster: PlacedMonster, _layers: number, _ctx?: BadgeContext): number {
    return _layers;
  }

  // ==================== 属性修正阶段 ====================

  /**
   * 修正攻击范围（累加制）
   * 如 badge 9 延伸 +1
   */
  public getRangeBonus(_monster: PlacedMonster): number {
    return 0;
  }

  /**
   * 修正技能冷却速度倍率（累加制）
   * 如 badge 10 蓄能 +0.4、badge 16 贤者 +0.5
   */
  public getCdSpeedBonus(_monster: PlacedMonster): number {
    return 0;
  }

  /**
   * 修正相邻友方的技能冷却速度倍率（可叠加）
   * 如 badge 16 贤者 +0.5
   */
  public getAdjacentCdSpeedBonus(_owner: PlacedMonster, _neighbor: PlacedMonster): number {
    return 0;
  }

  /**
   * 修正攻击速度倍率（累乘制）
   * 返回倍率因子，如 badge 10 蓄能 0.75
   */
  public getAtsMultiplier(_monster: PlacedMonster): number {
    return 1.0;
  }

  // ==================== 技能阶段 ====================

  /**
   * 释放技能时调用
   * 如 badge 4 元素涌动：对技能目标轮流施加燃烧/寒冷
   */
  public onSkillCast(_monster: PlacedMonster, _ctx: BadgeContext): void {
    void _monster;
    void _ctx;
  }

  // ==================== 死亡阶段 ====================

  /**
   * 怪兽即将死亡时调用
   * 返回 false 可阻止死亡（如 badge 18 复活）
   * 返回 true 则正常死亡
   */
  public onBeforeDeath(_monster: PlacedMonster, _ctx?: BadgeContext): boolean {
    return true;
  }

  /**
   * 当状态效果即将施加到怪兽身上时调用。
   * 返回 false 可免疫/阻止该状态效果。
   * 返回 true 正常施加。
   */
  public onApplyStatusEffect(_monster: PlacedMonster, _effect: { type: string; duration: number }): boolean {
    return true;
  }

  /**
   * 怪兽死亡后调用
   * 如 badge 24 炸弹爆炸、badge 33 礼物、badge 35 接力
   */
  public onAfterDeath(_monster: PlacedMonster, _ctx?: BadgeContext): void {
    void _monster;
    void _ctx;
  }

  // ==================== 回合/持续更新 ====================

  /**
   * 每帧更新回调
   * 如 badge 6 回复光环（定时治疗）、badge 31 哨位（站桩加攻）
   */
  public onTick(_monster: PlacedMonster, _dt: number, _ctx?: BadgeContext): void {
    void _monster;
    void _dt;
    void _ctx;
  }
}

// ==================== 徽章注册表 ====================

const BADGE_REGISTRY: Map<number, BaseBadge> = new Map();

export function registerBadge(badge: BaseBadge): void {
  BADGE_REGISTRY.set(badge.id, badge);
}

export function getBadge(id: number): BaseBadge | undefined {
  return BADGE_REGISTRY.get(id);
}

export function getMonsterBadges(monster: PlacedMonster): BaseBadge[] {
  return monster.badges
    .map(b => BADGE_REGISTRY.get(b.id))
    .filter((b): b is BaseBadge => !!b);
}

// ==================== 批量调用工具函数 ====================

export function badgeOnPlace(monster: PlacedMonster, ctx?: BadgeContext): void {
  for (const badge of getMonsterBadges(monster)) {
    badge.onPlace(monster, ctx);
  }
}

export function badgeOnStartOfBattle(monster: PlacedMonster, ctx?: BadgeContext): void {
  for (const badge of getMonsterBadges(monster)) {
    badge.onStartOfBattle(monster, ctx);
  }
}

export function badgeModifyDamage(monster: PlacedMonster, dmg: number, ctx: BadgeContext): number {
  let result = dmg;
  for (const badge of getMonsterBadges(monster)) {
    result = badge.modifyDamage(monster, result, ctx);
  }
  return result;
}

export function badgeModifyIncomingDamage(monster: PlacedMonster, dmg: number, ctx: BadgeContext): number {
  let result = dmg;
  for (const badge of getMonsterBadges(monster)) {
    result = badge.modifyIncomingDamage(monster, result, ctx);
  }
  return result;
}

export function badgeOnAfterDealDamage(monster: PlacedMonster, ctx: BadgeContext): void {
  for (const badge of getMonsterBadges(monster)) {
    badge.onAfterDealDamage(monster, ctx);
  }
}

export function badgeOnAfterTakeDamage(monster: PlacedMonster, ctx: BadgeContext): void {
  for (const badge of getMonsterBadges(monster)) {
    badge.onAfterTakeDamage(monster, ctx);
  }
}

export function badgeModifyHeal(monster: PlacedMonster, amount: number, ctx?: BadgeContext): number {
  let result = amount;
  for (const badge of getMonsterBadges(monster)) {
    result = badge.modifyHeal(monster, result, ctx);
  }
  return result;
}

export function badgeOnAfterHeal(monster: PlacedMonster, ctx: BadgeContext): void {
  for (const badge of getMonsterBadges(monster)) {
    badge.onAfterHeal(monster, ctx);
  }
}

export function badgeModifyShield(monster: PlacedMonster, layers: number, ctx?: BadgeContext): number {
  let result = layers;
  for (const badge of getMonsterBadges(monster)) {
    result = badge.modifyShield(monster, result, ctx);
  }
  return result;
}

export function badgeGetRangeBonus(monster: PlacedMonster): number {
  let bonus = 0;
  for (const badge of getMonsterBadges(monster)) {
    bonus += badge.getRangeBonus(monster);
  }
  return bonus;
}

export function badgeGetCdSpeedBonus(monster: PlacedMonster): number {
  let bonus = 0;
  for (const badge of getMonsterBadges(monster)) {
    bonus += badge.getCdSpeedBonus(monster);
  }
  return bonus;
}

export function badgeGetAtsMultiplier(monster: PlacedMonster): number {
  let mult = 1.0;
  for (const badge of getMonsterBadges(monster)) {
    mult *= badge.getAtsMultiplier(monster);
  }
  return mult;
}

export function badgeOnSkillCast(monster: PlacedMonster, ctx: BadgeContext): void {
  for (const badge of getMonsterBadges(monster)) {
    badge.onSkillCast(monster, ctx);
  }
}

export function badgeOnAfterDeath(monster: PlacedMonster, ctx?: BadgeContext): void {
  for (const badge of getMonsterBadges(monster)) {
    badge.onAfterDeath(monster, ctx);
  }
}

export function badgeOnTick(monster: PlacedMonster, dt: number, ctx?: BadgeContext): void {
  for (const badge of getMonsterBadges(monster)) {
    badge.onTick(monster, dt, ctx);
  }
}

export function badgeOnBeforeDeath(monster: PlacedMonster, ctx?: BadgeContext): boolean {
  let shouldDie = true;
  for (const badge of getMonsterBadges(monster)) {
    if (!badge.onBeforeDeath(monster, ctx)) {
      shouldDie = false;
    }
  }
  return shouldDie;
}

export function badgeOnApplyStatusEffect(monster: PlacedMonster, effect: { type: string; duration: number }): boolean {
  for (const badge of getMonsterBadges(monster)) {
    if (!badge.onApplyStatusEffect(monster, effect)) {
      return false;
    }
  }
  return true;
}

// ==================== 徽章实现 ====================

// --- Badge 1: 穿透 ---
// 实际逻辑在 BattleSystem 创建弹丸时处理（设置 isPiercing + onHit）
class PiercingBadge extends BaseBadge {
  readonly id = 1;
  readonly name = '穿透';
  readonly desc = '远程攻击穿透敌人，对后续敌人造成70%伤害';
}

// --- Badge 2: 凋零 ---
class WitherBadge extends BaseBadge {
  readonly id = 2;
  readonly name = '凋零';
  readonly desc = '目标附带负面效果数时，普攻伤害增加40%每效果';

  modifyDamage(_m: PlacedMonster, dmg: number, ctx: BadgeContext): number {
    const count = ctx.target?.statusEffects.length ?? 0;
    return count > 0 ? dmg + Math.round(dmg * 0.4 * count) : dmg;
  }
}

// --- Badge 3: 破盾 ---
class ShieldBreakerBadge extends BaseBadge {
  readonly id = 3;
  readonly name = '破盾';
  readonly desc = '伤害增加25%，一下可以直接破掉目标4层护盾';

  modifyDamage(_m: PlacedMonster, dmg: number, ctx: BadgeContext): number {
    ctx.isShieldBreaker = true;
    return Math.round(dmg * 1.25);
  }
}

// --- Badge 4: 元素涌动 ---
class ElementSurgeBadge extends BaseBadge {
  readonly id = 4;
  readonly name = '元素涌动';
  readonly desc = '每次释放技能对目标轮流施加燃烧、寒冷效果';

  private _indexMap = new Map<string, number>();

  onSkillCast(_m: PlacedMonster, ctx: BadgeContext): void {
    const target = ctx.target;
    if (!target || target.isDead) return;
    const key = target.id;
    let idx = this._indexMap.get(key) || 0;
    if (idx % 2 === 0) {
      if (!target.statusEffects.some(e => e.type === 'burn')) {
        target.statusEffects.push({ type: 'burn', duration: 4.0 });
      }
    } else {
      if (!target.statusEffects.some(e => e.type === 'chill')) {
        target.statusEffects.push({ type: 'chill', duration: 5.0 });
        target.ats *= 0.65;
        ctx.battle?.scheduler.schedule(() => {
          if (!target.isDead) target.ats /= 0.65;
        }, 5.0);
      }
    }
    this._indexMap.set(key, idx + 1);
  }
}

// --- Badge 5: 助跑 ---
class RunUpBadge extends BaseBadge {
  readonly id = 5;
  readonly name = '助跑';
  readonly desc = '开局5s内每移动一格增加7点攻击，持续至战斗20s时全部扣除';

  private _state = new Map<string, { lastGx: number; lastGy: number; bonus: number; deducted: boolean }>();

  onStartOfBattle(m: PlacedMonster, _ctx?: BadgeContext): void {
    this._state.set(m.id, { lastGx: m.gridX, lastGy: m.gridY, bonus: 0, deducted: false });
  }

  onTick(m: PlacedMonster, _dt: number, ctx?: BadgeContext): void {
    const s = this._state.get(m.id);
    if (!s) return;
    const elapsed = 40 - (ctx?.battle?.timeLeft ?? 0);
    // 20s 到期一次性扣除
    if (elapsed >= 20 && !s.deducted) {
      m.atk = Math.max(0, m.atk - s.bonus);
      s.deducted = true;
      return;
    }
    if (s.deducted || elapsed > 5) return;
    // 前 5s 检测位移
    const moved = Math.abs(m.gridX - s.lastGx) + Math.abs(m.gridY - s.lastGy);
    if (moved > 0) {
      const gain = moved * 7;
      m.atk += gain;
      s.bonus += gain;
    }
    s.lastGx = m.gridX;
    s.lastGy = m.gridY;
  }
}

// --- Badge 6: 回复光环 ---
class RegenAuraBadge extends BaseBadge {
  readonly id = 6;
  readonly name = '回复光环';
  readonly desc = '每3s回复5%血量，自身受治疗后扩散30%治疗给范围2内队友';

  private _timers = new Map<string, number>();

  onTick(m: PlacedMonster, dt: number, ctx?: BadgeContext): void {
    let t = this._timers.get(m.id) || 0;
    t += dt;
    if (t >= 3) {
      t -= 3;
      const healVal = Math.round(m.maxHp * 0.05);
      ctx?.battle?.applyHeal(m, healVal);
    }
    this._timers.set(m.id, t);
  }

  onAfterHeal(m: PlacedMonster, ctx: BadgeContext): void {
    const battle = ctx.battle;
    if (!battle || !ctx.healAmount) return;
    const spread = Math.round(ctx.healAmount * 0.3);
    if (spread <= 0) return;
    const auraRange = 2 + badgeGetRangeBonus(m);
    const allies = battle._monsters.filter(
      (a: PlacedMonster) => a.team === m.team && !a.isDead && a.id !== m.id
    ).filter((a: PlacedMonster) => {
      const dx = Math.abs(a.gridX - m.gridX);
      const dy = Math.abs(a.gridY - m.gridY);
      return dx + dy <= auraRange;
    });
    for (const ally of allies) {
      battle.applyHeal(ally, spread);
    }
  }
}

// --- Badge 7: 吸血 ---
class LifestealBadge extends BaseBadge {
  readonly id = 7;
  readonly name = '吸血';
  readonly desc = '普通攻击回复血量上限的2%';

  onAfterDealDamage(m: PlacedMonster, ctx: BadgeContext): void {
    ctx.battle?.applyHeal(m, Math.round(m.maxHp * 0.02));
  }
}

// --- Badge 8: 厚皮 ---
class ThickSkinBadge extends BaseBadge {
  readonly id = 8;
  readonly name = '厚皮';
  readonly desc = '最大生命值增加1000';

  onPlace(m: PlacedMonster, _ctx?: BadgeContext): void {
    m.maxHp += 1000;
    m.hp = m.maxHp;
  }
}

// --- Badge 9: 延伸 ---
class ExtensionBadge extends BaseBadge {
  readonly id = 9;
  readonly name = '延伸';
  readonly desc = '怪兽的技能及徽章作用范围增加1格';

  getRangeBonus(_m: PlacedMonster): number {
    return 1;
  }
}

// --- Badge 10: 蓄能 ---
class EnergyChargeBadge extends BaseBadge {
  readonly id = 10;
  readonly name = '蓄能';
  readonly desc = '技能冷却速度加快40%，攻击速度降低25%';

  getCdSpeedBonus(_m: PlacedMonster): number {
    return 0.4;
  }

  getAtsMultiplier(_m: PlacedMonster): number {
    return 0.75;
  }
}

function localGridToScreen(gridX: number, gridY: number): { x: number; y: number } {
  return {
    x: 588 + (gridX + 0.5) * 125.4,
    y: 236 + (gridY + 0.5) * 141.4
  };
}

// --- Badge 11: 预防 ---
class PreventionBadge extends BaseBadge {
  readonly id = 11;
  readonly name = '预防';
  readonly desc = '战斗开始时获得12层护盾';

  onStartOfBattle(m: PlacedMonster, ctx?: BadgeContext): void {
    ctx?.battle?.addShield(m, 12);
  }
}

// --- Badge 12: 结阵守 ---
class PhalanxDefenseBadge extends BaseBadge {
  readonly id = 12;
  readonly name = '结阵守';
  readonly desc = '相邻有友方时，每2.5秒给自己和相邻的队友一格盾';

  private _timers = new Map<string, number>();

  onTick(m: PlacedMonster, dt: number, ctx?: BadgeContext): void {
    const battle = ctx?.battle;
    if (!battle) return;

    let t = this._timers.get(m.id) || 0;
    t += dt;
    if (t >= 2.5) {
      t -= 2.5;

      const neighbors = battle.getAdjacentMonsters(m.gridX, m.gridY);
      const hasAlly = neighbors.some((n: PlacedMonster) => n.team === m.team && !n.isDead);
      if (hasAlly) {
        battle.addShield(m, 1);
        for (const n of neighbors) {
          if (n.team === m.team && !n.isDead) {
            battle.addShield(n, 1);
          }
        }
      }
    }
    this._timers.set(m.id, t);
  }
}

// --- Badge 13: 结阵攻 ---
class PhalanxOffenseBadge extends BaseBadge {
  readonly id = 13;
  readonly name = '结阵攻';
  readonly desc = '相邻有友方时，自己和队友攻击提升30';
}

// --- Badge 14: 独狼守 ---
class LoneWolfDefenseBadge extends BaseBadge {
  readonly id = 14;
  readonly name = '独狼守';
  readonly desc = '周围1格没有友方时，受到的伤害减少35%';
}

// --- Badge 15: 独狼攻 ---
class LoneWolfOffenseBadge extends BaseBadge {
  readonly id = 15;
  readonly name = '独狼攻';
  readonly desc = '周围1格没有友方时，攻击力提升40%';
}

// --- Badge 16: 贤者 ---
class SageBadge extends BaseBadge {
  readonly id = 16;
  readonly name = '贤者';
  readonly desc = '相邻友方的技能冷却速度加快50%';

  getAdjacentCdSpeedBonus(_owner: PlacedMonster, _neighbor: PlacedMonster): number {
    return 0.5;
  }
}

// --- Badge 17: 大厨 ---
class ChefBadge extends BaseBadge {
  readonly id = 17;
  readonly name = '大厨';
  readonly desc = '自身获得的所有治疗效果提升50%';

  modifyHeal(_m: PlacedMonster, amount: number, _ctx?: BadgeContext): number {
    return Math.round(amount * 1.5);
  }
}

// --- Badge 18: 复活 ---
class ResurrectBadge extends BaseBadge {
  readonly id = 18;
  readonly name = '复活';
  readonly desc = '死亡2s后以20%生命值复活（每局限一次）';

  onBeforeDeath(m: PlacedMonster, ctx: BadgeContext): boolean {
    const battle = ctx.battle;
    if (!battle) return true;

    const resKey = `res_${m.id}`;
    if (!battle._attackTimers.has(resKey)) {
      battle._attackTimers.set(resKey, 1);
      (m as any).resurrecting = true;
      battle._gridOccupation[m.gridX][m.gridY] = null; // Clear grid occupation per instruction

      battle.scheduler.schedule(() => {
        if (battle.active) {
          (m as any).resurrecting = false;
          m.isDead = false;
          m.hp = Math.floor(m.maxHp * 0.2);
          
          // Re-occupy in place (ignore overlaps)
          battle._gridOccupation[m.gridX][m.gridY] = m;

          const scrPos = localGridToScreen(m.gridX, m.gridY);
          battle.screenPositions.set(m.id, { ...scrPos });
          battle._targetPositions.set(m.id, { ...scrPos });
        }
      }, 2.0);

      return true; // Allow death triggers (like Gift/Bomb)
    }
    return true;
  }
}

// --- Badge 19: 决斗（空类） ---
class DuelBadge extends BaseBadge {
  readonly id = 19;
  readonly name = '决斗';
  readonly desc = '每次攻击相同目标增加10%伤害，上限50%';
}

// --- Badge 20: 狙击 ---
class SniperBadge extends BaseBadge {
  readonly id = 20;
  readonly name = '狙击';
  readonly desc = '子弹飞行距离超过2格时，每多1格增加20%伤害';

  modifyDamage(m: PlacedMonster, dmg: number, ctx: BadgeContext): number {
    if (m.data.type !== 'ranged' || !ctx.target) return dmg;
    const gDist = Math.sqrt((m.gridX - ctx.target.gridX) ** 2 + (m.gridY - ctx.target.gridY) ** 2);
    if (gDist > 2) {
      return dmg + Math.round(dmg * 0.2 * (gDist - 2));
    }
    return dmg;
  }
}

// --- Badge 21: 反击 ---
class CounterBadge extends BaseBadge {
  readonly id = 21;
  readonly name = '反击';
  readonly desc = '受到伤害后，下一次普通攻击必定暴击';

  private _ready = new Set<string>();

  onAfterTakeDamage(m: PlacedMonster, _ctx: BadgeContext): void {
    this._ready.add(m.id);
  }

  modifyDamage(m: PlacedMonster, dmg: number, _ctx: BadgeContext): number {
    if (this._ready.has(m.id)) {
      this._ready.delete(m.id);
      return Math.round(dmg * 1.5);
    }
    return dmg;
  }
}

// --- Badge 22: 鲁莽 ---
class RecklessBadge extends BaseBadge {
  readonly id = 22;
  readonly name = '鲁莽';
  readonly desc = '普通攻击对自己造成16点伤害，伤害提升16%（持续2s，可叠3次）';

  private _state = new Map<string, { stacks: number; timer: number }>();

  modifyDamage(m: PlacedMonster, dmg: number, _ctx: BadgeContext): number {
    const s = this._state.get(m.id);
    return s ? Math.round(dmg * (1 + s.stacks * 0.16)) : dmg;
  }

  onAfterDealDamage(m: PlacedMonster, ctx: BadgeContext): void {
    ctx.battle?.applyDamage(m, 16, null);
    const s = this._state.get(m.id);
    if (s) {
      s.stacks = Math.min(s.stacks + 1, 3);
      s.timer = 2.0;
    } else {
      this._state.set(m.id, { stacks: 1, timer: 2.0 });
    }
  }

  onTick(m: PlacedMonster, dt: number, _ctx?: BadgeContext): void {
    const s = this._state.get(m.id);
    if (!s || s.stacks === 0) return;
    s.timer -= dt;
    if (s.timer <= 0) {
      s.stacks = 0;
    }
  }
}

// --- Badge 23: 韧性 ---
class TenacityBadge extends BaseBadge {
  readonly id = 23;
  readonly name = '韧性';
  readonly desc = '生命值低于20%时，三次16%回血（24s冷却）';

  private _state = new Map<string, { phase: 'idle' | 'healing' | 'cd'; timer: number; pulse: number }>();

  onStartOfBattle(m: PlacedMonster, _ctx?: BadgeContext): void {
    this._state.set(m.id, { phase: 'idle', timer: 0, pulse: 0 });
  }

  onTick(m: PlacedMonster, dt: number, ctx?: BadgeContext): void {
    const s = this._state.get(m.id);
    if (!s) return;

    if (s.phase === 'healing') {
      s.timer -= dt;
      // 每 1s 一次脉冲，共 3 次
      const targetPulse = 3 - Math.ceil(s.timer);
      if (targetPulse > s.pulse && targetPulse <= 3) {
        s.pulse = targetPulse;
        ctx?.battle?.applyHeal(m, Math.round(m.maxHp * 0.18));
      }
      if (s.timer <= 0) {
        s.phase = 'cd';
        s.timer = 24.0;
      }
    } else if (s.phase === 'cd') {
      s.timer -= dt;
      if (s.timer <= 0) {
        s.phase = 'idle';
        s.timer = 0;
      }
    } else if (s.phase === 'idle' && m.hp > 0 && m.hp < m.maxHp * 0.2) {
      s.phase = 'healing';
      s.timer = 3.0;
      s.pulse = 0;
    }
  }
}

// --- Badge 24: 炸弹 ---
class BombBadge extends BaseBadge {
  readonly id = 24;
  readonly name = '炸弹';
  readonly desc = '开局损失80%生命，死亡时对范围1敌人造成累计受伤害40%的爆炸';

  private _totalDmg = new Map<string, number>();

  onStartOfBattle(m: PlacedMonster, _ctx?: BadgeContext): void {
    const loss = Math.floor(m.hp * 0.8);
    m.hp = Math.max(1, m.hp - loss);
    this._totalDmg.set(m.id, loss);
  }

  onAfterTakeDamage(m: PlacedMonster, ctx: BadgeContext): void {
    const prev = this._totalDmg.get(m.id) || 0;
    this._totalDmg.set(m.id, prev + (ctx.damage || 0));
  }

  onAfterDeath(m: PlacedMonster, ctx?: BadgeContext): void {
    const battle = ctx?.battle;
    if (!battle) return;
    const totalDmg = this._totalDmg.get(m.id) || 0;
    const explosion = Math.round(totalDmg * 0.4);
    const enemies = battle._monsters.filter(
      (e: PlacedMonster) => !e.isDead && e.team !== m.team
    ).filter((e: PlacedMonster) => {
      const dx = Math.abs(e.gridX - m.gridX);
      const dy = Math.abs(e.gridY - m.gridY);
      return dx <= 1 && dy <= 1;
    });
    for (const enemy of enemies) {
      battle.applyDamage(enemy, explosion, null);
    }
  }
}

// --- Badge 25: 中毒 ---
class PoisonBadge extends BaseBadge {
  readonly id = 25;
  readonly name = '中毒';
  readonly desc = '攻击或技能给目标施加中毒效果';

  onAfterDealDamage(_m: PlacedMonster, ctx: BadgeContext): void {
    const target = ctx.target;
    if (!target || target.isDead) return;
    if (!target.statusEffects.some(e => e.type === 'poison')) {
      target.statusEffects.push({ type: 'poison', duration: 4.0 });
    }
  }
}

// --- Badge 26: 丛林之影（空类） ---
class JungleShadowBadge extends BaseBadge {
  readonly id = 26;
  readonly name = '丛林之影';
  readonly desc = '战斗开始隐身3秒，隐身期间必暴击且不被选为目标';
}

// --- Badge 27: 献祭 ---
class SacrificeBadge extends BaseBadge {
  readonly id = 27;
  readonly name = '献祭';
  readonly desc = '免疫所有控制，每2s让周围1格内敌人燃烧流失20血';

  private _timers = new Map<string, number>();

  onApplyStatusEffect(_m: PlacedMonster, effect: any): boolean {
    if (effect.type === 'stun' || effect.type === 'chill') {
      return false;
    }
    return true;
  }

  onTick(m: PlacedMonster, dt: number, ctx?: BadgeContext): void {
    const battle = ctx?.battle;
    if (!battle) return;

    let t = this._timers.get(m.id) || 0;
    t += dt;
    if (t >= 2.0) {
      t -= 2.0;
      battle.applyDamage(m, 16, null, false, false, true);

      const targets = battle.getMonstersInGridRange(m.gridX, m.gridY, 1);
      for (const target of targets) {
        if (!target.isDead && !(target as any).resurrecting) {
          battle.applyStatusEffect(target, { type: 'burn', duration: 4.0 });
        }
      }
    }
    this._timers.set(m.id, t);
  }
}

// --- Badge 28: 加固 ---
class ReinforcementBadge extends BaseBadge {
  readonly id = 28;
  readonly name = '加固';
  readonly desc = '自身获得的所有护盾效果提升50%';

  modifyShield(_m: PlacedMonster, layers: number, _ctx?: BadgeContext): number {
    return Math.round(layers * 1.5);
  }
}

// --- Badge 29: 协同进攻 ---
class CooperativeOffenseBadge extends BaseBadge {
  readonly id = 29;
  readonly name = '协同进攻';
  readonly desc = '与友方怪兽相邻时，攻击速度增加30%';
}

// --- Badge 30: 反应装甲 ---
class ReactiveArmorBadge extends BaseBadge {
  readonly id = 30;
  readonly name = '反应装甲';
  readonly desc = '自身护盾破裂或减少时，对周围1格造成4倍于消耗盾值的伤害';

  onAfterTakeDamage(m: PlacedMonster, ctx: BadgeContext): void {
    const battle = ctx.battle;
    const shieldReduced = ctx.shieldReduced || 0;
    if (!battle || shieldReduced <= 0) return;

    const dmg = shieldReduced * 4;
    const pos = battle.screenPositions.get(m.id);
    if (pos) {
      vfx.addParticle(pos.x, pos.y, 'explosion', 0.4, '#ffffff', 12);
    }

    const enemies = battle.getMonstersInGridRange(m.gridX, m.gridY, 1)
      .filter((e: PlacedMonster) => e.team !== m.team && !e.isDead && !(e as any).resurrecting);
    for (const e of enemies) {
      battle.applyDamage(e, dmg, m);
    }
  }
}

// --- Badge 31: 哨位 ---
class SentryBadge extends BaseBadge {
  readonly id = 31;
  readonly name = '哨位';
  readonly desc = '保持原地不动时每秒增加5%攻击，移动后重置，上限25%';
}

// --- Badge 32: 巫毒 ---
class VoodooBadge extends BaseBadge {
  readonly id = 32;
  readonly name = '巫毒';
  readonly desc = '战斗开始前10秒免疫死亡，每5s将血量强制置为20%';

  private _timers = new Map<string, number>();

  onBeforeDeath(m: PlacedMonster, ctx: BadgeContext): boolean {
    const battle = ctx.battle;
    if (!battle) return true;
    const elapsed = 40 - battle.timeLeft;
    if (elapsed <= 10) {
      m.hp = 1;
      return false;
    }
    return true;
  }

  onTick(m: PlacedMonster, dt: number, _ctx?: BadgeContext): void {
    let t = this._timers.get(m.id) || 0;
    t += dt;
    if (t >= 5.0) {
      t -= 5.0;
      m.hp = Math.floor(m.maxHp * 0.2);
    }
    this._timers.set(m.id, t);
  }
}

// --- Badge 33: 礼物 ---
class GiftBadge extends BaseBadge {
  readonly id = 33;
  readonly name = '礼物';
  readonly desc = '死亡后将自身当前攻击力的30%给予最近的友方';

  onAfterDeath(m: PlacedMonster, ctx?: BadgeContext): void {
    const battle = ctx?.battle;
    if (!battle) return;
    const closestAlly = battle.findClosestAlly(m);
    if (closestAlly) {
      const giftAtk = Math.round(m.atk * 0.3);
      closestAlly.atk += giftAtk;
      const aPos = battle.screenPositions.get(closestAlly.id);
      if (aPos) {
        vfx.addFloatingText(aPos.x, aPos.y, `+${giftAtk} ATK`, '#e5c158');
      }
    }
  }
}

// --- Badge 34: 逆转术 ---
class ReversalBadge extends BaseBadge {
  readonly id = 34;
  readonly name = '逆转术';
  readonly desc = '血量首次低于30%时，将当前HP百分比与最大HP百分比反转';
}

// --- Badge 35: 接力 ---
class RelayBadge extends BaseBadge {
  readonly id = 35;
  readonly name = '接力';
  readonly desc = '死亡时将自身的第一个徽章的效果给予最近的友方';

  onStartOfBattle(m: PlacedMonster, ctx?: BadgeContext): void {
    const battle = ctx?.battle;
    if (!battle) return;

    const firstBadge = m.badges.find(b => b.id !== 35);
    if (!firstBadge) return;

    const neighbors = battle.getAdjacentMonsters(m.gridX, m.gridY);
    const candidates = neighbors.filter((n: PlacedMonster) => 
      n.team === m.team && 
      !n.isDead && 
      n.data.race === m.data.race && 
      !n.badges.some(b => b.id === firstBadge.id)
    );

    if (candidates.length > 0) {
      const recipient = candidates[0];
      recipient.badges.push(firstBadge);
      
      const badgeInstance = getBadge(firstBadge.id);
      if (badgeInstance) {
        badgeInstance.onPlace(recipient, ctx);
        badgeInstance.onStartOfBattle(recipient, ctx);
      }
    }
  }
}

// ==================== 注册所有徽章 ====================

export function registerAllBadges(): void {
  registerBadge(new PiercingBadge());
  registerBadge(new WitherBadge());
  registerBadge(new ShieldBreakerBadge());
  registerBadge(new ElementSurgeBadge());
  registerBadge(new RunUpBadge());
  registerBadge(new RegenAuraBadge());
  registerBadge(new LifestealBadge());
  registerBadge(new ThickSkinBadge());
  registerBadge(new ExtensionBadge());
  registerBadge(new EnergyChargeBadge());
  
  registerBadge(new PreventionBadge());
  registerBadge(new PhalanxDefenseBadge());
  registerBadge(new PhalanxOffenseBadge());
  registerBadge(new LoneWolfDefenseBadge());
  registerBadge(new LoneWolfOffenseBadge());
  registerBadge(new SageBadge());
  registerBadge(new ChefBadge());
  registerBadge(new ResurrectBadge());

  registerBadge(new DuelBadge());
  registerBadge(new SniperBadge());
  registerBadge(new CounterBadge());
  registerBadge(new RecklessBadge());
  registerBadge(new TenacityBadge());
  registerBadge(new BombBadge());
  registerBadge(new PoisonBadge());
  registerBadge(new JungleShadowBadge());

  registerBadge(new SacrificeBadge());
  registerBadge(new ReinforcementBadge());
  registerBadge(new CooperativeOffenseBadge());
  registerBadge(new ReactiveArmorBadge());
  registerBadge(new SentryBadge());
  registerBadge(new VoodooBadge());
  registerBadge(new GiftBadge());
  registerBadge(new ReversalBadge());
  registerBadge(new RelayBadge());
}
