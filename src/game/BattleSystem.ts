import { gameEngine, PlacedMonster } from './GameEngine';
import { vfx, tntImage } from './VfxManager';
import type { Projectile, BoltType } from './VfxManager';
import { BOLT_PROFILES } from './VfxManager';
import { HIT, SKILL, BULLET_OFFSET, STATUS_EFFECT, DEFAULT_BULLET } from './VfxPresets';
import { screenConfig, gridToScreen } from './ScreenConfig';
import { getSkill } from './SkillSystem';
import { GameTickScheduler } from './GameTickScheduler';
import {
  badgeOnPlace, badgeOnStartOfBattle, badgeModifyDamage, badgeModifyIncomingDamage,
  badgeOnAfterDealDamage, badgeOnAfterTakeDamage, badgeModifyHeal, badgeOnAfterHeal,
  badgeModifyShield, badgeGetRangeBonus, badgeGetCdSpeedBonus, badgeGetAtsMultiplier,
  badgeOnSkillCast, badgeOnBeforeDeath, badgeOnAfterDeath, badgeOnTick,
  badgeOnApplyStatusEffect, getMonsterBadges, BadgeContext
} from './BadgeSystem';

// 段式攻击配置（用户可手动调整以下参数）
// count    = 每轮攻击次数
// delay    = 段内攻击间隔(秒)
// panelDiv = 面板攻速除数（面板显示 ats / panelDiv，默认 = count）
// 攻时     = count * delay（每轮攻击总时长，供参考，攻速变化时不变）
// 间隔     = count / ats（两轮之间的冷却，攻速变化时随之改变）
const BURST_CONFIG: Record<number, { count: number; delay: number; panelDiv: number }> = {
  108: { count: 2,  delay: 0.5, panelDiv: 2  },  // 救星骑士   ats=1.00  攻时=1s  间隔=2.00s
  114: { count: 4,  delay: 0.25, panelDiv: 4  },  // 突突突矿工 ats=2.14  攻时=1s  间隔=1.87s
  116: { count: 10, delay: 0.37, panelDiv: 10 },  // 钻头       ats=2.38  攻时=3.7s  间隔=4.20s
  120: { count: 5,  delay: 0.3, panelDiv: 5  },  // 金面猴王   ats=2.50  攻时=1.5s  间隔=2.00s
  122: { count: 5,  delay: 0.2, panelDiv: 5  },  // 丛林猴     ats=2.70  攻时=1s  间隔=1.85s
};

// ==================== 物理/抛物线可调参数 ====================

/** 击退动画速度倍率：1.0=正常, 0.5=慢一半（duration翻倍） */
const KNOCKBACK_SPEED_FACTOR = 0.5;

/** 击退抛物线高度倍率 */
const KNOCKBACK_HEIGHT_FACTOR = 1.0;

/** 冲锋移动速度倍率 */
const CHARGE_SPEED_FACTOR = 1.0;

/** 跃击（救星）峰值高度（px） */
export const LEAP_PEAK_HEIGHT = 500;

/** 跃击（救星）飞行时长（秒） */
export const LEAP_DURATION = 0.6;

/** 投掷（铁甲）峰值高度（px） */
export const THROW_PEAK_HEIGHT = 180;

/** 投掷（铁甲）飞行时长（秒） */
export const THROW_DURATION = 1.0;

/** 碰撞反弹：被投掷怪兽 X 反弹峰值高度（px）≈ 1.5 格 */
const COLLISION_REBOUND_X_HEIGHT = 188;

/** 碰撞反弹：冲锋哥反弹峰值高度（px）≈ 1 格 */
const COLLISION_REBOUND_CHARGE_HEIGHT = 125;

/** 碰撞反弹：水平位移格数范围 [min, max] */
const COLLISION_REBOUND_STRENGTH_MIN = 2;
const COLLISION_REBOUND_STRENGTH_MAX = 3;

export interface KnockbackState {
  startX: number;
  startY: number;
  targetX: number;
  targetY: number;
  totalDuration: number;
  elapsedTime: number;
  peakHeight: number;
}

export interface LeapState {
  startX: number;
  startY: number;
  targetX: number;
  targetY: number;
  totalDuration: number;
  elapsedTime: number;
  peakHeight: number;
  damageOnLanding: number;
  /** 落地时对目标敌人施加击退（敌人id） */
  knockbackTargetId?: string;
  /** 击退方向（1=右，-1=左） */
  knockbackDir?: number;
}

export function isP1Monster(m: PlacedMonster): boolean {
  return m.team === 1;
}

// Re-exported from ScreenConfig for backward compatibility
export { screenConfig, gridToScreen } from './ScreenConfig';

export class BattleSystem {
  private static _instance: BattleSystem | null = null;
  public static get instance(): BattleSystem {
    if (!BattleSystem._instance) {
      BattleSystem._instance = new BattleSystem();
    }
    return BattleSystem._instance;
  }

  public active: boolean = false;
  public timeLeft: number = 40; // 40 seconds combat limit
  private _monsters: PlacedMonster[] = [];
  
  // Real-time grid occupation map
  private _gridOccupation: (PlacedMonster | null)[][] = [];

  // Timers for attack intervals
  private _attackTimers: Map<string, number> = new Map();
  // Cooldown speed multipliers (from badges, e.g. Sage, Sage increases adjacent cd speed)
  private _cdMultipliers: Map<string, number> = new Map();

  // Smooth position tracking for rendering
  public screenPositions: Map<string, { x: number; y: number }> = new Map();
  // Target position for interpolation
  private _targetPositions: Map<string, { x: number; y: number }> = new Map();

  // Knockback animation states
  private _knockbacks: Map<string, KnockbackState> = new Map();
  // Charge animation states (e.g. for rush timing)
  private _chargingMonsters: Map<string, { targetId: string; dir: number; strength: number }> = new Map();

  // Reserved landing cells during knockback/charge to prevent overlap
  private _reservedCells: Map<string, { x: number; y: number }> = new Map();
  // Priest healing links
  private _priestLinks: Map<string, string[]> = new Map();

  // Leap animation states
  private _leaps: Map<string, LeapState> = new Map();
  // Track last damaged friendly monsters for Savior Knight leap targeting
  public _lastDamagedFriendlyIdP1: string | null = null;
  public _lastDamagedFriendlyIdP2: string | null = null;

  // Replay & End-game delay
  private _battleEndingTimer: number = -1;

  public scheduler: GameTickScheduler = new GameTickScheduler();
  public _summonCounter: number = 0;


  private constructor() {
    this.resetGrid();
  }

  private resetGrid(): void {
    this._gridOccupation = Array(11).fill(null).map(() => Array(5).fill(null));
  }

  public startBattle(): void {
    this.active = true;
    this.timeLeft = 40;
    this.resetGrid();
    this._knockbacks.clear();
    this._chargingMonsters.clear();
    this._reservedCells.clear();
    this._priestLinks.clear();
    this._leaps.clear();
    this._lastDamagedFriendlyIdP1 = null;
    this._lastDamagedFriendlyIdP2 = null;
    this._battleEndingTimer = -1;

    this.scheduler.clear();
    this._summonCounter = 0;
    gameEngine.setReplaySeed(gameEngine.currentRound * 1000 + 456);

    // Decoupled projectile tracking visual target provider
    vfx.getTargetPosition = (id) => this.screenPositions.get(id);

    // AABB 子弹体积碰撞检测（仅碰撞敌方单位）
    vfx.bulletCollisionCheck = (x, y, bulletSize = 8, ownerId) => {
      const ownerTeam = ownerId ? this._monsters.find(m => m.id === ownerId)?.team : null;
      const hb = bulletSize / 2;
      const bx1 = x - hb;
      const bx2 = x + hb;
      const by1 = y - hb;
      const by2 = y + hb;

      for (const m of this._monsters) {
        if (m.isDead || (m as any).resurrecting || (m as any).deepStealth) continue;
        // 跳过己方单位（含发射者自身）
        if (ownerTeam !== null && m.team === ownerTeam) continue;
        const pos = this.screenPositions.get(m.id);
        if (!pos) continue;
        // 缩小碰撞盒使判定接近视觉中心
        const hw = (m.data.sw * 0.4) / 2;
        const hh = (m.data.sh * 0.4) / 2;
        
        const mx1 = pos.x - hw;
        const mx2 = pos.x + hw;
        const my1 = pos.y - hh;
        const my2 = pos.y + hh;
        
        if (bx1 <= mx2 && bx2 >= mx1 && by1 <= my2 && by2 >= my1) {
          return m.id;
        }
      }
      return null;
    };
    
    // Copy active board monsters
    this._monsters = gameEngine.boardMonsters.filter(m => !m.isDead);
    
    // Fill grid & apply badge placement
    for (const m of this._monsters) {
      m.hp = m.data.hp;
      m.maxHp = m.data.hp;
      m.atk = m.data.atk;
      m.ats = m.data.ats;
      m.range = m.data.range;
      m.speed = m.data.speed;
      m.shield = 0;
      (m as any).phalanxAtkAdded = 0;
      (m as any).resurrecting = false;
      (m as any).noSprite = false;
      
      // 徽章放置修正（badge 8 厚皮等）
      badgeOnPlace(m, { battle: this, engine: gameEngine });
      // 徽章攻速修正（badge 10 蓄能）
      m.ats *= badgeGetAtsMultiplier(m);

      this._gridOccupation[m.gridX][m.gridY] = m;
      const screenPos = gridToScreen(m.gridX, m.gridY);
      this.screenPositions.set(m.id, { ...screenPos });
      this._targetPositions.set(m.id, { ...screenPos });
      
      // 先攻击再冷却：初始计时器设为攻击间隔，首帧即触发攻击
      const initBurstCount = BURST_CONFIG[m.dbId]?.count || 0;
      const atkInterval = initBurstCount > 0 ? initBurstCount / m.ats : 1 / m.ats;
      this._attackTimers.set(m.id, atkInterval);
      
      m.skillCdProgress = 0;
      (m as any).skillReady = false;
      (m as any).skillAnimationTimeLeft = 0;
      (m as any).deepStealth = false;
      (m as any).burrowing = false;
      (m as any).currentTargetId = undefined;

      // 段式攻击配置
      const burstCfg = BURST_CONFIG[m.dbId];
      (m as any).burstCount = burstCfg ? burstCfg.count : 0;
      (m as any).burstDelay = burstCfg ? burstCfg.delay : 0;
      (m as any).burstAttacksLeft = 0;
      (m as any).burstTimer = 0;
      (m as any).burstTargetId = '';

      m.state = 'idle';
    }

    if (!gameEngine.isReplaying) {
      gameEngine.clearStats();
    }

    // Trigger start-of-battle skills/badges
    this.triggerStartOfBattleEffects();

    // 设置 Badge 6 回复光环（绿色圆圈范围显示）
    this._updateAuraCircles();

    // Check end condition immediately at start in case of empty boards
    this.checkBattleEnd();
  }

