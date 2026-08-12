import { PlacedMonster, gameEngine } from './GameEngine';
import { vfx } from './VfxManager';
import { getMonsterBadges, badgeGetRangeBonus } from './BadgeSystem';
import { isP1Monster } from './BattleSystem';
import { LEAP_PEAK_HEIGHT, LEAP_DURATION, THROW_PEAK_HEIGHT, THROW_DURATION, SKILL_DELAY, RUSH_WINDUP } from './animation/AnimTuning';
import { getAnimationClip } from './animation/AnimationAnimator';
import { DB_MONSTERS, gridToScreen } from './Database';
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

    // 反方向蓄力0.2s + 加减速旋转0.8s = 1.0s
    (caster as any)._rotationDuration = 1.0;
    (caster as any)._rotationRemaining = 1.0;
    caster.state = 'skill';

    // 0.2s 蓄力完成后触发伤害、流血和粒子特效
    battle.scheduler.schedule(() => {
      if (caster.isDead) return;
      const pos = battle.screenPositions.get(caster.id);
      if (!pos) return;

      // 伤害和流血（传入 source 用于吸血）
      const enemies = battle.getAdjacentMonsters(caster.gridX, caster.gridY)
        .filter((e: PlacedMonster) => isP1Monster(e) !== isP1Monster(caster));
      for (const e of enemies) {
        battle.applyDamage(e, Math.round(caster.atk * 1.0), caster);
        battle.applyStatusEffect(e, { type: 'bleed', duration: 6.0, source: caster.id });
      }

      // 血色漩涡斩击：0.2s / 0.4s / 0.6s / 0.8s 共四段（跟随旋转方向顺时针）
      const arcTimes = [0.2, 0.4, 0.6, 0.8];
      for (const t of arcTimes) {
        vfx.spawnParticle(pos.x, pos.y, SKILL.reap.bloodArc);
        if (t < 0.8) {
          battle.scheduler.schedule(() => {
            const p = battle.screenPositions.get(caster.id) || pos;
            if (!caster.isDead) vfx.spawnParticle(p.x, p.y, SKILL.reap.bloodArc);
          }, t);
        }
      }

      // 血雾效果
      for (let i = 0; i < 12; i++) {
        vfx.spawnParticle(pos.x, pos.y, SKILL.reap.bloodMist);
        if (i < 6) {
          battle.scheduler.schedule(() => {
            const p = battle.screenPositions.get(caster.id) || pos;
            vfx.spawnParticle(p.x, p.y, SKILL.reap.bloodMist);
          }, 0.2 + i * 0.08);
        }
      }

      // 血滴飞溅
      for (let i = 0; i < 10; i++) {
        vfx.spawnParticle(pos.x, pos.y, SKILL.reap.bloodDrop);
        battle.scheduler.schedule(() => {
          const p = battle.screenPositions.get(caster.id) || pos;
          vfx.spawnParticle(p.x, p.y, SKILL.reap.bloodDrop);
        }, i * 0.06);
      }
    }, 0.2);

    return true;
  }
}

// 102: Lightning (大祭司哥) — 雷霆审判
export class LightningSkill extends BaseSkill {
  readonly name = 'lightning';

