import { PlacedMonster, gameEngine } from './GameEngine';
import { vfx } from './VfxManager';
import { getMonsterBadges } from './BadgeSystem';
import { isP1Monster } from './BattleSystem';
import { gridToScreen } from './ScreenConfig';
import { HIT, SKILL, STATUS_EFFECT } from './VfxPresets';

/** 初始化穿透弹公共属性 */
function setupPiercingProjectile(pr: any, ownerId: string, onHit?: (hitId: string) => void): void {
  pr.ownerId = ownerId;
  pr.isPiercing = true;
  pr.hitTargetIds = new Set<string>();
  if (onHit) pr.onHit = onHit;
}


export abstract class BaseSkill {
  abstract readonly name: string;

  // Triggered at start of battle
  public onStartOfBattle(_caster: PlacedMonster, _battle: any): void {
    void _caster;
    void _battle;
  }

  // Triggered when active skill is ready, returns true if casted successfully
  public onCast(_caster: PlacedMonster, _battle: any): boolean {
    void _caster;
    void _battle;
    return false;
  }
}

// 101: Reap (肃清哥) — 人物旋转一周
export class ReapSkill extends BaseSkill {
  readonly name = 'reap';

  public onCast(caster: PlacedMonster, battle: any): boolean {
    const target = battle.findClosestEnemy(caster, true);
    if (!target) return false;

    // 人物旋转一周，0.8s
    (caster as any)._rotationDuration = 0.8;
    (caster as any)._rotationRemaining = 0.8;

    const enemies = battle.getAdjacentMonsters(caster.gridX, caster.gridY)
      .filter((e: PlacedMonster) => isP1Monster(e) !== isP1Monster(caster));

    for (const e of enemies) {
      battle.applyDamage(e, Math.round(caster.atk * 1.0), caster);
      battle.applyStatusEffect(e, { type: 'bleed', duration: 6.0 });
    }
    return true;
  }
}

// 102: Lightning (大祭司哥) — 雷霆审判
export class LightningSkill extends BaseSkill {
  readonly name = 'lightning';

  public onCast(caster: PlacedMonster, battle: any): boolean {
    const target = battle.findClosestEnemy(caster, true);
    if (!target) return false;

    const enemies = battle._monsters
      .filter((e: PlacedMonster) => isP1Monster(e) !== isP1Monster(caster) && !e.isDead)
      .filter((e: PlacedMonster) => {
        const dx = e.gridX - caster.gridX;
        const dy = e.gridY - caster.gridY;
        return Math.sqrt(dx * dx + dy * dy) <= 7;
      })
      .slice(0, 4);

    if (enemies.length === 0) return false;

    // 每个目标延迟 0.12s 依次落雷
    enemies.forEach((e: PlacedMonster, idx: number) => {
      battle.scheduler.schedule(() => {
        const ePos = battle.screenPositions.get(e.id);
        if (!ePos) return;
        // 层1: 天雷（颜色已提亮至 #e0f8ff）
        vfx.spawnParticle(ePos.x, ePos.y, SKILL.lightningStorm.hit);
        // 层2: 落点火花
        for (let i = 0; i < 3; i++) {
          vfx.spawnParticle(
            ePos.x + (Math.random() - 0.5) * 40,
            ePos.y + (Math.random() - 0.5) * 20,
            { type: 'star', duration: 0.3, color: '#c0e0ff', size: 30 }
          );
        }
        battle.applyDamage(e, Math.round(caster.atk * 3.0), caster);
        if (gameEngine.random() < 0.5) {
          battle.applyStatusEffect(e, { type: 'stun', duration: 2.0 });
        }
      }, idx * 0.12);
    });
    return true;
  }
}

// 103: Life Link (学徒哥) — 生命均衡
export class LifeLinkSkill extends BaseSkill {
  readonly name = 'life_link';

  public onCast(caster: PlacedMonster, battle: any): boolean {
    const target = battle.findClosestEnemy(caster, true);
    if (!target) return false;

    const allies = battle._monsters
      .filter((a: PlacedMonster) => {
        if (isP1Monster(a) !== isP1Monster(caster) || a.isDead) return false;
        const dx = a.gridX - caster.gridX;
        const dy = a.gridY - caster.gridY;
        return Math.sqrt(dx * dx + dy * dy) <= 3;
      });

    if (allies.length === 0) return false;

    const cPos = battle.screenPositions.get(caster.id);
    if (!cPos) return false;

    // HP 均衡计算
    let totalHp = 0;
    let totalMaxHp = 0;
    for (const a of allies) {
      totalHp += a.hp;
      totalMaxHp += a.maxHp;
    }
    const avgPercent = totalHp / totalMaxHp;
    for (const a of allies) {
      a.hp = Math.round(a.maxHp * avgPercent);
    }

    // 层1: 抖动链接线（每友方一条亮绿色细线）
    for (const a of allies) {
      if (a.id === caster.id) continue;
      const aPos = battle.screenPositions.get(a.id);
      if (!aPos) continue;
      // 持续生成多条线增强可见性
      for (let s = 0; s < 3; s++) {
        battle.scheduler.schedule(() => {
          vfx.spawnParticle(cPos.x, cPos.y, SKILL.lifeBalance.link, { x2: aPos.x, y2: aPos.y });
        }, s * 0.08);
      }
    }
    return true;
  }
}

// 104: Incendiary (散弹哥)
export class IncendiarySkill extends BaseSkill {
  readonly name = 'incendiary';

