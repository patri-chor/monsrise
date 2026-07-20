﻿import { Pool } from '../core/Pool';
import { screenConfig } from './BattleSystem';
import { BULLET_SPRITES } from './VfxPresets';
import { Particle, ParticleType, PARTICLE_TYPES } from './ParticleTypes';

export const buttleImage = new Image();
buttleImage.src = 'buttle.png';

export const tntImage = new Image();
tntImage.src = 'tnt.png';

export interface FloatingText {
  x: number;
  y: number;
  text: string;
  color: string;
  isCrit: boolean;
  life: number;
  maxLife: number;
  vy: number;
  scale: number;
}

export interface Projectile {
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  speed: number;
  color: string;
  size: number;
  onArrive: () => void;
  isArrived: boolean;
  targetId?: string;
  /** 穿透模式：命中后不销毁 */
  isPiercing?: boolean;
  /** 穿透时已命中的目标ID集合（防连伤） */
  hitTargetIds?: Set<string>;
  /** 碰撞命中回调（穿透子弹每命中一个新目标触发） */
  onHit?: (targetId: string) => void;
  /** 发射者ID（碰撞检测时排除自身） */
  ownerId?: string;
  /** 子弹粒子类型 */
  boltType?: BoltType;
  /** 抛物线峰值高度（像素） */
  arcHeight?: number;
  /** 初始总距离（用于抛物线进度计算） */
  initialDist?: number;
  /** 已飞行距离（用于抛物线进度计算） */
  travelledDist?: number;
  /** 拖尾位置记录 */
  trail?: { x: number; y: number }[];
  /** 子弹年龄（帧计数） */
  age?: number;
  /** 粒子闪光相位 */
  flash?: number;
  /** 脉动相位 */
  pulse?: number;
  /** 子弹精灵切图属性 */
  imageRect?: {
    img: HTMLImageElement;
    sx: number;
    sy: number;
    sw: number;
    sh: number;
    dw: number;
    dh: number;
    rotate?: boolean;
  };
}

export interface AuraCircle {
  monsterId: string;
  color: string;
  radius: number;
  alpha: number;
}

// ===== Bolt 配置表（集中管理子弹参数，方便调整大小/速度等） =====
export interface BoltProfile {
  size: number;
  speed: number;
  color: string;
  colMul: number;                    // 碰撞体积倍数
  trailLife: number;                 // 拖尾粒子寿命
  trailSize: [number, number];       // [min, max]
  trailColor: string;
  trailCount: number;
  trailSpawnChance: number;          // 0~1 每帧生成概率
  arcHeight?: number;
}

export const BOLT_PROFILES: Record<string, BoltProfile> = {
  lightning: { size:14, speed:400, color:'#a0e0ff', colMul:2.0, trailLife:0.125, trailSize:[1,3],   trailColor:'#a0e0ff',     trailCount:1, trailSpawnChance:0.25 },
  fire:      { size:12, speed:400, color:'#ff6600', colMul:2.5, trailLife:0.25,  trailSize:[3,9],   trailColor:'fire_trail',  trailCount:3, trailSpawnChance:1 },
  heal:      { size:10, speed:400, color:'#5ac54f', colMul:2.0, trailLife:0.3,   trailSize:[1.5,3.5],trailColor:'heal_trail',  trailCount:2, trailSpawnChance:1 },
  void:      { size:10, speed:400, color:'#c880ff', colMul:1.2, trailLife:0.175, trailSize:[1,2.5], trailColor:'#c880ff',     trailCount:1, trailSpawnChance:0.85 },
  cannon:    { size:20, speed:350, color:'#c880ff', colMul:3.0, trailLife:0.25,  trailSize:[3,9],   trailColor:'cannon_trail',trailCount:4, trailSpawnChance:1 },
  empowered: { size:20, speed:800, color:'#ffff44', colMul:2.5, trailLife:0.35,  trailSize:[4,8],   trailColor:'#ffdd44',     trailCount:2, trailSpawnChance:1 },
};

export type BoltType = keyof typeof BOLT_PROFILES;