  public onCast(caster: PlacedMonster, battle: any): boolean {
    const firstTarget = battle.findClosestEnemy(caster, true);
    if (!firstTarget) return false;

    // 技能前摇（AnimTuning.SKILL_DELAY 可调）后开始链式闪电
    battle.scheduler.schedule(() => {
      if (!battle.active || caster.isDead) return;

      // 本次施法已命中的目标，链式闪电不重复攻击同一目标
      const hitIds = new Set<string>();

      const doStrike = (currentTarget: PlacedMonster, remaining: number) => {
        if (!battle.active || caster.isDead || !currentTarget || currentTarget.isDead) return;
        hitIds.add(currentTarget.id);

        const ePos = battle.screenPositions.get(currentTarget.id);
        if (ePos) {
          // 天雷
          vfx.spawnParticle(ePos.x, ePos.y, SKILL.lightningStorm.hit);
          // 落点火花
          for (let i = 0; i < 3; i++) {
            vfx.spawnParticle(
              ePos.x + (Math.random() - 0.5) * 40,
              ePos.y + (Math.random() - 0.5) * 20,
              { type: 'star', duration: 0.3, color: '#c0e0ff', size: 30 }
            );
          }
          battle.applyDamage(currentTarget, Math.round(caster.atk * 2.5), caster);
          if (gameEngine.random() < 0.5) {
            battle.applyStatusEffect(currentTarget, { type: 'stun', duration: 2.0 });
          }
        }

        if (remaining <= 0) return;

        // 0.2s 后在未命中的敌人中随机选一个，全部命中过则停止连锁
        battle.scheduler.schedule(() => {
          const candidates = battle._monsters
            .filter((e: PlacedMonster) =>
              isP1Monster(e) !== isP1Monster(caster) && !e.isDead
              && !hitIds.has(e.id)
            );
          if (candidates.length === 0) return;
          const next = candidates[Math.floor(gameEngine.random() * candidates.length)];
          doStrike(next, remaining - 1);
        }, 0.2);
      };

      doStrike(firstTarget, 3);
    }, SKILL_DELAY[102] ?? 1.0);

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
        return Math.sqrt(dx * dx + dy * dy) <= 3 + badgeGetRangeBonus(caster);
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

    // 技能延迟（秒，AnimTuning.SKILL_DELAY 可调）：配合技能动画抬枪相位再出手
    const delay = SKILL_DELAY[caster.dbId] ?? 0;
    battle.scheduler.schedule(() => {
      if (caster.isDead || !battle.active) return;
      const pos = battle.screenPositions.get(caster.id);
      const tPos = battle.screenPositions.get(target.id);
      if (!pos || !tPos) return;

      // 发射原点跟随动画枪口（与普攻一致），无枪口时回退身体中心
      const muzzle = (caster as any)._weaponMuzzle;
      const fireX = muzzle ? muzzle.x : pos.x;
      const fireY = muzzle ? muzzle.y : pos.y;
      const angle = Math.atan2(tPos.y - fireY, tPos.x - fireX);

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

      const cfg = SKILL.multishot.projectile;
      angles.forEach((offset, idx) => {
        const a = angle + offset;
        // 子弹延伸至远处，碰撞才销毁，不追踪目标
        const tx = fireX + Math.cos(a) * 2500;
        const ty = fireY + Math.sin(a) * 2500;

        const isCenter = idx === 3;
        const pr = vfx.addProjectile(fireX, fireY, tx, ty, cfg.speed, cfg.color, () => {}, undefined, undefined, undefined, caster.id);
        vfx.applyBulletSprite(pr, caster.dbId);
        if (isCenter) {
          pr.onHit = (hitId: string) => {
            const ht = battle._monsters.find((e: any) => e.id === hitId);
            if (ht) {
              battle.applyDamage(ht, caster.atk * 3, caster);
              battle.applyKnockback(ht, dir, 0, 1);
              battle.applyStatusEffect(ht, { type: 'burn', duration: 4.0 });
            }
          };
        }
      });
    }, delay);
    return true;
  }
}

// 105: Recovery (祈祷哥) — 圣疗
export class RecoverySkill extends BaseSkill {
  readonly name = 'recovery';