  public onCast(caster: PlacedMonster, battle: any): boolean {
    const target = battle.findClosestEnemy(caster, true);
    if (!target) return false;

    const pos = battle.screenPositions.get(caster.id);
    const targetPos = battle.screenPositions.get(target.id);
    if (pos && targetPos) {
      const angle = Math.atan2(targetPos.y - pos.y, targetPos.x - pos.x);
      const dist = Math.sqrt((targetPos.x - pos.x) ** 2 + (targetPos.y - pos.y) ** 2);
      
      const dir = isP1Monster(caster) ? 1 : -1;
      
      // 7 angles: -45, -30, -15, 0, 15, 30, 45 degrees
      const angles = [
        -Math.PI / 4,
        -Math.PI / 6,
        -Math.PI / 12,
        0,
        Math.PI / 12,
        Math.PI / 6,
        Math.PI / 4
      ];
      
      angles.forEach((offset, idx) => {
        const a = angle + offset;
        const tx = pos.x + Math.cos(a) * dist;
        const ty = pos.y + Math.sin(a) * dist;
        
        const isCenter = idx === 3;
        const cfg = SKILL.multishot.projectile;
        vfx.addProjectile(pos.x, pos.y, tx, ty, cfg.speed, cfg.color, () => {
          if (isCenter) {
            // Apply 3x ATK damage
            battle.applyDamage(target, caster.atk * 3, caster);
            
            // Apply 1-cell knockback
            battle.applyKnockback(target, dir, 0, 1);
            
            // Apply burn status
            battle.applyStatusEffect(target, { type: 'burn', duration: 4.0 });
          }
        }, isCenter ? target.id : undefined);
      });
      return true;
    }
    return false;
  }
}

// 105: Recovery (祈祷哥) — 圣疗
export class RecoverySkill extends BaseSkill {
  readonly name = 'recovery';

  public onStartOfBattle(caster: PlacedMonster, battle: any): void {
    const adjacentAllies = battle.getAdjacentMonsters(caster.gridX, caster.gridY)
      .filter((ally: PlacedMonster) => isP1Monster(ally) === isP1Monster(caster) && ally.id !== caster.id);
    
    const allyIds = adjacentAllies.map((ally: PlacedMonster) => ally.id);
    battle.registerPriestLinks(caster.id, allyIds);
  }
}

// 106: Rush (冲锋哥) — 野蛮冲撞
export class RushSkill extends BaseSkill {
  readonly name = 'rush';

  public onStartOfBattle(caster: PlacedMonster, battle: any): void {
    const target = battle.findClosestEnemy(caster, true);
    if (!target) return;

    const dir = isP1Monster(caster) ? 1 : -1;
    const startX = caster.gridX;
    const startY = caster.gridY;

    let landX = startX;
    let hitEnemy: PlacedMonster | null = null;

    // Search forward for first enemy or wall collision
    const minBound = 0;
    const maxBound = 10;
    let checkX = startX + dir;

    while (checkX >= minBound && checkX <= maxBound) {
      const occupant = battle._gridOccupation[checkX][startY];
      if (occupant && !occupant.isDead) {
        if (isP1Monster(occupant) !== isP1Monster(caster)) {
          hitEnemy = occupant;
          landX = checkX - dir; // land right before enemy
          break;
        }
      }
      checkX += dir;
    }

    // If no enemy hit, slide all the way to the boundary wall
    if (!hitEnemy) {
      landX = dir === 1 ? maxBound : minBound;
    }

    // 层1: 冲刺灰色尘土拖尾（每 0.06s 生成 3 粒）
    const trailKey = battle.scheduler.scheduleInterval(() => {
      const sPos = battle.screenPositions.get(caster.id);
      if (sPos && (!hitEnemy || !target.isDead)) {
        for (let i = 0; i < 3; i++) {
          vfx.spawnParticle(
            sPos.x + (Math.random() - 0.5) * 30,
            sPos.y + (Math.random() - 0.5) * 20,
            SKILL.rush.trail
          );
        }
      }
    }, 0.06);

    // 1.5s 后自动停止拖尾
    battle.scheduler.schedule(() => {
      battle.scheduler.unschedule(trailKey);
    }, 1.5);

    // Free original grid cell, and reserve the target cell immediately
    battle._gridOccupation[startX][startY] = null;
    battle.reserveCell(caster.id, landX, startY);

    // Apply speed dash visual state: stealth status + stun duration (so they don't hit while sliding)
    battle.applyStatusEffect(caster, { type: 'stealth', duration: 1.5 });
    battle.applyStatusEffect(caster, { type: 'stun', duration: 1.5 });

    const kbDist = hitEnemy ? (gameEngine.random() < 0.5 ? 2 : 3) : 0;
    // Register deferred charge collision trigger（撞击 VFX 在 triggerChargeImpact 中处理）
    battle.registerCharge(caster.id, hitEnemy ? hitEnemy.id : '', dir, kbDist);
  }
}

// 107: Big Cannon (咒法骑士)
export class BigCannonSkill extends BaseSkill {
  readonly name = 'big_cannon';

