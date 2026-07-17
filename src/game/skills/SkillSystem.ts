import { PlacedMonster, gameEngine } from '../GameEngine';
import { vfx } from '../VfxManager';

// Helpers to avoid circular dependency with BattleSystem
function isP1Monster(m: PlacedMonster): boolean {
  return m.team === 1;
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

// 101: Reap (肃清哥)
export class ReapSkill extends BaseSkill {
  readonly name = 'reap';

  public onCast(caster: PlacedMonster, battle: any): boolean {
    const target = battle.findClosestEnemy(caster, true);
    if (!target) return false;

    const pos = battle.screenPositions.get(caster.id);
    if (pos) {
      vfx.addParticle(pos.x, pos.y, 'slash', 0.3, '#df3e23', 30);
    }

    const enemies = battle.getAdjacentMonsters(caster.gridX, caster.gridY)
      .filter((e: PlacedMonster) => isP1Monster(e) !== isP1Monster(caster));

    for (const e of enemies) {
      battle.applyDamage(e, 120, caster, false, false, true);
      // Bleed effect: 2% of max HP per second, duration 6s
      battle.applyStatusEffect(e, { type: 'bleed', duration: 6.0 });
    }
    return true;
  }
}

// 102: Lightning (大祭司哥)
export class LightningSkill extends BaseSkill {
  readonly name = 'lightning';

  public onCast(caster: PlacedMonster, battle: any): boolean {
    const target = battle.findClosestEnemy(caster, true);
    if (!target) return false;

    // Filter targets within 7 grid cells (Euclidean distance)
    const enemies = battle._monsters
      .filter((e: PlacedMonster) => isP1Monster(e) !== isP1Monster(caster) && !e.isDead)
      .filter((e: PlacedMonster) => {
        const dx = e.gridX - caster.gridX;
        const dy = e.gridY - caster.gridY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        return dist <= 7;
      })
      .slice(0, 4);

    if (enemies.length === 0) return false;

    for (const e of enemies) {
      const ePos = battle.screenPositions.get(e.id);
      if (ePos) {
        vfx.addParticle(ePos.x, ePos.y, 'lightning', 0.4, '#4ba3e3');
        battle.applyDamage(e, 570, caster, false, false, true);
        if (gameEngine.random() < 0.5) {
          battle.applyStatusEffect(e, { type: 'stun', duration: 2.0 });
          vfx.addFloatingText(ePos.x, ePos.y, "眩晕!", '#4ba3e3');
        }
      }
    }
    return true;
  }
}

// 103: Life Link (学徒哥)
export class LifeLinkSkill extends BaseSkill {
  readonly name = 'life_link';

  public onCast(caster: PlacedMonster, battle: any): boolean {
    const target = battle.findClosestEnemy(caster, true);
    if (!target) return false;

    const allies = battle._monsters
      .filter((a: PlacedMonster) => isP1Monster(a) === isP1Monster(caster) && !a.isDead);

    if (allies.length === 0) return false;

    let totalHp = 0;
    let totalMaxHp = 0;
    for (const a of allies) {
      totalHp += a.hp;
      totalMaxHp += a.maxHp;
    }
    const avgPercent = totalHp / totalMaxHp;
    for (const a of allies) {
      a.hp = Math.round(a.maxHp * avgPercent);
      const aPos = battle.screenPositions.get(a.id);
      if (aPos) {
        vfx.addParticle(aPos.x, aPos.y, 'heal', 0.3, '#5ac54f', 10);
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
        vfx.addProjectile(pos.x, pos.y, tx, ty, 500, '#ff4500', () => {
          if (isCenter) {
            // Apply 3x ATK damage
            battle.applyDamage(target, caster.atk * 3, caster, false, false, true);
            
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

// 105: Recovery (祈祷哥)
export class RecoverySkill extends BaseSkill {
  readonly name = 'recovery';

  public onStartOfBattle(caster: PlacedMonster, battle: any): void {
    const adjacentAllies = battle.getAdjacentMonsters(caster.gridX, caster.gridY)
      .filter((ally: PlacedMonster) => isP1Monster(ally) === isP1Monster(caster) && ally.id !== caster.id);
    
    const allyIds = adjacentAllies.map((ally: PlacedMonster) => ally.id);
    battle.registerPriestLinks(caster.id, allyIds);

    for (const ally of adjacentAllies) {
      const aPos = battle.screenPositions.get(ally.id);
      if (aPos) {
        vfx.addFloatingText(aPos.x, aPos.y, "连结", '#5ac54f');
        vfx.addParticle(aPos.x, aPos.y, 'heal', 0.5, '#5ac54f', 12);
      }
    }
  }
}

// 106: Rush (冲锋哥)
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

    // Free original grid cell, and reserve the target cell immediately
    battle._gridOccupation[startX][startY] = null;
    battle.reserveCell(caster.id, landX, startY);

    // Apply speed dash visual state: stealth status + stun duration (so they don't hit while sliding)
    battle.applyStatusEffect(caster, { type: 'stealth', duration: 1.5 });
    battle.applyStatusEffect(caster, { type: 'stun', duration: 1.5 });

    const kbDist = hitEnemy ? (gameEngine.random() < 0.5 ? 2 : 3) : 0;
    // Register deferred charge collision trigger
    battle.registerCharge(caster.id, hitEnemy ? hitEnemy.id : '', dir, kbDist);
  }
}

// 107: Big Cannon (咒法骑士)
export class BigCannonSkill extends BaseSkill {
  readonly name = 'big_cannon';

  public onStartOfBattle(caster: PlacedMonster, battle: any): void {
    // 2.0s charging
    (caster as any).chargingCannon = true;
    
    // Add periodic simple particles to represent charging
    const intervalKey = `big_cannon_charge_${caster.id}`;
    battle.scheduler.scheduleInterval(() => {
      if (!battle.active || caster.isDead || !(caster as any).chargingCannon) {
        battle.scheduler.unschedule(intervalKey);
        return;
      }
      const pos = battle.screenPositions.get(caster.id);
      if (pos) {
        vfx.addParticle(pos.x, pos.y, 'star', 0.5, '#ffff00', 16);
      }
    }, 0.2, intervalKey);

    battle.scheduler.schedule(() => {
      (caster as any).chargingCannon = false;
      battle.scheduler.unschedule(intervalKey);

      if (battle.active && !caster.isDead) {
        const target = battle.findClosestEnemy(caster, true);
        if (target) {
          const pos = battle.screenPositions.get(caster.id);
          const tPos = battle.screenPositions.get(target.id);
          if (pos && tPos) {
            const isPiercing = caster.badges.some((b: any) => b.id === 1);
            if (isPiercing) {
              const dx = tPos.x - pos.x;
              const dy = tPos.y - pos.y;
              const dirLen = Math.sqrt(dx * dx + dy * dy);
              const extX = tPos.x + (dx / dirLen) * 2500;
              const extY = tPos.y + (dy / dirLen) * 2500;
              vfx.addProjectile(pos.x, pos.y, extX, extY, 450, '#ff3333', () => {}, undefined);
              const pr = vfx.projectiles[vfx.projectiles.length - 1];
              pr.ownerId = caster.id;
              pr.isPiercing = true;
              pr.hitTargetIds = new Set<string>();
              pr.onHit = (hitId: string) => {
                const ht = battle._monsters.find((e: any) => e.id === hitId);
                if (ht) {
                  battle.applyDamage(ht, caster.atk * 13, caster, false, false, true);
                  const hitPos = battle.screenPositions.get(ht.id);
                  if (hitPos) {
                    vfx.addParticle(hitPos.x, hitPos.y, 'explosion', 0.4, '#ff3333', 30);
                  }
                }
              };
            } else {
              vfx.addProjectile(pos.x, pos.y, tPos.x, tPos.y, 450, '#ff3333', () => {
                battle.applyDamage(target, caster.atk * 13, caster, false, false, true);
                const hitPos = battle.screenPositions.get(target.id);
                if (hitPos) {
                  vfx.addParticle(hitPos.x, hitPos.y, 'explosion', 0.4, '#ff3333', 30);
                }
              }, target.id);
              vfx.projectiles[vfx.projectiles.length - 1].ownerId = caster.id;
            }
          }
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
      vfx.addParticle(pos.x, pos.y, 'star', 0.5, '#00ffff', 24);
      vfx.addFloatingText(pos.x, pos.y, "锁定!", '#00ffff');
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
      // Wind circle particle of size 160 (radius 160, total width 320)
      vfx.addParticle(pos.x, pos.y, 'wind_circle', 0.4, '#ffffff', 160);
      
      const enemies = battle.getMonstersInGridRange(caster.gridX, caster.gridY, 1)
        .filter((e: PlacedMonster) => isP1Monster(e) !== isP1Monster(caster));
      
      for (const e of enemies) {
        battle.applyDamage(e, caster.atk * 2, caster, false, false, true);
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
      vfx.addParticle(pos.x, pos.y, 'heal_circle', 1.0, '#5ac54f', 100);

      // Deal 1.5x damage to closest enemy in range
      const target = battle.findClosestEnemy(caster, true);
      if (target && Math.abs(target.gridX - caster.gridX) <= 1 && Math.abs(target.gridY - caster.gridY) <= 1) {
        battle.applyDamage(target, Math.round(caster.atk * 1.5), caster, false, false, true);
      }

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
      battle.applyHeal(a, Math.round(a.maxHp * 0.05));
    }
    battle.applyHeal(caster, Math.round(caster.maxHp * 0.08));
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
        const enemiesInRow = battle._monsters
          .filter((e: PlacedMonster) => isP1Monster(e) !== isP1Monster(caster) && !e.isDead && e.gridY === caster.gridY);
        
        let targetEnemy: PlacedMonster | null = null;
        let closestDist = Infinity;
        for (const e of enemiesInRow) {
          const dist = Math.abs(e.gridX - caster.gridX);
          if (dist < closestDist) {
            closestDist = dist;
            targetEnemy = e;
          }
        }

        const dir = caster.team === 1 ? 1 : -1;
        const baseAngle = dir === 1 ? 0 : Math.PI;
        const offset = (gameEngine.random() - 0.5) * 20 * Math.PI / 180;
        const finalAngle = baseAngle + offset;

        let tx = pos.x + Math.cos(finalAngle) * 1500;
        let ty = pos.y + Math.sin(finalAngle) * 1500;

        if (targetEnemy) {
          const tPos = battle.screenPositions.get(targetEnemy.id);
          if (tPos) {
            const dist = Math.sqrt((tPos.x - pos.x) ** 2 + (tPos.y - pos.y) ** 2);
            tx = pos.x + Math.cos(finalAngle) * dist;
            ty = pos.y + Math.sin(finalAngle) * dist;
          }
        }

        vfx.addProjectile(pos.x, pos.y, tx, ty, 500, '#e5c158', () => {
          if (targetEnemy && !targetEnemy.isDead && battle.active) {
            battle.applyDamage(targetEnemy, caster.atk + 12, caster, false, false, true);
          }
        });
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
    battle.applyHeal(caster, 500);
    return true;
  }
}

// 116: Dig (钻头)
export class DigSkill extends BaseSkill {
  readonly name = 'dig';

  public onStartOfBattle(caster: PlacedMonster, battle: any): void {
    battle.addShield(caster, 6);
    
    const dir = isP1Monster(caster) ? 1 : -1;
    const startX = caster.gridX;
    const startY = caster.gridY;

    const idealX = Math.max(0, Math.min(10, caster.gridX + 6 * dir));
    const landGridY = caster.gridY;

    const occupant = battle._gridOccupation[idealX][landGridY];
    if (occupant && isP1Monster(occupant) !== isP1Monster(caster)) {
      const freeCell = battle.findClosestFreeCell(idealX, landGridY);
      if (freeCell) {
        battle._gridOccupation[idealX][landGridY] = null;
        occupant.gridX = freeCell.gridX;
        occupant.gridY = freeCell.gridY;
        battle._gridOccupation[freeCell.gridX][freeCell.gridY] = occupant;
        
        const slidePos = {
          x: 588 + (freeCell.gridX + 0.5) * 125.4,
          y: 236 + (freeCell.gridY + 0.5) * 141.4
        };
        battle._targetPositions.set(occupant.id, slidePos);
      }
    }

    for (let i = 1; i <= 6; i++) {
      const tx = startX + i * dir;
      if (tx >= 0 && tx <= 10) {
        const enemy = battle._gridOccupation[tx][landGridY];
        if (enemy && isP1Monster(enemy) !== isP1Monster(caster)) {
          battle.applyStatusEffect(enemy, { type: 'stun', duration: 2.0 });
          battle.applyDamage(enemy, 80, caster, false, false, true);
          const ePos = battle.screenPositions.get(enemy.id);
          if (ePos) {
            vfx.addFloatingText(ePos.x, ePos.y, "击晕!", '#e5c158');
          }
        }
      }
    }

    (caster as any).digging = true;
    battle.applyStatusEffect(caster, { type: 'invincible', duration: 1.0 });
    battle.applyStatusEffect(caster, { type: 'stealth', duration: 1.0 });
    battle._gridOccupation[startX][startY] = null;
    battle.reserveCell(caster.id, idealX, landGridY);

    const targetPos = {
      x: 588 + (idealX + 0.5) * 125.4,
      y: 236 + (landGridY + 0.5) * 141.4
    };
    battle._targetPositions.set(caster.id, targetPos);
    caster.state = 'walk';
  }
}

function localGridToScreen(gx: number, gy: number): { x: number; y: number } {
  return {
    x: 588 + (gx + 0.5) * 125.4,
    y: 236 + (gy + 0.5) * 141.4
  };
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

    const enemy = battle.findClosestEnemy(caster);
    let destX = caster.gridX;
    let destY = caster.gridY;
    if (enemy) {
      destX = enemy.gridX;
      destY = enemy.gridY;
    } else {
      const dir = (caster.team === 1) ? 1 : -1;
      destX = Math.max(0, Math.min(10, caster.gridX + 4 * dir));
    }

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
          battle._gridOccupation[caster.gridX][caster.gridY] = null;
          caster.gridX = freeCell.gridX;
          caster.gridY = freeCell.gridY;
          battle._gridOccupation[freeCell.gridX][freeCell.gridY] = caster;

          const pos = localGridToScreen(freeCell.gridX, freeCell.gridY);
          battle.screenPositions.set(caster.id, { ...pos });
          battle._targetPositions.set(caster.id, { ...pos });
        }

        battle.applyDamage(target, 192, caster, false, false, true);
        const tPos = battle.screenPositions.get(target.id);
        if (tPos) {
          vfx.addParticle(tPos.x, tPos.y, 'slash', 0.2, '#ffffff', 8);
        }
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
    battle.scheduler.schedule(() => {
      if (!battle.active || caster.isDead) return;

      let furthestEnemy: PlacedMonster | null = null;
      let maxDist = -1;
      for (const enemy of battle._monsters) {
        if (enemy.team !== caster.team && !enemy.isDead) {
          const d = Math.abs(enemy.gridX - caster.gridX) + Math.abs(enemy.gridY - caster.gridY);
          if (d > maxDist) {
            maxDist = d;
            furthestEnemy = enemy;
          }
        }
      }

      if (furthestEnemy) {
        const cell = battle.findClosestFreeCell(furthestEnemy.gridX, furthestEnemy.gridY);
        if (cell) {
          battle._gridOccupation[caster.gridX][caster.gridY] = null;
          caster.gridX = cell.gridX;
          caster.gridY = cell.gridY;
          battle._gridOccupation[caster.gridX][caster.gridY] = caster;

          const newPos = localGridToScreen(caster.gridX, caster.gridY);
          battle._targetPositions.set(caster.id, newPos);
          battle.screenPositions.set(caster.id, { ...newPos });
          if ((globalThis as any).vfx) {
            (globalThis as any).vfx.addParticle(newPos.x, newPos.y, 'explosion', 0.25, '#8833ff');
          }
        }
      }
    }, 0.5);
  }

  public onCast(caster: PlacedMonster, battle: any): boolean {
    if (!(caster as any).shadowCastCount) {
      (caster as any).shadowCastCount = 0;
    }
    (caster as any).shadowCastCount++;

    if ((caster as any).shadowCastCount % 2 === 0) {
      battle.applyStatusEffect(caster, { type: 'stealth', duration: 2.0 });
      const pos = battle.screenPositions.get(caster.id);
      if (pos) {
        vfx.addFloatingText(pos.x, pos.y, "隐身!", '#8833ff');
      }
    }

    const target = battle.findClosestEnemy(caster, true);
    if (target) {
      battle.applyDamage(target, caster.atk * 3, caster, false, false, true);
      return true;
    }
    return false;
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
        vfx.addFloatingText(pos.x, pos.y, "+30 ATK", '#ffffff');
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
      vfx.addFloatingText(pos.x, pos.y, "+40 ATK", '#ffffff');
      vfx.addFloatingText(pos.x, pos.y - 20, `+300 MaxHP`, '#5ac54f');
      vfx.addFloatingText(pos.x, pos.y - 40, `-${hpLoss} HP`, '#ff3333');
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
      vfx.addFloatingText(pos.x, pos.y, "+10% 攻速", '#ffffff');
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

    battle.applyDamage(target, 207, caster, false, false, true);

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

        const scrPos = localGridToScreen(freeCell.gridX, freeCell.gridY);
        battle.screenPositions.set(miniMonkey.id, { ...scrPos });
        battle._targetPositions.set(miniMonkey.id, { ...scrPos });
        battle._attackTimers.set(miniMonkey.id, 0);

        vfx.addParticle(scrPos.x, scrPos.y, 'explosion', 0.25, '#8833ff');
        vfx.addFloatingText(scrPos.x, scrPos.y, "召唤!", '#5ac54f');
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
    vfx.addParticle(pos.x, pos.y, 'incendiary', 0.4, '#4ba3e3', 60);

    const targetPos = battle.screenPositions.get(target.id)!;
    vfx.addProjectile(pos.x, pos.y, targetPos.x, targetPos.y, 350, '#aae0ff', () => {
      const enemies = battle._monsters
        .filter((e: PlacedMonster) => e.team !== caster.team && !e.isDead)
        .filter((e: PlacedMonster) => {
          const dist = Math.sqrt(Math.pow(e.gridX - target.gridX, 2) + Math.pow(e.gridY - target.gridY, 2));
          return dist <= 2;
        });

      for (const e of enemies) {
        battle.applyDamage(e, caster.atk * 2, caster, false, false, true);
        const hasChill = e.statusEffects.some((s: any) => s.type === 'chill');
        battle.applyStatusEffect(e, { type: 'chill', duration: 5.0 });
        if (!hasChill && e.statusEffects.some((s: any) => s.type === 'chill')) {
          battle.scheduler.schedule(() => {
            if (battle.active && !e.isDead) {
              e.ats /= 0.65;
            }
          }, 5.0);
        }
      }
    });
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
    for (const t of targets) {
      const count = t.statusEffects.length;
      if (count > 0) {
        t.statusEffects = [];
        absorbedCount += count;
      }
    }

    if (absorbedCount > 0) {
      caster.atk += absorbedCount * 50;
      caster.maxHp += absorbedCount * 30;
      caster.hp += absorbedCount * 30;

      const pos = battle.screenPositions.get(caster.id);
      if (pos) {
        vfx.addFloatingText(pos.x, pos.y, `+${absorbedCount * 50} ATK`, '#ffffff');
        vfx.addFloatingText(pos.x, pos.y - 20, `+${absorbedCount * 30} HP上限`, '#5ac54f');
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