  private triggerStartOfBattleEffects(): void {
    for (const m of this._monsters) {
      // 徽章战斗开始效果（badge 11 预防, badge 24 炸弹, badge 32 巫毒 等）
      badgeOnStartOfBattle(m, { battle: this, engine: gameEngine });

      // Try to execute via new Skill Class System (e.g. rush, open_fire, dig, throw, shadow)
      const skillInstance = getSkill(m.data.skill);
      if (skillInstance) {
        skillInstance.onStartOfBattle(m, this);
      }
    }
  }

  private _updateAuraCircles(): void {
    vfx.auraCircles = [];
    for (const m of this._monsters) {
      if (m.isDead || (m as any).resurrecting) continue;
      if (getMonsterBadges(m).some(b => b.id === 6)) {
        const baseRadius = 320;
        const hasExtension = getMonsterBadges(m).some(b => b.id === 9);
        vfx.auraCircles.push({
          monsterId: m.id,
          color: '#5ac54f',
          radius: hasExtension ? baseRadius * 1.3 : baseRadius,
          alpha: 0.35,
        });
      }
    }
  }

  public update(dt: number): void {
    if (!this.active) return;

    this.scheduler.update(dt);

    // Process charging monsters movement in real-time
    this.updateCharges(dt);

    if (this._battleEndingTimer > 0) {
      this._battleEndingTimer -= dt;
      if (this._battleEndingTimer <= 0) {
        this._battleEndingTimer = -1;
        // 延迟结束后重新检查存活，避免飞行弹幕/DoT 导致同归于尽误判
        const p1Alive = this._monsters.some(m => !m.isDead && isP1Monster(m));
        const p2Alive = this._monsters.some(m => !m.isDead && !isP1Monster(m));
        if (p1Alive && p2Alive) return; // 双方都活着，取消结束
        let finalWinner: 1 | 2 | null = null;
        if (!p1Alive && !p2Alive) {
          finalWinner = null;
        } else if (!p1Alive) {
          finalWinner = 2;
        } else {
          finalWinner = 1;
        }
        this.endBattle(finalWinner);
        return;
      }
    } else {
      this.timeLeft -= dt;
      if (this.timeLeft <= 0) {
        this.endBattle(null); // Draw
        return;
      }
    }

    // 0. Update Phalanx Offense (Badge 13) dynamic attack buff
    this.updatePhalanxAtkBuff();
    // 0.1 Update Cooperative Offense (Badge 29) dynamic attack speed buff
    this.updateCooperativeAtsBuff();

    // 1. Process CD multipliers (Sage Badge 16, etc.)
    this.updateCdMultipliers();

    // 2. Update statuses & badge ticks
    this.updateStatusEffects(dt);

    // 3. Entity logic (AI, combat, skills)
    for (const m of this._monsters) {
      if (m.isDead || (m as any).resurrecting) continue;

      // 徽章每帧更新（badge 5 助跑, badge 6 回复光环 等）
      badgeOnTick(m, dt, { battle: this, engine: gameEngine });

      // Update flashTime
      if (m.flashTime && m.flashTime > 0) {
        m.flashTime -= dt;
        if (m.flashTime < 0) m.flashTime = 0;
      }

      // Decrement skillAnimationTimeLeft
      if ((m as any).skillAnimationTimeLeft && (m as any).skillAnimationTimeLeft > 0) {
        (m as any).skillAnimationTimeLeft -= dt;
        m.state = 'skill';
        if ((m as any).skillAnimationTimeLeft < 0) {
          (m as any).skillAnimationTimeLeft = 0;
          m.state = 'idle';
        }
      }

      // Decrement skill rotation timer（肃清哥旋转）
      if ((m as any)._rotationRemaining > 0) {
        (m as any)._rotationRemaining -= dt;
        m.state = 'skill';
      }

      // Smooth position interpolation must run BEFORE stun check so leaps/knockbacks update visually
      this.interpolatePosition(m, dt);

      // Check stun, cannon charging, active skill animation lock, digging, or leaping
      if (
        m.statusEffects.some(e => e.type === 'stun') || 
        (m as any).chargingCannon ||
        ((m as any).skillAnimationTimeLeft && (m as any).skillAnimationTimeLeft > 0) ||
        (m as any).burrowing ||
        this._leaps.has(m.id)
      ) {
        if ((m as any).chargingCannon) {
          m.state = 'skill';
        } else if (m.statusEffects.some(e => e.type === 'stun')) {
          m.state = 'idle';
        } else if ((m as any).burrowing) {
          m.state = 'skill';
        }
        continue;
      }

      if (this._battleEndingTimer > 0) {
        continue; // Skip combat actions during ending phase
      }

      // Attack logic timer progress
      let atkTimer = this._attackTimers.get(m.id) || 0;
      atkTimer += dt;
      this._attackTimers.set(m.id, atkTimer);

      // Cooldown progress for skill
      const cdSpeed = this._cdMultipliers.get(m.id) || 1.0;
      m.skillCdProgress += dt * cdSpeed;

      let actedThisFrame = false;
      const burstCount = (m as any).burstCount || 0;
      const interval = burstCount > 0 ? burstCount / m.ats : 1 / m.ats;

      if ((m as any).burstAttacksLeft > 0) {
        // 段内连发（不中断，继续射完）
        (m as any).burstTimer += dt;
        while ((m as any).burstTimer >= (m as any).burstDelay && (m as any).burstAttacksLeft > 0) {
          (m as any).burstTimer -= (m as any).burstDelay;
          const lockedTarget = this._monsters.find(
            e => e.id === (m as any).burstTargetId && !e.isDead && !(e as any).resurrecting
          );
          if (lockedTarget) {
            const prevTarget = (m as any).currentTargetId;
            (m as any).currentTargetId = (m as any).burstTargetId;
            this.performNormalAttack(m);
            (m as any).currentTargetId = prevTarget;
            actedThisFrame = true;
            m.state = 'attack';
          }
          (m as any).burstAttacksLeft--;
        }
        if ((m as any).burstAttacksLeft === 0) {
          (m as any).burstTargetId = '';
          this._attackTimers.set(m.id, 0);
        }
      } else if (atkTimer >= interval) {
        // 冷却到期：先尝试技能，再普攻
        if (m.data.skillCd > 0 && m.skillCdProgress >= m.data.skillCd) {
          const casted = this.castSkill(m);
          if (casted) {
            m.skillCdProgress = 0;
            // 技能后保留攻击冷却进度，动画结束后立即攻击
            this._attackTimers.set(m.id, interval);
            actedThisFrame = true;

            let animDur = 1 / m.ats;
            if (m.data.skill === 'shield' || m.data.skill === 'shot' || m.data.skill === 'shadow') {
              animDur = 0.2;
              if (m.data.skill === 'shadow') (m as any)._tiltTotal = animDur;
            } else if (m.data.skill === 'life_link') {
              animDur = 0.25;
            } else if (m.data.skill === 'heal_sword') {
              animDur = 1.0;
            } else if (m.data.skill === 'unyielding') {
              animDur = 0.3;
            } else if (m.data.skill === 'attack' || m.data.skill === 'cultivation' || m.data.skill === 'anger' || m.data.skill === 'conversion') {
              animDur = 0;
            }
            if (animDur > 0) {
              (m as any).skillAnimationTimeLeft = animDur;
              m.state = 'skill';
            }

            const pos = this.screenPositions.get(m.id);
            if (pos) {
              vfx.spawnParticle(pos.x - 24, pos.y - 24, SKILL.cooldownReady.star);
            }
          }
        }

        // 技能没触发，尝试普攻
        if (!actedThisFrame) {
          if (burstCount > 0) {
            const target = this.findClosestEnemy(m, true);
            if (target) {
              (m as any).burstTargetId = target.id;
              (m as any).burstAttacksLeft = burstCount;
              (m as any).burstTimer = 0;
              const prevTarget = (m as any).currentTargetId;
              (m as any).currentTargetId = target.id;
              this.performNormalAttack(m);
              (m as any).currentTargetId = prevTarget;
              (m as any).burstAttacksLeft--;
              actedThisFrame = true;
              m.state = 'attack';
            }
          } else {
            const attacked = this.performNormalAttack(m);
            if (attacked) {
              this._attackTimers.set(m.id, 0);
              actedThisFrame = true;
              m.state = 'attack';
            }
          }
        }
      }

      // 本帧没有动作：移动 AI
      if (!actedThisFrame) {
        this.performMovementAI(m, dt);
      }
    }

    // Check end condition
    this.checkBattleEnd();
  }

