// ===== VFX 预设配置表（集中管理所有粒子/子弹参数） =====
// 修改大小、速度、颜色、寿命只需改这一个文件

export { BOLT_PROFILES } from './VfxManager';
export type { BoltProfile, BoltType } from './VfxManager';
import type { ParticleType } from './ParticleTypes';

// ---- 粒子参数预设 ----
export interface ParticlePreset {
  type: ParticleType;
  duration: number;
  color: string;
  size: number;
}

// ---- 子弹参数预设（非 boltType） ----
export interface ProjectilePreset {
  speed: number;
  color: string;
  size?: number;
  arcHeight?: number;
}

// ================================================================
//  击中 / 命中效果
// ================================================================
export const HIT = {
  /** 近战斩击 */
  meleeSlash: { type: 'slash', duration: 0.2, color: '#ffffff', size: 8 } as ParticlePreset,
  /** 矿爆溅射 */
  explosiveSplash: { type: 'explosion', duration: 0.2, color: '#ff6600', size: 8 } as ParticlePreset,
  /** 矿爆闪光 */
  explosiveFlash:  { type: 'explosion',   duration: 0.08, color: '#ffffff', size: 28 } as ParticlePreset,
  /** 矿爆橙红爆破 */
  explosiveBlast:  { type: 'explosion',   duration: 0.5,  color: '#ff6600', size: 70 } as ParticlePreset,
  /** 矿爆灰烟（浅） */
  explosiveSmoke1: { type: 'dust',        duration: 1.4,  color: '#777777', size: 18 } as ParticlePreset,
  /** 矿爆黑烟（深） */
  explosiveSmoke2: { type: 'dust',        duration: 1.8,  color: '#444444', size: 22 } as ParticlePreset,
  /** 雪球普攻命中 */
  snowballAttack: { type: 'explosion', duration: 0.4, color: '#4ba3e3', size: 20 } as ParticlePreset,
  /** 冲撞命中 */
  chargeHit: { type: 'explosion', duration: 0.3, color: '#df3e23', size: 12 } as ParticlePreset,
  /** 怪物死亡 */
  death: { type: 'explosion', duration: 0.4, color: '#ffffff', size: 8 } as ParticlePreset,
  /** 炸弹徽章死亡 */
  bombDeath: { type: 'explosion', duration: 0.7, color: '#ff6600', size: 35 } as ParticlePreset,
  /** 召唤闪现（紫色） */
  summonFlash: { type: 'explosion', duration: 0.25, color: '#8833ff', size: 12 } as ParticlePreset,
  /** 跃击落地尘土 */
  leapDust: { type: 'explosion', duration: 0.3, color: '#cccccc', size: 16 } as ParticlePreset,
  /** 反应装甲：白色硬质菱形碎片爆发 */
  reactiveArmor: { type: 'hard_shard', duration: 0.45, color: '#ffffff', size: 26 } as ParticlePreset,
  /** 爆炸核心闪光（径向渐变） */
  blastCore: { type: 'blast_core', duration: 0.18, color: '#ffffff', size: 70 } as ParticlePreset,
  /** 爆炸火焰粒子 */
  blastFlame: { type: 'blast_flame', duration: 0.45, color: '#ff6600', size: 7 } as ParticlePreset,
  /** 爆炸烟雾粒子（膨胀上浮） */
  blastSmoke: { type: 'blast_smoke', duration: 0.5, color: '#444444', size: 14 } as ParticlePreset,
  /** 炸弹火花（带重力弹道） */
  blastSpark: { type: 'blast_spark', duration: 0.42, color: '#ffcc00', size: 2.5 } as ParticlePreset,
  /** 炸弹冲击波环 */
  blastShockwave: { type: 'wind_circle', duration: 0.55, color: '#ffd28c', size: 80 } as ParticlePreset,
};

