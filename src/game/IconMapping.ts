import { BADGE_SPRITES } from './Database';

/** skill 名称 → badge 图标 ID 映射表 */
export const SKILL_BADGE_MAP: Record<string, number> = {
  'reap': 19, 'lightning': 4, 'life_link': 6, 'incendiary': 24,
  'recovery': 17, 'rush': 5, 'big_cannon': 20, 'leap': 22,
  'shot': 20, 'shield': 11, 'wind_attack': 31, 'heal_sword': 7,
  'explosive': 24, 'open_fire': 29, 'unyielding': 32, 'dig': 21,
  'throw': 13, 'slash': 27, 'shadow': 26, 'attack': 15,
  'cultivation': 16, 'anger': 22, 'bash': 13, 'snowball': 25,
  'conversion': 34,
};

/** 根据技能名获取对应的 badge ID */
export function getSkillBadgeId(skillName: string): number {
  return SKILL_BADGE_MAP[skillName] ?? 11; // 默认 Shield
}

/** 渲染技能图标 HTML（badge.png 精灵图裁剪） */
export function renderSkillIconHtml(skillName: string): string {
  const badgeId = getSkillBadgeId(skillName);
  const sprite = BADGE_SPRITES[badgeId];
  if (!sprite) return '';
  const scale = 64 / sprite.sw;
  const imgW = 2556 * scale;
  const imgH = 1417 * scale;
  const left = -sprite.sx * scale;
  const top = -sprite.sy * scale;
  return `
    <div style="width: 64px; height: 64px; overflow: hidden; position: relative; display: flex; justify-content: center; align-items: center; background: transparent;">
      <img src="badge.png" style="
        position: absolute;
        left: ${left}px;
        top: ${top}px;
        width: ${imgW}px;
        height: ${imgH}px;
        border: none;
        background: transparent;
      " />
    </div>
  `;
}