export class VfxManager {
  private static _instance: VfxManager | null = null;
  public static get instance(): VfxManager {
    if (!VfxManager._instance) {
      VfxManager._instance = new VfxManager();
    }
    return VfxManager._instance;
  }

  // Active VFX entities
  public floatingTexts: FloatingText[] = [];
  public projectiles: Projectile[] = [];
  public particles: Particle[] = [];
  public auraCircles: AuraCircle[] = [];
  public getTargetPosition: ((id: string) => { x: number; y: number } | undefined) | null = null;
  /** 子弹碰撞检测：传入子弹坐标，返回命中的怪物ID或null */
  public bulletCollisionCheck: ((x: number, y: number, size?: number, ownerId?: string) => string | null) | null = null;

  // Pools
  private _textPool = new Pool<FloatingText>(
    () => ({ x: 0, y: 0, text: '', color: '', isCrit: false, life: 0, maxLife: 0, vy: 0, scale: 0.5 }),
    (t) => {
      t.text = '';
      t.life = 0;
      t.scale = 0.5;
    }
  );

  private _projectilePool = new Pool<Projectile>(
    () => ({ x: 0, y: 0, targetX: 0, targetY: 0, speed: 0, color: '', size: 7, onArrive: () => {}, isArrived: false }),
    (p) => {
      p.isArrived = false;
      p.onArrive = () => {};
      p.onHit = undefined;
      p.targetId = undefined;
      p.isPiercing = false;
      p.hitTargetIds = undefined;
      p.ownerId = undefined;
      p.boltType = undefined;
      p.arcHeight = undefined;
      p.initialDist = undefined;
      p.travelledDist = undefined;
      p.trail = undefined;
      p.age = undefined;
      p.flash = undefined;
      p.pulse = undefined;
      p.imageRect = undefined;
    }
  );

  private _particlePool = new Pool<Particle>(
    () => ({ x: 0, y: 0, type: 'slash', life: 0, maxLife: 0, color: '', size: 0, vx: 0, vy: 0 }),
    (pt) => {
      pt.life = 0;
      pt.extra = undefined;
    }
  );

  private constructor() {}

  public addFloatingText(x: number, y: number, text: string, color: string = '#ffffff', isCrit: boolean = false): void {
    const t = this._textPool.get();
    const isDamage = text.startsWith('-');
    
    if (isDamage) {
      t.x = x + (Math.random() - 0.5) * 70;
      t.y = y - 20;
      t.vy = isCrit ? -55 : -45;
    } else {
      t.x = x + (Math.random() - 0.5) * 16;
      t.y = y - 20;
      t.vy = -35;
    }
    
    t.text = text;
    t.color = color;
    t.isCrit = isCrit;
    t.maxLife = isCrit ? 1.2 : 1.0;
    t.life = t.maxLife;
    t.scale = isCrit ? 0.5 : 1.0;
    this.floatingTexts.push(t);
  }

  public addProjectile(
    x: number,
    y: number,
    targetX: number,
    targetY: number,
    speed: number,
    color: string = '#ffff00',
    onArrive: () => void,
    targetId?: string,
    boltType?: BoltType,
    arcHeight?: number,
    ownerId?: string,
  ): Projectile {
    const cfg = boltType ? BOLT_PROFILES[boltType] : null;
    const p = this._projectilePool.get();
    p.x = x;
    p.y = y;
    p.targetX = targetX;
    p.targetY = targetY;
    p.speed = speed;
    p.color = color;
    p.size = cfg ? cfg.size : (arcHeight ? (color === '#4ba3e3' ? 24 : 16) : 8);
    p.onArrive = onArrive;
    p.isArrived = false;
    p.targetId = targetId;
    p.boltType = boltType;
    p.arcHeight = cfg?.arcHeight ?? arcHeight;
    if (p.arcHeight) {
      p.initialDist = Math.sqrt((targetX - x) ** 2 + (targetY - y) ** 2);
      p.travelledDist = 0;
    }
    if (boltType) {
      p.trail = [];
      p.age = 0;
      p.flash = 0;
      p.pulse = 0;
    }
    if (ownerId) p.ownerId = ownerId;
    this.projectiles.push(p);
    return p;
  }