// ================================================================
//  技能效果
// ================================================================
export const SKILL = {
  /** 雪球技能 */
  snowball: {
    launch: { type: 'incendiary', duration: 0.5, color: '#4ba3e3', size: 160 } as ParticlePreset,
    /** 雪雾爆发（少量雾气不叠加） */
    hit: { type: 'chill_haze', duration: 0.7, color: '#5588cc', size: 45 } as ParticlePreset,
    /** 震荡波（1.5格半径 ≈ 188px，wind_circle 最大膨胀 size*2.5 → 75*2.5=188） */
    circle: { type: 'wind_circle', duration: 0.6, color: '#4ba3e3', size: 75 } as ParticlePreset,
    projectile: { speed: 300, color: '#4ba3e3', arcHeight: 80 } as ProjectilePreset,
  },
  /** 火炮技能 */
  bigCannon: {
    chargeRing: { type: 'wind_circle', duration: 0.4,  color: '#ffdd44', size: 25 } as ParticlePreset,
    coreGlow:   { type: 'heal_circle', duration: 1.2,  color: '#ffdd44', size: 18 } as ParticlePreset,
    spark:      { type: 'energy_spark',duration: 0.6,  color: '#ffee44', size: 18 } as ParticlePreset,
    muzzle:     { type: 'explosion',   duration: 0.15, color: '#ffffff', size: 24 } as ParticlePreset,
    hit:        { type: 'explosion',   duration: 0.35, color: '#ffffff', size: 40 } as ParticlePreset,
    shockRing:  { type: 'wind_circle', duration: 0.35, color: '#ffffff', size: 80 } as ParticlePreset,
  },
  /** 多重射击 */
  multishot: {
    hit: { type: 'slash', duration: 0.2, color: '#ffffff', size: 8 } as ParticlePreset,
    projectile: { speed: 500, color: '#ff4500', arcHeight: undefined } as ProjectilePreset,
    pierceProjectile: { speed: 500, color: '#e5c158', arcHeight: undefined } as ProjectilePreset,
  },
  /** 旋刃 */
  spinningBlade: {
    cast: { type: 'slash', duration: 0.3, color: '#df3e23', size: 30 } as ParticlePreset,
  },
  /** 雷霆万钧 */
  lightningStorm: {
    hit: { type: 'lightning', duration: 0.4, color: '#e0f8ff', size: 12 } as ParticlePreset,
  },
  /** 生命链接 & 祭司连结 */
  lifeLink: {
    link: { type: 'heal', duration: 0.5, color: '#5ac54f', size: 12 } as ParticlePreset,
    ally: { type: 'heal', duration: 0.3, color: '#5ac54f', size: 10 } as ParticlePreset,
  },
  /** 肃清哥 - 血刃收割（月牙刀光旋转） */
  reap: {
    ring: { type: 'crescent', duration: 0.8, color: '#df3e23', size: 50 } as ParticlePreset,
    hit:  { type: 'explosion', duration: 0.5, color: '#8b0000', size: 10 } as ParticlePreset,
  },
  /** 学徒哥 - 生命均衡 */
  lifeBalance: {
    link: { type: 'jitter_line', duration: 0.6, color: '#7fff7f', size: 3 } as ParticlePreset,
  },
  /** 祈祷哥 - 圣疗 */
  recovery: {
    healPuff:  { type: 'heal_float', duration: 1.0, color: '#8fbc5a', size: 30 } as ParticlePreset,
    healCross: { type: 'heal_cross', duration: 1.2, color: '#8fbc5a', size: 24 } as ParticlePreset,
  },
  /** 冲锋哥 - 野蛮冲撞 */
  rush: {
    trail: { type: 'dust', duration: 0.8, color: '#999999', size: 20 } as ParticlePreset,
  },
  /** 治疗光环 */
  healAura: {
    circle: { type: 'heal_circle', duration: 0.6, color: '#5ac54f', size: 80 } as ParticlePreset,
    slash:  { type: 'crescent',   duration: 0.3, color: '#ffffff', size: 22 } as ParticlePreset,
    puff:   { type: 'heal_float', duration: 1.0, color: '#5ac54f', size: 22 } as ParticlePreset,
    cross:  { type: 'heal_cross', duration: 1.2, color: '#5ac54f', size: 18 } as ParticlePreset,
  },
  /** 旋风斩 */
  whirlwind: {
    flash:  { type: 'explosion',   duration: 0.1,  color: '#ffffff', size: 8  } as ParticlePreset,
    circle: { type: 'wind_circle', duration: 0.4,  color: '#ffffff', size: 160 } as ParticlePreset,
    blade:  { type: 'crescent',    duration: 0.45, color: '#ffffff', size: 70 } as ParticlePreset,
  },
  /** 锁定 */
  lockOn: {
    mark: { type: 'star', duration: 0.5, color: '#00ffff', size: 24 } as ParticlePreset,
    empoweredBullet: { speed: 800, color: '#ffff44', size: 20 } as ProjectilePreset,
  },
  /** 跃击 */
  leap: {
    landFlash: { type: 'explosion',   duration: 0.15, color: '#ffffff', size: 30 } as ParticlePreset,
    land:      { type: 'wind_circle', duration: 0.6,  color: '#ffffff', size: 120 } as ParticlePreset,
    landDust:  { type: 'dust',        duration: 0.7,  color: '#cccccc', size: 24 } as ParticlePreset,
  },
  /** 技能回退（紫色弹） */
  skillRecall: {
    projectile: { speed: 500, color: '#ff00ff', arcHeight: undefined } as ProjectilePreset,
  },
  /** 技能冷却就绪提示 */
  cooldownReady: {
    star: { type: 'star', duration: 0.4, color: '#ffffff', size: 20 } as ParticlePreset,
  },
  /** 雪球普攻 */
  snowballAttack: {
    launch: { type: 'incendiary', duration: 0.3, color: '#4ba3e3', size: 30 } as ParticlePreset,
    projectile: { speed: 600, color: '#4ba3e3', arcHeight: 80 } as ProjectilePreset,
  },
  /** 矿爆普攻 */
  explosiveAttack: {
    projectile: { speed: 600, color: '#ff6600', size: 48, arcHeight: 100 } as ProjectilePreset,
  },
  /** 塞雷 - 影子斩击 */
  slash: {
    /** 位移轨迹线（白色锥形，中间粗两边细） */
    trail: { type: 'slash', duration: 0.35, color: '#ffffff', size: 8 } as ParticlePreset,
    /** 瞬移落点尘土 */
    dust: { type: 'dust', duration: 0.5, color: '#cccccc', size: 16 } as ParticlePreset,
  },
  /** 忍小猴 - 忍者瞬移 */
  shadow: {
    /** 瞬移烟雾（灰黑色，覆盖全身） */
    smoke: { type: 'dust', duration: 0.8, color: '#444444', size: 40 } as ParticlePreset,
    /** 隐身进入/退出闪光 */
    stealthFlash: { type: 'explosion', duration: 0.2, color: '#6644cc', size: 18 } as ParticlePreset,
  },
  /** 战壕 - 战壕转换 */
  conversion: {
    /** 吸收光环（向内收缩） */
    ring: { type: 'wind_circle', duration: 0.5, color: '#ddaa33', size: 120 } as ParticlePreset,
    /** 增益战壕印记（金色十字） */
    buff: { type: 'heal_cross', duration: 1.0, color: '#ddaa33', size: 18 } as ParticlePreset,
    /** 状态解除闪光 */
    cleanse: { type: 'explosion', duration: 0.3, color: '#dddddd', size: 8 } as ParticlePreset,
  },
};