  public onStartOfBattle(caster: PlacedMonster, battle: any): void {
    (caster as any).skillAnimationTimeLeft = 0.8;

    const adjacentAllies = battle.getAdjacentMonsters(caster.gridX, caster.gridY)
      .filter((ally: PlacedMonster) => isP1Monster(ally) === isP1Monster(caster) && ally.id !== caster.id);
    
    // 自身选中光效
    const cPos = battle.screenPositions.get(caster.id);
    if (cPos) {
      vfx.spawnParticle(cPos.x, cPos.y, { type: 'wind_circle', duration: 0.4, color: '#a0ffc0', size: 30 });
      battle.scheduler.schedule(() => {
        if (caster.isDead) return;
        const pos = battle.screenPositions.get(caster.id);
        if (pos) {
          vfx.spawnParticle(pos.x, pos.y, { type: 'solid_glow', duration: 0.5, color: '#a0ffc0', size: 100 });
        }
      }, 0.25);
    }

    // 对每个连接友方生成选中光效：先柔光环标记，再受击确认
    for (const ally of adjacentAllies) {
      const aPos = battle.screenPositions.get(ally.id);
      if (!aPos) continue;
      // 0.0s: 柔光选中环（风圈，白绿色）
      vfx.spawnParticle(aPos.x, aPos.y, { type: 'wind_circle', duration: 0.4, color: '#a0ffc0', size: 30 });
      // 0.25s: 受击确认（纯色光效）
      battle.scheduler.schedule(() => {
        if (ally.isDead) return;
        const pos = battle.screenPositions.get(ally.id);
        if (pos) {
          vfx.spawnParticle(pos.x, pos.y, { type: 'solid_glow', duration: 0.5, color: '#a0ffc0', size: 100 });
        }
      }, 0.25);
    }

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
          landX = checkX; // 直接重叠敌人位置
          break;
        }
      }
      checkX += dir;
    }

    // If no enemy hit, slide all the way to the boundary wall
    if (!hitEnemy) {
      landX = dir === 1 ? maxBound : minBound;
    }

    // 前摇动画：106s 技能剪辑（武器后摆 → 前冲），时长 = RUSH_WINDUP（AnimTuning 可调）。
    // 冲锋发起时刻与动画前冲段同步。
    (caster as any)._chargeDir = dir;
    (caster as any).skillAnimationTimeLeft = RUSH_WINDUP;
    caster.state = 'skill';

    const cPos = battle.screenPositions.get(caster.id);
    if (cPos) {
      // 脚下蓄力扬尘
      for (let i = 0; i < 4; i++) {
        vfx.spawnParticle(
          cPos.x + (Math.random() - 0.5) * 40,
          cPos.y + 60 + Math.random() * 30,
          { type: 'dust', duration: 0.5, color: '#aa9977', size: 10 }
        );
      }
    }

    const kbDist = hitEnemy ? (gameEngine.random() < 0.5 ? 2 : 3) : 0;

    // 蓄力段动画（117s 后仰蓄力，t=0~40 帧）结束后正式发起冲锋
    battle.scheduler.schedule(() => {
      if (caster.isDead) return;
      (caster as any)._chargeDir = undefined;
      caster.state = 'idle';

      // 层1: 冲刺留在原地的烟雾
      const trailKey = battle.scheduler.scheduleInterval(() => {
        const sPos = battle.screenPositions.get(caster.id);
        if (sPos && (!hitEnemy || !target.isDead)) {
          // 原地烟雾
          for (let i = 0; i < 2; i++) {
            vfx.spawnParticle(
              sPos.x,
              sPos.y + (Math.random() - 0.5) * 15,
              SKILL.rush.trail,
              { dir }
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

      // Apply speed dash visual state
      battle.applyStatusEffect(caster, { type: 'stealth', duration: 1.5 });
      battle.applyStatusEffect(caster, { type: 'stun', duration: 1.5 });

      // Register deferred charge collision trigger
      battle.registerCharge(caster.id, hitEnemy ? hitEnemy.id : '', dir, kbDist);

      // 破风半圆跟随施法者移动
      const startPos = battle.screenPositions.get(caster.id);
      if (startPos) {
        vfx.spawnParticle(startPos.x, startPos.y, SKILL.rush.windRing, { ownerId: caster.id, dir });
        battle.scheduler.schedule(() => {
          const p2 = battle.screenPositions.get(caster.id);
          if (p2) vfx.spawnParticle(p2.x, p2.y, SKILL.rush.windRing, { ownerId: caster.id, dir });
        }, 0.2);
      }
    }, RUSH_WINDUP);
  }
}

// 107: Big Cannon (咒法骑士)
export class BigCannonSkill extends BaseSkill {
  readonly name = 'big_cannon';

  public onStartOfBattle(caster: PlacedMonster, battle: any): void {
    // 2.0s charging
    (caster as any).chargingCannon = true;
    
    // 蓄力（0.4s 间隔，2秒共5次）
    const intervalKey = `big_cannon_charge_${caster.id}`;
    battle.scheduler.scheduleInterval(() => {
      if (!battle.active || caster.isDead || !(caster as any).chargingCannon) {
        battle.scheduler.unschedule(intervalKey);
        return;
      }
      const pos = battle.screenPositions.get(caster.id);
      if (pos) {
        // 法杖头部位置（武器锚点 + 沿队伍方向伸出枪口长度）
        const dir = caster.team === 1 ? 1 : -1;
        const ang = dir === 1 ? 0 : Math.PI;
        const muzzle = (caster as any)._weaponMuzzle;
        const px = muzzle ? muzzle.x + Math.cos(ang) * (muzzle.length || 0) : pos.x;
        const py = muzzle ? muzzle.y + Math.sin(ang) * (muzzle.length || 0) : pos.y;
        // 蓄力实心球与放大扩散圆环（不带 ownerId：粒子固定在枪口坐标，避免被拉回身体中心）
        vfx.spawnParticle(px, py, SKILL.bigCannon.chargeOrb);
        vfx.spawnParticle(px, py, SKILL.bigCannon.chargeRing);
        // 增加汇聚粒子数量（改为生成 4 粒且高度可见）
        for (let i = 0; i < 4; i++) {
          vfx.spawnParticle(px, py, SKILL.bigCannon.chargeMist);
        }
      }
    }, 0.4, intervalKey);

    battle.scheduler.schedule(() => {
      (caster as any).chargingCannon = false;
      battle.scheduler.unschedule(intervalKey);

      // 蓄力期间被眩晕 → 打断
      if (caster.statusEffects.some((e: any) => e.type === 'stun')) {
        const pos = battle.screenPositions.get(caster.id);
        if (pos) {
          vfx.addFloatingText(pos.x, pos.y, "打断!", '#ff3333');
        }
        return;
      }

      if (battle.active && !caster.isDead) {
        const pos = battle.screenPositions.get(caster.id);
        if (!pos) return;

        const dir = caster.team === 1 ? 1 : -1;
        const baseAngle = dir === 1 ? 0 : Math.PI;
        // 法杖头部位置（武器锚点 + 沿队伍方向伸出枪口长度）
        const muzzle = (caster as any)._weaponMuzzle;
        const fireX = muzzle ? muzzle.x + Math.cos(baseAngle) * (muzzle.length || 0) : pos.x;
        const fireY = muzzle ? muzzle.y + Math.sin(baseAngle) * (muzzle.length || 0) : pos.y;

        // 炮口闪光
        vfx.spawnParticle(fireX, fireY, SKILL.bigCannon.muzzle);

        const isPiercing = getMonsterBadges(caster).some(b => b.id === 1);
        
        if (isPiercing) {
          const extX = fireX + Math.cos(baseAngle) * 2500;
          const extY = fireY + Math.sin(baseAngle) * 2500;
          const pr = vfx.addProjectileByType(fireX, fireY, extX, extY, 'cannon', () => {}, undefined, undefined, caster.id);
          setupPiercingProjectile(pr, caster.id, (hitId: string) => {
            const ht = battle._monsters.find((e: any) => e.id === hitId);
            if (ht) {
              battle.applyDamage(ht, caster.atk * 7.5, caster);
              const hitPos = battle.screenPositions.get(ht.id);
              if (hitPos) {
                // 击中：实心爆闪球 + 放大扩散环 + 三向旋转放射线 + 扩散紫色烟雾
                vfx.spawnParticle(hitPos.x, hitPos.y, SKILL.bigCannon.hitOrb, { mode: 'hit' });
                vfx.spawnParticle(hitPos.x, hitPos.y, SKILL.bigCannon.hitRing, { mode: 'hit' });
                vfx.spawnParticle(hitPos.x, hitPos.y, SKILL.bigCannon.hitRays);
                for (let i = 0; i < 6; i++) {
                  vfx.spawnParticle(hitPos.x, hitPos.y, SKILL.bigCannon.hitMist, { mode: 'hit' });
                }
              }
            }
          });
        } else {
          const tx = fireX + Math.cos(baseAngle) * 2500;
          const ty = fireY + Math.sin(baseAngle) * 2500;
          const pr = vfx.addProjectileByType(fireX, fireY, tx, ty, 'cannon', () => {}, undefined, undefined, caster.id);
          pr.onHit = (hitId: string) => {
            const ht = battle._monsters.find((e: any) => e.id === hitId);
            if (ht) {
              battle.applyDamage(ht, caster.atk * 7.5, caster);
              const hitPos = battle.screenPositions.get(ht.id);
              if (hitPos) {
                // 击中：实心爆闪球 + 放大扩散环 + 三向旋转放射线 + 扩散紫色烟雾
                vfx.spawnParticle(hitPos.x, hitPos.y, SKILL.bigCannon.hitOrb, { mode: 'hit' });
                vfx.spawnParticle(hitPos.x, hitPos.y, SKILL.bigCannon.hitRing, { mode: 'hit' });
                vfx.spawnParticle(hitPos.x, hitPos.y, SKILL.bigCannon.hitRays);
                for (let i = 0; i < 6; i++) {
                  vfx.spawnParticle(hitPos.x, hitPos.y, SKILL.bigCannon.hitMist, { mode: 'hit' });
                }
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

    // 搜索队友身边最近的敌人作为跳跃目标
    let landEnemy: PlacedMonster | null = null;
    const allyX = targetAlly.gridX;
    const allyY = targetAlly.gridY;
    let bestDist = Infinity;
    for (const e of battle._monsters) {
      if (e.isDead) continue;
      if (isP1Monster(e) === isP1Monster(caster)) continue;
      const d = Math.abs(e.gridX - allyX) + Math.abs(e.gridY - allyY);
      if (d < bestDist) {
        bestDist = d;
        landEnemy = e;
      }
    }

    // 如果没有找到敌人，回退到队友位置
    if (!landEnemy) {
      landEnemy = targetAlly;
    }

    const landGridX = landEnemy.gridX;
    const landGridY = landEnemy.gridY;

    // Add 8 shields to both self and the target ally
    battle.addShield(caster, 8);
    if (targetAlly !== caster) {
      battle.addShield(targetAlly, 8);
    }

    // 预留目标格子（但不提前释放原位，落地时由 landing 逻辑处理）
    battle.reserveCell(caster.id, landGridX, landGridY);

    // Lock caster actions during leap
    (caster as any).skillAnimationTimeLeft = LEAP_DURATION;

    // 击退信息：延迟到落地时触发
    const kbTargetId = (landEnemy !== targetAlly) ? landEnemy.id : undefined;
    const pushDir = isP1Monster(caster) ? 1 : -1;

    // Register leap state in battle（跳向队友身边敌人，落地时击退）
    battle.registerLeap(caster.id, startX, startY, landGridX, landGridY, LEAP_DURATION, caster.atk * 4.5, LEAP_PEAK_HEIGHT, kbTargetId, pushDir);

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
    // 技能时间 = 110s 技能动画时长（举盾动画），与 castSkill 的技能动画时长逻辑一致
    const skillClip = getAnimationClip(caster.dbId, 'skill')?.clip;
    (caster as any).skillAnimationTimeLeft = skillClip ? skillClip.duration / 100 : 0.5;
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
      // 反方向蓄力0.12s + 加减速旋转0.48s = 0.6s
      (caster as any)._rotationDuration = 0.6;
      (caster as any)._rotationRemaining = 0.6;
      caster.state = 'skill';
      
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
      const swordRange = 1 + badgeGetRangeBonus(caster);
      if (target && Math.abs(target.gridX - caster.gridX) <= swordRange && Math.abs(target.gridY - caster.gridY) <= swordRange) {
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
    const healRange = 1 + badgeGetRangeBonus(caster);
    const allies = battle.getMonstersInGridRange(caster.gridX, caster.gridY, healRange)
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
        // 枪口：跟随动画武器位置（与普攻一致），沿队伍方向伸出枪口长度
        const muzzle = (caster as any)._weaponMuzzle;
        const fireX = muzzle ? muzzle.x + Math.cos(baseAngle) * (muzzle.length || 0) : pos.x;
        const fireY = muzzle ? muzzle.y + Math.sin(baseAngle) * (muzzle.length || 0) : pos.y;
        const offset = (gameEngine.random() - 0.5) * 20 * Math.PI / 180;
        const finalAngle = baseAngle + offset;

        const isPiercing = getMonsterBadges(caster).some(b => b.id === 1);

        if (isPiercing) {
          // 穿透模式：延长弹道穿过敌人
          const extX = fireX + Math.cos(finalAngle) * 2500;
          const extY = fireY + Math.sin(finalAngle) * 2500;
          let hitCount = 0;
          const pr = vfx.addProjectile(fireX, fireY, extX, extY, 500, '#e5c158', () => {}, undefined, undefined, undefined, caster.id);
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
          const tx = fireX + Math.cos(finalAngle) * 1500;
          const ty = fireY + Math.sin(finalAngle) * 1500;
          const pr = vfx.addProjectile(fireX, fireY, tx, ty, 500, '#e5c158', () => {}, undefined, undefined, undefined, caster.id);
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

// 115: Unyielding (铲土人) — 永久坚固 + 每10s给范围2内队友施加坚固
export class UnyieldingSkill extends BaseSkill {
  readonly name = 'unyielding';

  public onStartOfBattle(caster: PlacedMonster, battle: any): void {
    // 铲土人自身永久拥有坚固
    battle.applyStatusEffect(caster, { type: 'fortified', duration: Infinity });

    // 每 10 秒给范围 2 内队友施加坚固，持续 4 秒
    battle.scheduler.scheduleInterval(() => {
      if (caster.isDead || !battle.active) return;
      const allies = battle._monsters
        .filter((a: PlacedMonster) => a.team === caster.team && !a.isDead && a.id !== caster.id)
        .filter((a: PlacedMonster) => {
          const dx = Math.abs(a.gridX - caster.gridX);
          const dy = Math.abs(a.gridY - caster.gridY);
          return dx + dy <= 2;
        });
      for (const ally of allies) {
        battle.applyStatusEffect(ally, { type: 'fortified', duration: 4.0 });
      }
    }, 10);
  }

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
    // 仅投掷紧邻身后一格的友方
    for (const m of battle._monsters) {
      if (!m.isDead && m.team === caster.team && m.gridX === caster.gridX + dir && m.gridY === caster.gridY) {
        bestAlly = m;
        break;
      }
    }

    if (!bestAlly) return;

    battle.addShield(caster, 8);
    battle.addShield(bestAlly, 8);

    // 0.5s 举盾前摇动画：铁甲猴自身 + 被投掷友方都锁定（不寻路/不攻击），保证投掷起飞稳定
    (caster as any).skillAnimationTimeLeft = 0.5;
    caster.state = 'skill';

    const forwardDir = (caster.team === 1) ? 1 : -1;
    let destX = Math.max(0, Math.min(10, caster.gridX + 4 * forwardDir));
    const destY = caster.gridY;
    const throwTarget = bestAlly;
    (throwTarget as any)._pendingThrow = true;

    // 蓄力粒子
    const cPos = battle.screenPositions.get(caster.id);
    if (cPos) {
      vfx.spawnParticle(cPos.x, cPos.y, { type: 'solid_glow', duration: 0.5, color: '#ffcc66', size: 80 });
    }

    // 0.5s 后投掷
    battle.scheduler.schedule(() => {
      if (caster.isDead || throwTarget.isDead) return;
      (caster as any).skillAnimationTimeLeft = 0;
      caster.state = 'idle';
      (throwTarget as any)._pendingThrow = false;

      battle.reserveCell(throwTarget.id, destX, destY);
      (throwTarget as any).skillAnimationTimeLeft = THROW_DURATION;

      battle.registerLeap(throwTarget.id, throwTarget.gridX, throwTarget.gridY, destX, destY, THROW_DURATION, throwTarget.shield * 45, THROW_PEAK_HEIGHT, undefined, undefined, badgeGetRangeBonus(caster));
    }, 0.5);
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
        
        // Clamp to grid bounds; if out of bounds, fallback to nearest free cell near target
        if (idealX < 0 || idealX > 10 || idealY < 0 || idealY > 4) {
          const fallback = battle.findClosestFreeCell(target.gridX, target.gridY);
          if (fallback) {
            idealX = fallback.gridX;
            idealY = fallback.gridY;
          }
        }
        
        const landX = Math.max(0, Math.min(10, idealX));
        const landY = Math.max(0, Math.min(4, idealY));

        // 如果落地格被其他怪物占据，推开它
        const occupier = battle._gridOccupation[landX][landY];
        if (occupier && occupier.id !== caster.id && !occupier.isDead) {
          const emptyCell = battle.findNearestEmptyCell(landX, landY);
          if (emptyCell) {
            battle._gridOccupation[landX][landY] = null;
            occupier.gridX = emptyCell.gridX;
            occupier.gridY = emptyCell.gridY;
            battle._gridOccupation[emptyCell.gridX][emptyCell.gridY] = occupier;
            const occPos = gridToScreen(emptyCell.gridX, emptyCell.gridY);
            battle.screenPositions.set(occupier.id, { ...occPos });
            battle._targetPositions.set(occupier.id, { ...occPos });
          }
        }

        // 记录旧屏幕坐标（用于位移轨迹线）
        const oldPos = battle.screenPositions.get(caster.id);

        battle._gridOccupation[caster.gridX][caster.gridY] = null;
        caster.gridX = landX;
        caster.gridY = landY;
        battle._gridOccupation[landX][landY] = caster;

        const pos = gridToScreen(landX, landY);
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

        battle.applyDamage(target, Math.round(caster.atk * 1.6), caster);
        battle.addShield(caster, 1);
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
        const monkeyData = DB_MONSTERS.find(m => m.id === 126);
        if (monkeyData) {
          const miniMonkey: PlacedMonster = {
            id: `summon_${caster.id}_${battle._summonCounter++}`,
            dbId: 126,
            data: monkeyData,
            badges: [],
            gridX: freeCell.gridX,
            gridY: freeCell.gridY,
            initialGridX: freeCell.gridX,
            initialGridY: freeCell.gridY,
            placedRound: caster.placedRound,
            team: caster.team,
            hp: monkeyData.hp,
            maxHp: monkeyData.hp,
            atk: monkeyData.atk,
            ats: monkeyData.ats,
            range: monkeyData.range,
            speed: monkeyData.speed,
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

    // 技能延迟（秒，AnimTuning.SKILL_DELAY 可调）：配合投掷动画出手相位再扔出
    const delay = SKILL_DELAY[caster.dbId] ?? 0;
    battle.scheduler.schedule(() => {
      if (caster.isDead || !battle.active) return;

      const pos = battle.screenPositions.get(caster.id)!;
      vfx.spawnParticle(pos.x, pos.y, SKILL.snowball.launch);

      // 使用目标格子坐标，不追踪
      const destPos = gridToScreen(target.gridX, target.gridY);
      const destGridX = target.gridX;
      const destGridY = target.gridY;
      // 投掷型雪球，抛物线落向目标格子
      const pr = vfx.addProjectile(pos.x, pos.y, destPos.x, destPos.y, 500, '#4ba3e3', () => {
        // 雪雾爆发 + 六角冰晶碎片
        for (let i = 0; i < 8; i++) {
          vfx.spawnParticle(destPos.x, destPos.y, SKILL.snowball.hit);
        }
        for (let i = 0; i < 8; i++) {
          vfx.spawnParticle(destPos.x, destPos.y, STATUS_EFFECT.chillCrystal);
        }
        // 震荡波
        vfx.spawnParticle(destPos.x, destPos.y, SKILL.snowball.circle);

        const enemies = battle._monsters
          .filter((e: PlacedMonster) => e.team !== caster.team && !e.isDead)
          .filter((e: PlacedMonster) => {
            const dist = Math.sqrt(Math.pow(e.gridX - destGridX, 2) + Math.pow(e.gridY - destGridY, 2));
            return dist <= 2 + badgeGetRangeBonus(caster);
          });

        for (const e of enemies) {
          battle.applyDamage(e, caster.atk * 2, caster);
          battle.applyChill(e, 5.0);
          battle.applyFreeze(e, 5.0);
        }
      }, undefined, undefined, 80, caster.id);
      pr.size = 120; // 3x size
    }, delay);
    return true;
  }
}

// 125: Conversion (战壕)
export class ConversionSkill extends BaseSkill {
  readonly name = 'conversion';

  public onCast(caster: PlacedMonster, battle: any): boolean {
    const targets = battle.getMonstersInGridRange(caster.gridX, caster.gridY, 1 + badgeGetRangeBonus(caster))
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