  public onStartOfBattle(caster: PlacedMonster, battle: any): void {
    // 2.0s charging
    (caster as any).chargingCannon = true;
    
    // 蓄力光环（0.5s 间隔，0.4s 一轮，2秒共4个环）
    const intervalKey = `big_cannon_charge_${caster.id}`;
    battle.scheduler.scheduleInterval(() => {
      if (!battle.active || caster.isDead || !(caster as any).chargingCannon) {
        battle.scheduler.unschedule(intervalKey);
        return;
      }
      const pos = battle.screenPositions.get(caster.id);
      if (pos) {
        vfx.spawnParticle(pos.x, pos.y, SKILL.bigCannon.chargeRing);
      }
    }, 0.5, intervalKey);

    // 核心能量球壮大（0.3s 间隔）
    const glowKey = `big_cannon_glow_${caster.id}`;
    battle.scheduler.scheduleInterval(() => {
      if (!battle.active || caster.isDead || !(caster as any).chargingCannon) {
        battle.scheduler.unschedule(glowKey);
        return;
      }
      const pos = battle.screenPositions.get(caster.id);
      if (pos) {
        vfx.spawnParticle(pos.x, pos.y, SKILL.bigCannon.coreGlow);
      }
    }, 0.3, glowKey);

    // 能量火花汇聚（0.05s 间隔）
    const sparkKey = `big_cannon_spark_${caster.id}`;
    battle.scheduler.scheduleInterval(() => {
      if (!battle.active || caster.isDead || !(caster as any).chargingCannon) {
        battle.scheduler.unschedule(sparkKey);
        return;
      }
      const pos = battle.screenPositions.get(caster.id);
      if (pos) {
        vfx.spawnParticle(pos.x, pos.y, SKILL.bigCannon.spark);
      }
    }, 0.05, sparkKey);

    battle.scheduler.schedule(() => {
      (caster as any).chargingCannon = false;
      battle.scheduler.unschedule(intervalKey);
      battle.scheduler.unschedule(glowKey);
      battle.scheduler.unschedule(sparkKey);

      if (battle.active && !caster.isDead) {
        const pos = battle.screenPositions.get(caster.id);
        if (!pos) return;

        // 炮口闪光
        vfx.spawnParticle(pos.x, pos.y, SKILL.bigCannon.muzzle);

        const dir = caster.team === 1 ? 1 : -1;
        const baseAngle = dir === 1 ? 0 : Math.PI;
        const isPiercing = getMonsterBadges(caster).some(b => b.id === 1);
        
        if (isPiercing) {
          const extX = pos.x + Math.cos(baseAngle) * 2500;
          const extY = pos.y + Math.sin(baseAngle) * 2500;
          const pr = vfx.addProjectileByType(pos.x, pos.y, extX, extY, 'cannon', () => {}, undefined, undefined, caster.id);
          setupPiercingProjectile(pr, caster.id, (hitId: string) => {
            const ht = battle._monsters.find((e: any) => e.id === hitId);
            if (ht) {
              battle.applyDamage(ht, caster.atk * 13, caster);
              const hitPos = battle.screenPositions.get(ht.id);
              if (hitPos) {
                vfx.spawnParticle(hitPos.x, hitPos.y, SKILL.bigCannon.hit);
                vfx.spawnParticle(hitPos.x, hitPos.y, SKILL.bigCannon.shockRing);
              }
            }
          });
        } else {
          const tx = pos.x + Math.cos(baseAngle) * 2500;
          const ty = pos.y + Math.sin(baseAngle) * 2500;
          const pr = vfx.addProjectileByType(pos.x, pos.y, tx, ty, 'cannon', () => {}, undefined, undefined, caster.id);
          // 非穿透弹命中时触发伤害+VFX
          pr.onHit = (hitId: string) => {
            const ht = battle._monsters.find((e: any) => e.id === hitId);
            if (ht) {
              battle.applyDamage(ht, caster.atk * 13, caster);
              const hitPos = battle.screenPositions.get(ht.id);
              if (hitPos) {
                vfx.spawnParticle(hitPos.x, hitPos.y, SKILL.bigCannon.hit);
                vfx.spawnParticle(hitPos.x, hitPos.y, SKILL.bigCannon.shockRing);
              }
            }
          };
        }
      }
    }, 2.0);
  }
}

// 108: Leap (救星骑士)
export class LeapSkill extends BaseSkill {
  readonly name = 'leap';

  public onCast(caster: PlacedMonster, battle: any): boolean {
    const lastDamagedId = isP1Monster(caster) ? battle._lastDamagedFriendlyIdP1 : battle._lastDamagedFriendlyIdP2;
    let targetAlly: PlacedMonster | null = null;
    
    if (lastDamagedId) {
      targetAlly = battle._monsters.find((m: any) => m.id === lastDamagedId && !m.isDead);
    }
    
    if (!targetAlly) {
      targetAlly = battle.findClosestAlly(caster);
    }

    if (!targetAlly) {
      targetAlly = caster;
    }

    const startX = caster.gridX;
    const startY = caster.gridY;
    
    let landGridX = targetAlly.gridX;
    let landGridY = targetAlly.gridY;

    // Squeeze the ally if target is not self
    if (targetAlly !== caster) {
      const freeCell = battle.findClosestFreeCell(targetAlly.gridX, targetAlly.gridY);
      if (freeCell) {
        // Push target ally logically
        battle._gridOccupation[targetAlly.gridX][targetAlly.gridY] = null;
        targetAlly.gridX = freeCell.gridX;
        targetAlly.gridY = freeCell.gridY;
        battle._gridOccupation[freeCell.gridX][freeCell.gridY] = targetAlly;
        
        // Push target ally visually
        const slidePos = {
          x: 588 + (freeCell.gridX + 0.5) * 125.4,
          y: 236 + (freeCell.gridY + 0.5) * 141.4
        };
        battle._targetPositions.set(targetAlly.id, slidePos);
      }
    }

    // Add 8 shields to both self and the target ally
    battle.addShield(caster, 8);
    if (targetAlly !== caster) {
      battle.addShield(targetAlly, 8);
    }

    // Free original grid cell logically, and reserve the target cell immediately
    battle._gridOccupation[startX][startY] = null;
    battle.reserveCell(caster.id, landGridX, landGridY);

    // Lock caster actions during leap
    (caster as any).skillAnimationTimeLeft = 0.5;

    // Register leap state in battle
    battle.registerLeap(caster.id, startX, startY, landGridX, landGridY, 0.5, caster.atk * 4.5);
    return true;
  }
}