// ================================================================
//  状态 / Buff 文字颜色（供 addFloatingText 引用）
// ================================================================
export const STATUS_COLOR = {
  damage: '#ff3333',
  crit: '#ffcc00',
  heal: '#5ac54f',
  atk: '#ffffff',
};

// ================================================================
//  状态持续粒子效果（燃烧 / 寒冷）
// ================================================================
export const STATUS_EFFECT = {
  /** 燃烧：外焰粒子（橙色，向上扩散，钟形透明度） */
  burnFire: { type: 'burn_fire', duration: 1.7, color: '#ff8800', size: 36 } as ParticlePreset,
  /** 燃烧：余烬火花（小型亮黄粒子，稀疏漂浮） */
  burnEmber: { type: 'burn_ember', duration: 0.5, color: '#ffcc00', size: 6 } as ParticlePreset,
  /** 寒冷：蓝色雾气（单层不叠加） */
  chillHaze: { type: 'chill_haze', duration: 0.8, color: '#5588cc', size: 50 } as ParticlePreset,
  /** 寒冷：六角冰晶（缓慢出现消失，极慢漂浮） */
  chillCrystal: { type: 'chill_crystal', duration: 1.5, color: '#88bbee', size: 8 } as ParticlePreset,
};

// ================================================================
//  便捷工厂：从 preset 生成 addParticle 参数
// ================================================================
export function preset(x: number, y: number, p: ParticlePreset, extra?: any) {
  return { x, y, type: p.type, duration: p.duration, color: p.color, size: p.size, extra } as const;
}