  private updateCooperativeAtsBuff(): void {
    for (const m of this._monsters) {
      if (m.isDead || (m as any).resurrecting) {
        const added = (m as any).cooperativeAtsAdded || 0;
        if (added > 0) {
          m.ats /= 1.3;
          (m as any).cooperativeAtsAdded = 0;
        }
        continue;
      }
      const neighbors = this.getAdjacentMonsters(m.gridX, m.gridY);
      const hasAlly = neighbors.some(n => n.team === m.team && !n.isDead && !(n as any).resurrecting);
      const has29 = getMonsterBadges(m).some(b => b.id === 29);
      
      const shouldHave = hasAlly && has29;
      const current = (m as any).cooperativeAtsAdded || 0;
      
      if (shouldHave && current === 0) {
        m.ats *= 1.3;
        (m as any).cooperativeAtsAdded = 1;
      } else if (!shouldHave && current > 0) {
        m.ats /= 1.3;
        (m as any).cooperativeAtsAdded = 0;
      }
    }
  }

  private updatePhalanxAtkBuff(): void {
    for (const m of this._monsters) {
      if (m.isDead || (m as any).resurrecting) {
        const currentAdded = (m as any).phalanxAtkAdded || 0;
        if (currentAdded > 0) {
          m.atk = Math.max(0, m.atk - currentAdded);
          (m as any).phalanxAtkAdded = 0;
        }
        continue;
      }
      const neighbors = this.getAdjacentMonsters(m.gridX, m.gridY);
      const hasAlly = neighbors.some(n => n.team === m.team && !n.isDead && !(n as any).resurrecting);
      let targetBonus = 0;
      if (hasAlly) {
        const selfHas13 = getMonsterBadges(m).some(b => b.id === 13);
        const neighborHas13 = neighbors.some(n => n.team === m.team && !n.isDead && !(n as any).resurrecting && getMonsterBadges(n).some(b => b.id === 13));
        if (selfHas13 || neighborHas13) {
          targetBonus = 30;
        }
      }

      const currentAdded = (m as any).phalanxAtkAdded || 0;
      if (currentAdded !== targetBonus) {
        m.atk = m.atk - currentAdded + targetBonus;
        (m as any).phalanxAtkAdded = targetBonus;
      }
    }
  }

  private updateCdMultipliers(): void {
    this._cdMultipliers.clear();
    for (const m of this._monsters) {
      if (m.isDead || (m as any).resurrecting) continue;

      // Badge CD Speed neighbors (e.g. Sage Badge 16)
      const neighbors = this.getAdjacentMonsters(m.gridX, m.gridY);
      let totalMult = 1.0 + badgeGetCdSpeedBonus(m);
      for (const n of neighbors) {
        if (isP1Monster(n) === isP1Monster(m)) {
          for (const badge of getMonsterBadges(n)) {
            totalMult += badge.getAdjacentCdSpeedBonus(n, m);
          }
        }
      }
      // 冰冻效果：技能冷却速度降低 30%
      if (m.statusEffects.some(e => e.type === 'freeze')) {
        totalMult *= 0.7;
      }
      this._cdMultipliers.set(m.id, totalMult);
    }
  }

  private updateStatusEffects(dt: number): void {
    for (const m of this._monsters) {
      if (m.isDead || (m as any).resurrecting) continue;
      for (let i = m.statusEffects.length - 1; i >= 0; i--) {
        const effect = m.statusEffects[i];
        effect.duration -= dt;

        // Apply damage-over-time ticks at 1-second intervals using a timer accumulator
        if (effect.type === 'poison' || effect.type === 'bleed' || effect.type === 'burn') {
          if (effect.tickTimer === undefined) {
            effect.tickTimer = 0;
          }
          effect.tickTimer += dt;

          if (effect.tickTimer >= 1.0) {
            let tickDmg = 0;
            if (effect.type === 'poison') {
              tickDmg = 15; // Poison: 15 dmg/s
            } else if (effect.type === 'bleed') {
              tickDmg = Math.round(m.maxHp * 0.02); // 2% max HP per second
            } else if (effect.type === 'burn') {
              tickDmg = 20; // Burn: 20 dmg/s
            }

            const ticks = Math.floor(effect.tickTimer);
            this.applyDamage(m, tickDmg * ticks, null, { bypassesShield: true });

            // If burn, also deal damage to all adjacent targets
            if (effect.type === 'burn') {
              const neighbors = this.getAdjacentMonsters(m.gridX, m.gridY);
              for (const n of neighbors) {
                if (!n.isDead && !(n as any).resurrecting) {
                  this.applyDamage(n, tickDmg * ticks, null, { bypassesShield: true });
                }
              }
            }

            effect.tickTimer -= ticks;
          }
        }

        // 燃烧 VFX：定时器每 0.35s 生成火焰粒子（减慢频率）
        if (effect.type === 'burn') {
          if ((effect as any)._vfxTimer === undefined) {
            (effect as any)._vfxTimer = 0;
          }
          (effect as any)._vfxTimer += dt;
          if ((effect as any)._vfxTimer >= 0.35) {
            (effect as any)._vfxTimer -= 0.35;
            const pos = this.screenPositions.get(m.id);
            if (pos) {
              for (let fi = 0; fi < 10; fi++) {
                vfx.spawnParticle(pos.x, pos.y, STATUS_EFFECT.burnFire);
              }
              for (let ei = 0; ei < 4; ei++) {
                vfx.spawnParticle(pos.x, pos.y, STATUS_EFFECT.burnEmber);
              }
            }
          }
        }

        // 寒冷状态 VFX：每 0.4s 生成寒雾（低频率避免雾气叠加遮住人物）
        if (effect.type === 'chill') {
          if ((effect as any)._vfxTimer === undefined) {
            (effect as any)._vfxTimer = 0;
          }
          (effect as any)._vfxTimer += dt;
          if ((effect as any)._vfxTimer >= 0.4) {
            (effect as any)._vfxTimer -= 0.4;
            const pos = this.screenPositions.get(m.id);
            if (pos) {
              vfx.spawnParticle(pos.x, pos.y, STATUS_EFFECT.chillHaze);
            }
          }
        }

        // 冰冻状态 VFX：每 0.4s 生成冰晶
        if (effect.type === 'freeze') {
          if ((effect as any)._vfxTimer === undefined) {
            (effect as any)._vfxTimer = 0;
          }
          (effect as any)._vfxTimer += dt;
          if ((effect as any)._vfxTimer >= 0.4) {
            (effect as any)._vfxTimer -= 0.4;
            const pos = this.screenPositions.get(m.id);
            if (pos) {
              for (let ci = 0; ci < 4; ci++) {
                vfx.spawnParticle(pos.x, pos.y, STATUS_EFFECT.chillCrystal);
              }
            }
          }
        }

        if (effect.duration <= 0) {
          m.statusEffects.splice(i, 1);
        }
      }
    }
  }