// 109: Shot (银狙骑士)
export class ShotSkill extends BaseSkill {
  readonly name = 'shot';

  public onCast(caster: PlacedMonster, battle: any): boolean {
    (caster as any).empoweredShot = true;
    const pos = battle.screenPositions.get(caster.id);
    if (pos) {
      vfx.spawnParticle(pos.x, pos.y, SKILL.lockOn.mark);
    }
    return true;
  }
}

// 110: Shield (帝国之盾)
export class ShieldSkill extends BaseSkill {
  readonly name = 'shield';

  public onStartOfBattle(caster: PlacedMonster, battle: any): void {
    this.castShield(caster, battle);
  }

  public onCast(caster: PlacedMonster, battle: any): boolean {
    this.castShield(caster, battle);
    return true;
  }

  private castShield(caster: PlacedMonster, battle: any): void {
    battle.addShield(caster, 5);
    const adjacents = battle.getAdjacentMonsters(caster.gridX, caster.gridY)
      .filter((m: PlacedMonster) => isP1Monster(m) === isP1Monster(caster) && m.id !== caster.id)
      .filter((m: PlacedMonster) => {
        return Math.abs(m.gridX - caster.gridX) + Math.abs(m.gridY - caster.gridY) === 1;
      });

    for (const a of adjacents) {
      battle.addShield(a, 5);
    }
  }
}

// 111: Wind Attack (见习骑士)
export class WindAttackSkill extends BaseSkill {
  readonly name = 'wind_attack';

  public onCast(caster: PlacedMonster, battle: any): boolean {
    const pos = battle.screenPositions.get(caster.id);
    if (pos) {
      // 角色原地旋转0.5s（参考肃清哥）
      (caster as any)._rotationDuration = 0.5;
      (caster as any)._rotationRemaining = 0.5;
      
      const enemies = battle.getMonstersInGridRange(caster.gridX, caster.gridY, 1)
        .filter((e: PlacedMonster) => isP1Monster(e) !== isP1Monster(caster));
      
      for (const e of enemies) {
        battle.applyDamage(e, caster.atk * 2, caster);
      }
      return true;
    }
    return false;
  }
}

export class HealSwordSkill extends BaseSkill {
  readonly name = 'heal_sword';

  public onCast(caster: PlacedMonster, battle: any): boolean {
    const pos = battle.screenPositions.get(caster.id);
    if (pos) {
      // 治疗脉冲光环
      vfx.spawnParticle(pos.x, pos.y, SKILL.healAura.circle);

      // Phase 1: 伤害（白色斩击）
      const target = battle.findClosestEnemy(caster, true);
      if (target && Math.abs(target.gridX - caster.gridX) <= 1 && Math.abs(target.gridY - caster.gridY) <= 1) {
        const tPos = battle.screenPositions.get(target.id);
        if (tPos) {
          vfx.spawnParticle(tPos.x, tPos.y, SKILL.healAura.slash);
        }
        battle.applyDamage(target, Math.round(caster.atk * 1.5), caster);
      }

      // Phase 2: 治疗（绿色漂浮粒子）
      this.healAction(caster, battle);

      battle.scheduler.schedule(() => {
        if (battle.active && !caster.isDead) {
          this.healAction(caster, battle);
        }
      }, 0.5);

      return true;
    }
    return false;
  }

  private healAction(caster: PlacedMonster, battle: any): void {
    const allies = battle.getMonstersInGridRange(caster.gridX, caster.gridY, 1)
      .filter((a: PlacedMonster) => isP1Monster(a) === isP1Monster(caster) && a.id !== caster.id);
    
    for (const a of allies) {
      battle.applyHealWithChefBonus(caster, a, Math.round(a.maxHp * 0.05), battle);
      const aPos = battle.screenPositions.get(a.id);
      if (aPos) {
        for (let i = 0; i < 3; i++) vfx.spawnParticle(aPos.x, aPos.y, SKILL.healAura.puff);
        vfx.spawnParticle(aPos.x, aPos.y, SKILL.healAura.cross);
      }
    }
    battle.applyHealWithChefBonus(caster, caster, Math.round(caster.maxHp * 0.08), battle);
  }
}

// 113: Explosive (爆破大师)
export class ExplosiveSkill extends BaseSkill {
  readonly name = 'explosive';
}

// 114: Open Fire (突突突矿工)
export class OpenFireSkill extends BaseSkill {
  readonly name = 'open_fire';

