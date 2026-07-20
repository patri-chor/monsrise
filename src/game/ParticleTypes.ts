// ===== 粒子类型定义 + 行为配置表 =====
// 每种粒子类型的 spawn / render / update 集中在此文件
// 新增粒子类型：扩展 ParticleType 联合 → 添加 PARTICLE_TYPES 条目即可

import { Pool } from '../core/Pool';

/** 土壤贴图（钻土拖尾用） */
export const dustImage = new Image();
dustImage.src = 'dust.png';

// ---- 粒子数据结构 ----
export interface Particle {
  x: number;
  y: number;
  type: ParticleType;
  life: number;
  maxLife: number;
  color: string;
  size: number;
  vx: number;
  vy: number;
  extra?: any;
}

// ---- 粒子类型联合 ----
export type ParticleType = 'slash' | 'explosion' | 'lightning' | 'heal' | 'shield'
  | 'fire' | 'incendiary' | 'star' | 'wind_circle' | 'heal_circle'
  | 'bolt_trail' | 'burn_fire' | 'burn_ember' | 'chill_haze' | 'chill_crystal'
  | 'crescent' | 'jitter_line' | 'dust' | 'heal_float' | 'heal_cross'
  | 'energy_spark' | 'soil'
  | 'blast_core' | 'blast_flame' | 'blast_spark' | 'blast_smoke'
  | 'smoke_puff' | 'hard_shard';

// ---- 策略接口 ----
export type ParticleSpawner = (
  x: number, y: number,
  color: string, size: number, duration: number,
  pool: Pool<Particle>, list: Particle[], extra?: any
) => void;

export type ParticleRenderer = (ctx: CanvasRenderingContext2D, pt: Particle) => void;

export type ParticleUpdater = (pt: Particle, dt: number) => void;

export interface ParticleTypeConfig {
  spawn: ParticleSpawner;
  render: ParticleRenderer;
  update?: ParticleUpdater;
}

// ================================================================
//  通用默认值
// ================================================================
function defaultSpawn(x: number, y: number, type: ParticleType, color: string, size: number, duration: number, pool: Pool<Particle>, list: Particle[], extra?: any) {
  const pt = pool.get();
  pt.x = x; pt.y = y; pt.type = type; pt.color = color; pt.size = size;
  pt.maxLife = duration; pt.life = duration; pt.vx = 0; pt.vy = 0; pt.extra = extra;
  list.push(pt);
}

function rectRender(ctx: CanvasRenderingContext2D, pt: Particle) {
  const ratio = pt.life / pt.maxLife;
  const s = pt.size * ratio;
  ctx.fillStyle = pt.color;
  ctx.fillRect(pt.x - s / 2, pt.y - s / 2, s, s);
}