  private interpolatePosition(m: PlacedMonster, dt: number): void {
    // 0. Handle Savior Knight leap visually with parabolic jump formula
    const lp = this._leaps.get(m.id);
    if (lp) {
      lp.elapsedTime += dt;
      const t = Math.min(1.0, lp.elapsedTime / lp.totalDuration);
      
      const sPos = this.screenPositions.get(m.id);
      if (sPos) {
        sPos.x = lp.startX + (lp.targetX - lp.startX) * t;
        sPos.y = lp.startY + (lp.targetY - lp.startY) * t;
        
        // Add parabolic height to Y: height = 4 * H * t * (1 - t)
        const h = 4 * lp.peakHeight * t * (1 - t);
        sPos.y -= h;
      }
      
      if (t >= 1.0) {
        this._leaps.delete(m.id);
        
        // Write logic coordinates after landing!
        const dest = this._reservedCells.get(m.id);
        let splashTargets: PlacedMonster[] = [];
        if (dest) {
          this._reservedCells.delete(m.id);
          this._gridOccupation[m.gridX][m.gridY] = null;

          // Capture enemies for splash damage BEFORE pushing occupant
          splashTargets = this.getAdjacentMonsters(dest.x, dest.y)
            .filter(e => isP1Monster(e) !== isP1Monster(m));

          const other = this._gridOccupation[dest.x][dest.y];
          if (other && other.id !== m.id) {
            const emptyCell = this.findNearestEmptyCell(dest.x, dest.y);
            if (emptyCell) {
              this._gridOccupation[dest.x][dest.y] = null;
              other.gridX = emptyCell.gridX;
              other.gridY = emptyCell.gridY;
              this._gridOccupation[emptyCell.gridX][emptyCell.gridY] = other;
              
              const otherScreenPos = gridToScreen(emptyCell.gridX, emptyCell.gridY);
              this.screenPositions.set(other.id, { ...otherScreenPos });
              this._targetPositions.set(other.id, { ...otherScreenPos });
            }
          }

          m.gridX = dest.x;
          m.gridY = dest.y;
          this._gridOccupation[m.gridX][m.gridY] = m;

          const landPos = this.screenPositions.get(m.id) || gridToScreen(dest.x, dest.y);
          // 着陆：冲击环 + 碎石在背景层，尘土在前景层
          const ly = landPos.y + 70;
          vfx.spawnBackgroundParticle(landPos.x, ly, SKILL.leap.ring);
          this.scheduler.schedule(() => {
            if (this.active) vfx.spawnBackgroundParticle(landPos.x, ly, SKILL.leap.ring);
          }, 0.18);
          this.scheduler.schedule(() => {
            if (this.active) vfx.spawnBackgroundParticle(landPos.x, ly, SKILL.leap.ring);
          }, 0.36);
          vfx.spawnBackgroundParticle(landPos.x, ly, SKILL.leap.debris);
          for (let i = 0; i < 12; i++) {
            const dx = (Math.random() - 0.5) * 180;
            const dy = (Math.random() - 0.5) * 100;
            vfx.spawnParticle(landPos.x + dx, ly + dy, SKILL.leap.dust);
          }
        }
        
        // Apply landing range 1 damage to enemies (captured before push)
        for (const e of splashTargets) {
          this.applyDamage(e, lp.damageOnLanding, m);
          // 救星骑士：70% 造成 2s 眩晕
          if (m.dbId === 108 && gameEngine.random() < 0.7) {
            this.applyStatusEffect(e, { type: 'stun', duration: 2.0 });
          }
        }

        // 落地时对指定敌人施加击退
        if (lp.knockbackTargetId && lp.knockbackDir !== undefined) {
          const kbTarget = this._monsters.find(e => e.id === lp.knockbackTargetId);
          if (kbTarget && !kbTarget.isDead) {
            this.applyKnockback(kbTarget, lp.knockbackDir, 0, 1);
          }
        }
      }
      return;
    }

    // Skip normal interpolation if this monster is charging visually
    if (this._chargingMonsters.has(m.id)) {
      return;
    }

    // 1. If currently in a knockback state, handle it with parabolic formula
    const kb = this._knockbacks.get(m.id);
    if (kb) {
      kb.elapsedTime += dt;
      const t = Math.min(1.0, kb.elapsedTime / kb.totalDuration);
      
      const sPos = this.screenPositions.get(m.id);
      if (sPos) {
        sPos.x = kb.startX + (kb.targetX - kb.startX) * t;
        sPos.y = kb.startY + (kb.targetY - kb.startY) * t;
        
        // Add parabolic height to Y: height = 4 * H * t * (1 - t)
        const h = 4 * kb.peakHeight * t * (1 - t);
        sPos.y -= h;
      }
      
      if (t >= 1.0) {
        this._knockbacks.delete(m.id);
        
        // Delayed logical coordinate write-back ONLY upon parabolic arrival!
        const dest = this._reservedCells.get(m.id);
        if (dest) {
          this._reservedCells.delete(m.id);
          this._gridOccupation[m.gridX][m.gridY] = null;
          m.gridX = dest.x;
          m.gridY = dest.y;
          this._gridOccupation[m.gridX][m.gridY] = m;
        }
      }
      return;
    }

    const sPos = this.screenPositions.get(m.id);
    const tPos = this._targetPositions.get(m.id);
    if (sPos && tPos) {
      const dx = tPos.x - sPos.x;
      const dy = tPos.y - sPos.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      let speed = m.speed * screenConfig.cellW; // Smooth speed (halved)
      if ((m as any).burrowing) {
        speed *= 2;
      }
      if (m.statusEffects.some(e => e.type === 'stun' && e.duration > 1.0)) {
        speed *= 3;
      }
      if (dist < speed * dt) {
        sPos.x = tPos.x;
        sPos.y = tPos.y;
        
        if ((m as any).burrowing) {
          (m as any).burrowing = false;
          (m as any).deepStealth = false;
          const destX = (m as any).burrowDestX;
          const destY = (m as any).burrowDestY;

          if (destX !== undefined && destY !== undefined) {
            // 出土：给自己6盾
            this.addShield(m, 6);

            // 检测落点是否有敌人
            const occupant = this._gridOccupation[destX][destY];
            if (occupant && isP1Monster(occupant) !== isP1Monster(m)) {
              // 挤开敌人
              const pushDir = isP1Monster(m) ? 1 : -1;
              this.applyKnockback(occupant, pushDir, 0, 1);
              // 2s眩晕
              this.applyStatusEffect(occupant, { type: 'stun', duration: 2.0 });
              const ePos = this.screenPositions.get(occupant.id);
              if (ePos) {
                vfx.spawnParticle(ePos.x, ePos.y, HIT.chargeHit);
              }
            }

            // 出土占位
            m.gridX = destX;
            m.gridY = destY;
            this._gridOccupation[destX][destY] = m;

            // 出土动画：冲击波环 + 碎石 + 尘土（复用 SKILL.leap 预设）
            const emergePos = gridToScreen(destX, destY);
            const ey = emergePos.y + 40;
            vfx.spawnBackgroundParticle(emergePos.x, ey, SKILL.leap.ring);
            vfx.spawnBackgroundParticle(emergePos.x, ey, SKILL.leap.debris);
            for (let i = 0; i < 8; i++) {
              const dx = (Math.random() - 0.5) * 140;
              const dy = (Math.random() - 0.5) * 70;
              vfx.spawnParticle(emergePos.x + dx, ey + dy, SKILL.leap.dust);
            }
          }

          // 清空索敌，恢复正常攻击
          (m as any).currentTargetId = undefined;
          m.state = 'idle';
        }
      } else {
        sPos.x += (dx / dist) * speed * dt;
        sPos.y += (dy / dist) * speed * dt;
      }
    }
  }

  /** 初始化穿透弹公共属性 */
  private setupPiercingProjectile(pr: Projectile, ownerId: string, onHit?: (hitId: string) => void): void {
    pr.ownerId = ownerId;
    pr.isPiercing = true;
    pr.hitTargetIds = new Set<string>();
    if (onHit) pr.onHit = onHit;
  }

  private performNormalAttack(m: PlacedMonster): boolean {
    const target = this.findClosestEnemy(m, true);
    if (!target) return false;

    // Check range
    if (!this.isInAttackRange(m, target)) return false;

    // Perform attack
    const pos = this.screenPositions.get(m.id)!;
    const tPos = this.screenPositions.get(target.id)!;

    // Badge 1 穿透：远程弹丸设为穿透模式
    const isPiercing = m.data.type === 'ranged' && getMonsterBadges(m).some(b => b.id === 1);

    // 怪兽子弹类型映射
    const unitBoltMap: Record<number, string> = { 102: 'lightning', 103: 'fire', 105: 'heal', 107: 'void' };
    const boltType = unitBoltMap[m.dbId] as BoltType | undefined;

    if (m.data.type === 'ranged') {
      if (m.dbId === 104) {
        // Shotgun: 5 projectiles in 90-degree fan
        const angle = Math.atan2(tPos.y - pos.y, tPos.x - pos.x);
        const dist = Math.sqrt((tPos.x - pos.x) ** 2 + (tPos.y - pos.y) ** 2);
        const angles = [-Math.PI / 4, -Math.PI / 8, 0, Math.PI / 8, Math.PI / 4];
        
        angles.forEach((offset, idx) => {
          const a = angle + offset;
          const isCenter = idx === 2;

          if (isPiercing) {
            const extX = pos.x + Math.cos(a) * (dist + 2500);
            const extY = pos.y + Math.sin(a) * (dist + 2500);
            const pr = vfx.addProjectile(pos.x, pos.y, extX, extY, DEFAULT_BULLET.speed, DEFAULT_BULLET.color, () => {}, undefined, undefined, undefined, m.id);
            vfx.applyBulletSprite(pr, m.dbId);
            if (isCenter) {
              this.setupPiercingProjectile(pr, m.id, (hitId: string) => {
                const ht = this._monsters.find(e => e.id === hitId);
                if (ht) this.dealDamageImpact(m, ht);
              });
            }
          } else {
            const extX = pos.x + Math.cos(a) * 2500;
            const extY = pos.y + Math.sin(a) * 2500;
            const pr = vfx.addProjectile(pos.x, pos.y, extX, extY, DEFAULT_BULLET.speed, DEFAULT_BULLET.color, () => {}, undefined, boltType, undefined, m.id);
            vfx.applyBulletSprite(pr, m.dbId);
            if (isCenter) {
              pr.onHit = (hitId: string) => {
                const ht = this._monsters.find(e => e.id === hitId);
                if (ht) this.dealDamageImpact(m, ht);
              };
            }
          }
        });
      } else {
        // Standard ranged — 子弹不追踪，延伸直线飞行直到碰撞才销毁
        // 计算方向向量
        const dX = tPos.x - pos.x;
        const dY = tPos.y - pos.y;
        const dirLen = Math.sqrt(dX * dX + dY * dY);
        const nX = dX / dirLen;
        const nY = dY / dirLen;
        const extX = pos.x + nX * 2500;
        const extY = pos.y + nY * 2500;

        if (isPiercing) {
          const pr = vfx.addProjectile(pos.x, pos.y, extX, extY, DEFAULT_BULLET.speed, DEFAULT_BULLET.color, () => {}, undefined, boltType, undefined, m.id);
          this.setupPiercingProjectile(pr, m.id, (hitId: string) => {
            const ht = this._monsters.find(e => e.id === hitId);
            if (ht) this.dealDamageImpact(m, ht);
          });
          vfx.applyBulletSprite(pr, m.dbId);
        } else {
          const isExplosive = m.data.skill === 'explosive';
          const isSnowball = m.data.skill === 'snowball';

          if (isSnowball) {
            vfx.spawnParticle(pos.x, pos.y, SKILL.snowballAttack.launch);
          }

          let pr: Projectile;
          if (isExplosive) {
            const cfg = SKILL.explosiveAttack.projectile;
            const destPos = gridToScreen(target.gridX, target.gridY);
            const destGridX = target.gridX;
            const destGridY = target.gridY;
            pr = vfx.addProjectile(pos.x, pos.y, destPos.x, destPos.y, cfg.speed, cfg.color, () => {
              const occupant = this._gridOccupation[destGridX]?.[destGridY];
              if (occupant && !occupant.isDead && isP1Monster(occupant) !== isP1Monster(m)) {
                this.dealDamageImpact(m, occupant);
              }
            }, undefined, undefined, cfg.arcHeight, m.id);
            if (cfg.size) pr.size = cfg.size;
            // 使用 tnt.png 贴图
            const tntW = tntImage.naturalWidth || tntImage.width || 32;
            const tntH = tntImage.naturalHeight || tntImage.height || 32;
            pr.imageRect = { img: tntImage, sx: 0, sy: 0, sw: tntW, sh: tntH, dw: cfg.size || 16, dh: (cfg.size || 16) * tntH / tntW };
          } else if (isSnowball) {
            const cfg = SKILL.snowballAttack.projectile;
            const destPos = gridToScreen(target.gridX, target.gridY);
            const destGridX = target.gridX;
            const destGridY = target.gridY;
            pr = vfx.addProjectile(pos.x, pos.y, destPos.x, destPos.y, cfg.speed, cfg.color, () => {
              const occupant = this._gridOccupation[destGridX]?.[destGridY];
              if (occupant && !occupant.isDead && isP1Monster(occupant) !== isP1Monster(m)) {
                const tScr = gridToScreen(occupant.gridX, occupant.gridY);
                vfx.spawnParticle(tScr.x, tScr.y, HIT.snowballAttack);
                this.dealDamageImpact(m, occupant);
              }
            }, undefined, undefined, cfg.arcHeight, m.id);
          } else if (boltType) {
            const cfg = BOLT_PROFILES[boltType];
            pr = vfx.addProjectile(pos.x, pos.y, extX, extY, cfg.speed, cfg.color, () => {}, undefined, boltType, undefined, m.id);
            pr.onHit = (hitId: string) => {
              const ht = this._monsters.find(e => e.id === hitId);
              if (ht) this.dealDamageImpact(m, ht);
            };
          } else if ((m as any).empoweredShot) {
            // 银狙骑士强化射击：金色子弹 + 流线型拖尾（不追踪，固定弹道）
            const cfg = BOLT_PROFILES['empowered'];
            pr = vfx.addProjectile(pos.x, pos.y, extX, extY, cfg.speed, cfg.color, () => {}, undefined, 'empowered', undefined, m.id);
            pr.onHit = (hitId: string) => {
              const ht = this._monsters.find(e => e.id === hitId);
              if (ht) this.dealDamageImpact(m, ht);
            };
            vfx.applyBulletSprite(pr, m.dbId);
          } else {
            // 发射位置偏移
            const offset = BULLET_OFFSET[m.dbId] || { dx: 0, dy: 0 };
            const sx = pos.x + offset.dx;
            const sy = pos.y + offset.dy;
            // 角度微小偏移（±5°）
            const baseAngle = Math.atan2(tPos.y - sy, tPos.x - sx);
            const spreadAngle = baseAngle + (gameEngine.random() - 0.5) * (Math.PI / 36);
            const spreadExtX = sx + Math.cos(spreadAngle) * 2500;
            const spreadExtY = sy + Math.sin(spreadAngle) * 2500;
            pr = vfx.addProjectile(sx, sy, spreadExtX, spreadExtY, DEFAULT_BULLET.speed, DEFAULT_BULLET.color, () => {}, undefined, undefined, undefined, m.id);
            pr.onHit = (hitId: string) => {
              const ht = this._monsters.find(e => e.id === hitId);
              if (ht) this.dealDamageImpact(m, ht);
            };
            vfx.applyBulletSprite(pr, m.dbId);
          }
        }
      }
    } else {
      // Melee slash particle
      const angle = Math.atan2(tPos.y - pos.y, tPos.x - pos.x);
      vfx.spawnParticle((pos.x + tPos.x)/2, (pos.y + tPos.y)/2, HIT.meleeSlash, { angle, length: 24 });
      this.dealDamageImpact(m, target);
    }

    return true;
  }

