export interface MonsterData {
  id: number;
  name: string;
  nameEn: string;
  cost: number;
  type: 'melee' | 'ranged';
  hp: number;
  atk: number;
  ats: number; // attack speed (attacks per second)
  range: number;
  speed: number;
  skill: string;
  skillName: string;
  skillNameEn: string;
  skillCd: number;
  race: string;
  raceEn: string;
  role: string;
  roleEn: string;
  scale: number;         // 编辑器和卡片渲染的额外缩放倍率（默认 1.0），精细调整各怪兽视觉大小
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  skillCoeff?: number;  // 技能伤害系数（atk * coeff），无伤害技能不填
  skillDesc: string;     // 技能描述模板，{dmg} 占位符
  skillDescEn: string;
  isSummon?: boolean;    // 是否是召唤物
}

export interface BadgeData {
  id: number;
  name: string;
  nameEn: string;
  desc: string;
  descEn: string;
}

export const DB_MONSTERS: MonsterData[] = [
  { id: 101, name: "肃清哥", nameEn: "Reaper Goblin", cost: 4, type: 'melee', hp: 3000, atk: 120, ats: 1.25, range: 1, speed: 2.5, skill: 'reap', skillName: "撕裂", skillNameEn: "Reap", skillCd: 2, race: "哥布林", raceEn: "Goblin", role: "战士", roleEn: "Warrior",
    scale: 1, sx: 0, sy: 10, sw: 204, sh: 205, skillCoeff: 1.0, skillDesc: "旋转对周围一圈敌人造成 {dmg} 伤害，并附带流血效果。", skillDescEn: "Spin and deal {dmg} damage to surrounding enemies, causing bleeding." },
  { id: 102, name: "大祭司哥", nameEn: "High Priest Goblin", cost: 4, type: 'ranged', hp: 2450, atk: 190, ats: 0.59, range: 7, speed: 2.5, skill: 'lightning', skillName: "闪电", skillNameEn: "Lightning", skillCd: 7, race: "哥布林", raceEn: "Goblin", role: "法师", roleEn: "Mage", 
    scale: 1, sx: 204, sy: 10, sw: 204, sh: 205, skillCoeff: 2.5, skillDesc: "对范围内最多 4 个敌人造成 {dmg} 伤害，并有 50% 概率附加 2 秒眩晕。", skillDescEn: "Deal {dmg} damage to up to 4 enemies in range, with a 50% chance to stun for 2 seconds." },
  { id: 103, name: "学徒哥", nameEn: "Apprentice Goblin", cost: 2, type: 'ranged', hp: 1500, atk: 80, ats: 1.05, range: 5, speed: 2.5, skill: 'life_link', skillName: "生命链接", skillNameEn: "Life Link", skillCd: 2, race: "哥布林", raceEn: "Goblin", role: "法师", roleEn: "Mage", 
    scale: 1, sx: 408, sy: 15, sw: 204, sh: 205, skillDesc: "将范围内所有友方生命按百分比平均分摊。", skillDescEn: "Distribute the HP percentage of all friendly units in range equally." },
  { id: 104, name: "散弹哥", nameEn: "Shotgun Goblin", cost: 2, type: 'ranged', hp: 1400, atk: 30, ats: 1.18, range: 5, speed: 2.5, skill: 'incendiary', skillName: "散弹", skillNameEn: "Shotgun", skillCd: 3, race: "哥布林", raceEn: "Goblin", role: "射手", roleEn: "Ranger", 
    scale: 1.07, sx: 623, sy: 30, sw: 204, sh: 180, skillCoeff: 3.0, skillDesc: "普攻散射五颗子弹；技能发射燃烧弹造成 {dmg} 伤害，击退 1 格并施加燃烧。", skillDescEn: "Normal attacks scatter 5 bullets. Skill fires an incendiary bomb dealing {dmg} damage, knocking back 1 cell and burning." },
  { id: 105, name: "祈祷哥", nameEn: "Priest Goblin", cost: 2, type: 'ranged', hp: 2000, atk: 50, ats: 1, range: 5, speed: 2.5, skill: 'recovery', skillName: "治疗", skillNameEn: "Heal", skillCd: 0, race: "哥布林", raceEn: "Goblin", role: "法师", roleEn: "Mage", 
    scale: 1, sx: 0, sy: 215, sw: 204, sh: 205, skillDesc: "战斗开始时连线周围友军，自身攻击伤害时连线友军回血 2% 最大生命值。", skillDescEn: "Connects to nearby allies at start. On dealing damage, heals connected allies for 2% of their max HP." },
  { id: 106, name: "冲锋哥", nameEn: "Charger Goblin", cost: 2, type: 'melee', hp: 2000, atk: 100, ats: 0.91, range: 1, speed: 2.5, skill: 'rush', skillName: "冲锋", skillNameEn: "Charge", skillCd: 0, race: "哥布林", raceEn: "Goblin", role: "特殊", roleEn: "Special",
    scale: 1.0, sx: 204, sy: 215, sw: 204, sh: 205, skillCoeff: 1.0, skillDesc: "战斗开始时向前突进，撞击对手造成 {dmg} 伤害，并击退 2-3 格。", skillDescEn: "Dash forward at start, dealing {dmg} damage to collision target and knocking them back 2-3 cells." },
  { id: 107, name: "咒法骑士", nameEn: "Conjurer Knight", cost: 2, type: 'ranged', hp: 1500, atk: 130, ats: 0.5, range: 5, speed: 2.5, skill: 'big_cannon', skillName: "咒法大炮", skillNameEn: "Conjure Cannon", skillCd: 0, race: "人类", raceEn: "Human", role: "法师", roleEn: "Mage",
    scale: 1.0, sx: 408, sy: 215, sw: 204, sh: 205, skillCoeff: 7.5, skillDesc: "开局蓄力 2s，发射重炮对直线上敌人造成 {dmg} 伤害。", skillDescEn: "Charge for 2s at start, then fire a heavy cannon dealing {dmg} damage in a straight line." },
  { id: 108, name: "救星骑士", nameEn: "Savior Knight", cost: 4, type: 'melee', hp: 3600, atk: 120, ats: 1, range: 1, speed: 2.5, skill: 'leap', skillName: "营救", skillNameEn: "Rescue Leap", skillCd: 8, race: "人类", raceEn: "Human", role: "战士", roleEn: "Warrior",
    scale: 0.85, sx: 617, sy: 205, sw: 204, sh: 205, skillCoeff: 4.5, skillDesc: "跳跃至上一个受伤的友方身边，落点造成 {dmg} 伤害，双方各获 8 层护盾。", skillDescEn: "Leap to the recently injured ally, dealing {dmg} damage at landing. Grants 8 layers of shield to both." },
  { id: 109, name: "银狙骑士", nameEn: "Silver Sniper", cost: 2, type: 'ranged', hp: 1000, atk: 300, ats: 0.35, range: 7, speed: 2.5, skill: 'shot', skillName: "狙击", skillNameEn: "Snipe", skillCd: 8, race: "人类", raceEn: "Human", role: "射手", roleEn: "Ranger",
    scale: 1.0, sx: 0, sy: 420, sw: 204, sh: 205, skillCoeff: 4.0, skillDesc: "下一次普攻造成 4-5 倍伤害（{dmg}-{dmg2}），对高血量敌人伤害更高。", skillDescEn: "Next attack deals 4-5x damage ({dmg}-{dmg2}), scaling higher on high HP enemies." },
  { id: 110, name: "帝国之盾", nameEn: "Imperial Shield", cost: 2, type: 'melee', hp: 3000, atk: 72, ats: 0.83, range: 1, speed: 2.5, skill: 'shield', skillName: "御敌", skillNameEn: "Guardian Shield", skillCd: 6, race: "人类", raceEn: "Human", role: "坦克", roleEn: "Tank",
    scale: 1.0, sx: 204, sy: 425, sw: 204, sh: 205, skillDesc: "每 6s 给自己和相邻友方 5 层护盾。护盾减免 60% 伤害。", skillDescEn: "Every 6s, grant himself and adjacent allies 5 shield layers (blocks 60% damage)." },
  { id: 111, name: "见习骑士", nameEn: "Novice Knight", cost: 2, type: 'melee', hp: 2200, atk: 105, ats: 0.91, range: 1, speed: 2.5, skill: 'wind_attack', skillName: "旋风斩", skillNameEn: "Cyclone", skillCd: 2, race: "人类", raceEn: "Human", role: "战士", roleEn: "Warrior",
    scale: 0.93, sx: 414, sy: 420, sw: 204, sh: 205, skillCoeff: 2.0, skillDesc: "旋转对周围一圈造成 {dmg} 伤害。", skillDescEn: "Spin and deal {dmg} damage to surrounding enemies." },
  { id: 112, name: "守卫者之剑", nameEn: "Guardian Sword", cost: 2, type: 'melee', hp: 2100, atk: 190, ats: 0.5, range: 1, speed: 2.5, skill: 'heal_sword', skillName: "守护之剑", skillNameEn: "Sacred Sword", skillCd: 6, race: "人类", raceEn: "Human", role: "坦克", roleEn: "Tank",
    scale: 1.0, sx: 625, sy: 420, sw: 230, sh: 205, skillCoeff: 1.5, skillDesc: "造成 {dmg} 伤害，使周围友方回复 5% 最大生命值。", skillDescEn: "Deal {dmg} damage and restore 5% of max HP to surrounding allies." },
  { id: 113, name: "爆破大师", nameEn: "Demolitionist", cost: 2, type: 'ranged', hp: 1700, atk: 102, ats: 0.74, range: 6, speed: 2.5, skill: 'explosive', skillName: "爆破", skillNameEn: "Demolition", skillCd: 0, race: "矿工", raceEn: "Dwarf", role: "法师", roleEn: "Mage",
    scale: 1.0, sx: 0, sy: 625, sw: 204, sh: 200, skillDesc: "普攻附带溅射效果，可同时攻击相邻的怪兽。", skillDescEn: "Normal attacks splash to damage adjacent monsters." },
  { id: 114, name: "突突突矿工", nameEn: "Rapid Miner", cost: 2, type: 'ranged', hp: 1400, atk: 50, ats: 2.14, range: 5, speed: 2.5, skill: 'open_fire', skillName: "扫射", skillNameEn: "Rapid Fire", skillCd: 0, race: "矿工", raceEn: "Dwarf", role: "射手", roleEn: "Ranger",
    scale: 1.0, sx: 210, sy: 625, sw: 204, sh: 205, skillDesc: "开局攻速提升 200%，攻击力提升 12，持续 2.5s。", skillDescEn: "At start, increase ATK speed by 200% and ATK by 12 for 2.5s." },
  { id: 115, name: "铲土人", nameEn: "Shovel Guard", cost: 4, type: 'melee', hp: 4500, atk: 200, ats: 0.41, range: 1, speed: 2.5, skill: 'unyielding', skillName: "堡垒", skillNameEn: "Fortress", skillCd: 10, race: "矿工", raceEn: "Dwarf", role: "坦克", roleEn: "Tank",
    scale: 0.9, sx: 420, sy: 625, sw: 204, sh: 205, skillDesc: "每 10s 给自己和2以内的队友施加坚固，持续4s，自己回复 500 生命；坚固：减免30%伤害", skillDescEn: "Every 10s, apply Fortified (blocks 30% damage) to self and allies within 2 cells for 4s, healing self for 500." },
  { id: 116, name: "钻头", nameEn: "Driller", cost: 2, type: 'melee', hp: 1800, atk: 40, ats: 2.38, range: 1, speed: 2.5, skill: 'dig', skillName: "地道战", skillNameEn: "Drill Dash", skillCd: 0, race: "矿工", raceEn: "Dwarf", role: "特殊", roleEn: "Special",
    scale: 0.88, sx: 624, sy: 625, sw: 204, sh: 205, skillDesc: "开局钻地前进 6 格，给自己 6 层护盾，击中眩晕 2s。", skillDescEn: "Drill underground to advance 6 cells at start, granting self 6 shield layers and stunning target hit for 2s." },
  { id: 117, name: "铁甲猴", nameEn: "Armored Monkey", cost: 2, type: 'melee', hp: 2000, atk: 140, ats: 0.71, range: 1, speed: 2.5, skill: 'throw', skillName: "人间大炮", skillNameEn: "Monkey Cannon", skillCd: 0, race: "亚人", raceEn: "Beastman", role: "特殊", roleEn: "Special",
    scale: 0.83, sx: 15, sy: 810, sw: 204, sh: 205, skillDesc: "将身后友方投出，双方获 8 层护盾，落点对范围1造成盾值 ×45 伤害。", skillDescEn: "Throw the ally behind. Both gain 8 shields; landing deals Shield x 45 damage to area 1." },
  { id: 118, name: "塞雷", nameEn: "Celeste", cost: 4, type: 'melee', hp: 2700, atk: 120, ats: 1, range: 1, speed: 2.5, skill: 'slash', skillName: "斩击", skillNameEn: "Slash", skillCd: 4, race: "亚人", raceEn: "Beastman", role: "战士", roleEn: "Warrior",
    scale: 0.93, sx: 225, sy: 824, sw: 204, sh: 205, skillCoeff: 1.6, skillDesc: "突进到目标身后造成 {dmg} 伤害，给自己1层盾，最多突进 3 次。", skillDescEn: "Dash behind the target, dealing {dmg} damage and gaining 1 shield layer (up to 3 times)." },
  { id: 119, name: "忍小猴", nameEn: "Ninja Monkey", cost: 2, type: 'melee', hp: 1400, atk: 86, ats: 1, range: 1, speed: 2.5, skill: 'shadow', skillName: "飞雷神", skillNameEn: "Shadow Teleport", skillCd: 3.5, race: "亚人", raceEn: "Beastman", role: "特殊", roleEn: "Special",
    scale: 1.0, sx: 424, sy: 824, sw: 204, sh: 205, skillCoeff: 3.0, skillDesc: "开局瞬移到最远敌人身边，技能造成 {dmg} 伤害。", skillDescEn: "Teleport to the furthest enemy at start, dealing {dmg} damage." },
  { id: 120, name: "金面猴王", nameEn: "Golden Monkey King", cost: 4, type: 'ranged', hp: 2500, atk: 48, ats: 2.5, range: 5, speed: 2.5, skill: 'attack', skillName: "强化", skillNameEn: "Empower", skillCd: 4, race: "亚人", raceEn: "Beastman", role: "射手", roleEn: "Ranger",
    scale: 1.0, sx: 628, sy: 824, sw: 204, sh: 205, skillDesc: "范围 2 内友方攻击力 +30，持续 3s。", skillDescEn: "Grant allies within 2 cells +30 ATK for 3s." },
  { id: 121, name: "僧小猴", nameEn: "Monk Monkey", cost: 2, type: 'ranged', hp: 2500, atk: 90, ats: 1.54, range: 5, speed: 2.5, skill: 'cultivation', skillName: "修行", skillNameEn: "Cultivation", skillCd: 4, race: "亚人", raceEn: "Beastman", role: "射手", roleEn: "Ranger",
    scale: 1.0, sx: 0, sy: 1030, sw: 204, sh: 205, skillDesc: "攻击力 +40，生命上限 +300，但扣除 20% 当前血量。", skillDescEn: "Increase ATK by 40, Max HP by 300, at the cost of 20% of current HP." },
  { id: 122, name: "丛林猴", nameEn: "Jungle Monkey", cost: 2, type: 'ranged', hp: 1150, atk: 30, ats: 2.7, range: 5, speed: 2.5, skill: 'anger', skillName: "狂野", skillNameEn: "Feral Rage", skillCd: 3.5, race: "亚人", raceEn: "Beastman", role: "射手", roleEn: "Ranger",
    scale: 1.0, sx: 206, sy: 1025, sw: 204, sh: 205, skillDesc: "每次技能攻速 +10%，可无限叠加。", skillDescEn: "Each skill cast increases ATK speed by 10% (stacks infinitely)." },
  { id: 123, name: "棒球猴", nameEn: "Baseball Monkey", cost: 2, type: 'melee', hp: 1950, atk: 90, ats: 0.91, range: 1, speed: 2.5, skill: 'bash', skillName: "猛击", skillNameEn: "Heavy Slugger", skillCd: 3, race: "亚人", raceEn: "Beastman", role: "战士", roleEn: "Warrior",
    scale: 1.0, sx: 420, sy: 1035, sw: 204, sh: 205, skillCoeff: 2.3, skillDesc: "造成 {dmg} 伤害，每 2 次技能召唤一个小猴。", skillDescEn: "Deal {dmg} damage and summon a mini monkey every 2 skill casts." },
  { id: 124, name: "三振王", nameEn: "Strikeout King", cost: 2, type: 'ranged', hp: 2000, atk: 95, ats: 0.59, range: 5, speed: 2.5, skill: 'snowball', skillName: "大雪球", skillNameEn: "Giant Snowball", skillCd: 6, race: "亚人", raceEn: "Beastman", role: "法师", roleEn: "Mage",
    scale: 1.0, sx: 625, sy: 1035, sw: 204, sh: 205, skillCoeff: 2.0, skillDesc: "大雪球：造成 {dmg} 伤害，范围 2 内怪兽寒冷减速（攻速 -35%）。", skillDescEn: "Deal {dmg} damage and slow down monsters within 2 cells (ATK speed -35%)." },
  { id: 125, name: "战壕", nameEn: "Trench Monkey", cost: 2, type: 'melee', hp: 2350, atk: 150, ats: 0.53, range: 1, speed: 2.5, skill: 'conversion', skillName: "适应", skillNameEn: "Adaptation", skillCd: 2.5, race: "亚人", raceEn: "Beastman", role: "战士", roleEn: "Warrior",
    scale: 1.0, sx: 0, sy: 1240, sw: 204, sh: 205, skillDesc: "吸收范围 1 内效果，每吸收一个最大血量 +30，攻击力 +50，持续 2s。", skillDescEn: "Absorb effects within 1 cell; each increases Max HP by 30 and ATK by 50 for 2s." },
  { id: 126, name: "小猴子", nameEn: "Mini Monkey", cost: 0, type: 'ranged', hp: 100, atk: 40, ats: 0.43, range: 4, speed: 2.5, skill: 'none', skillName: "无", skillNameEn: "None", skillCd: 0, race: "亚人", raceEn: "Beastman", role: "召唤物", roleEn: "Summon",
    scale: 1.0, sx: 204, sy: 1240, sw: 204, sh: 205, isSummon: true, skillDesc: "普通攻击：远程掷石，对击中的对象附加中毒效果。", skillDescEn: "Normal attacks throw stones, applying Poison effect to targets hit." }
];

