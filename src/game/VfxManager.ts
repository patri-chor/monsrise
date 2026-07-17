import { Pool } from '../core/Pool';

const screenW = 2556;
const screenH = 1179;

export interface FloatingText {
  x: number;
  y: number;
  text: string;
  color: string;
  isCrit: boolean;
  life: number;
  maxLife: number;
  vy: number;
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
  /** 穿透时已命中的目标ID集合（防帧伤） */
  hitTargetIds?: Set<string>;
  /** 碰撞命中回调（穿透子弹每命中一个新目标触发） */
  onHit?: (targetId: string) => void;
  /** 发射者ID（碰撞检测时排除自身） */
  ownerId?: string;
}

export interface Particle {
  x: number;
  y: number;
  type: 'slash' | 'explosion' | 'lightning' | 'heal' | 'shield' | 'fire' | 'incendiary' | 'star' | 'wind_circle' | 'heal_circle';
  life: number;
  maxLife: number;
  color: string;
  size: number;
  vx: number;
  vy: number;
  extra?: any;
}

export interface AuraCircle {
  monsterId: string;
  color: string;
  radius: number;
  alpha: number;
}

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
  public bulletCollisionCheck: ((x: number, y: number, size?: number) => string | null) | null = null;

  // Pools
  private _textPool = new Pool<FloatingText>(
    () => ({ x: 0, y: 0, text: '', color: '', isCrit: false, life: 0, maxLife: 0, vy: 0 }),
    (t) => {
      t.text = '';
      t.life = 0;
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
      t.y = y - 20; // Restored to original
      t.vy = isCrit ? -55 : -40; // Faster rise speed
    } else {
      t.x = x + (Math.random() - 0.5) * 16;
      t.y = y - 20;
      t.vy = isCrit ? -45 : -30;
    }
    
    t.text = text;
    t.color = color;
    t.isCrit = isCrit;
    t.maxLife = isCrit ? 1.0 : 0.8;
    t.life = t.maxLife;
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
    targetId?: string
  ): void {
    const p = this._projectilePool.get();
    p.x = x;
    p.y = y;
    p.targetX = targetX;
    p.targetY = targetY;
    p.speed = speed;
    p.color = color;
    p.size = 8;
    p.onArrive = onArrive;
    p.isArrived = false;
    p.targetId = targetId;
    this.projectiles.push(p);
  }

  public addParticle(
    x: number,
    y: number,
    type: Particle['type'],
    duration: number,
    color: string,
    size: number = 8,
    extra?: any
  ): void {
    if (type === 'explosion') {
      // Spawn multiple debris particles
      for (let i = 0; i < 12; i++) {
        const pt = this._particlePool.get();
        pt.x = x;
        pt.y = y;
        pt.type = type;
        pt.color = color;
        pt.size = size * (0.4 + Math.random() * 0.6);
        pt.maxLife = duration * (0.6 + Math.random() * 0.5);
        pt.life = pt.maxLife;
        const angle = Math.random() * Math.PI * 2;
        const speed = 40 + Math.random() * 60;
        pt.vx = Math.cos(angle) * speed;
        pt.vy = Math.sin(angle) * speed;
        this.particles.push(pt);
      }
    } else if (type === 'fire') {
      const pt = this._particlePool.get();
      pt.x = x + (Math.random() - 0.5) * 20;
      pt.y = y + (Math.random() - 0.5) * 20;
      pt.type = type;
      pt.color = color;
      pt.size = size * (0.6 + Math.random() * 0.5);
      pt.maxLife = duration;
      pt.life = pt.maxLife;
      pt.vx = (Math.random() - 0.5) * 10;
      pt.vy = -20 - Math.random() * 20;
      this.particles.push(pt);
    } else {
      const pt = this._particlePool.get();
      pt.x = x;
      pt.y = y;
      pt.type = type;
      pt.color = color;
      pt.size = size;
      pt.maxLife = duration;
      pt.life = pt.maxLife;
      pt.vx = 0;
      pt.vy = 0;
      pt.extra = extra;
      this.particles.push(pt);
    }
  }

  public update(dt: number): void {
    // 1. Update floating texts
    for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
      const t = this.floatingTexts[i];
      t.life -= dt;
      t.y += t.vy * dt;
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

      // ===== 碰撞检测（AABB） =====
      if (this.bulletCollisionCheck) {
        const hitId = this.bulletCollisionCheck(p.x, p.y, p.size);
        // 跳过发射者自身
        if (hitId && hitId !== p.ownerId) {
          if (p.isPiercing && p.hitTargetIds) {
            if (!p.hitTargetIds.has(hitId)) {
              p.hitTargetIds.add(hitId);
              p.onHit?.(hitId);
            }
            // 穿透：继续飞行，到终点或出界才销毁
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
        if (p.x < -50 || p.x > screenW + 50 || p.y < -50 || p.y > screenH + 50) {
          if (p.isPiercing) {
            p.onArrive(); // 穿透弹飞行结束
          }
          this.projectiles.splice(i, 1);
          this._projectilePool.put(p);
          continue;
        }
      }

      // 无碰撞检测时：到达终点即销毁（原逻辑）
      if (!this.bulletCollisionCheck && dist <= step) {
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
      if (pt.life <= 0) {
        this.particles.splice(i, 1);
        this._particlePool.put(pt);
      }
    }
  }

  public draw(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    
    // Draw particles
    for (const pt of this.particles) {
      const ratio = pt.life / pt.maxLife;
      ctx.fillStyle = pt.color;
      
      if (pt.type === 'slash') {
        // Draw slash line
        ctx.strokeStyle = pt.color;
        ctx.lineWidth = pt.size * ratio;
        ctx.beginPath();
        const angle = pt.extra?.angle || 0;
        const length = pt.extra?.length || 32;
        ctx.moveTo(pt.x - Math.cos(angle) * length * ratio * 0.5, pt.y - Math.sin(angle) * length * ratio * 0.5);
        ctx.lineTo(pt.x + Math.cos(angle) * length * ratio * 0.5, pt.y + Math.sin(angle) * length * ratio * 0.5);
        ctx.stroke();
      } else if (pt.type === 'lightning') {
        // Draw lightning bolts
        ctx.strokeStyle = pt.color;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(pt.x, pt.y - 100);
        let curX = pt.x;
        let curY = pt.y - 100;
        while (curY < pt.y) {
          curX += (Math.random() - 0.5) * 20;
          curY += 20;
          ctx.lineTo(curX, Math.min(curY, pt.y));
        }
        ctx.stroke();
      } else if (pt.type === 'explosion') {
        // Draw square debris
        const size = pt.size * ratio;
        ctx.fillRect(pt.x - size/2, pt.y - size/2, size, size);
      } else if (pt.type === 'heal') {
        // Green plus symbol
        const size = pt.size * ratio;
        ctx.fillRect(pt.x - size/2, pt.y - 1, size, 2);
        ctx.fillRect(pt.x - 1, pt.y - size/2, 2, size);
      } else if (pt.type === 'shield') {
        // Hexagonal outline
        ctx.strokeStyle = pt.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        const radius = pt.size * ratio;
        for (let j = 0; j < 6; j++) {
          const angle = (j * Math.PI) / 3;
          ctx.lineTo(pt.x + Math.cos(angle) * radius, pt.y + Math.sin(angle) * radius);
        }
        ctx.closePath();
        ctx.stroke();
      } else if (pt.type === 'fire') {
        const size = pt.size * ratio;
        ctx.fillRect(pt.x - size/2, pt.y - size/2, size, size);
      } else if (pt.type === 'incendiary') {
        // Draw a circle of fire particles expanding
        const radius = pt.size * (1 - ratio);
        ctx.strokeStyle = pt.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, radius, 0, Math.PI * 2);
        ctx.stroke();
      } else if (pt.type === 'star') {
        // Draw a 4-pointed sparkle star with outline and spin animation
        const size = pt.size * ratio;
        ctx.save();
        ctx.translate(pt.x, pt.y);
        const rotationAngle = (1 - ratio) * Math.PI * 4; // 2 full rotations over lifetime
        ctx.rotate(rotationAngle);
        
        ctx.fillStyle = pt.color;
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(0, -size);
        ctx.quadraticCurveTo(0, 0, size, 0);
        ctx.quadraticCurveTo(0, 0, 0, size);
        ctx.quadraticCurveTo(0, 0, -size, 0);
        ctx.quadraticCurveTo(0, 0, 0, -size);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      } else if (pt.type === 'wind_circle') {
        ctx.save();
        ctx.globalAlpha = ratio;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, pt.size, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      } else if (pt.type === 'heal_circle') {
        let opacity = 0;
        if (ratio > 0.5) {
          opacity = (1 - ratio) * 2;
        } else {
          opacity = ratio * 2;
        }
        ctx.save();
        ctx.globalAlpha = opacity;
        ctx.fillStyle = 'rgba(90, 197, 79, 0.15)';
        ctx.strokeStyle = '#5ac54f';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, pt.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
    }

    // Draw aura circles (persistent range indicators)
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
      ctx.fillStyle = p.color;
      // Draw standard square pixel projectile
      ctx.fillRect(p.x - p.size/2, p.y - p.size/2, p.size, p.size);
    }

    // Draw floating damage/crit texts
    for (const t of this.floatingTexts) {
      const ratio = t.life / t.maxLife;
      // Fade out opacity simulated by colors or draw alpha
      ctx.globalAlpha = Math.min(1, ratio * 1.5);
      
      const isDamage = t.text.startsWith('-');
      let fontSize = t.isCrit ? 14 : 10;
      if (isDamage) {
        fontSize = t.isCrit ? 21 : 15; // 1.5x scale
      }
      
      // Retro monospace-style text draw
      ctx.font = t.isCrit ? `bold ${fontSize}px 'Press Start 2P', 'Zpix', monospace` : `${fontSize}px 'Press Start 2P', 'Zpix', monospace`;
      
      // Black outline/stroke for pixel text
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = isDamage ? 4 : 3;
      ctx.strokeText(t.text, t.x, t.y);
      
      // Fill text
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, t.x, t.y);
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