  private dealDamageImpact(attacker: PlacedMonster, target: PlacedMonster): void {
    if (!this.active || target.isDead) return;

    let dmg = attacker.atk;

    // Apply Silver Sniper (109: shot) empowered shot logic
    if ((attacker as any).empoweredShot) {
      (attacker as any).empoweredShot = false;
      const targetHpPercent = target.hp / target.maxHp;
      const mult = targetHpPercent > 0.8 ? 5 : 4;
      dmg = Math.round(attacker.atk * mult);
      (attacker as any).empoweredShotLast = true;
    }

    // Apply damage — 银狙技能暴击 50%
    const sniperCrit = (attacker as any).empoweredShotLast && gameEngine.random() < 0.5;
    this.applyDamage(target, dmg, attacker, { forceCrit: sniperCrit });
    if ((attacker as any).empoweredShotLast) {
      (attacker as any).empoweredShotLast = false;
    }

    if (attacker.data.skill === 'explosive') {
      // 矿爆命中效果（kuangbao风格，2x放大）
      const tPos = this.screenPositions.get(target.id);
      if (tPos) {
        // Phase 1: 核心闪光（径向渐变，白→黄→橙，爆发后消退）
        vfx.addParticle(tPos.x, tPos.y, 'blast_core', 0.36, '#ffffff', 100);

        // Phase 2: 火焰粒子（28个，从中心径向扩散，颜色从白黄→橙→暗红）
        for (let i = 0; i < 28; i++) {
          vfx.addParticle(tPos.x, tPos.y, 'blast_flame', 0.7 + Math.random() * 0.4, '#ff6600', 10 + Math.random() * 12);
        }

        // Phase 3: 烟雾粒子（22个，延迟0.6s后生成，膨胀上浮加深）
        this.scheduler.schedule(() => {
          const sp = this.screenPositions.get(target.id);
          if (!sp) return;
          for (let i = 0; i < 22; i++) {
            vfx.addParticle(sp.x, sp.y, 'blast_smoke', 0.4 + Math.random() * 0.4, '#444444', 18 + Math.random() * 18);
          }
        }, 0.4);
      }
      // 溅射目标
      const splashTargets = this.getMonstersInGridRange(target.gridX, target.gridY, 1)
        .filter(e => isP1Monster(e) !== isP1Monster(attacker) && e.id !== target.id)
        .filter(e => Math.abs(e.gridX - target.gridX) + Math.abs(e.gridY - target.gridY) === 1);
      for (const st of splashTargets) {
        this.applyDamage(st, dmg, attacker);
        const stPos = this.screenPositions.get(st.id);
        if (stPos) {
          vfx.spawnParticle(stPos.x, stPos.y, HIT.explosiveSplash);
        }
      }
    }

    // ID 124 Strikeout King chill effect on basic attacks
    if (attacker.data.id === 124) {
      this.applyChill(target, 2.0);
    }

    // Apply Priest (祈祷哥) heal links
    const linkedIds = this._priestLinks.get(attacker.id);
    if (linkedIds) {
      const healAmount = Math.round(attacker.maxHp * 0.02);
      this.applyHealWithChefBonus(attacker, attacker, healAmount, this);
      // VFX on caster（祈祷哥自身）
      const cP = this.screenPositions.get(attacker.id);
      if (cP) {
        for (let i = 0; i < 5; i++) vfx.spawnParticle(cP.x, cP.y, SKILL.recovery.healPuff);
        vfx.spawnParticle(cP.x, cP.y, SKILL.recovery.healCross);
        vfx.spawnParticle(cP.x, cP.y, SKILL.recovery.healCross);
      }
      for (const id of linkedIds) {
        const ally = this._monsters.find(x => x.id === id);
        if (ally && !ally.isDead) {
          this.applyHealWithChefBonus(attacker, ally, healAmount, this);
          // VFX on ally（圆形光点 + 圆角十字，向上飘散渐出）
          const aPos = this.screenPositions.get(ally.id);
          if (aPos) {
            for (let i = 0; i < 5; i++) vfx.spawnParticle(aPos.x, aPos.y, SKILL.recovery.healPuff);
            vfx.spawnParticle(aPos.x, aPos.y, SKILL.recovery.healCross);
            vfx.spawnParticle(aPos.x, aPos.y, SKILL.recovery.healCross);
          }
        }
      }
    }
  }