  public onStartOfBattle(caster: PlacedMonster, battle: any): void {
    (caster as any).skillAnimationTimeLeft = 2.5;
    
    let count = 0;
    const taskKey = `open_fire_${caster.id}`;
    battle.scheduler.scheduleInterval(() => {
      if (!battle.active || caster.isDead) {
        battle.scheduler.unschedule(taskKey);
        (caster as any).openFireIntervalId = null;
        return;
      }

      // Interrupt check: self-interrupted if stunned or knocked back
      const isStunned = caster.statusEffects.some((e: any) => e.type === 'stun');
      const isKnockedBack = battle.isKnockedBack ? battle.isKnockedBack(caster.id) : false;
      if (isStunned || isKnockedBack) {
        battle.scheduler.unschedule(taskKey);
        (caster as any).openFireIntervalId = null;
        (caster as any).skillAnimationTimeLeft = 0;
        const pos = battle.screenPositions.get(caster.id);
        if (pos) {
          vfx.addFloatingText(pos.x, pos.y, "打断!", '#ff3333');
        }
        return;
      }

      const pos = battle.screenPositions.get(caster.id);
      if (pos) {
        const dir = caster.team === 1 ? 1 : -1;
        const baseAngle = dir === 1 ? 0 : Math.PI;
        const offset = (gameEngine.random() - 0.5) * 20 * Math.PI / 180;
        const finalAngle = baseAngle + offset;

        const isPiercing = getMonsterBadges(caster).some(b => b.id === 1);

        if (isPiercing) {
          // 穿透模式：延长弹道穿过敌人
          const extX = pos.x + Math.cos(finalAngle) * 2500;
          const extY = pos.y + Math.sin(finalAngle) * 2500;
          let hitCount = 0;
          const pr = vfx.addProjectile(pos.x, pos.y, extX, extY, 500, '#e5c158', () => {}, undefined, undefined, undefined, caster.id);
          setupPiercingProjectile(pr, caster.id, (hitId: string) => {
            hitCount++;
            const ht = battle._monsters.find((e: PlacedMonster) => e.id === hitId);
            if (ht && !ht.isDead) {
              const dmg = hitCount === 1 ? (caster.atk + 12) : Math.round((caster.atk + 12) * 0.7);
              battle.applyDamage(ht, dmg, caster);
            }
          });
          vfx.applyBulletSprite(pr, caster.dbId);
        } else {
          const tx = pos.x + Math.cos(finalAngle) * 1500;
          const ty = pos.y + Math.sin(finalAngle) * 1500;
          const pr = vfx.addProjectile(pos.x, pos.y, tx, ty, 500, '#e5c158', () => {}, undefined, undefined, undefined, caster.id);
          pr.onHit = (hitId: string) => {
            const ht = battle._monsters.find((e: PlacedMonster) => e.id === hitId);
            if (ht && !ht.isDead) {
              battle.applyDamage(ht, caster.atk + 12, caster);
            }
          };
          vfx.applyBulletSprite(pr, caster.dbId);
        }
      }

      count++;
      if (count >= 16) {
        battle.scheduler.unschedule(taskKey);
        (caster as any).openFireIntervalId = null;
        (caster as any).skillAnimationTimeLeft = 0;
      }
    }, 0.15, taskKey);

    (caster as any).openFireIntervalId = taskKey;
  }
}

// 115: Unyielding (铲土人)
export class UnyieldingSkill extends BaseSkill {
  readonly name = 'unyielding';

  public onCast(caster: PlacedMonster, battle: any): boolean {
    battle.applyHealWithChefBonus(caster, caster, 500, battle);
    return true;
  }
}

// 116: Dig (钻头)
export class DigSkill extends BaseSkill {
  readonly name = 'dig';

  public onStartOfBattle(caster: PlacedMonster, battle: any): void {
    const dir = isP1Monster(caster) ? 1 : -1;
    const startX = caster.gridX;
    const startY = caster.gridY;
    const destX = Math.max(0, Math.min(10, startX + 6 * dir));
    const destY = startY;

    // 进入深层隐身 + 钻地状态（保留grid坐标不设为-999，避免助跑徽章误算）
    battle._gridOccupation[startX][startY] = null;
    (caster as any).deepStealth = true;
    (caster as any).burrowing = true;

    // 存储出土目标
    (caster as any).burrowDestX = destX;
    (caster as any).burrowDestY = destY;

    const targetPos = gridToScreen(destX, destY);
    battle._targetPositions.set(caster.id, targetPos);
    caster.state = 'skill';

    // 钻土拖尾：上下并排两组土壤粒子（不透明，无随机，先后消失）
    const particleKey = `burrow_particle_${caster.id}`;
    battle.scheduler.scheduleInterval(() => {
      if (!battle.active || caster.isDead || !(caster as any).burrowing) {
        battle.scheduler.unschedule(particleKey);
        return;
      }
      const pos = battle.screenPositions.get(caster.id);
      if (pos) {
        // 上行浅色土壤（先消失）
        vfx.addParticle(pos.x, pos.y + 70, 'soil', 0.8, '#8B6914', 100);
        // 下行深色土壤（后消失），间距缩小3倍
        vfx.addParticle(pos.x + 20, pos.y + 45, 'soil', 0.7, '#6B4226', 100);
      }
    }, 0.08, particleKey);
  }
}

// 117: Throw (铁甲猴)
export class ThrowSkill extends BaseSkill {
  readonly name = 'throw';