import { languageManager } from './LanguageManager';

export const DB_BADGES: BadgeData[] = [
  { id: 1, name: "穿透", nameEn: "Pierce", desc: "子弹穿透敌人，对后续敌人造成70%伤害", descEn: "Bullets pierce enemies, dealing 70% damage to subsequent targets." },
  { id: 2, name: "凋零", nameEn: "Wither", desc: "目标每带有一种负面效果，普攻伤害增加40%", descEn: "Deals +40% basic attack damage per negative effect on the target." },
  { id: 3, name: "破盾", nameEn: "Shield Breaker", desc: "伤害增加25%，一击可以破除目标4层护盾", descEn: "Damage +25% and breaks up to 4 layers of shields instantly." },
  { id: 4, name: "元素涌动", nameEn: "Elemental Surge", desc: "对技能命中的目标轮流施加燃烧和寒冷效果", descEn: "Alternately applies Burn and Cold to targets hit by skills." },
  { id: 5, name: "助跑", nameEn: "Sprint Run", desc: "开局5s内每移动一格增加7点攻击，持续到第20s", descEn: "Each grid moved in first 5s adds 7 ATK, lasting until 20s." },
  { id: 6, name: "回复光环", nameEn: "Recovery Aura", desc: "每3s回复5%血量，且提供范围2光环内己方+30%治疗量", descEn: "Heals 5% HP every 3s, and boosts incoming healing of allies in range 2 by 30%." },
  { id: 7, name: "吸血", nameEn: "Lifesteal", desc: "普通攻击回复自身血量的2%", descEn: "Normal attacks restore 2% of own max HP." },
  { id: 8, name: "厚皮", nameEn: "Thick Skin", desc: "最大生命值增加1000", descEn: "Increases Max HP by 1000." },
  { id: 9, name: "延伸", nameEn: "Extension", desc: "技能及徽章作用范围增加1格", descEn: "Increases skill and badge range by 1 cell." },
  { id: 10, name: "蓄能", nameEn: "Energy Charge", desc: "技能冷却速度加快40%，攻击速度降低25%", descEn: "Skill CD recovers 40% faster, but attack speed drops by 25%." },
  { id: 11, name: "预防", nameEn: "Prevention", desc: "战斗开始时获得12层护盾", descEn: "Grants 12 layers of shield at the start of battle." },
  { id: 12, name: "结阵守", nameEn: "Shield Phalanx", desc: "与友方相邻时，每2.5s给自己和相邻的友方2层盾", descEn: "When adjacent to allies, grant 2 shields to self and adjacent allies every 2.5s." },
  { id: 13, name: "结阵攻", nameEn: "Attack Phalanx", desc: "与友方相邻时，自己和相邻的友方攻击提升30", descEn: "When adjacent to allies, increase ATK of self and adjacent allies by 30." },
  { id: 14, name: "独狼守", nameEn: "Lone Guard", desc: "未实现！", descEn: "Unimplemented!" },
  { id: 15, name: "独狼攻", nameEn: "Lone Raider", desc: "未实现！", descEn: "Unimplemented!" },
  { id: 16, name: "贤者", nameEn: "Sage", desc: "相邻友方的技能冷却速度加快50%", descEn: "Adjacent allies' skill cooldown recovers 50% faster." },
  { id: 17, name: "大厨", nameEn: "Chef", desc: "自身产生的治疗效果提升50%", descEn: "Increases outgoing heals by 50%." },
  { id: 18, name: "复活", nameEn: "Resurrection", desc: "死亡2s后以20%生命值复活（每局一次）", descEn: "Revive with 20% HP after 2s of death (once per round)." },
  { id: 19, name: "决斗", nameEn: "Duel", desc: "未实现！", descEn: "Unimplemented!" },
  { id: 20, name: "狙击", nameEn: "Sniper", desc: "子弹飞行距离超过2格时，每多1格增加20%伤害", descEn: "Projectile deals +20% damage per cell beyond 2 cells." },
  { id: 21, name: "反击", nameEn: "Counterattack", desc: "受到伤害后，下一次攻击必定暴击", descEn: "Next attack is a guaranteed critical hit after taking damage." },
  { id: 22, name: "鲁莽", nameEn: "Reckless", desc: "普通攻击对自己造成16点伤害，但伤害提升16%（持续2s，可叠3次）", descEn: "Attack deals 16 self-damage, but increases damage by 16% (lasts 2s, up to 3 stacks)." },
  { id: 23, name: "韧性", nameEn: "Tenacity", desc: "生命值低于20%时，在3秒内回血54%", descEn: "Heals 54% HP over 3s when HP drops below 20%." },
  { id: 24, name: "炸弹", nameEn: "Detonator", desc: "开局损失80%生命，死亡时对范围1敌人造成承受伤害40%的爆炸伤害", descEn: "Starts with -80% HP. Deals 40% of damage taken as area damage on death." },
  { id: 25, name: "中毒", nameEn: "Poison", desc: "攻击或技能给目标施加中毒效果，每s受到15点伤害", descEn: "Attacks or skills apply Poison, dealing 15 damage per second." },
  { id: 26, name: "丛林之影", nameEn: "Jungle Shadow", desc: "释放技能时召唤一只小猴子（最多三次）", descEn: "Summon a mini monkey on casting skill (up to 3 times)." },
  { id: 27, name: "献祭", nameEn: "Immolation", desc: "免疫所有控制，每2s让周围1格的怪兽燃烧", descEn: "Immune to crowd control. Burns enemies within 1 cell every 2s." },
  { id: 28, name: "加固", nameEn: "Reinforce", desc: "额外获得50%的护盾", descEn: "Grants 50% additional shield capacity." },
  { id: 29, name: "协同进攻", nameEn: "Cooperative", desc: "与友方相邻时，攻击速度增加30%", descEn: "Increases attack speed by 30% when adjacent to allies." },
  { id: 30, name: "反应装甲", nameEn: "Reactive Armor", desc: "自身护盾减少时，对周围1格造成4倍于当前盾数量的伤害，生命每累计减少20%获得1层护盾", descEn: "On shield depletion, deal 4x current shield value to surrounding 1 cell. Gain 1 shield layer per 20% HP lost." },
  { id: 31, name: "哨位", nameEn: "Sentry", desc: "未实现！", descEn: "Unimplemented!" },
  { id: 32, name: "巫毒", nameEn: "Voodoo", desc: "战斗开始前10秒免疫死亡，每5s将血量强制置为20%", descEn: "Immune to death for the first 10s of battle. Forcefully sets HP to 20% every 5s." },
  { id: 33, name: "礼物", nameEn: "Legacy Gift", desc: "死亡后将自身当前攻击力的30%给予最近的友方", descEn: "On death, transfers 30% of current ATK to the nearest ally." },
  { id: 34, name: "逆转术", nameEn: "Reversal", desc: "未实现！", descEn: "Unimplemented!" },
  { id: 35, name: "接力", nameEn: "Relay", desc: "死亡时将自身的第一个徽章的效果给予最近的友方", descEn: "On death, transfers first badge effect to the nearest ally." },
  { id: 36, name: "回环", nameEn: "Loop Heal", desc: "自身受治疗后扩散30%治疗给范围2内队友", descEn: "When healed, shares 30% of incoming healing to allies within 2 cells." }
];