  public applyDamage(target: PlacedMonster, amount: number, attacker: PlacedMonster | null, options?: { isShieldBreaker?: boolean; forceCrit?: boolean; bypassesShield?: boolean }): void {
    if (!this.active || target.isDead) return;

    let finalDmg = amount;
    let isShieldBreaker = options?.isShieldBreaker ?? false;
    let ctxForceCrit = false;
    const forceCrit = options?.forceCrit ?? false;
    const bypassesShield = options?.bypassesShield ?? false;

    // --- Badge System: Attacker Modifier ---
    if (attacker) {
      const dmgCtx: BadgeContext = { attacker, target, damage: finalDmg, battle: this, engine: gameEngine };
      finalDmg = badgeModifyDamage(attacker, finalDmg, dmgCtx);
      isShieldBreaker = isShieldBreaker || !!dmgCtx.isShieldBreaker;
      ctxForceCrit = ctxForceCrit || !!dmgCtx.isCrit;
    }

    // 1. 徽章减伤（badge 12 结阵守, badge 14 独狼守 等）
    finalDmg = badgeModifyIncomingDamage(target, finalDmg, { attacker, target, damage: finalDmg, battle: this, engine: gameEngine });

    // 2. Shield reduction
    if (target.shield > 0 && !bypassesShield) {
      const layersToReduce = isShieldBreaker ? 4 : 1;
      const absorption = Math.round(finalDmg * 0.6);
      finalDmg -= absorption;
      
      const oldShield = target.shield;
      target.shield = Math.max(0, target.shield - layersToReduce);
      
      // 徽章承受伤害后触发（badge 30 反应装甲）
      if (oldShield !== target.shield) {
        badgeOnAfterTakeDamage(target, {
          attacker, target, damage: finalDmg, battle: this, engine: gameEngine,
          isShieldBreaker, shieldReduced: oldShield - target.shield
        });
      }
    }

    // 判定暴击（在扣除 HP 之前，自然暴击需乘以伤害）
    const naturalCrit = (attacker && (attacker as any).stealthCrit) || gameEngine.random() < 0.1;
    const isCrit = forceCrit || ctxForceCrit || naturalCrit;

    // 自然暴击 1.5x 伤害（强制暴击已有独立倍率，不叠加）
    if (naturalCrit && !forceCrit && !ctxForceCrit) {
      finalDmg = Math.round(finalDmg * 1.5);
    }

    target.hp = Math.max(0, target.hp - finalDmg);
    target.flashTime = 0.15;
    
    // Track recently damaged friendly monster for Savior Knight leap targeting
    if (isP1Monster(target)) {
      this._lastDamagedFriendlyIdP1 = target.id;
    } else {
      this._lastDamagedFriendlyIdP2 = target.id;
    }
    
    // Float text on Canvas
    const tPos = this.screenPositions.get(target.id);
    if (tPos) {
      vfx.addFloatingText(tPos.x, tPos.y, `-${finalDmg}`, isCrit ? '#ffcc00' : '#ff3333', isCrit);
    }

    // Record statistics
    if (attacker) {
      gameEngine.recordStat(attacker, finalDmg, 0, 0);
      
      // 徽章攻击后触发（badge 7 吸血, badge 25 中毒 等）
      badgeOnAfterDealDamage(attacker, { attacker, target, damage: finalDmg, battle: this, engine: gameEngine });
    }
    gameEngine.recordStat(target, 0, finalDmg, 0);

    // Trigger badge on after take damage hook
    badgeOnAfterTakeDamage(target, { attacker, target, damage: finalDmg, battle: this, engine: gameEngine });

    // Death check
    if (target.hp <= 0) {
      if (attacker) {
        gameEngine.recordStat(attacker, 0, 0, 0, 0, 1);
      }
      this.killMonster(target);
    }
  }

  public applyHeal(healer: PlacedMonster, target: PlacedMonster, amount: number): void {
    if (!this.active || target.isDead) return;

    // 徽章治疗修正（badge 17 大厨 +50% 等）
    const healCtx: BadgeContext = { healAmount: amount, battle: this, engine: gameEngine };
    let healVal = badgeModifyHeal(target, amount, healCtx);

    target.hp = Math.min(target.maxHp, target.hp + healVal);
    const tPos = this.screenPositions.get(target.id);
    if (tPos) {
      vfx.addFloatingText(tPos.x, tPos.y, `${healVal}`, '#5ac54f');
    }

    // 治疗量记在治疗者，接受治疗记在被治疗者
    gameEngine.recordStat(healer, 0, 0, healVal, 0);
    gameEngine.recordStat(target, 0, 0, 0, healVal);

    // 徽章治疗后触发（badge 6 回复光环扩散 等）
    badgeOnAfterHeal(target, { healAmount: healVal, healSource: target, battle: this, engine: gameEngine });
  }

  public applyHealWithChefBonus(healer: PlacedMonster, target: PlacedMonster, baseAmount: number, battle: any): void {
    const chefBonus = getMonsterBadges(healer).some(b => b.id === 17);
    battle.applyHeal(healer, target, chefBonus ? Math.round(baseAmount * 1.5) : baseAmount);
  }

  public addShield(target: PlacedMonster, layers: number): void {
    if (!this.active || target.isDead) return;
    
    // 徽章护盾修正（badge 28 加固 +50% 等）
    let addedLayers = badgeModifyShield(target, layers, { shieldLayers: layers, battle: this, engine: gameEngine });

    target.shield += addedLayers;
  }

  private killMonster(m: PlacedMonster): void {
    // Check onBeforeDeath hooks for badges
    const ctx: BadgeContext = { battle: this, engine: gameEngine };
    if (!badgeOnBeforeDeath(m, ctx)) {
      return;
    }

    m.isDead = true;
    m.hp = 0;
    this._gridOccupation[m.gridX][m.gridY] = null;
    
    const pos = this.screenPositions.get(m.id);
    if (pos) {
      vfx.spawnParticle(pos.x, pos.y, HIT.death);
    }

    // Remove from active list unless it is currently resurrecting (so it can wait and be resurrected)
    if (!(m as any).resurrecting) {
      const idx = this._monsters.indexOf(m);
      if (idx !== -1) {
        this._monsters.splice(idx, 1);
      }
    }

    // 徽章死亡后触发（badge 24 炸弹爆炸 等）
    badgeOnAfterDeath(m, { battle: this, engine: gameEngine });

    this._updateAuraCircles();

    // Check win/loss end condition immediately
    this.checkBattleEnd();
  }

  private findPathToTarget(m: PlacedMonster, target: PlacedMonster): { x: number; y: number } | null {
    const startX = m.gridX;
    const startY = m.gridY;
    
    const isMelee = m.data.type === 'melee';
    const effectiveRange = m.range + badgeGetRangeBonus(m);

    // Helper to evaluate if a cell is within attack range of target enemy
    const isCellInRange = (cx: number, cy: number): boolean => {
      const dx = Math.abs(cx - target.gridX);
      const dy = Math.abs(cy - target.gridY);
      if (isMelee) {
        return dx <= 1 && dy <= 1;
      }
      return dx + dy <= effectiveRange;
    };

    // BFS setup
    const queue: { x: number; y: number; path: { x: number; y: number }[] }[] = [];
    queue.push({ x: startX, y: startY, path: [] });
    
    const visited = new Set<string>();
    visited.add(`${startX},${startY}`);

    const directions = [
      { x: 1, y: 0 },
      { x: -1, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: -1 }
    ];

    while (queue.length > 0) {
      const current = queue.shift()!;
      
      // If reached target area, return first step
      if (isCellInRange(current.x, current.y)) {
        if (current.path.length > 0) {
          return current.path[0];
        }
        return null; // Already in range
      }

      for (const dir of directions) {
        const nx = current.x + dir.x;
        const ny = current.y + dir.y;
        const key = `${nx},${ny}`;

        if (nx >= 0 && nx <= 10 && ny >= 0 && ny <= 4 && !visited.has(key)) {
          const occupant = this._gridOccupation[nx][ny];
          // Valid only if cell is free and not reserved
          if (occupant === null && !this.isCellReserved(nx, ny)) {
            visited.add(key);
            queue.push({
              x: nx,
              y: ny,
              path: current.path.concat([{ x: nx, y: ny }])
            });
          }
        }
      }
    }

    return null;
  }

  private performMovementAI(m: PlacedMonster, _dt: number): void {
    // If smooth movement is not finished, wait
    const sPos = this.screenPositions.get(m.id)!;
    const tPos = this._targetPositions.get(m.id)!;
    if (Math.abs(sPos.x - tPos.x) > 1 || Math.abs(sPos.y - tPos.y) > 1) {
      m.state = 'walk';
      return;
    }

    const target = this.findClosestEnemy(m, true);
    if (!target) {
      m.state = 'idle';
      return;
    }

    if (this.isInAttackRange(m, target)) {
      m.state = 'idle';
      return; // Don't move if target is already in range
    }

    // Otherwise, find the next step to take via BFS pathfinding
    const nextStep = this.findPathToTarget(m, target);
    if (nextStep) {
      this._gridOccupation[m.gridX][m.gridY] = null;
      m.gridX = nextStep.x;
      m.gridY = nextStep.y;
      this._gridOccupation[m.gridX][m.gridY] = m;
      
      // Update target positions for smooth rendering
      const newScrPos = gridToScreen(m.gridX, m.gridY);
      this._targetPositions.set(m.id, newScrPos);
      m.state = 'walk';
    } else {
      m.state = 'idle';
    }
  }

  // --- Skill implement switch-case ---
  private castSkill(m: PlacedMonster): boolean {
    const skillInstance = getSkill(m.data.skill);
    if (skillInstance) {
      const result = skillInstance.onCast(m, this);
      if (result) {
        // 徽章技能释放触发（badge 4 元素涌动 等）
        const target = this.findClosestEnemy(m, true);
        badgeOnSkillCast(m, { attacker: m, target: target || undefined, battle: this, engine: gameEngine });
      }
      return result;
    }

    const target = this.findClosestEnemy(m, true);
    if (!target) return false;

    const pos = this.screenPositions.get(m.id)!;

    // Default simple damage projectile if skill not fully implemented
    vfx.addProjectile(pos.x, pos.y, this.screenPositions.get(target.id)!.x, this.screenPositions.get(target.id)!.y, 500, '#ff00ff', () => {
      this.applyDamage(target, m.atk * 3, m);
    }, undefined, undefined, undefined, m.id);
    return true;
  }

  public isKnockedBack(monsterId: string): boolean {
    return this._knockbacks.has(monsterId);
  }

  public getEffectiveRange(m: PlacedMonster): number {
    return m.range + badgeGetRangeBonus(m);
  }

  public isInAttackRange(m: PlacedMonster, target: PlacedMonster): boolean {
    const dx = Math.abs(m.gridX - target.gridX);
    const dy = Math.abs(m.gridY - target.gridY);
    if (m.data.type === 'melee') {
      return dx <= 1 && dy <= 1;
    }
    return dx + dy <= this.getEffectiveRange(m);
  }