  public onStartOfBattle(caster: PlacedMonster, battle: any): void {
    const dir = (caster.team === 1) ? -1 : 1;
    let bestAlly: PlacedMonster | null = null;
    // Strictly adjacent behind
    for (const m of battle._monsters) {
      if (!m.isDead && m.team === caster.team && m.gridX === caster.gridX + dir && m.gridY === caster.gridY) {
        bestAlly = m;
        break;
      }
    }
    // Fallback: any ally directly behind in the same row
    if (!bestAlly) {
      for (const m of battle._monsters) {
        if (!m.isDead && m.team === caster.team && m.gridY === caster.gridY) {
          const isBehind = (caster.team === 1) ? (m.gridX < caster.gridX) : (m.gridX > caster.gridX);
          if (isBehind) {
            bestAlly = m;
            break;
          }
        }
      }
    }

    if (!bestAlly) return;

    battle.addShield(caster, 8);
    battle.addShield(bestAlly, 8);

    (caster as any).skillAnimationTimeLeft = 1.0;

    // Landing position: fixed 5 tiles ahead of caster
    const forwardDir = (caster.team === 1) ? 1 : -1;
    let destX = Math.max(0, Math.min(10, caster.gridX + 4 * forwardDir));
    const destY = caster.gridY;

    battle.reserveCell(bestAlly.id, destX, destY);

    (bestAlly as any).skillAnimationTimeLeft = 0.5;

    battle.registerLeap(bestAlly.id, bestAlly.gridX, bestAlly.gridY, destX, destY, 0.5, bestAlly.shield * 45);
  }
}

// 118: Slash (塞雷)
export class SlashSkill extends BaseSkill {
  readonly name = 'slash';

  public onCast(caster: PlacedMonster, battle: any): boolean {
    const enemies = battle.getMonstersInGridRange(caster.gridX, caster.gridY, 1)
      .filter((e: PlacedMonster) => e.team !== caster.team && !e.isDead);

    if (enemies.length === 0) {
      return false;
    }

    (caster as any).skillAnimationTimeLeft = 0.5;

    let slashCount = 0;
    const runSlash = () => {
      if (!battle.active || caster.isDead) return;

      const currentEnemies = battle.getMonstersInGridRange(caster.gridX, caster.gridY, 1)
        .filter((e: PlacedMonster) => e.team !== caster.team && !e.isDead);

      if (currentEnemies.length > 0) {
        const target = currentEnemies[Math.floor(gameEngine.random() * currentEnemies.length)];
        let idealX = target.gridX + (target.gridX - caster.gridX);
        let idealY = target.gridY + (target.gridY - caster.gridY);
        
        // Fine-tune if out of grid bounds
        if (idealX < 0 || idealX > 10 || idealY < 0 || idealY > 4) {
          const fallback = battle.findClosestFreeCell(target.gridX, target.gridY);
          if (fallback) {
            idealX = fallback.gridX;
            idealY = fallback.gridY;
          }
        }
        const freeCell = battle.findClosestFreeCell(idealX, idealY);
        if (freeCell) {
          // 记录旧屏幕坐标（用于位移轨迹线）
          const oldPos = battle.screenPositions.get(caster.id);

          battle._gridOccupation[caster.gridX][caster.gridY] = null;
          caster.gridX = freeCell.gridX;
          caster.gridY = freeCell.gridY;
          battle._gridOccupation[freeCell.gridX][freeCell.gridY] = caster;

          const pos = gridToScreen(freeCell.gridX, freeCell.gridY);
          battle.screenPositions.set(caster.id, { ...pos });
          battle._targetPositions.set(caster.id, { ...pos });

          // 位移轨迹线（白色锥形，中间粗两边细）
          if (oldPos) {
            const dx = pos.x - oldPos.x;
            const dy = pos.y - oldPos.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const midX = (oldPos.x + pos.x) / 2;
            const midY = (oldPos.y + pos.y) / 2;
            vfx.spawnParticle(midX, midY, SKILL.slash.trail, { angle: Math.atan2(dy, dx), length: dist, tapered: true });
          }

          // 落点尘土
          vfx.spawnParticle(pos.x, pos.y, SKILL.slash.dust);
        }

        battle.applyDamage(target, Math.round(caster.atk * 1.6), caster);
      }

      slashCount++;
      if (slashCount < 3) {
        battle.scheduler.schedule(runSlash, 0.3);
      }
    };

    runSlash();
    return true;
  }
}

// 119: Shadow (忍小猴)
export class ShadowSkill extends BaseSkill {
  readonly name = 'shadow';

  public onStartOfBattle(caster: PlacedMonster, battle: any): void {
    // 开局 0.5s 技能动画：原地烟雾，不索敌
    (caster as any).skillAnimationTimeLeft = 0.5;
    (caster as any)._tiltTotal = 0.5;
    caster.state = 'skill';

    const oldPos = gridToScreen(caster.gridX, caster.gridY);
    for (let i = 0; i < 3; i++) {
      battle.scheduler.schedule(() => {
        for (let j = 0; j < 10; j++) {
          vfx.addParticle(oldPos.x, oldPos.y, 'smoke_puff', 1.5, '#777777', 20 + Math.random() * 10);
        }
      }, 0.4 * i);
    }


    // 找到最远敌人的身后格子
    let furthestEnemy: PlacedMonster | null = null;
    let maxDist = -1;
    for (const enemy of battle._monsters) {
      if (enemy.team !== caster.team && !enemy.isDead) {
        const d = Math.abs(enemy.gridX - caster.gridX) + Math.abs(enemy.gridY - caster.gridY);
        if (d > maxDist) { maxDist = d; furthestEnemy = enemy; }
      }
    }
    if (!furthestEnemy) return;
    const cell = battle.findClosestFreeCell(furthestEnemy.gridX, furthestEnemy.gridY);
    if (!cell) return;
    const newPos = gridToScreen(cell.gridX, cell.gridY);

    // 0.5s 后瞬移
    battle.scheduler.schedule(() => {
      if (!battle.active || caster.isDead) return;
      battle._gridOccupation[caster.gridX][caster.gridY] = null;
      caster.gridX = cell.gridX;
      caster.gridY = cell.gridY;
      battle._gridOccupation[caster.gridX][caster.gridY] = caster;
      battle._targetPositions.set(caster.id, newPos);
      battle.screenPositions.set(caster.id, { ...newPos });
    }, 0.5);
  }