// ================================================================
//  子弹精灵切图表（按 dbId 映射 buttleImage 切图坐标）
// ================================================================
export interface BulletSpriteConfig {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  dw: number;
  dh: number;
}

/** 默认子弹（突突突矿工/金面猴王/丛林猴 共用） */

export const BULLET_SPRITES: Record<number, BulletSpriteConfig> = {
  104: { sx: 57, sy: 10, sw: 24, sh: 7, dw: 35, dh: 10 },//散弹
  109: { sx: 5, sy: 26, sw: 37, sh: 12, dw: 55, dh: 18 },//银狙（同金面）
  114: { sx: 5, sy: 9, sw: 21, sh: 8, dw: 31, dh: 12 },//突突
  120: { sx: 5, sy: 26, sw: 37, sh: 12, dw: 55, dh: 18 },//金面
  122: { sx: 32, sy: 10, sw: 19, sh: 7, dw: 28, dh: 10 },//丛林
  121: { sx: 12, sy: 48, sw: 28, sh: 3, dw: 41, dh: 4 }, //僧小猴
};

/** 子弹发射位置偏移（相对怪兽屏幕中心，单位 px） */
export const BULLET_OFFSET: Record<number, { dx: number; dy: number }> = {
  104: { dx: 0, dy: 0 },  // 散弹
  109: { dx: 0, dy: 30 },  // 银狙
  114: { dx: 0, dy: 20 },  // 突突
  120: { dx: 0, dy: 20 },  // 金面
  122: { dx: 0, dy: 0 },  // 丛林
  121: { dx: 0, dy: 0 },  // 僧小猴
};

/** 默认子弹参数 */
export const DEFAULT_BULLET = { speed: 600, color: '#e5c158' } as const;

// ================================================================
//  未来扩展预留区
// ================================================================
// 新增击中效果：在 HIT 对象中添加新条目 { type, duration, color, size }
// 新增技能效果：在 SKILL 对象中添加新子对象 { ... }
// 新增状态粒子：在 STATUS_EFFECT 对象中添加新条目
// 新增子弹精灵：在 BULLET_SPRITES 中添加新的 dbId → BulletSpriteConfig 映射
// 
// 新增粒子类型需同步修改：
//   1. ParticleTypes.ts 的 ParticleType 联合类型
//   2. ParticleTypes.ts 的 PARTICLE_TYPES 添加 spawn + render ± update
//   3. 本文件新建预设条目
//
// 新增 Bolt 类型需同步修改：
//   1. VfxManager.ts 的 BOLT_PROFILES 添加条目 + BoltType 联合类型
//   2. VfxManager.drawBoltProjectile() 添加 switch-case 渲染分支
