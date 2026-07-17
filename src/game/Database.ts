export interface MonsterData {
  id: number;
  name: string;
  cost: number;
  type: 'melee' | 'ranged';
  hp: number;
  atk: number;
  ats: number; // attack speed (attacks per second)
  range: number;
  speed: number;
  skill: string;
  skillCd: number;
  race: string;
  role: string;
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

export interface BadgeData {
  id: number;
  name: string;
  desc: string;
}

export const DB_MONSTERS: MonsterData[] = [
  { id: 101, name: "肃清哥", cost: 4, type: 'melee', hp: 3000, atk: 120, ats: 1.25, range: 1, speed: 2.5, skill: 'reap', skillCd: 2, race: "哥布林", role: "战士", sx: 0, sy: 10, sw: 204, sh: 205 },
  { id: 102, name: "大祭司哥", cost: 4, type: 'ranged', hp: 2450, atk: 190, ats: 0.59, range: 7, speed: 2.5, skill: 'lightning', skillCd: 7, race: "哥布林", role: "法师", sx: 204, sy: 10, sw: 204, sh: 205 },
  { id: 103, name: "学徒哥", cost: 2, type: 'ranged', hp: 1500, atk: 80, ats: 1.05, range: 5, speed: 2.5, skill: 'life_link', skillCd: 3, race: "哥布林", role: "法师", sx: 408, sy: 10, sw: 204, sh: 205 },
  { id: 104, name: "散弹哥", cost: 2, type: 'ranged', hp: 1400, atk: 30, ats: 1.18, range: 5, speed: 2.5, skill: 'incendiary', skillCd: 3, race: "哥布林", role: "射手", sx: 612, sy: 10, sw: 204, sh: 205 },
  { id: 105, name: "祈祷哥", cost: 2, type: 'ranged', hp: 2000, atk: 50, ats: 1, range: 5, speed: 2.5, skill: 'recovery', skillCd: 0, race: "哥布林", role: "法师", sx: 0, sy: 215, sw: 204, sh: 205 },
  { id: 106, name: "冲锋哥", cost: 2, type: 'melee', hp: 2000, atk: 100, ats: 0.91, range: 1, speed: 2.5, skill: 'rush', skillCd: 0, race: "哥布林", role: "特殊", sx: 204, sy: 215, sw: 204, sh: 205 },
  { id: 107, name: "咒法骑士", cost: 2, type: 'ranged', hp: 1500, atk: 130, ats: 0.5, range: 5, speed: 2.5, skill: 'big_cannon', skillCd: 0, race: "人类", role: "法师", sx: 408, sy: 215, sw: 204, sh: 205 },
  { id: 108, name: "救星骑士", cost: 4, type: 'melee', hp: 3600, atk: 120, ats: 1, range: 1, speed: 2.5, skill: 'leap', skillCd: 8, race: "人类", role: "战士", sx: 617, sy: 205, sw: 204, sh: 205 },
  { id: 109, name: "银狙骑士", cost: 2, type: 'ranged', hp: 1000, atk: 300, ats: 0.35, range: 7, speed: 2.5, skill: 'shot', skillCd: 8, race: "人类", role: "射手", sx: 0, sy: 420, sw: 204, sh: 205 },
  { id: 110, name: "帝国之盾", cost: 2, type: 'melee', hp: 3500, atk: 72, ats: 0.83, range: 1, speed: 2.5, skill: 'shield', skillCd: 6, race: "人类", role: "坦克", sx: 204, sy: 425, sw: 204, sh: 205 },
  { id: 111, name: "见习骑士", cost: 2, type: 'melee', hp: 2200, atk: 105, ats: 0.91, range: 1, speed: 2.5, skill: 'wind_attack', skillCd: 2, race: "人类", role: "战士", sx: 408, sy: 420, sw: 204, sh: 205 },
  { id: 112, name: "守卫者之剑", cost: 2, type: 'melee', hp: 2100, atk: 190, ats: 0.5, range: 1, speed: 2.5, skill: 'heal_sword', skillCd: 6, race: "人类", role: "坦克", sx: 620, sy: 420, sw: 204, sh: 205 },
  { id: 113, name: "爆破大师", cost: 2, type: 'ranged', hp: 1700, atk: 102, ats: 0.74, range: 6, speed: 2.5, skill: 'explosive', skillCd: 0, race: "矿工", role: "法师", sx: 0, sy: 625, sw: 204, sh: 205 },
  { id: 114, name: "突突突矿工", cost: 2, type: 'ranged', hp: 1400, atk: 50, ats: 2.14, range: 5, speed: 2.5, skill: 'open_fire', skillCd: 0, race: "矿工", role: "射手", sx: 204, sy: 625, sw: 204, sh: 205 },
  { id: 115, name: "铲土人", cost: 4, type: 'melee', hp: 4500, atk: 200, ats: 0.41, range: 1, speed: 2.5, skill: 'unyielding', skillCd: 10, race: "矿工", role: "坦克", sx: 408, sy: 625, sw: 204, sh: 205 },
  { id: 116, name: "钻头", cost: 2, type: 'melee', hp: 1800, atk: 40, ats: 2.38, range: 1, speed: 2.5, skill: 'dig', skillCd: 0, race: "矿工", role: "特殊", sx: 624, sy: 625, sw: 204, sh: 205 },
  { id: 117, name: "铁甲猴", cost: 2, type: 'melee', hp: 2000, atk: 140, ats: 0.71, range: 1, speed: 2.5, skill: 'throw', skillCd: 0, race: "亚人", role: "特殊", sx: 15, sy: 810, sw: 204, sh: 205 },
  { id: 118, name: "塞雷", cost: 4, type: 'melee', hp: 2700, atk: 120, ats: 1, range: 1, speed: 2.5, skill: 'slash', skillCd: 4, race: "亚人", role: "战士", sx: 212, sy: 824, sw: 204, sh: 205 },
  { id: 119, name: "忍小猴", cost: 2, type: 'melee', hp: 1400, atk: 86, ats: 1, range: 1, speed: 2.5, skill: 'shadow', skillCd: 3.5, race: "亚人", role: "特殊", sx: 424, sy: 824, sw: 204, sh: 205 },
  { id: 120, name: "金面猴王", cost: 4, type: 'ranged', hp: 2500, atk: 48, ats: 2.5, range: 5, speed: 2.5, skill: 'attack', skillCd: 4, race: "亚人", role: "射手", sx: 622, sy: 824, sw: 204, sh: 205 },
  { id: 121, name: "僧小猴", cost: 2, type: 'ranged', hp: 2500, atk: 90, ats: 1.54, range: 5, speed: 2.5, skill: 'cultivation', skillCd: 4, race: "亚人", role: "射手", sx: 0, sy: 1030, sw: 204, sh: 205 },
  { id: 122, name: "丛林猴", cost: 2, type: 'ranged', hp: 1150, atk: 30, ats: 2.7, range: 5, speed: 2.5, skill: 'anger', skillCd: 3.5, race: "亚人", role: "射手", sx: 206, sy: 1025, sw: 204, sh: 205 },
  { id: 123, name: "棒球猴", cost: 2, type: 'melee', hp: 1950, atk: 90, ats: 0.91, range: 1, speed: 2.5, skill: 'bash', skillCd: 3, race: "亚人", role: "战士", sx: 420, sy: 1035, sw: 204, sh: 205 },
  { id: 124, name: "三振王", cost: 2, type: 'ranged', hp: 2000, atk: 95, ats: 0.59, range: 5, speed: 2.5, skill: 'snowball', skillCd: 6, race: "亚人", role: "法师", sx: 620, sy: 1035, sw: 204, sh: 205 },
  { id: 125, name: "战壕", cost: 2, type: 'melee', hp: 2350, atk: 150, ats: 0.53, range: 1, speed: 2.5, skill: 'conversion', skillCd: 2.5, race: "亚人", role: "战士", sx: 0, sy: 1240, sw: 204, sh: 205 }
];

export const DB_BADGES: BadgeData[] = [
  { id: 1, name: "穿透", desc: "远程攻击穿透敌人，对后续敌人造成70%伤害" },
  { id: 2, name: "凋零", desc: "目标附带负面效果数时，普攻伤害增加40%每效果" },
  { id: 3, name: "破盾", desc: "伤害增加25%，一下可以直接破掉目标4层护盾" },
  { id: 4, name: "元素涌动", desc: "每次释放技能提升20%技能冷却恢复速度，叠3次" },
  { id: 5, name: "助跑", desc: "开局5s内每移动一格增加7点攻击，持续15s" },
  { id: 6, name: "回复光环", desc: "每3s回复5%血量，且提供范围2光环内己方+30%治疗量" },
  { id: 7, name: "吸血", desc: "普通攻击伤害的20%转化为自身血量" },
  { id: 8, name: "厚皮", desc: "最大生命值增加1000" },
  { id: 9, name: "延伸", desc: "怪兽的技能及徽章作用范围增加1格" },
  { id: 10, name: "蓄能", desc: "技能冷却速度加快40%，攻击速度降低25%" },
  { id: 11, name: "预防", desc: "战斗开始时获得12层护盾" },
  { id: 12, name: "结阵守", desc: "相邻有友方时，受到的伤害减少20%" },
  { id: 13, name: "结阵攻", desc: "相邻有友方时，攻击力提升25%" },
  { id: 14, name: "独狼守", desc: "未实现！周围1格没有友方时，受到的伤害减少35%" },
  { id: 15, name: "独狼攻", desc: "未实现！周围1格没有友方时，攻击力提升40%" },
  { id: 16, name: "贤者", desc: "相邻友方的技能冷却速度加快50%" },
  { id: 17, name: "大厨", desc: "自身获得的所有治疗效果提升50%" },
  { id: 18, name: "复活", desc: "死亡2s后以20%生命值复活（每局限一次）" },
  { id: 19, name: "决斗", desc: "未实现！每次攻击相同目标增加10%伤害，上限50%" },
  { id: 20, name: "狙击", desc: "子弹飞行距离超过2格时，每多1格增加20%伤害" },
  { id: 21, name: "反击", desc: "受到伤害后，下一次普通攻击必定暴击" },
  { id: 22, name: "鲁莽", desc: "普通攻击对自己造成16点伤害，但伤害提升16%（持续2s，可叠3次）" },
  { id: 23, name: "韧性", desc: "生命值低于20%时，在3秒内回血54%" },
  { id: 24, name: "炸弹", desc: "开局损失80%生命，死亡时对范围1敌人造成承受伤害40%的爆炸伤害" },
  { id: 25, name: "中毒", desc: "攻击或技能给目标施加中毒效果，每s受到15点魔法伤害" },
  { id: 26, name: "丛林之影", desc: "未实现！战斗开始隐身3秒，隐身期间必暴击且不被选为目标" },
  { id: 27, name: "献祭", desc: "免疫所有控制，每2s让周围1格内敌人燃烧流失20血" },
  { id: 28, name: "加固", desc: "自身获得的所有护盾效果提升50%" },
  { id: 29, name: "协同进攻", desc: "与友方怪兽相邻时，攻击速度增加30%" },
  { id: 30, name: "反应装甲", desc: "自身护盾破裂或减少时，对周围1格造成4倍于消耗盾值的伤害" },
  { id: 31, name: "哨位", desc: "未实现！保持原地不动时每秒增加5%攻击，移动后重置，上限25%" },
  { id: 32, name: "巫毒", desc: "战斗开始前10秒免疫死亡，每5s将血量强制置为20%" },
  { id: 33, name: "礼物", desc: "死亡后将自身当前攻击力的30%给予最近的友方" },
  { id: 34, name: "逆转术", desc: "未实现！血量首次低于30%时，将当前HP百分比与最大HP百分比反转" },
  { id: 35, name: "接力", desc: "死亡时将自身的第一个徽章的效果给予最近的友方" }
];

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