  // Find closest living enemy
  public findClosestEnemy(m: PlacedMonster, isAttacking: boolean = false): PlacedMonster | null {
    if ((m as any).currentTargetId) {
      const current = this._monsters.find(x => x.id === (m as any).currentTargetId);
      if (current && !current.isDead && !(current as any).resurrecting
          && !this._leaps.has(current.id)
          && !(current as any).deepStealth) {
        if (isAttacking) {
          return current; // 技能和普攻释放时不重新索敌更换目标
        } else {
          // 移动寻路索敌，若在射程内也优先保留不更换
          if (this.isInAttackRange(m, current)) {
            return current;
          }
        }
      }
    }

    let closest: PlacedMonster | null = null;
    let minManhattan = Infinity;
    let minDx = Infinity;
    const isP1 = isP1Monster(m);
    
    const isFarSniper = m.dbId === 113 || m.dbId === 109;
    let maxManhattan = -1;
    let furthestInRange: PlacedMonster | null = null;
    const effectiveRange = m.range + badgeGetRangeBonus(m);

    for (const enemy of this._monsters) {
      if (enemy.isDead || (enemy as any).resurrecting || this._leaps.has(enemy.id) || (enemy as any).deepStealth) continue;
      // Opposite side
      if (isP1 !== isP1Monster(enemy)) {
        const dx = Math.abs(enemy.gridX - m.gridX);
        const dy = Math.abs(enemy.gridY - m.gridY);
        const manhattan = dx + dy;
        
        if (isFarSniper) {
          if (manhattan <= effectiveRange && manhattan > maxManhattan) {
            maxManhattan = manhattan;
            furthestInRange = enemy;
          }
        }

        // 曼哈顿距离优先，相同时X轴优先（|dx| 更小优先）
        if (manhattan < minManhattan || (manhattan === minManhattan && dx < minDx)) {
          minManhattan = manhattan;
          minDx = dx;
          closest = enemy;
        }
      }
    }
    
    const finalTarget = (isFarSniper && furthestInRange) ? furthestInRange : closest;
    if (finalTarget) {
      (m as any).currentTargetId = finalTarget.id;
    }
    return finalTarget;
  }

  // Find closest living ally
  public findClosestAlly(m: PlacedMonster): PlacedMonster | null {
    let closest: PlacedMonster | null = null;
    let minDist = Infinity;
    const isP1 = isP1Monster(m);

    for (const ally of this._monsters) {
      if (ally.isDead || (ally as any).resurrecting || ally.id === m.id) continue;
      if (isP1 === isP1Monster(ally)) {
        const dx = ally.gridX - m.gridX;
        const dy = ally.gridY - m.gridY;
        const dist = dx * dx + dy * dy;
        if (dist < minDist) {
          minDist = dist;
          closest = ally;
        }
      }
    }
    return closest;
  }

  public findClosestFreeCell(gx: number, gy: number): { gridX: number; gridY: number } | null {
    return this.bfsFindNearestCell(gx, gy, (cx, cy) =>
      this._gridOccupation[cx][cy] === null && !this.isCellReserved(cx, cy)
    );
  }

  private bfsFindNearestCell(startX: number, startY: number, predicate: (x: number, y: number) => boolean): { gridX: number; gridY: number } | null {
    const queue: { x: number; y: number }[] = [{ x: startX, y: startY }];
    const visited = new Set<string>();
    visited.add(`${startX},${startY}`);

    const dirs = [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }];