  public onCast(caster: PlacedMonster, battle: any): boolean {
    const target = battle.findClosestEnemy(caster, true);
    if (!target) return false;

    // 两次技能触发一次隐身
    if (!(caster as any).shadowCastCount) {
      (caster as any).shadowCastCount = 0;
    }
    (caster as any).shadowCastCount++;

    // 后倾蓄力完成后（0.1s），在前倾的同时瞬移
    battle.scheduler.schedule(() => {
      if (!battle.active || caster.isDead) return;
      const oldPos = gridToScreen(caster.gridX, caster.gridY);
      for (let j = 0; j < 10; j++) {
          vfx.addParticle(oldPos.x, oldPos.y, 'smoke_puff', 1.5, '#777777', 20 + Math.random() * 10);
      }
      // 瞬移到目标周围
      const cell = battle.findClosestFreeCell(target.gridX, target.gridY);
      if (cell) {
        battle._gridOccupation[caster.gridX][caster.gridY] = null;
        caster.gridX = cell.gridX;
        caster.gridY = cell.gridY;
        battle._gridOccupation[caster.gridX][caster.gridY] = caster;
        const newPos = gridToScreen(caster.gridX, caster.gridY);
        battle._targetPositions.set(caster.id, newPos);
        battle.screenPositions.set(caster.id, { ...newPos });
      }

      if ((caster as any).shadowCastCount % 2 === 0) {
        // 半透明隐身
        (caster as any)._shadowStealth = true;
        battle.scheduler.schedule(() => {
          if (!caster.isDead) (caster as any)._shadowStealth = false;
        }, 1.5);

        // 100% 暴击
        (caster as any).stealthCrit = true;
        battle.scheduler.schedule(() => {
          if (!caster.isDead) (caster as any).stealthCrit = false;
        }, 1.5);
      }

      battle.applyDamage(target, caster.atk * 3, caster);
    }, 0.2);

    return true;
  }
}

// 120: Attack (金面猴王)
export class AttackSkill extends BaseSkill {
  readonly name = 'attack';

  public onCast(caster: PlacedMonster, battle: any): boolean {
    const allies = battle.getMonstersInGridRange(caster.gridX, caster.gridY, 2)
      .filter((a: PlacedMonster) => a.team === caster.team && !a.isDead);

    for (const ally of allies) {
      ally.atk += 30;
      const pos = battle.screenPositions.get(ally.id);
      if (pos) {
        vfx.addFloatingText(pos.x, pos.y, "+30", '#ffffff');
      }

      battle.scheduler.schedule(() => {
        if (battle.active && !ally.isDead) {
          ally.atk = Math.max(0, ally.atk - 30);
        }
      }, 7.0);
    }
    return true;
  }
}

// 121: Cultivation (僧小猴)
export class CultivationSkill extends BaseSkill {
  readonly name = 'cultivation';

  public onCast(caster: PlacedMonster, battle: any): boolean {
    caster.atk += 40;
    caster.maxHp += 300;
    
    const hpLoss = Math.floor(caster.hp * 0.2);
    caster.hp = Math.max(1, caster.hp - hpLoss);
    caster.maxHp = Math.max(1, caster.maxHp - hpLoss);

    const pos = battle.screenPositions.get(caster.id);
    if (pos) {
      vfx.addFloatingText(pos.x, pos.y, "+40", '#ffffff');
    }
    return true;
  }
}

// 122: Anger (丛林猴)
export class AngerSkill extends BaseSkill {
  readonly name = 'anger';

  public onCast(caster: PlacedMonster, battle: any): boolean {
    caster.ats *= 1.1;
    const pos = battle.screenPositions.get(caster.id);
    if (pos) {
      vfx.addFloatingText(pos.x, pos.y, "+10%", '#ffffff');
    }
    return true;
  }
}

// 123: Bash (棒球猴)
export class BashSkill extends BaseSkill {
  readonly name = 'bash';

  public onCast(caster: PlacedMonster, battle: any): boolean {
    const target = battle.findClosestEnemy(caster, true);
    if (!target) return false;

    battle.applyDamage(target, Math.round(caster.atk * 2.3), caster);

    if (!(caster as any).bashCount) {
      (caster as any).bashCount = 0;
    }
    (caster as any).bashCount++;

    if ((caster as any).bashCount % 2 === 0) {
      const freeCell = battle.findClosestFreeCell(caster.gridX, caster.gridY);
      if (freeCell) {
        const miniMonkey: PlacedMonster = {
          id: `summon_${caster.id}_${battle._summonCounter++}`,
          dbId: 123,
          data: caster.data,
          badges: [],
          gridX: freeCell.gridX,
          gridY: freeCell.gridY,
          initialGridX: freeCell.gridX,
          initialGridY: freeCell.gridY,
          placedRound: caster.placedRound,
          team: caster.team,
          hp: Math.round(caster.data.hp * 0.2),
          maxHp: Math.round(caster.data.hp * 0.2),
          atk: Math.round(caster.data.atk * 0.2),
          ats: caster.data.ats,
          range: caster.data.range,
          speed: caster.data.speed,
          shield: 0,
          skillCdProgress: 0,
          isDead: false,
          statusEffects: [],
          state: 'idle'
        };

        battle._monsters.push(miniMonkey);
        gameEngine.boardMonsters.push(miniMonkey);
        battle._gridOccupation[freeCell.gridX][freeCell.gridY] = miniMonkey;

        const scrPos = gridToScreen(freeCell.gridX, freeCell.gridY);
        battle.screenPositions.set(miniMonkey.id, { ...scrPos });
        battle._targetPositions.set(miniMonkey.id, { ...scrPos });
        battle._attackTimers.set(miniMonkey.id, 1 / miniMonkey.ats);

        vfx.spawnParticle(scrPos.x, scrPos.y, HIT.summonFlash);
      }
    }
    return true;
  }
}

