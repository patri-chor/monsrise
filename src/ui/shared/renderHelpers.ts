/**
 * 共享渲染工具函数 — 消除 TeamEditorUI / BattleUI / SummaryUI 中的重复 HTML 生成代码
 */
import { BADGE_SPRITES } from '../../game/Database';

// ========== Spritesheet 图片渲染 ==========

export interface SpriteImgOptions {
  /** 额外的 CSS transform，如 'scale(0.8)' */
  transform?: string;
  /** 额外的内联样式 */
  extraStyle?: string;
  /** CSS class */
  className?: string;
  /** 是否使用绝对定位居中模式 */
  absoluteCenter?: boolean;
  /** draggable 属性 */
  draggable?: boolean;
}

/** 生成 spritesheet 切片的 <img> HTML（用于 all.png 怪兽图片） */
export function renderSpriteImg(
  sx: number, sy: number, sw: number, sh: number,
  options: SpriteImgOptions = {}
): string {
  const { transform, extraStyle, className, absoluteCenter, draggable } = options;
  const cls = className ? ` class="${className}"` : '';
  const xform = transform ? ` transform: ${transform};` : '';
  const dragAttr = draggable === false ? ' draggable="false"' : '';

  let style = `object-fit: none; object-position: -${sx}px -${sy}px; width: ${sw}px; height: ${sh}px;${xform}`;
  if (extraStyle) style += ` ${extraStyle}`;

  if (absoluteCenter) {
    return `<img src="all.png"${cls}${dragAttr} style="position: absolute; left: 50%; top: 50%; ${style} transform: translate(-50%, -50%)${transform ? ' ' + transform : ''}; transform-origin: center; display: block; border: none; background: transparent;" />`;
  }

  return `<img src="all.png"${cls}${dragAttr} style="${style}" />`;
}

// ========== 徽章图片渲染 ==========

/** 生成徽章图片的 HTML（在 badge.png 上做 spritesheet 裁剪），size 为容器边长 px */
export function renderBadgeImg(badgeId: number, size: number = 64): string {
  const sprite = BADGE_SPRITES[badgeId];
  if (!sprite) return '';

  const scale = size / sprite.sw;
  const imgW = 2556 * scale;
  const imgH = 1417 * scale;
  const left = -sprite.sx * scale;
  const top = -sprite.sy * scale;

  return `<div style="width: ${size}px; height: ${size}px; overflow: hidden; position: relative; display: flex; justify-content: center; align-items: center; background: transparent; flex-shrink: 0;">
    <img src="badge.png" style="position: absolute; left: ${left}px; top: ${top}px; width: ${imgW}px; height: ${imgH}px; border: none; background: transparent;" />
  </div>`;
}

// ========== 怪兽详情卡渲染 ==========

export interface DetailCardOptions {
  /** 当前生命值 */
  hp?: number;
  /** 最大生命值 */
  maxHp?: number;
  /** 当前攻击力 */
  atk?: number;
  /** 当前攻速 */
  ats?: number;
  /** 护盾值 */
  shield?: number;
  /** 额外要显示在详情卡底部的 HTML（徽章槽等） */
  badgesHtml?: string;
  /** 技能文本覆盖（默认使用 getSkillDescription） */
  skillTextOverride?: string;
}

/**
 * 生成怪兽详情卡面板的 HTML。
 * 用于 TeamEditorUI 和 BattleUI 的右侧详情面板。
 * @param monster MonsterData 对象
 * @param options 运行时属性覆盖
 * @param getSkillDesc 技能描述函数引用
 */
export function renderDetailCard(
  monster: {
    sx: number; sy: number;
    name: string; race: string; role: string;
    hp: number; atk: number; ats: number;
    range: number; speed: number;
    skill: string; skillCd: number;
  },
  options: DetailCardOptions = {},
  skillDescText: string = ''
): string {
  const {
    hp = monster.hp, maxHp = monster.hp,
    atk = monster.atk, ats = monster.ats,
    badgesHtml = '',
    skillTextOverride,
  } = options;

  const skillText = skillTextOverride || skillDescText;

  return `
    <!-- Avatar -->
    <div class="details-avatar-frame">
      <img src="all.png" style="
        object-fit: none;
        object-position: -${monster.sx}px -${monster.sy}px;
        width: 204px;
        height: 204px;
        left: 120px;
        top: 137px;
      " />
    </div>

    <!-- Stars -->
    <div class="details-stars-container">★★★</div>

    <!-- Meta info -->
    <div class="details-type-tag">[ ${monster.race} | ${monster.role} ]</div>
    <div class="details-name-banner">${monster.name}</div>

    <!-- Stats overlays -->
    <div class="details-val details-val-hp">${hp}/${maxHp}</div>
    <div class="details-val details-val-atk">${atk}</div>
    <div class="details-val details-val-ats">${typeof ats === 'number' ? ats.toFixed(2) : ats}</div>
    <div class="details-val details-val-range">${monster.range}</div>
    <div class="details-val details-val-speed">${monster.speed}</div>

    <!-- Skill Box -->
    <div class="details-skill-section">
      <div class="details-skill-desc-box">
        <div style="color:#e5c158; font-size:32px; margin-bottom:4px;">${monster.skill} (CD: ${monster.skillCd}s)</div>
        <div style="font-size:22px;">${skillText}</div>
      </div>
    </div>

    <!-- Equipped Badges Slots -->
    <div class="details-badges-section">
      ${badgesHtml}
    </div>
  `;
}