  /** 便捷方法：按 boltType 创建子弹，自动应用 profile 的 speed/color */
  public addProjectileByType(
    x: number, y: number, targetX: number, targetY: number,
    boltType: BoltType,
    onArrive: () => void,
    targetId?: string,
    speedOverride?: number,
    ownerId?: string,
  ): Projectile {
    const cfg = BOLT_PROFILES[boltType];
    return this.addProjectile(x, y, targetX, targetY,
      speedOverride ?? cfg.speed, cfg.color, onArrive, targetId, boltType,
      undefined, ownerId,
    );
  }

  private getParabolicY(p: Projectile): number {
    const progress = Math.min(1, p.travelledDist! / p.initialDist!);
    return p.y - 4 * p.arcHeight! * progress * (1 - progress);
  }

  /** 为弹丸应用 BULLET_SPRITES 精灵贴图 */
  public applyBulletSprite(pr: Projectile, dbId: number): void {
    const sprite = BULLET_SPRITES[dbId];
    if (sprite) {
      pr.imageRect = { img: buttleImage, ...sprite, rotate: true };
    }
  }

  public addParticle(
    x: number,
    y: number,
    type: ParticleType,
    duration: number,
    color: string,
    size: number = 8,
    extra?: any
  ): void {
    PARTICLE_TYPES[type].spawn(x, y, color, size, duration, this._particlePool, this.particles, extra);
  }

  /** 从 ParticlePreset 生成粒子 */
  public spawnParticle(x: number, y: number, p: { type: Particle['type']; duration: number; color: string; size: number }, extra?: any): void {
    this.addParticle(x, y, p.type, p.duration, p.color, p.size, extra);
  }

  public update(dt: number): void {
    // 1. Update floating texts
    for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
      const t = this.floatingTexts[i];
      t.life -= dt;
      t.y += t.vy * dt;
      if (t.isCrit) {
        const elapsed = t.maxLife - t.life;
        t.scale = Math.min(1, 0.5 + (elapsed / (t.maxLife * 0.5)) * 0.5);
      }
      if (t.life <= 0) {
        this.floatingTexts.splice(i, 1);
        this._textPool.put(t);
      }
    }