    while (queue.length > 0) {
      const curr = queue.shift()!;
      if (curr.x >= 0 && curr.x <= 10 && curr.y >= 0 && curr.y <= 4) {
        if (predicate(curr.x, curr.y)) {
          return { gridX: curr.x, gridY: curr.y };
        }
      }

      for (const d of dirs) {
        const nx = curr.x + d.x;
        const ny = curr.y + d.y;
        const key = `${nx},${ny}`;
        if (!visited.has(key) && nx >= 0 && nx <= 10 && ny >= 0 && ny <= 4) {
          visited.add(key);
          queue.push({ x: nx, y: ny });
        }
      }
    }
    return null;
  }

  public isCoordinateInRange(x1: number, y1: number, x2: number, y2: number, range: number): boolean {
    const dx = Math.abs(x1 - x2);
    const dy = Math.abs(y1 - y2);
    if (range === 1) {
      // 3x3 surrounding including diagonals
      return dx <= 1 && dy <= 1;
    } else {
      // Manhattan distance
      return (dx + dy) <= range;
    }
  }

  public getMonstersInGridRange(cx: number, cy: number, range: number): PlacedMonster[] {
    return this._monsters.filter(m => !m.isDead && !(m as any).resurrecting && this.isCoordinateInRange(cx, cy, m.gridX, m.gridY, range));
  }

  private getAdjacentMonsters(gx: number, gy: number): PlacedMonster[] {
    return this.getMonstersInGridRange(gx, gy, 1).filter(m => m.gridX !== gx || m.gridY !== gy);
  }

  public applyStatusEffect(target: PlacedMonster, effect: {
    type: 'poison' | 'bleed' | 'stun' | 'chill' | 'freeze' | 'burn' | 'stealth' | 'invincible';
    duration: number;
    value?: number;
    source?: any;
    tickTimer?: number;
  }): void {
    if (target.isDead || (target as any).resurrecting) return;
    if (!badgeOnApplyStatusEffect(target, effect)) {
      return; // Immune!
    }
    if (effect.type === 'chill') {
      const hasChill = target.statusEffects.some(e => e.type === 'chill');
      if (!hasChill) {
        target.ats *= 0.7;
      }
    }
    target.statusEffects.push(effect);
  }

  public applyChill(target: PlacedMonster, duration: number): void {
    const hasChill = target.statusEffects.some(s => s.type === 'chill');
    this.applyStatusEffect(target, { type: 'chill', duration });
    if (!hasChill && target.statusEffects.some(s => s.type === 'chill')) {
      this.scheduler.schedule(() => {
        if (this.active && !target.isDead) {
          target.ats /= 0.7;
        }
      }, duration);
    }
  }

  public applyFreeze(target: PlacedMonster, duration: number): void {
    this.applyStatusEffect(target, { type: 'freeze', duration });
  }

  private checkBattleEnd(): void {
    if (this._battleEndingTimer > 0) return;

    const p1Alive = this._monsters.some(m => (!m.isDead || (m as any).resurrecting) && isP1Monster(m));
    const p2Alive = this._monsters.some(m => (!m.isDead || (m as any).resurrecting) && !isP1Monster(m));

    const ended = !p1Alive || !p2Alive;

    if (ended) {
      this._battleEndingTimer = 1.0; // 1s end-delay phase
    }
  }

  private endBattle(winner: 1 | 2 | null): void {
    this.active = false;
    this.scheduler.clear();
    
    // Reset monsters back to their initial positions and status from database config
    for (const m of gameEngine.boardMonsters) {
      m.hp = m.data.hp;
      m.maxHp = m.data.hp;
      m.atk = m.data.atk;
      m.ats = m.data.ats;
      m.range = m.data.range;
      m.speed = m.data.speed;
      m.shield = 0;
      m.skillCdProgress = 0;
      m.isDead = false;
      m.statusEffects = [];
      (m as any).skillAnimationTimeLeft = 0;
      (m as any).burrowing = false;
      (m as any).resurrecting = false;
      (m as any).noSprite = false;
      (m as any).phalanxAtkAdded = 0;
      m.gridX = m.initialGridX;
      m.gridY = m.initialGridY;
      m.flashTime = 0;

      badgeOnPlace(m, { battle: this, engine: gameEngine });
    }
    
    if (!gameEngine.isReplaying) {
      if (winner === 1) {
        gameEngine.p1Score += 1;
      } else if (winner === 2) {
        gameEngine.p2Score += 1;
      }
      // If draw, scores are not incremented
      
      // Set game engine states
      gameEngine.state = 'ROUND_END';
    }
    
    // Clear dynamic combat properties
    this.screenPositions.clear();
    this._targetPositions.clear();
    this._attackTimers.clear();
    this._cdMultipliers.clear();
    this._knockbacks.clear();
    this._chargingMonsters.clear();
    this._reservedCells.clear();
    this._priestLinks.clear();
    
    // Clean visual tracking callback
    vfx.getTargetPosition = null;
    vfx.bulletCollisionCheck = null;

    // Trigger callbacks in UI to open summary panel
    if (this.onBattleEndCallback) {
      this.onBattleEndCallback(winner);
    }
  }

  // Callback injected by UI
  public onBattleEndCallback: ((winner: 1 | 2 | null) => void) | null = null;

  // New knockback and charge APIs for Skill Class System
  public registerPriestLinks(priestId: string, allyIds: string[]): void {
    this._priestLinks.set(priestId, allyIds);
  }

  /** 触发祈祷链疗（用于非普攻伤害如献祭自伤、反甲反射等场景） */
  public tryTriggerPriestHeal(monster: PlacedMonster): void {
    const linkedIds = this._priestLinks.get(monster.id);
    if (!linkedIds) return;
    const healAmount = Math.round(monster.maxHp * 0.02);
    this.applyHealWithChefBonus(monster, monster, healAmount, this);
    for (const id of linkedIds) {
      const ally = this._monsters.find(x => x.id === id);
      if (ally && !ally.isDead) {
        this.applyHealWithChefBonus(monster, ally, healAmount, this);
      }
    }
  }

  public reserveCell(casterId: string, x: number, y: number): void {
    this._reservedCells.set(casterId, { x, y });
  }

  public isCellReserved(x: number, y: number): boolean {
    for (const res of this._reservedCells.values()) {
      if (res.x === x && res.y === y) return true;
    }
    return false;
  }

  public isCellOccupied(x: number, y: number): boolean {
    if (this._gridOccupation[x][y] !== null) return true;
    return this.isCellReserved(x, y);
  }

  public registerCharge(casterId: string, targetId: string, dir: number, strength: number): void {
    this._chargingMonsters.set(casterId, { targetId, dir, strength });
  }

  private updateCharges(dt: number): void {
    for (const [casterId, charge] of this._chargingMonsters.entries()) {
      const caster = this._monsters.find(m => m.id === casterId);
      if (!caster || caster.isDead) {
        this._chargingMonsters.delete(casterId);
        this._reservedCells.delete(casterId);
        continue;
      }
      
      const sPos = this.screenPositions.get(casterId);
      if (!sPos) continue;
      
      const speed = caster.speed * screenConfig.cellW * 4 * CHARGE_SPEED_FACTOR; // 4x speed charge
      
      if (charge.targetId) {
        const target = this._monsters.find(m => m.id === charge.targetId);
        if (!target || target.isDead) {
          this.finishChargeAtCurrentPos(caster, sPos);
          continue;
        }
        
        const tPos = this.screenPositions.get(target.id);
        if (!tPos) continue;
        
        // Move towards target
        const step = charge.dir * speed * dt;
        sPos.x += step;
        
        // Check collision with leaping monsters in path
        for (const [lepId, _leap] of this._leaps) {
          const leaper = this._monsters.find(m => m.id === lepId);
          if (!leaper || leaper.isDead) continue;
          const lPos = this.screenPositions.get(lepId);
          if (!lPos) continue;
          if (Math.abs(lPos.x - sPos.x) < 125 && Math.abs(lPos.y - sPos.y) < 140) {
            // 空中碰撞！双方使用抛物线弹飞
            this._leaps.delete(lepId);
            this._reservedCells.delete(lepId);
            this._chargingMonsters.delete(casterId);
            this._reservedCells.delete(casterId);
            this.finishChargeAtCurrentPos(caster, sPos);

            // 根据碰撞连线角度计算反弹方向
            const dx = lPos.x - sPos.x;
            const dy = lPos.y - sPos.y;
            const angle = Math.atan2(dy, dx || 0.001);
            const reboundDirX = -Math.sign(Math.cos(angle));
            const reboundDirY = -Math.sign(Math.sin(angle));

            // X（被投掷怪兽）反弹：1.5格高，2-3格水平位移
            const xStr = COLLISION_REBOUND_STRENGTH_MIN + Math.floor(Math.random() * (COLLISION_REBOUND_STRENGTH_MAX - COLLISION_REBOUND_STRENGTH_MIN + 1));
            this.applyKnockback(leaper, reboundDirX, reboundDirY, xStr, COLLISION_REBOUND_X_HEIGHT);

            // 冲锋反弹：1格高，反方向
            const cStr = COLLISION_REBOUND_STRENGTH_MIN + Math.floor(Math.random() * (COLLISION_REBOUND_STRENGTH_MAX - COLLISION_REBOUND_STRENGTH_MIN + 1));
            this.applyKnockback(caster, -reboundDirX, -reboundDirY, cStr, COLLISION_REBOUND_CHARGE_HEIGHT);

            // Clear caster stun/stealth
            caster.statusEffects = caster.statusEffects.filter(e => e.type !== 'stun' && e.type !== 'stealth');
            // 碰撞粒子
            const midX = (lPos.x + sPos.x) / 2;
            const midY = (lPos.y + sPos.y) / 2;
            vfx.spawnParticle(midX, midY, HIT.chargeHit);
            return; // exit the forEach over _chargingMonsters
          }
        }
        
        // Check for contact: distance <= 125.4 (1 grid cell width)
        const currentDist = Math.abs(tPos.x - sPos.x);
        if (currentDist <= 125.4) {
          this.triggerChargeImpact(casterId);
        }
      } else {
        // Charging to wall boundary
        const targetX = charge.dir === 1 ? 588 + (10 + 0.5) * 125.4 : 588 + (0 + 0.5) * 125.4;
        const dist = Math.abs(targetX - sPos.x);
        const step = speed * dt;
        
        if (dist <= step) {
          sPos.x = targetX;
          this.finishChargeAtCurrentPos(caster, sPos);
        } else {
          sPos.x += charge.dir * step;
        }
      }
    }
  }

  private finishChargeAtCurrentPos(caster: PlacedMonster, sPos: { x: number; y: number }): void {
    this._chargingMonsters.delete(caster.id);
    this._reservedCells.delete(caster.id);
    
    // Snaps to nearest grid cell
    const idealGridX = Math.max(0, Math.min(10, Math.round((sPos.x - 588) / 125.4 - 0.5)));
    const nearestCell = this.findNearestEmptyCell(idealGridX, caster.gridY);
    if (nearestCell) {
      this._gridOccupation[caster.gridX][caster.gridY] = null;
      caster.gridX = nearestCell.gridX;
      caster.gridY = nearestCell.gridY;
      this._gridOccupation[nearestCell.gridX][nearestCell.gridY] = caster;
      
      const newPos = gridToScreen(nearestCell.gridX, caster.gridY);
      this._targetPositions.set(caster.id, newPos);
      sPos.x = newPos.x;
      sPos.y = newPos.y;
    }
    
    // Clear stun and stealth
    caster.statusEffects = caster.statusEffects.filter(e => e.type !== 'stun' && e.type !== 'stealth');
  }

  public triggerChargeImpact(casterId: string): void {
    const charge = this._chargingMonsters.get(casterId);
    if (!charge) return;
    this._chargingMonsters.delete(casterId);
    this._reservedCells.delete(casterId);

    const caster = this._monsters.find(m => m.id === casterId);
    const target = this._monsters.find(m => m.id === charge.targetId);

    if (caster && target && !target.isDead) {
      // 1. Caster stops immediately and snaps to nearest free cell in front of the target
      const cPos = this.screenPositions.get(caster.id)!;
      const idealGridX = Math.max(0, Math.min(10, target.gridX - charge.dir));
      const nearestCell = this.findNearestEmptyCell(idealGridX, caster.gridY);
      if (nearestCell) {
        this._gridOccupation[caster.gridX][caster.gridY] = null;
        caster.gridX = nearestCell.gridX;
        caster.gridY = nearestCell.gridY;
        this._gridOccupation[nearestCell.gridX][nearestCell.gridY] = caster;
        
        const newPos = gridToScreen(nearestCell.gridX, caster.gridY);
        this._targetPositions.set(caster.id, newPos);
        cPos.x = newPos.x;
        cPos.y = newPos.y;
      }
      
      // Clear caster stun and stealth
      caster.statusEffects = caster.statusEffects.filter(e => e.type !== 'stun' && e.type !== 'stealth');

      // Give 10 shields to caster upon impact
      this.addShield(caster, 10);

      // 2. Start knockback effect on target immediately!
      this.applyKnockback(target, charge.dir, 0, charge.strength);

      // 3. Apply damage and stun to target
      this.applyDamage(target, caster.atk, caster);

      // Display hit floating text & impact particles at target position
      const tPos = this.screenPositions.get(target.id);
      if (tPos) {
        vfx.spawnParticle(tPos.x, tPos.y, HIT.chargeHit);
      }
    }
  }

  public applyKnockback(target: PlacedMonster, dirX: number, dirY: number, strength: number, customPeakHeight?: number): void {
    if (target.isDead) return;

    // 1. Calculate ideal landing cell
    let idealX = Math.max(0, Math.min(10, Math.round(target.gridX + dirX * strength)));
    let idealY = Math.max(0, Math.min(4, Math.round(target.gridY + dirY * strength)));
    
    // 2. Find nearest empty cell to (idealX, idealY)
    const nearestCell = this.findNearestEmptyCell(idealX, idealY);
    if (!nearestCell) return; // No empty cells left (very rare)
    
    // 3. Move logically on grid by reserving destination cell
    // We do NOT change target.gridX/gridY immediately, only reserve the destination cell
    this._gridOccupation[target.gridX][target.gridY] = null;
    this._reservedCells.set(target.id, { x: nearestCell.gridX, y: nearestCell.gridY });
    
    // 4. Start visual parabolic knockback
    const sPos = this.screenPositions.get(target.id);
    const startPos = sPos ? { x: sPos.x, y: sPos.y } : gridToScreen(target.gridX, target.gridY);
    const targetPos = gridToScreen(nearestCell.gridX, nearestCell.gridY);
    this._targetPositions.set(target.id, targetPos);
    
    // 可调参数：速度倍率、高度倍率、自定义峰值
    const duration = (0.16 + 0.08 * strength) / KNOCKBACK_SPEED_FACTOR;
    const peakHeight = customPeakHeight ?? (40 * strength * KNOCKBACK_HEIGHT_FACTOR);
    this._knockbacks.set(target.id, {
      startX: startPos.x,
      startY: startPos.y,
      targetX: targetPos.x,
      targetY: targetPos.y,
      totalDuration: duration,
      elapsedTime: 0,
      peakHeight: peakHeight
    });
    
    // Stun the monster during the knockback
    this.applyStatusEffect(target, { type: 'stun', duration: duration });
  }

  public registerLeap(casterId: string, startX: number, startY: number, targetX: number, targetY: number, duration: number, damage: number, peakHeight: number = 120, knockbackTargetId?: string, knockbackDir?: number): void {
    const startPos = gridToScreen(startX, startY);
    const targetPos = gridToScreen(targetX, targetY);
    this._targetPositions.set(casterId, targetPos);
    this._leaps.set(casterId, {
      startX: startPos.x,
      startY: startPos.y,
      targetX: targetPos.x,
      targetY: targetPos.y,
      totalDuration: duration,
      elapsedTime: 0,
      peakHeight: peakHeight,
      damageOnLanding: damage,
      knockbackTargetId,
      knockbackDir
    });
  }

  public findNearestEmptyCell(startX: number, startY: number): { gridX: number; gridY: number } | null {
    return this.bfsFindNearestCell(startX, startY, (cx, cy) => !this.isCellOccupied(cx, cy));
  }
}
export const battleSystem = BattleSystem.instance;