// ================================================================
//  PARTICLE_TYPES 配置表（按字母序排列，方便查找）
// ================================================================
export const PARTICLE_TYPES: Record<ParticleType, ParticleTypeConfig> = {

  // ---- bolt_trail：子弹拖尾小点 ----
  bolt_trail: {
    spawn(x, y, color, size, duration, pool, list) {
      const pt = pool.get();
      pt.x = x; pt.y = y; pt.type = 'bolt_trail'; pt.color = color;
      pt.size = size; pt.maxLife = duration; pt.life = duration;
      pt.vx = 0; pt.vy = 0;
      list.push(pt);
    },
    render(ctx, pt) {
      const alpha = pt.life / pt.maxLife;
      if (pt.color === 'fire_trail') {
        let r: number, g: number, b: number;
        if (alpha > 0.6) {
          r = 255; g = Math.floor(200 + alpha * 55); b = Math.floor(100 + alpha * 100);
        } else if (alpha > 0.3) {
          r = 255; g = Math.floor(100 + alpha * 150); b = 30;
        } else {
          r = Math.floor(180 + alpha * 60); g = 30; b = 10;
        }
        ctx.globalAlpha = alpha;
        ctx.fillStyle = `rgba(${r},${g},${b},1)`;
      } else if (pt.color === 'heal_trail') {
        ctx.globalAlpha = alpha;
        ctx.fillStyle = `rgba(${150 + alpha * 100},255,${180 + alpha * 40},1)`;
      } else if (pt.color === 'cannon_trail') {
        ctx.globalAlpha = alpha;
        const r = Math.floor(180 + alpha * 40);
        const g = Math.floor(100 + alpha * 60);
        const b = Math.floor(220 + alpha * 35);
        ctx.fillStyle = `rgba(${r},${g},${b},1)`;
      } else {
        ctx.globalAlpha = alpha;
        ctx.fillStyle = pt.color;
      }
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, Math.max(0.1, pt.size), 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    },
    update(pt) {
      pt.vx *= 0.96;
      pt.vy *= 0.96;
      if (pt.color === 'fire_trail') pt.vy -= 0.05;
    },
  },

  // ---- burn_ember：余烬火花 ----
  burn_ember: {
    spawn(x, y, color, size, duration, pool, list) {
      const pt = pool.get();
      pt.x = x + (Math.random() - 0.5) * 40;
      pt.y = y + (Math.random() - 0.5) * 10;
      pt.type = 'burn_ember'; pt.color = color;
      pt.size = size * (0.4 + Math.random() * 0.8);
      pt.maxLife = duration * (0.6 + Math.random() * 0.5);
      pt.life = pt.maxLife;
      pt.vx = (Math.random() - 0.5) * 15;
      pt.vy = -15 - Math.random() * 30;
      list.push(pt);
    },
    render(ctx, pt) {
      const ratio = pt.life / pt.maxLife;
      const sz = Math.max(1, pt.size * ratio);
      ctx.save();
      ctx.fillStyle = `rgba(255,240,150,${ratio * 0.8})`;
      ctx.shadowBlur = sz * 1.5;
      ctx.shadowColor = '#ffcc00';
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, sz, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    },
    update(pt) {
      pt.vy *= 0.99;
      pt.vx *= 0.98;
    },
  },

  // ---- burn_fire：火焰粒子 ----
  burn_fire: {
    spawn(x, y, color, size, duration, pool, list) {
      const baseW = size;
      const pt = pool.get();
      pt.x = x + (Math.random() - 0.5) * baseW;
      pt.y = y + (Math.random() - 0.5) * 16;
      pt.type = 'burn_fire'; pt.color = color;
      pt.size = size * (0.5 + Math.random() * 0.8);
      pt.maxLife = duration * (0.5 + Math.random() * 0.6);
      pt.life = pt.maxLife;
      pt.vx = (Math.random() - 0.5) * 25;
      pt.vy = -30 - Math.random() * 50;
      list.push(pt);
    },
    render(ctx, pt) {
      const ratio = pt.life / pt.maxLife;
      const sz = Math.max(2, pt.size * ratio);
      const bell = Math.sin(ratio * Math.PI);
      ctx.save();
      const glow = ctx.createRadialGradient(pt.x, pt.y, sz * 0.1, pt.x, pt.y, sz * 1.8);
      glow.addColorStop(0, `rgba(255,160,40,${bell * 0.25})`);
      glow.addColorStop(0.4, `rgba(255,100,20,${bell * 0.07})`);
      glow.addColorStop(1, 'rgba(200,60,10,0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, sz * 1.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgba(255,220,80,${bell * 0.3})`;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, sz * 0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    },
    update(pt) {
      pt.vy *= 0.985;
      pt.vx *= 0.97;
    },
  },

  // ---- chill_crystal：六角冰晶 ----
  chill_crystal: {
    spawn(x, y, color, size, duration, pool, list) {
      const pt = pool.get();
      pt.x = x + (Math.random() - 0.5) * 50;
      pt.y = y + (Math.random() - 0.5) * 40;
      pt.type = 'chill_crystal'; pt.color = color;
      pt.size = size * (0.5 + Math.random() * 0.6);
      pt.maxLife = duration * (0.7 + Math.random() * 0.5);
      pt.life = pt.maxLife;
      pt.vx = (Math.random() - 0.5) * 6;
      pt.vy = (Math.random() - 0.5) * 8;
      list.push(pt);
    },
    render(ctx, pt) {
      const ratio = pt.life / pt.maxLife;
      const sz = Math.max(1.5, pt.size * (0.5 + ratio * 0.5));
      ctx.save();
      ctx.translate(pt.x, pt.y);
      const rotAngle = (1 - ratio) * Math.PI * 1.5;
      ctx.rotate(rotAngle);
      const alpha = ratio > 0.65 ? 1 : ratio / 0.65;
      ctx.fillStyle = `rgba(150,210,255,${alpha * 0.7})`;
      ctx.strokeStyle = `rgba(190,230,255,${alpha * 0.85})`;
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      for (let j = 0; j < 6; j++) {
        const a = (j * Math.PI) / 3 - Math.PI / 2;
        const px = Math.cos(a) * sz;
        const py = Math.sin(a) * sz;
        if (j === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    },
    update(pt) {
      pt.vx *= 0.998;
      pt.vy *= 0.998;
    },
  },

  // ---- chill_haze：蓝色雾气 ----
  chill_haze: {
    spawn(x, y, color, size, duration, pool, list) {
      const pt = pool.get();
      pt.x = x + (Math.random() - 0.5) * 40;
      pt.y = y + (Math.random() - 0.5) * 20;
      pt.type = 'chill_haze'; pt.color = color;
      pt.size = size * (0.7 + Math.random() * 0.5);
      pt.maxLife = duration * (0.8 + Math.random() * 0.4);
      pt.life = pt.maxLife;
      pt.vx = (Math.random() - 0.5) * 8;
      pt.vy = 8 + Math.random() * 10;
      list.push(pt);
    },
    render(ctx, pt) {
      const ratio = pt.life / pt.maxLife;
      const sz = pt.size * (1 + (1 - ratio) * 0.3);
      const alpha = Math.min(0.55, ratio * 0.7);
      const grad = ctx.createRadialGradient(pt.x, pt.y, sz * 0.1, pt.x, pt.y, sz);
      grad.addColorStop(0, `rgba(100,170,230,${alpha})`);
      grad.addColorStop(0.35, `rgba(70,140,210,${alpha * 0.75})`);
      grad.addColorStop(0.65, `rgba(40,100,180,${alpha * 0.35})`);
      grad.addColorStop(1, 'rgba(20,60,140,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, sz, 0, Math.PI * 2);
      ctx.fill();
    },
    update(pt) {
      pt.vx *= 0.98;
      pt.vy += 3 * 0.016; // dt averaged at ~16ms per frame
    },
  },

  // ---- crescent：月牙刀光 ----
  crescent: {
    spawn(x, y, color, size, duration, pool, list, extra) {
      const pt = pool.get();
      pt.x = x; pt.y = y; pt.type = 'crescent'; pt.color = color; pt.size = size;
      pt.maxLife = duration; pt.life = duration;
      pt.extra = extra;
      // 若传入 angle，设置向外飞行速度
      if (extra?.angle !== undefined) {
        const speed = 60 + Math.random() * 50;
        pt.vx = Math.cos(extra.angle) * speed;
        pt.vy = Math.sin(extra.angle) * speed;
      } else {
        pt.vx = 0; pt.vy = 0;
      }
      list.push(pt);
    },
    render(ctx, pt) {
      const ratio = pt.life / pt.maxLife;
      const elapsed = pt.maxLife - pt.life;
      const rotAngle = (elapsed / pt.maxLife) * Math.PI * 2;
      const r = pt.size * 0.9;
      ctx.save();
      ctx.globalAlpha = ratio;
      ctx.translate(pt.x, pt.y);
      ctx.rotate(rotAngle);
      ctx.fillStyle = pt.color;
      ctx.beginPath();
      ctx.arc(0, 0, r, -0.6, 0.6);
      ctx.arc(0, r * 0.35, r * 0.7, 2.5, -2.5, true);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    },
  },

  // ---- dust：半透明尘土 ----
  dust: {
    spawn(x, y, color, size, duration, pool, list) {
      const pt = pool.get();
      pt.x = x + (Math.random() - 0.5) * 30;
      pt.y = y + (Math.random() - 0.5) * 20;
      pt.type = 'dust'; pt.color = color;
      pt.size = size * (0.6 + Math.random() * 0.5);
      pt.maxLife = duration; pt.life = duration;
      pt.vx = (Math.random() - 0.5) * 15;
      pt.vy = -10 - Math.random() * 15;
      list.push(pt);
    },
    render(ctx, pt) {
      const ratio = pt.life / pt.maxLife;
      ctx.save();
      ctx.globalAlpha = 0.5 * ratio;
      ctx.fillStyle = pt.color;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, pt.size * ratio, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    },
  },

  // ---- energy_spark：能量火花（向中心汇聚） ----
  energy_spark: {
    spawn(x, y, color, size, duration, pool, list) {
      const pt = pool.get();
      // 从角色周围随机位置向中心汇聚
      const angle = Math.random() * Math.PI * 2;
      const dist = 30 + Math.random() * 50;
      pt.x = x + Math.cos(angle) * dist;
      pt.y = y + Math.sin(angle) * dist;
      pt.type = 'energy_spark'; pt.color = color;
      pt.size = size * (0.6 + Math.random() * 0.6);
      pt.maxLife = duration * (0.6 + Math.random() * 0.5);
      pt.life = pt.maxLife;
      // 向中心（x, y）运动
      const speed = 30 + Math.random() * 50;
      pt.vx = -Math.cos(angle) * speed / duration;
      pt.vy = -Math.sin(angle) * speed / duration;
      list.push(pt);
    },
    render(ctx, pt) {
      const ratio = pt.life / pt.maxLife;
      const sz = Math.max(1.5, pt.size * ratio);
      ctx.save();
      const glow = ctx.createRadialGradient(pt.x, pt.y, sz * 0.1, pt.x, pt.y, sz * 1.8);
      glow.addColorStop(0, `rgba(255,255,200,${ratio * 0.5})`);
      glow.addColorStop(0.4, `rgba(255,240,100,${ratio * 0.2})`);
      glow.addColorStop(1, 'rgba(255,200,50,0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, sz * 1.8, 0, Math.PI * 2);
      ctx.fill();
      // 内核亮点
      ctx.fillStyle = `rgba(255,255,220,${ratio * 0.7})`;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, sz * 0.35, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    },
    update(_pt) {
      // vx/vy 在 spawn 中已设置汇聚方向，不做衰减（保持向心运动）
    },
  },

  // ---- explosion：爆炸碎片（16粒，从中心爆开 + 圆形alpha衰减） ----
  explosion: {
    spawn(x, y, color, size, duration, pool, list) {
      for (let i = 0; i < 16; i++) {
        const pt = pool.get();
        pt.x = x; pt.y = y; pt.type = 'explosion'; pt.color = color;
        pt.size = size * (0.4 + Math.random() * 0.6);
        pt.maxLife = duration * (0.6 + Math.random() * 0.5);
        pt.life = pt.maxLife;
        const angle = Math.random() * Math.PI * 2;
        const speed = 60 + Math.random() * 100;
        pt.vx = Math.cos(angle) * speed;
        pt.vy = Math.sin(angle) * speed;
        list.push(pt);
      }
    },
    render(ctx, pt) {
      const ratio = pt.life / pt.maxLife;
      const s = pt.size * ratio;
      ctx.save();
      ctx.globalAlpha = ratio * 0.8;
      ctx.fillStyle = pt.color;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, s / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    },
  },

  // ---- fire：火焰（单粒上飘） ----
  fire: {
    spawn(x, y, color, size, duration, pool, list) {
      const pt = pool.get();
      pt.x = x + (Math.random() - 0.5) * 20;
      pt.y = y + (Math.random() - 0.5) * 20;
      pt.type = 'fire'; pt.color = color;
      pt.size = size * (0.6 + Math.random() * 0.5);
      pt.maxLife = duration; pt.life = duration;
      pt.vx = (Math.random() - 0.5) * 10;
      pt.vy = -20 - Math.random() * 20;
      list.push(pt);
    },
    render: rectRender,
  },

  // ---- heal：绿色十字 ----
  heal: {
    spawn: (x, y, color, size, duration, pool, list, extra) => defaultSpawn(x, y, 'heal', color, size, duration, pool, list, extra),
    render(ctx, pt) {
      const ratio = 0.5;//pt.life / pt.maxLife;
      const s = pt.size * ratio;
      ctx.fillStyle = pt.color;
      ctx.fillRect(pt.x - s / 2, pt.y - 1, s, 2);
      ctx.fillRect(pt.x - 1, pt.y - s / 2, 2, s);
    },
  },

  // ---- heal_cross：圆角十字（飘散渐出） ----
  heal_cross: {
    spawn(x, y, color, size, duration, pool, list) {
      const pt = pool.get();
      pt.x = x + (Math.random() - 0.5) * 40;
      pt.y = y + (Math.random() - 0.5) * 20;
      pt.type = 'heal_cross'; pt.color = color;
      pt.size = size * (0.8 + Math.random() * 0.4);
      pt.maxLife = duration * (0.7 + Math.random() * 0.5);
      pt.life = pt.maxLife;
      pt.vx = (Math.random() - 0.5) * 20;
      pt.vy = -25 - Math.random() * 40;
      list.push(pt);
    },
    render(ctx, pt) {
      const ratio = 0.5 + pt.life / pt.maxLife;
      const sz = Math.max(2, pt.size * ratio/2);
      ctx.save();
      ctx.translate(pt.x, pt.y);
      ctx.globalAlpha = ratio * 0.9;
      ctx.fillStyle = pt.color;
      ctx.lineJoin = 'round';
      const hw = sz * 0.18;
      ctx.fillRect(-hw, -sz * 0.5, hw * 2, sz);
      ctx.fillRect(-sz * 0.5, -hw, sz, hw * 2);
      ctx.restore();
    },
    update(pt) {
      pt.vx *= 0.98;
      pt.vy *= 0.98;
    },
  },

  // ---- heal_float：圆形治疗光点（飘散渐出） ----
  heal_float: {
    spawn(x, y, color, size, duration, pool, list) {
      const pt = pool.get();
      pt.x = x + (Math.random() - 0.5) * 40;
      pt.y = y + (Math.random() - 0.5) * 20;
      pt.type = 'heal_float'; pt.color = color;
      pt.size = size * (0.6 + Math.random() * 0.5);
      pt.maxLife = duration * (0.7 + Math.random() * 0.5);
      pt.life = pt.maxLife;
      pt.vx = (Math.random() - 0.5) * 20;
      pt.vy = -25 - Math.random() * 40;
      list.push(pt);
    },
    render(ctx, pt) {
      const ratio = 0.5 + pt.life / pt.maxLife;
      const sz = Math.max(2, pt.size * ratio/2);
      ctx.save();
      const glow = ctx.createRadialGradient(pt.x, pt.y, sz * 0.1, pt.x, pt.y, sz * 1.5);
      glow.addColorStop(0, `rgba(180,255,120,${ratio * 0.4})`);
      glow.addColorStop(0.5, `rgba(120,220,80,${ratio * 0.15})`);
      glow.addColorStop(1, 'rgba(80,180,60,0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, sz * 1.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    },
    update(pt) {
      pt.vx *= 0.98;
      pt.vy *= 0.98;
    },
  },

  // ---- heal_circle：治疗/能量光环（中间高亮放大 + 光圈缩小） ----
  heal_circle: {
    spawn: (x, y, color, size, duration, pool, list, extra) => defaultSpawn(x, y, 'heal_circle', color, size, duration, pool, list, extra),
    render(ctx, pt) {
      const ratio = pt.life / pt.maxLife;
      const glowSize = pt.size * (0.25 + (1 - ratio) * 1.8);   // 中心高亮放大
      const ringSize = pt.size * (0.15 + ratio * 1.5);          // 光圈缩小（收拢）
      let opacity = ratio > 0.6 ? (1 - ratio) * 2.5 : ratio * 1.6;
      ctx.save();
      ctx.globalAlpha = Math.min(1, opacity);
      // 外层光晕（膨胀）
      const outer = ctx.createRadialGradient(pt.x, pt.y, glowSize * 0.05, pt.x, pt.y, glowSize * 1.4);
      outer.addColorStop(0, `rgba(255,255,220,1)`);
      outer.addColorStop(0.3, `rgba(255,240,150,0.7)`);
      outer.addColorStop(0.7, `rgba(255,200,80,0.15)`);
      outer.addColorStop(1, 'rgba(255,180,50,0)');
      ctx.fillStyle = outer;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, glowSize * 1.4, 0, Math.PI * 2);
      ctx.fill();
      // 核心光圈（缩小收拢）
      ctx.strokeStyle = pt.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, ringSize, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    },
  },

  // ---- incendiary：扩散圆环 ----
  incendiary: {
    spawn: (x, y, color, size, duration, pool, list, extra) => defaultSpawn(x, y, 'incendiary', color, size, duration, pool, list, extra),
    render(ctx, pt) {
      const ratio = pt.life / pt.maxLife;
      const radius = pt.size * (1 - ratio);
      ctx.strokeStyle = pt.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, radius, 0, Math.PI * 2);
      ctx.stroke();
    },
  },

  // ---- jitter_line：抖动连线 ----
  jitter_line: {
    spawn: (x, y, color, size, duration, pool, list, extra) => defaultSpawn(x, y, 'jitter_line', color, size, duration, pool, list, extra),
    render(ctx, pt) {
      const ratio = pt.life / pt.maxLife;
      if (!pt.extra || pt.extra.x2 === undefined) return;
      const x1 = pt.x; const y1 = pt.y;
      const x2 = pt.extra.x2; const y2 = pt.extra.y2;
      const flicker = 0.5 + Math.random() * 0.5;
      ctx.save();
      ctx.globalAlpha = ratio * flicker;
      ctx.strokeStyle = pt.color;
      ctx.lineWidth = 4.5;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      const segments = 4;
      for (let s = 1; s < segments; s++) {
        const t = s / segments;
        ctx.lineTo(x1 + (x2 - x1) * t + (Math.random() - 0.5) * 25, y1 + (y2 - y1) * t + (Math.random() - 0.5) * 25);
      }
      ctx.lineTo(x2, y2);
      ctx.stroke();
      ctx.restore();
    },
  },

  // ---- lightning：雷电 ----
  lightning: {
    spawn: (x, y, color, size, duration, pool, list, extra) => defaultSpawn(x, y, 'lightning', color, size, duration, pool, list, extra),
    render(ctx, pt) {
      ctx.strokeStyle = pt.color;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(pt.x, pt.y - 100);
      let curX = pt.x; let curY = pt.y - 100;
      while (curY < pt.y) {
        curX += (Math.random() - 0.5) * 20;
        curY += 20;
        ctx.lineTo(curX, Math.min(curY, pt.y));
      }
      ctx.stroke();
    },
  },

  // ---- shield：六边形护盾 ----
  shield: {
    spawn: (x, y, color, size, duration, pool, list, extra) => defaultSpawn(x, y, 'shield', color, size, duration, pool, list, extra),
    render(ctx, pt) {
      const ratio = pt.life / pt.maxLife;
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
    },
  },

  // ---- slash：斩击线 ----
  slash: {
    spawn: (x, y, color, size, duration, pool, list, extra) => defaultSpawn(x, y, 'slash', color, size, duration, pool, list, extra),
    render(ctx, pt) {
      const ratio = pt.life / pt.maxLife;
      const angle = pt.extra?.angle || 0;
      const length = (pt.extra?.length || 32) * ratio * 0.5;
      const sx = pt.x - Math.cos(angle) * length;
      const sy = pt.y - Math.sin(angle) * length;
      const ex = pt.x + Math.cos(angle) * length;
      const ey = pt.y + Math.sin(angle) * length;
      const mx = (sx + ex) / 2;
      const my = (sy + ey) / 2;

      if (pt.extra?.tapered) {
        // 锥形模式：中间粗两边细，filled polygon
        const hw = pt.size * ratio;           // 中点半宽（粗）
        const ew = pt.size * ratio * 0.15;    // 端点半宽（细）
        const perpX = -Math.sin(angle);
        const perpY = Math.cos(angle);
        ctx.fillStyle = pt.color;
        ctx.globalAlpha = ratio;
        ctx.beginPath();
        ctx.moveTo(sx + perpX * ew, sy + perpY * ew);
        ctx.lineTo(mx + perpX * hw, my + perpY * hw);
        ctx.lineTo(ex + perpX * ew, ey + perpY * ew);
        ctx.lineTo(ex - perpX * ew, ey - perpY * ew);
        ctx.lineTo(mx - perpX * hw, my - perpY * hw);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 1;
      } else {
        ctx.strokeStyle = pt.color;
        ctx.lineWidth = pt.size * ratio;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(ex, ey);
        ctx.stroke();
      }
    },
  },

  // ---- star：四角旋转星 ----
  star: {
    spawn: (x, y, color, size, duration, pool, list, extra) => defaultSpawn(x, y, 'star', color, size, duration, pool, list, extra),
    render(ctx, pt) {
      const ratio = pt.life / pt.maxLife;
      const s = pt.size * ratio;
      ctx.save();
      ctx.translate(pt.x, pt.y);
      const rotationAngle = (1 - ratio) * Math.PI * 4;
      ctx.rotate(rotationAngle);
      ctx.fillStyle = pt.color;
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, -s);
      ctx.quadraticCurveTo(0, 0, s, 0);
      ctx.quadraticCurveTo(0, 0, 0, s);
      ctx.quadraticCurveTo(0, 0, -s, 0);
      ctx.quadraticCurveTo(0, 0, 0, -s);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    },
  },

  // ---- wind_circle：风圈 ----
  wind_circle: {
    spawn: (x, y, color, size, duration, pool, list, extra) => defaultSpawn(x, y, 'wind_circle', color, size, duration, pool, list, extra),
    render(ctx, pt) {
      const ratio = pt.life / pt.maxLife;
      let currentSize: number;
      if (pt.extra?.shrink) {
        // 收缩模式：从 size*1.3 缩小到 0，向内收缩
        currentSize = pt.size * (0.3 + ratio * 1.0);
      } else {
        // 原有扩散模式
        const expandRatio = 1 - ratio;
        currentSize = pt.size * (1 + expandRatio * 1.5);
      }
      ctx.save();
      ctx.globalAlpha = ratio;
      ctx.strokeStyle = pt.color || '#ffffff';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, currentSize, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    },
  },

  // ---- soil：钻土土壤碎块（dust.png贴图，不透明，无随机） ----
  soil: {
    spawn(x, y, color, size, duration, pool, list) {
      const pt = pool.get();
      pt.x = x; pt.y = y; pt.type = 'soil'; pt.color = color;
      pt.size = size;
      pt.maxLife = duration; pt.life = duration;
      pt.vx = 0; pt.vy = 0;
      list.push(pt);
    },
    render(ctx, pt) {
      if (!dustImage.complete) return;
      const s = pt.size;
      ctx.globalAlpha = 1;
      ctx.drawImage(dustImage, pt.x - s / 2, pt.y - s / 2, s, s);
    },
    // update(pt, dt) {
    //   pt.vy -= 2 * dt;
    //   pt.x += pt.vx * dt;
    //   pt.y += pt.vy * dt;
    // },
  },

  // ---- blast_core：爆炸核心闪光（径向渐变，从中心爆发后消退） ----
  blast_core: {
    spawn(x, y, color, size, duration, pool, list) {
      const pt = pool.get();
      pt.x = x; pt.y = y; pt.type = 'blast_core'; pt.color = color; pt.size = size;
      pt.maxLife = duration; pt.life = duration;
      pt.vx = 0; pt.vy = 0;
      list.push(pt);
    },
    render(ctx, pt) {
      const elapsed = pt.maxLife - pt.life;
      const peakTime = pt.maxLife * 0.44; // peak at ~44% of duration
      let progress: number;
      if (elapsed < peakTime) {
        progress = elapsed / peakTime;
      } else {
        progress = 1 - (elapsed - peakTime) / (pt.maxLife - peakTime);
      }
      if (progress <= 0) return;
      const r = pt.size * (0.15 + progress * 1.0);
      const alpha = progress;
      const grad = ctx.createRadialGradient(pt.x, pt.y, 0, pt.x, pt.y, Math.max(r, 1));
      grad.addColorStop(0, `rgba(255,255,255,${alpha})`);
      grad.addColorStop(0.4, `rgba(255,230,140,${alpha * 0.9})`);
      grad.addColorStop(1, 'rgba(255,150,40,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, Math.max(r, 1), 0, Math.PI * 2);
      ctx.fill();
    },
  },

  // ---- blast_flame：爆炸火焰粒子（径向扩散 + 颜色从白黄渐变到暗红） ----
  blast_flame: {
    spawn(x, y, color, size, duration, pool, list) {
      const pt = pool.get();
      pt.x = x; pt.y = y; pt.type = 'blast_flame'; pt.color = color; pt.size = size;
      pt.maxLife = duration; pt.life = duration;
      const angle = Math.random() * Math.PI * 2;
      const speed = 0.2 + Math.random();
      pt.vx = 0; pt.vy = 0;
      pt.extra = {
        originX: x, originY: y,
        baseVx: Math.cos(angle) * speed,
        baseVy: Math.sin(angle) * speed - (0.3 + Math.random() * 0.6),
      };
      list.push(pt);
    },
    render(ctx, pt) {
      const prog = 1 - pt.life / pt.maxLife;
      const alpha = prog < 0.2 ? prog / 0.1 : 1 - (prog - 0.2) / 0.8;
      if (alpha <= 0) return;
      const sz = Math.max(pt.size * (1 - prog * 0.4), 0.5);
      let colorStr: string;
      if (prog < 0.35) {
        const g = Math.max(0, Math.round(240 - prog * 100));
        const b = Math.max(0, Math.round(120 - prog * 200));
        colorStr = `rgba(255,${g},${b},${alpha})`;
      } else {
        const r = Math.max(0, Math.round(230 - prog * 120));
        const g = Math.max(0, Math.round(90 - prog * 80));
        colorStr = `rgba(${r},${g},30,${alpha})`;
      }
      ctx.fillStyle = colorStr;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, sz, 0, Math.PI * 2);
      ctx.fill();
    },
    update(pt, _dt) {
      const elapsed = (pt.maxLife - pt.life) * 1000; // ms
      const prog = elapsed / (pt.maxLife * 1000);
      pt.x = pt.extra.originX + pt.extra.baseVx * elapsed * 0.12;
      pt.y = pt.extra.originY + pt.extra.baseVy * elapsed * 0.12 - prog * prog * 10;
    },
  },

  // ---- blast_spark：爆炸火花（带重力弹道，从亮黄变为橙色） ----
  blast_spark: {
    spawn(x, y, color, size, duration, pool, list) {
      const pt = pool.get();
      pt.x = x; pt.y = y; pt.type = 'blast_spark'; pt.color = color; pt.size = size;
      pt.maxLife = duration; pt.life = duration;
      const angle = Math.random() * Math.PI * 2;
      const speed = 1.2 + Math.random() * 2.0;
      pt.vx = 0; pt.vy = 0;
      pt.extra = {
        originX: x, originY: y,
        baseVx: Math.cos(angle) * speed,
        baseVy: Math.sin(angle) * speed - (0.2 + Math.random() * 0.4),
        grav: 0.008 + Math.random() * 0.012,
      };
      list.push(pt);
    },
    render(ctx, pt) {
      const prog = 1 - pt.life / pt.maxLife;
      const alpha = Math.max(0, 1 - prog);
      if (alpha <= 0) return;
      const hue = prog < 0.5 ? '255,235,150' : '255,140,50';
      const sz = Math.max(pt.size * (1 - prog * 0.5), 0.4);
      ctx.fillStyle = `rgba(${hue},${alpha})`;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, sz, 0, Math.PI * 2);
      ctx.fill();
    },
    update(pt, _dt) {
      const elapsed = pt.maxLife - pt.life; // seconds
      const t = elapsed * 140; // match HTML: age * 0.14, age in ms → elapsed*1000*0.14
      pt.x = pt.extra.originX + pt.extra.baseVx * t;
      pt.y = pt.extra.originY + pt.extra.baseVy * t + pt.extra.grav * t * t;
    },
  },

  // ---- blast_smoke：爆炸烟雾（膨胀、上浮、加深） ----
  blast_smoke: {
    spawn(x, y, color, size, duration, pool, list) {
      const pt = pool.get();
      pt.x = x; pt.y = y; pt.type = 'blast_smoke'; pt.color = color; pt.size = size;
      pt.maxLife = duration; pt.life = duration;
      const angle = Math.random() * Math.PI * 2;
      const speed = 0.15 + Math.random() * 0.75;
      pt.vx = 0; pt.vy = 0;
      pt.extra = {
        originX: x + (Math.random() - 0.5) * 16,
        originY: y + (Math.random() - 0.5) * 16,
        baseVx: Math.cos(angle) * speed,
        baseVy: -(0.4 + Math.random() * 1.0),
      };
      list.push(pt);
    },
    render(ctx, pt) {
      const prog = 1 - pt.life / pt.maxLife;
      const alpha = (prog < 0.15 ? prog / 0.15 : 1 - (prog - 0.15) / 0.85) * 0.55;
      if (alpha <= 0) return;
      const sz = pt.size * (0.4 + prog * 0.8);
      const dark = Math.round(38 + prog * 22);
      ctx.fillStyle = `rgba(${dark},${dark},${dark},${alpha})`;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, sz, 0, Math.PI * 2);
      ctx.fill();
    },
    update(pt, _dt) {
      const elapsed = (pt.maxLife - pt.life) * 1000;
      const prog = elapsed / (pt.maxLife * 1000);
      pt.x = pt.extra.originX + pt.extra.baseVx * elapsed * 0.12;
      pt.y = pt.extra.originY + pt.extra.baseVy * elapsed * 0.12 - prog * prog * 10;
    },
  },

  // ---- smoke_puff：忍小猴瞬移烟雾（上升、膨胀、半透明灰球，模仿 smoke_rising_continuous.html） ----
  smoke_puff: {
    spawn(x, y, color, size, duration, pool, list) {
      const pt = pool.get();
      // 初始散布覆盖下半身区域（x: ±60px, y: +20~+100px 偏下）
      pt.x = x + (Math.random() - 0.5) * 80;
      pt.y = y   + Math.random() * 80;
      pt.type = 'smoke_puff'; pt.color = color; pt.size = size;
      pt.maxLife = duration; pt.life = duration;
      pt.vx = 0; pt.vy = 0;
      // 横向漂移量（-10 ~ +11px），模仿 HTML 中各 puff 的 --x 变量
      const driftX = -10 + Math.random() * 22;
      pt.extra = { originX: pt.x, originY: pt.y, driftX };
      list.push(pt);
    },
    render(ctx, pt) {
      const prog = 1 - pt.life / pt.maxLife;
      // Alpha: 快速淡入（0→0.15 → 0.9），然后缓慢衰减
      let alpha: number;
      if (prog < 0.15) alpha = (prog / 0.15) * 0.9;
      else if (prog < 0.55) alpha = 0.9 - ((prog - 0.15) / 0.4) * 0.15;
      else if (prog < 0.85) alpha = 0.75 - ((prog - 0.55) / 0.3) * 0.45;
      else alpha = 0.3 * (1 - (prog - 0.85) / 0.15);
      if (alpha <= 0) return;

      // Size: 从 0.4x 膨胀到 2.2x
      const sz = pt.size * (0.4 + prog * 1.8);

      // 径向渐变模拟 CSS blur(2.5px) 的柔和效果
      const grad = ctx.createRadialGradient(pt.x, pt.y, sz * 0.2, pt.x, pt.y, sz);
      grad.addColorStop(0, `rgba(160,160,160,${alpha})`);
      grad.addColorStop(0.5, `rgba(130,130,130,${alpha * 0.7})`);
      grad.addColorStop(1, 'rgba(90,90,90,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, sz, 0, Math.PI * 2);
      ctx.fill();
    },
    update(pt, _dt) {
      const prog = 1 - pt.life / pt.maxLife;
      // 上升 88px（匹配 CSS @keyframes），横向逐渐漂移
      pt.x = pt.extra.originX + pt.extra.driftX * (0.2 + prog * 0.8);
      pt.y = pt.extra.originY - 88 * prog;
    },
  },

  // ---- hard_shard：白色硬质碎片（反甲爆发用） ----
  hard_shard: {
    spawn(x, y, color, size, duration, pool, list) {
      const pt = pool.get();
      pt.x = x; pt.y = y; pt.type = 'hard_shard'; pt.color = color;
      pt.size = size * (0.5 + Math.random() * 0.7);
      pt.maxLife = duration * (0.7 + Math.random() * 0.4);
      pt.life = pt.maxLife;
      const angle = Math.random() * Math.PI * 2;
      const speed = 200 + Math.random() * 250; // 一格范围 ~128px
      pt.vx = Math.cos(angle) * speed;
      pt.vy = Math.sin(angle) * speed;
      list.push(pt);
    },
    render(ctx, pt) {
      const ratio = pt.life / pt.maxLife;
      const s = pt.size * (0.6 + ratio * 0.4);
      ctx.save();
      ctx.globalAlpha = ratio * 0.95;
      ctx.fillStyle = pt.color;
      // 菱形硬边碎片
      ctx.beginPath();
      ctx.moveTo(pt.x, pt.y - s);
      ctx.lineTo(pt.x + s * 0.65, pt.y);
      ctx.lineTo(pt.x, pt.y + s * 0.5);
      ctx.lineTo(pt.x - s * 0.65, pt.y);
      ctx.closePath();
      ctx.fill();
      // 亮边勾勒
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.lineWidth = 0.8;
      ctx.stroke();
      ctx.restore();
    },
    update(pt, dt) {
      // 速度衰减 + 一点重力
      pt.vx *= 0.94;
      pt.vy *= 0.94;
      pt.vy += 30 * dt; // 微重力
    },
  },
};