// 124: Snowball (三振王)
export class SnowballSkill extends BaseSkill {
  readonly name = 'snowball';

  public onCast(caster: PlacedMonster, battle: any): boolean {
    const target = battle.findClosestEnemy(caster, true);
    if (!target) return false;

    const pos = battle.screenPositions.get(caster.id)!;
    vfx.spawnParticle(pos.x, pos.y, SKILL.snowball.launch);

    const targetPos = battle.screenPositions.get(target.id)!;
    // Add projectile with parabolic arc, target tracking, 3x size
    const pr = vfx.addProjectile(pos.x, pos.y, targetPos.x, targetPos.y, 500, '#4ba3e3', () => {
      // 雪雾爆发：少量雾气 + 大量六角冰晶碎片
      for (let i = 0; i < 8; i++) {
        vfx.spawnParticle(targetPos.x, targetPos.y, SKILL.snowball.hit);
      }
      for (let i = 0; i < 8; i++) {
        vfx.spawnParticle(targetPos.x, targetPos.y, STATUS_EFFECT.chillCrystal);
      }
      // 震荡波（1.5格半径）
      vfx.spawnParticle(targetPos.x, targetPos.y, SKILL.snowball.circle);

      const enemies = battle._monsters
        .filter((e: PlacedMonster) => e.team !== caster.team && !e.isDead)
        .filter((e: PlacedMonster) => {
          const dist = Math.sqrt(Math.pow(e.gridX - target.gridX, 2) + Math.pow(e.gridY - target.gridY, 2));
          return dist <= 2;
        });

      for (const e of enemies) {
        battle.applyDamage(e, caster.atk * 2, caster);
        battle.applyChill(e, 5.0);
        battle.applyFreeze(e, 5.0);
      }
    }, target.id, undefined, 80, caster.id);
    pr.size = 120; // 3x size
    return true;
  }
}

// 125: Conversion (战壕)
export class ConversionSkill extends BaseSkill {
  readonly name = 'conversion';

  public onCast(caster: PlacedMonster, battle: any): boolean {
    const targets = battle.getMonstersInGridRange(caster.gridX, caster.gridY, 1)
      .filter((x: PlacedMonster) => !x.isDead);

    let absorbedCount = 0;
    const cleansedTargets: PlacedMonster[] = [];
    for (const t of targets) {
      const count = t.statusEffects.length;
      if (count > 0) {
        t.statusEffects = [];
        absorbedCount += count;
        cleansedTargets.push(t);
      }
    }

    if (absorbedCount > 0) {
      caster.atk += absorbedCount * 50;
      caster.maxHp += absorbedCount * 30;
      caster.hp += absorbedCount * 30;

      const pos = battle.screenPositions.get(caster.id);
      if (pos) {
        // 吸收光环（向内收缩）
        vfx.spawnParticle(pos.x, pos.y, SKILL.conversion.ring, { shrink: true });
        // 增益十字标记
        vfx.spawnParticle(pos.x, pos.y, SKILL.conversion.buff);
        // 浮动文字
        vfx.addFloatingText(pos.x, pos.y, `+${absorbedCount * 50}`, '#ffffff');
        vfx.addFloatingText(pos.x, pos.y - 20, `+${absorbedCount * 30}`, '#5ac54f');
      }

      // 被净化目标的闪光
      for (const t of cleansedTargets) {
        const tPos = battle.screenPositions.get(t.id);
        if (tPos) {
          vfx.spawnParticle(tPos.x, tPos.y, SKILL.conversion.cleanse);
        }
      }

      battle.scheduler.schedule(() => {
        if (battle.active && !caster.isDead) {
          caster.atk = Math.max(0, caster.atk - absorbedCount * 50);
        }
      }, 2.5);
    }
    return true;
  }
}

const SKILL_REGISTRY: Record<string, BaseSkill> = {
  'reap': new ReapSkill(),
  'lightning': new LightningSkill(),
  'life_link': new LifeLinkSkill(),
  'incendiary': new IncendiarySkill(),
  'recovery': new RecoverySkill(),
  'rush': new RushSkill(),
  'big_cannon': new BigCannonSkill(),
  'leap': new LeapSkill(),
  'shot': new ShotSkill(),
  'shield': new ShieldSkill(),
  'wind_attack': new WindAttackSkill(),
  'heal_sword': new HealSwordSkill(),
  'explosive': new ExplosiveSkill(),
  'open_fire': new OpenFireSkill(),
  'unyielding': new UnyieldingSkill(),
  'dig': new DigSkill(),
  'throw': new ThrowSkill(),
  'slash': new SlashSkill(),
  'shadow': new ShadowSkill(),
  'attack': new AttackSkill(),
  'cultivation': new CultivationSkill(),
  'anger': new AngerSkill(),
  'bash': new BashSkill(),
  'snowball': new SnowballSkill(),
  'conversion': new ConversionSkill()
};

export function getSkill(name: string): BaseSkill | null {
  return SKILL_REGISTRY[name] || null;
}