    // 2. Update projectiles
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];

      if (p.targetId && this.getTargetPosition) {
        const tPos = this.getTargetPosition(p.targetId);
        if (tPos) {
          p.targetX = tPos.x;
          p.targetY = tPos.y;
        }
      }

      const dx = p.targetX - p.x;
      const dy = p.targetY - p.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const step = p.speed * dt;

      if (dist <= step) {
        p.x = p.targetX;
        p.y = p.targetY;
      } else {
        p.x += (dx / dist) * step;
        p.y += (dy / dist) * step;
      }

      // ===== 抛物线 Y 偏移 =====
      if (p.arcHeight && p.initialDist) {
        p.travelledDist! += step;
      }

      // Calculate current visual Y with parabolic offset
      let curY = p.y;
      if (p.arcHeight && p.initialDist) {
        curY = this.getParabolicY(p);
      }

      // ===== 粒子子弹：拖尾更新 =====
      if (p.boltType) {
        const cfg = BOLT_PROFILES[p.boltType];
        p.age!++;
        if (p.trail) {
          p.trail.push({ x: p.x, y: curY });
          const maxTrail = p.boltType === 'lightning' ? 14 : (p.boltType === 'void' ? 2 : (p.boltType === 'fire' ? 2 : (p.boltType === 'empowered' ? 8 : 0)));
          while (p.trail.length > maxTrail) p.trail.shift();
        }
        p.flash = Math.sin(p.age! * 0.25) * 0.5 + 0.5;
        p.pulse! += 0.16;

        // 配置驱动的拖尾粒子生成
        const angle = Math.atan2(dy, dist > 0 ? dx : 0.001);
        const spawnChance = p.boltType === 'lightning' ? cfg.trailSpawnChance * (0.5 + p.flash!) : cfg.trailSpawnChance;
        if (Math.random() >= spawnChance) { /* skip this frame */ }
        else {
          for (let ti = 0; ti < cfg.trailCount; ti++) {
            const pt = this._particlePool.get();
            if (p.boltType === 'lightning' && p.trail && p.trail.length > 1) {
              // 闪电：从拖尾中随机点迸发
              const tp = p.trail[Math.floor(Math.random() * p.trail.length)];
              pt.x = tp.x + (Math.random() - 0.5) * 4;
              pt.y = tp.y + (Math.random() - 0.5) * 4;
              pt.vx = (Math.random() - 0.5) * 0.6;
              pt.vy = (Math.random() - 0.5) * 0.6;
            } else if (p.boltType === 'fire') {
              // 火焰：向后散开
              const a = angle + Math.PI + (Math.random() - 0.5) * 0.9;
              const s = 0.15 + Math.random() * 0.55;
              pt.x = p.x + (Math.random() - 0.5) * 5;
              pt.y = curY + (Math.random() - 0.5) * 5;
              pt.vx = Math.cos(a) * s - (dx / (dist || 1)) * p.speed * 0.08 * dt;
              pt.vy = Math.sin(a) * s - (dy / (dist || 1)) * p.speed * 0.08 * dt;
            } else if (p.boltType === 'cannon') {
              // 法球：从最后拖尾点散开
              if (!p.trail || p.trail.length === 0) { this._particlePool.put(pt); continue; }
              const r2 = p.size * 1.1;
              const tp = p.trail[p.trail.length - 1];
              const back2 = angle + Math.PI + (Math.random() - 0.5) * 0.6;
              pt.x = tp.x + (Math.random() - 0.5) * r2;
              pt.y = tp.y + (Math.random() - 0.5) * r2;
              pt.vx = Math.cos(back2) * (0.5 + Math.random() * 1.5);
              pt.vy = Math.sin(back2) * (0.5 + Math.random() * 1.5);
            } else {
              // heal / void: 随机散射
              const ra = Math.random() * Math.PI * 2;
              const rs = 0.3 + Math.random() * 1;
              const back = p.boltType === 'void' ? angle + Math.PI : ra;
              pt.x = p.x + (Math.random() - 0.5) * 10;
              pt.y = curY + (Math.random() - 0.5) * 10;
              pt.vx = Math.cos(back) * rs;
              pt.vy = Math.sin(back) * rs - (p.boltType === 'heal' ? 0.3 : 0);
            }
            pt.life = cfg.trailLife; pt.maxLife = cfg.trailLife;
            pt.size = cfg.trailSize[0] + Math.random() * (cfg.trailSize[1] - cfg.trailSize[0]);
            pt.color = cfg.trailColor;
            pt.type = 'bolt_trail';
            this.particles.push(pt);
          }
        }
      }

      // ===== 碰撞检测（AABB）=====
      if (this.bulletCollisionCheck && !p.arcHeight) {
        let colSize = p.size;
        if (p.boltType) {
          colSize = p.size * BOLT_PROFILES[p.boltType].colMul;
        }
        const hitId = this.bulletCollisionCheck(p.x, curY, colSize, p.ownerId);
        // 跳过发射者自身
        if (hitId && hitId !== p.ownerId) {
          if (p.isPiercing && p.hitTargetIds) {
            if (!p.hitTargetIds.has(hitId)) {
              p.hitTargetIds.add(hitId);
              p.onHit?.(hitId);
            }
            // 穿越：继续飞行，到终点或出界才销毁
          } else {
            // 普通子弹：命中即销毁
            p.onHit?.(hitId);
            p.onArrive();
            p.isArrived = true;
            this.projectiles.splice(i, 1);
            this._projectilePool.put(p);
            continue;
          }
        }

        // 检查是否飞出屏幕边界
        if (p.x < -50 || p.x > screenConfig.width + 50 || curY < -50 || curY > screenConfig.height + 50) {
          if (p.isPiercing) {
            p.onArrive(); // 穿越弹飞行结束
          }
          this.projectiles.splice(i, 1);
          this._projectilePool.put(p);
          continue;
        }
      }

      // 到达终点即销毁并结算
      if (dist <= step) {
        p.isArrived = true;
        p.onArrive();
        this.projectiles.splice(i, 1);
        this._projectilePool.put(p);
      }
    }

    // 3. Update particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const pt = this.particles[i];
      pt.life -= dt;
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      PARTICLE_TYPES[pt.type]?.update?.(pt, dt);
      if (pt.life <= 0) {
        this.particles.splice(i, 1);
        this._particlePool.put(pt);
      }
    }
  }

  public draw(ctx: CanvasRenderingContext2D): void {
    
    // Draw particles
    for (const pt of this.particles) {
      PARTICLE_TYPES[pt.type].render(ctx, pt);
    }

    if (this.getTargetPosition) {
      for (const aura of this.auraCircles) {
        const pos = this.getTargetPosition(aura.monsterId);
        if (pos) {
          ctx.save();
          ctx.globalAlpha = aura.alpha;
          ctx.strokeStyle = aura.color;
          ctx.lineWidth = 2;
          ctx.setLineDash([8, 6]);
          ctx.beginPath();
          ctx.arc(pos.x, pos.y, aura.radius, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = aura.color;
          ctx.globalAlpha = aura.alpha * 0.08;
          ctx.fill();
          ctx.restore();
        }
      }
    }

    // Draw projectiles
    for (const p of this.projectiles) {
      let drawY = p.y;
      if (p.arcHeight && p.initialDist) {
        drawY = this.getParabolicY(p);
      }

      if (p.imageRect) {
        // 如果有 boltType，先画拖尾粒子特效
        if (p.boltType) {
          const originalY = p.y;
          p.y = drawY;
          this.drawBoltProjectile(ctx, p);
          p.y = originalY;
        }
        // 再画贴图精灵（覆盖在拖尾之上）
        ctx.save();
        ctx.translate(p.x, drawY);
        if (p.imageRect.rotate) {
          const dx = p.targetX - p.x;
          const dy = p.targetY - p.y;
          const angle = Math.atan2(dy, dx || 0.001);
          ctx.rotate(angle);
        }
        ctx.drawImage(
          p.imageRect.img,
          p.imageRect.sx,
          p.imageRect.sy,
          p.imageRect.sw,
          p.imageRect.sh,
          -p.imageRect.dw / 2,
          -p.imageRect.dh / 2,
          p.imageRect.dw,
          p.imageRect.dh
        );
        ctx.restore();
      } else if (p.boltType) {
        const originalY = p.y;
        p.y = drawY;
        this.drawBoltProjectile(ctx, p);
        p.y = originalY;
      } else {
        if (p.color === '#4ba3e3') {
          ctx.save();
          ctx.beginPath();
          ctx.arc(p.x, drawY, p.size / 2, 0, Math.PI * 2);
          ctx.fillStyle = '#ffffff';
          ctx.shadowBlur = 8;
          ctx.shadowColor = '#4ba3e3';
          ctx.fill();
          ctx.strokeStyle = '#4ba3e3';
          ctx.lineWidth = 2.5;
          ctx.stroke();
          ctx.restore();
        } else {
          // boltType 子弹的连续拖尾线
          if (p.boltType && p.trail && p.trail.length > 1) {
            const cfg = BOLT_PROFILES[p.boltType];
            ctx.save();
            for (let i = 1; i < p.trail.length; i++) {
              const t = p.trail[i];
              const prev = p.trail[i - 1];
              const a = i / p.trail.length;
              ctx.globalAlpha = a * 0.6;
              ctx.strokeStyle = cfg.trailColor;
              ctx.lineWidth = p.size * (0.3 + a * 0.5);
              ctx.lineCap = 'round';
              ctx.beginPath();
              ctx.moveTo(prev.x, prev.y);
              ctx.lineTo(t.x, t.y);
              ctx.stroke();
            }
            ctx.restore();
          }
          // 子弹主体
          ctx.fillStyle = p.color;
          ctx.fillRect(p.x - p.size/2, drawY - p.size/2, p.size, p.size);
        }
      }
    }
  }

  /** 单独绘制浮动文字（供 Director 最上层调用） */
  public drawFloatingTexts(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    for (const t of this.floatingTexts) {
      const ratio = t.life / t.maxLife;
      ctx.globalAlpha = Math.min(1, ratio * 1.5);
      
      let fontSize = t.isCrit ? 24 : 18;
      ctx.font = t.isCrit ? `bold ${fontSize}px 'Press Start 2P', 'Zpix', monospace` : `${fontSize}px 'Press Start 2P', 'Zpix', monospace`;
      
      if (t.isCrit) {
        ctx.save();
        ctx.translate(t.x, t.y);
        ctx.scale(t.scale, t.scale);
        ctx.translate(-t.x, -t.y);
      }
      
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 4;
      ctx.strokeText(t.text, t.x, t.y);
      
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, t.x, t.y);
      
      if (t.isCrit) {
        ctx.restore();
      }
    }
    ctx.restore();
  }

  /** 绘制粒子特效子弹 */
  private drawBoltProjectile(ctx: CanvasRenderingContext2D, p: Projectile): void {
    const f = p.flash ?? 0.5;
    const pulse = p.pulse ?? 0;
    const r = p.size * 1.1; // 基础半径 ~9px
    const trail = p.trail;

    ctx.save();
    ctx.translate(p.x, p.y);

    switch (p.boltType) {
      case 'lightning': {
        // 角度
        const dx = p.targetX - p.x;
        const dy = p.targetY - p.y;
        const ang = Math.atan2(dy, dx || 0.001);
        ctx.rotate(ang);

        // ---- 拖尾闪电折线 ----
        const tailLen = 40;
        ctx.lineWidth = 1.5;
        ctx.lineCap = 'round';
        for (let b = 0; b < 3; b++) {
          const side = (b % 2 === 0 ? 1 : -1) * (0.5 + Math.random() * 0.3);
          ctx.beginPath();
          ctx.moveTo(-r * 0.3, side * r * 0.25);
          for (let s = 1; s <= 3; s++) {
            const prog = s / 3;
            const nx = -r * 0.3 - tailLen * prog;
            const ny = side * r * (0.5 + b * 0.15) * (1 - prog) + (Math.random() - 0.5) * r * 0.8;
            ctx.lineTo(nx, ny);
          }
          ctx.strokeStyle = `rgba(120,255,230,${0.35 * f * (0.5 + b / 3)})`;
          ctx.stroke();
        }

        // ---- 弹头光球 ----
        const headGrad = ctx.createRadialGradient(r * 0.2, 0, 0, r * 0.2, 0, r * 1.5);
        headGrad.addColorStop(0, `rgba(255,255,255,${f})`);
        headGrad.addColorStop(0.4, `rgba(200,255,250,${0.85 * f})`);
        headGrad.addColorStop(1, 'rgba(80,180,220,0)');
        ctx.fillStyle = headGrad;
        ctx.beginPath();
        ctx.ellipse(r * 0.2, 0, r * 1.2, r * 0.9, 0, 0, Math.PI * 2);
        ctx.fill();

        // 核心亮点
        const coreGrad = ctx.createRadialGradient(r * 0.25, 0, 0, r * 0.25, 0, r * 0.6);
        coreGrad.addColorStop(0, `rgba(255,255,255,${f})`);
        coreGrad.addColorStop(1, 'rgba(180,240,255,0)');
        ctx.fillStyle = coreGrad;
        ctx.beginPath();
        ctx.arc(r * 0.25, 0, r * 0.6, 0, Math.PI * 2);
        ctx.fill();
        break;
      }

      case 'fire': {
        // 拖尾
        if (trail) {
          for (let i = 0; i < trail.length; i++) {
            const t = trail[i];
            const a = i / trail.length;
            const tr = Math.max(1, (1 - a) * r * 0.8);
            const dx2 = t.x - p.x;
            const dy2 = t.y - p.y;
            const grad = ctx.createRadialGradient(dx2, dy2, 0, dx2, dy2, tr);
            grad.addColorStop(0, `rgba(255,220,100,${a * 0.45})`);
            grad.addColorStop(0.5, `rgba(255,100,30,${a * 0.25})`);
            grad.addColorStop(1, 'rgba(180,30,10,0)');
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(dx2, dy2, tr, 0, Math.PI * 2);
            ctx.fill();
          }
        }

        // 主体火球
        const fGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 2.2);
        fGrad.addColorStop(0, 'rgba(255,255,200,1)');
        fGrad.addColorStop(0.25, 'rgba(255,180,60,0.9)');
        fGrad.addColorStop(0.6, 'rgba(255,80,20,0.55)');
        fGrad.addColorStop(1, 'rgba(160,30,10,0)');
        ctx.fillStyle = fGrad;
        ctx.beginPath();
        ctx.arc(0, 0, r * 2.2, 0, Math.PI * 2);
        ctx.fill();

        // 核心高亮
        ctx.fillStyle = 'rgba(255,255,240,1)';
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.35, 0, Math.PI * 2);
        ctx.fill();
        break;
      }

      case 'heal': {
        // 外层脉动光环
        const ps = r * 1.5 + Math.sin(pulse) * 3;
        const g1 = ctx.createRadialGradient(0, 0, 0, 0, 0, ps);
        g1.addColorStop(0, 'rgba(200,255,180,0.5)');
        g1.addColorStop(0.5, 'rgba(120,220,120,0.25)');
        g1.addColorStop(1, 'rgba(60,160,60,0)');
        ctx.fillStyle = g1;
        ctx.beginPath();
        ctx.arc(0, 0, ps, 0, Math.PI * 2);
        ctx.fill();

        // 中层
        const g2 = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
        g2.addColorStop(0, 'rgba(255,255,230,1)');
        g2.addColorStop(0.5, 'rgba(200,255,180,0.85)');
        g2.addColorStop(1, 'rgba(100,200,100,0)');
        ctx.fillStyle = g2;
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fill();

        // 十字标记
        ctx.save();
        ctx.rotate(Math.sin(pulse * 0.3) * 0.1);
        ctx.fillStyle = `rgba(255,255,240,${0.6 + Math.sin(pulse) * 0.4})`;
        const cs = r * 0.35;
        const cw = r * 0.1;
        ctx.fillRect(-cs, -cw, cs * 2, cw * 2);
        ctx.fillRect(-cw, -cs, cw * 2, cs * 2);
        ctx.restore();
        break;
      }

      case 'empowered': {
        // 角度
        const dx = p.targetX - p.x;
        const dy = p.targetY - p.y;
        const ang = Math.atan2(dy, dx || 0.002);
        ctx.rotate(ang);

        // 金色流线拖尾（同 void 风格：连续 fillRect 点）
        const w = r * 0.7;
        if (trail) {
          for (let i = 0; i < trail.length; i++) {
            const t = trail[i];
            const lx = (t.x - p.x) * Math.cos(-ang) - (t.y - p.y) * Math.sin(-ang);
            const a = i / trail.length;
            ctx.fillStyle = `rgba(255,220,80,${a * 0.5})`;
            ctx.fillRect(lx - 1, -w * 0.3, 2, w * 0.6);
          }
        }
        break;
      }

      case 'void': {
        // 角度
        const dx = p.targetX - p.x;
        const dy = p.targetY - p.y;
        const ang = Math.atan2(dy, dx || 0.001);
        ctx.rotate(ang);

        const len = r * 2.5;
        const w = r * 0.5;

        // 拖尾
        if (trail) {
          for (let i = 0; i < trail.length; i++) {
            const t = trail[i];
            const lx = (t.x - p.x) * Math.cos(-ang) - (t.y - p.y) * Math.sin(-ang);
            const a = i / trail.length;
            ctx.fillStyle = `rgba(180,120,255,${a * 0.3})`;
            ctx.fillRect(lx - 1, -w * 0.3, 2, w * 0.6);
          }
        }

        // 外层光晕
        const glowGrad = ctx.createLinearGradient(-len, 0, len * 0.3, 0);
        glowGrad.addColorStop(0, 'rgba(140,60,220,0)');
        glowGrad.addColorStop(0.4, 'rgba(170,90,255,0.3)');
        glowGrad.addColorStop(0.85, 'rgba(220,180,255,0.55)');
        glowGrad.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = glowGrad;
        ctx.beginPath();
        ctx.ellipse(-len * 0.25, 0, len * 0.7, w * 1.2, 0, 0, Math.PI * 2);
        ctx.fill();

        // 主能量条
        const grad = ctx.createLinearGradient(-len, 0, len * 0.25, 0);
        grad.addColorStop(0, 'rgba(160,80,255,0)');
        grad.addColorStop(0.25, 'rgba(190,120,255,0.5)');
        grad.addColorStop(0.7, 'rgba(230,190,255,0.95)');
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(-len, -w * 0.15);
        ctx.lineTo(len * 0.15, -w * 0.55);
        ctx.lineTo(len * 0.25, 0);
        ctx.lineTo(len * 0.15, w * 0.55);
        ctx.lineTo(-len, w * 0.15);
        ctx.closePath();
        ctx.fill();

        // 头部高光
        const hGrad = ctx.createRadialGradient(len * 0.1, 0, 0, len * 0.1, 0, w * 1.8);
        hGrad.addColorStop(0, 'rgba(255,255,255,1)');
        hGrad.addColorStop(0.3, 'rgba(220,180,255,0.7)');
        hGrad.addColorStop(1, 'rgba(160,80,255,0)');
        ctx.fillStyle = hGrad;
        ctx.beginPath();
        ctx.arc(len * 0.1, 0, w * 1.8, 0, Math.PI * 2);
        ctx.fill();
        break;
      }

      case 'cannon': {
        // 巨大能量法球：白芯紫边 + 脉冲光晕
        const cr = r * 3;
        const outerGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, cr);
        outerGrad.addColorStop(0, 'rgba(255,255,255,1)');
        outerGrad.addColorStop(0.15, 'rgba(255,230,255,0.9)');
        outerGrad.addColorStop(0.4, 'rgba(210,150,255,0.6)');
        outerGrad.addColorStop(0.7, 'rgba(150,80,220,0.25)');
        outerGrad.addColorStop(1, 'rgba(100,40,180,0)');
        ctx.fillStyle = outerGrad;
        ctx.beginPath();
        ctx.arc(0, 0, cr, 0, Math.PI * 2);
        ctx.fill();

        // 内层白芯
        const innerGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 1.1);
        innerGrad.addColorStop(0, 'rgba(255,255,255,1)');
        innerGrad.addColorStop(0.5, 'rgba(255,245,255,0.8)');
        innerGrad.addColorStop(1, 'rgba(220,170,255,0)');
        ctx.fillStyle = innerGrad;
        ctx.beginPath();
        ctx.arc(0, 0, r * 1.1, 0, Math.PI * 2);
        ctx.fill();

        // 脉冲光晕
        const pulseR = r * 2.2 + Math.sin(p.pulse!) * r * 0.5;
        const pulseGrad = ctx.createRadialGradient(0, 0, r * 1.5, 0, 0, pulseR);
        pulseGrad.addColorStop(0, 'rgba(200,140,255,0)');
        pulseGrad.addColorStop(0.5, `rgba(180,120,255,${0.2 + f * 0.15})`);
        pulseGrad.addColorStop(1, 'rgba(140,60,220,0)');
        ctx.fillStyle = pulseGrad;
        ctx.beginPath();
        ctx.arc(0, 0, pulseR, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
    }

    ctx.restore();
  }

  public clear(): void {
    this.floatingTexts = [];
    this.projectiles = [];
    this.particles = [];
    this.auraCircles = [];
    this._textPool.clear();
    this._projectilePool.clear();
    this._particlePool.clear();
  }
}
export const vfx = VfxManager.instance;