/** 根据怪物数据生成技能描述（动态代入伤害数值，支持双语） */
export function getSkillDescription(m: MonsterData): string {
  const isZh = languageManager.currentLanguage === 'zh';
  let desc = isZh ? m.skillDesc : m.skillDescEn;
  if (!desc) {
    desc = isZh ? "普通攻击：无特殊技能。" : "Basic attack: No special skill.";
  }
  const coeff = m.skillCoeff;
  if (coeff !== undefined) {
    desc = desc.replace(/\{dmg\}/g, String(Math.round(m.atk * coeff)));
  }
  // 特殊处理：银狙双段伤害 {dmg2} = atk * 5
  if (m.id === 109) {
    desc = desc.replace(/\{dmg2\}/g, String(Math.round(m.atk * 5)));
  }
  return desc;
}

export interface BadgeSprite { sx: number; sy: number; sw: number; sh: number; }
export const BADGE_SPRITES: Record<number, BadgeSprite> = {
  1: { sx: 397, sy: 64, sw: 139, sh: 148 },
  2: { sx: 676, sy: 64, sw: 138, sh: 148 },
  3: { sx: 954, sy: 64, sw: 139, sh: 148 },
  4: { sx: 1232, sy: 64, sw: 139, sh: 148 },
  5: { sx: 1511, sy: 64, sw: 139, sh: 148 },
  6: { sx: 1789, sy: 64, sw: 139, sh: 148 },
  7: { sx: 2068, sy: 64, sw: 138, sh: 148 },
  8: { sx: 119, sy: 335, sw: 139, sh: 147 },
  9: { sx: 397, sy: 335, sw: 139, sh: 147 },
  10: { sx: 676, sy: 335, sw: 138, sh: 147 },
  11: { sx: 954, sy: 335, sw: 139, sh: 147 },
  12: { sx: 1232, sy: 335, sw: 139, sh: 147 },
  13: { sx: 1511, sy: 335, sw: 139, sh: 147 },
  14: { sx: 1789, sy: 335, sw: 139, sh: 147 },
  15: { sx: 2068, sy: 335, sw: 138, sh: 147 },
  16: { sx: 119, sy: 605, sw: 139, sh: 148 },
  17: { sx: 397, sy: 605, sw: 139, sh: 147 },
  18: { sx: 676, sy: 605, sw: 138, sh: 147 },
  19: { sx: 954, sy: 605, sw: 139, sh: 147 },
  20: { sx: 1232, sy: 605, sw: 139, sh: 147 },
  21: { sx: 1511, sy: 605, sw: 139, sh: 147 },
  22: { sx: 1789, sy: 605, sw: 139, sh: 147 },
  23: { sx: 2068, sy: 605, sw: 138, sh: 147 },
  24: { sx: 119, sy: 875, sw: 139, sh: 148 },
  25: { sx: 397, sy: 875, sw: 139, sh: 148 },
  26: { sx: 676, sy: 875, sw: 138, sh: 148 },
  27: { sx: 954, sy: 875, sw: 139, sh: 148 },
  28: { sx: 1232, sy: 875, sw: 139, sh: 148 },
  29: { sx: 1511, sy: 875, sw: 139, sh: 148 },
  30: { sx: 1789, sy: 875, sw: 139, sh: 148 },
  31: { sx: 2068, sy: 875, sw: 138, sh: 148 },
  32: { sx: 119, sy: 1146, sw: 139, sh: 147 },
  33: { sx: 397, sy: 1146, sw: 139, sh: 147 },
  34: { sx: 676, sy: 1146, sw: 138, sh: 147 },
  35: { sx: 954, sy: 1146, sw: 139, sh: 147 },
};

// ================================================================
//  屏幕 / 网格配置（原 ScreenConfig.ts，合并入零依赖的 Database
//  以打破 VfxManager ↔ BattleSystem 之间的循环依赖）
// ================================================================
export const screenConfig = {
  width: 2556,
  height: 1179,
  leftOffset: 588,
  topOffset: 240,
  gridW: 1380,
  gridH: 620,
  gridCols: 11,
  gridRows: 5,
  cellGap: 10,
  get cellW() { return (this.gridW - this.cellGap * (this.gridCols - 1)) / this.gridCols + this.cellGap; },
  get cellH() { return (this.gridH - this.cellGap * (this.gridRows - 1)) / this.gridRows + this.cellGap; },
  get cellContentW() { return (this.gridW - this.cellGap * (this.gridCols - 1)) / this.gridCols; },
  get cellContentH() { return (this.gridH - this.cellGap * (this.gridRows - 1)) / this.gridRows; },
};

export function gridToScreen(gridX: number, gridY: number): { x: number; y: number } {
  const cfg = screenConfig;
  return {
    x: cfg.leftOffset + gridX * cfg.cellW + cfg.cellContentW / 2,
    y: cfg.topOffset + gridY * cfg.cellH + cfg.cellContentH / 2
  };
}
