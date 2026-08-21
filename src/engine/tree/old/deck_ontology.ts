// ============================================================
// 卡组本体（体系论编码）：架构 × 核心 × 辅助体系 + 角色池 + 徽章模板 + 进场曲线
//
// 来源：用户体系论（docs/tree_strategy/deck_generation_plan.md 第 1 节）
//   三大架构：祷徒（学徒103+祈祷105 保射手）/ 半冲（祈祷105+帝国110 前战士后射手）/ 全冲（无105/103 爆发）
//   核心怪兽：救星108 / 祭祀102 / 肃清101 / 塞雷118 / 金猴120 / 铲土115 / 全二∅
//   辅助体系：∅ / dof（凋零2+元素来源）/ 礼物（银狙109 复活18或炸弹24+礼物33）/ 盾流（预防11+加固28+反甲30）
//
// 用途：
//   1. classifyDeck —— 把任意 8 怪卡组归入 (架构, 核心, 辅助)（回归测试用）
//   2. enumerateTemplates —— 枚举全部合法模板（M2 卡组搜索的生成骨架）
//   3. validateDeck —— 卡组合法性校验（费用/槽位/徽章数/辅助要求）
//   4. 角色池 + 徽章模板 + 进场曲线 —— 未来生成/蒸馏的先验
// 纯数据 + 纯函数，无副作用（供 TS 脚本与后续 Python 端镜像复用）。
// ============================================================

import { DB_MONSTERS } from '../../game/Database';

// ---------- 类型 ----------

export type ArchKey = 'prayer' | 'halfrush' | 'fullrush';
export type AuxKey = 'none' | 'dof' | 'gift' | 'shield';
export type CoreKey = 'savior' | 'priest' | 'suqing' | 'seri' | 'golden' | 'digger' | 'all2';

export interface DeckSlot {
  monsterId: number;
  badgeIds: number[];
}

export interface Template {
  arch: ArchKey;
  core: CoreKey;
  aux: AuxKey;
  /** 必带怪（架构骨架 + 核心 + 辅助强制怪） */
  mandatory: number[];
  /** 禁带怪（架构规则） */
  forbidden: number[];
  /** 剩余可填槽位 = 8 - |mandatory| */
  slotsLeft: number;
  /** 剩余预算 = 18 - Σcost(mandatory) */
  budgetLeft: number;
  /** 进场曲线模板（角色序列，R1..R5 软先验） */
  spawnCurve: string[];
}

// ---------- 基础数据 ----------

export const ARCH_KEYS: ArchKey[] = ['prayer', 'halfrush', 'fullrush'];
export const AUX_KEYS: AuxKey[] = ['none', 'dof', 'gift', 'shield'];

export const DECK_SLOTS = 8;
export const DECK_BUDGET = 18; // 7 套实测总费用 16~18
export const BUDGET_LIMITS: Record<number, number> = { 1: 4, 2: 8, 3: 12, 4: 14, 5: 16 };

const COST: Record<number, number> = {};
const ROLE: Record<number, string> = {};
for (const m of DB_MONSTERS) {
  COST[m.id] = m.cost;
  ROLE[m.id] = m.role;
}

export function costOf(id: number): number {
  return COST[id] ?? 2;
}

export function roleOf(id: number): string {
  return ROLE[id] ?? '战士';
}

/** 4 费核心表（含未使用的金猴120/铲土115） */
export const CORE_TABLE: Record<CoreKey, { monsterId: number | null; name: string; cost: number }> = {
  savior: { monsterId: 108, name: '救星骑士', cost: 4 },
  priest: { monsterId: 102, name: '大祭司哥', cost: 4 },
  suqing: { monsterId: 101, name: '肃清哥', cost: 4 },
  seri: { monsterId: 118, name: '塞雷', cost: 4 },
  golden: { monsterId: 120, name: '金面猴王', cost: 4 },
  digger: { monsterId: 115, name: '铲土人', cost: 4 },
  all2: { monsterId: null, name: '全二（无四费）', cost: 0 },
};

/** 核心 → 可搭配架构（用户：救星万能；祭祀/金猴/铲土偏防守；肃清半冲+dof；塞雷全冲+盾流） */
export const CORE_ARCHS: Record<CoreKey, ArchKey[]> = {
  savior: ['prayer', 'halfrush', 'fullrush'],
  priest: ['prayer', 'halfrush'],
  suqing: ['halfrush', 'prayer'],
  seri: ['fullrush'],
  golden: ['prayer', 'halfrush', 'fullrush'],
  digger: ['prayer', 'halfrush', 'fullrush'],
  all2: ['prayer', 'halfrush', 'fullrush'],
};

// ---------- 架构规则 ----------

export interface ArchRule {
  mandatory: number[];          // 必带
  forbidden: number[];          // 禁带
  desc: string;
  /** 进场曲线模板（角色，R1..R5） */
  spawnCurve: string[];
  /** 角色池（生成先验：该架构倾向的怪，非硬约束） */
  poolPref: Record<string, number[]>;
}

export const ARCH_RULES: Record<ArchKey, ArchRule> = {
  prayer: {
    mandatory: [103, 105], // 学徒+祈祷
    forbidden: [],
    desc: '祷徒：学徒祈祷构成防御，保全部带伤害徽章的射手。布阵围绕祈祷（8格链接不需相邻）。学徒带结阵守12须与祈祷相邻，防咒法/救星。可带三振王124限对方输出（优先级低于祷徒）。',
    spawnCurve: ['坦克', '支援', '核心', '输出', '突进', '输出'],
    poolPref: {
      '坦克': [110, 112],
      '支援': [103, 105, 112],
      '输出': [102, 104, 114, 124, 109, 120, 113, 121, 122],
      '突进': [106, 116, 119],
    },
  },
  halfrush: {
    mandatory: [105], // 祈祷
    forbidden: [103], // 无学徒
    desc: '半冲：祈祷+帝国，前战士后射手，灵活。战士输出或射手输出皆可，祈祷保生存。',
    spawnCurve: ['坦克', '支援', '核心', '输出', '突进', '输出'],
    poolPref: {
      '坦克': [110, 112],
      '战士': [108, 111, 123, 125, 101],
      '输出': [114, 113, 109, 104, 124, 121, 122],
      '爆发': [107, 113],  // 咒法/矿爆：半冲 dof 反祷徒打法（肃清树"对方是祷徒"分支用 107）
      '突进': [106, 116, 119],
    },
  },
  fullrush: {
    mandatory: [],
    forbidden: [105, 103], // 无祈祷无学徒
    desc: '全冲：无祈祷无学徒，爆发性怪兽短时间内输出远超对方，解掉防御怪速战速决。特殊计算器已较好复现。',
    spawnCurve: ['坦克', '突进', '爆发', '爆发', '突进', '收尾'],
    poolPref: {
      '坦克': [110],
      '突进': [106, 116, 117, 119],
      '爆发': [107, 113, 114, 104],
      '输出': [109, 124],
    },
  },
};

// ---------- 辅助体系规则 ----------

export interface AuxRule {
  desc: string;
  /** 强制加入卡组的怪（无则空） */
  mandatoryMonsters: number[];
  /** 徽章要求：团队徽章集合必须满足（至少一条） */
  requires: ((badges: Set<number>, ids: Set<number>) => boolean)[];
  /** 典型徽章（生成先验） */
  typicalBadges: number[];
}

function hasBadge(badges: Set<number>, b: number): boolean {
  return badges.has(b);
}

export const AUX_RULES: Record<AuxKey, AuxRule> = {
  none: {
    desc: '无辅助体系',
    mandatoryMonsters: [],
    requires: [],
    typicalBadges: [],
  },
  dof: {
    desc: 'dof（负面效果赋予）：必须有凋零2（放大器，否则元素徽章无作用）+ 元素来源（元素涌动4/中毒25/献祭27 徽章，或肃清101/三振124/散弹104/小猴126）。输出怪（祭祀/金猴/突突/僧猴）带凋零收益最大。',
    mandatoryMonsters: [],
    requires: [
      (badges, ids) => hasBadge(badges, 2) // 凋零徽章必须有
        && (hasBadge(badges, 4) || hasBadge(badges, 25) || hasBadge(badges, 27)
            || ids.has(101) || ids.has(124) || ids.has(104) || ids.has(126)), // 元素来源
    ],
    typicalBadges: [2, 25, 4, 27],
  },
  gift: {
    desc: '礼物：银狙109（复活18或炸弹24+礼物33）死亡给最近友方30%攻击（90攻）。对象仅限三个：丛林122 / 金猴120 / 救星108。银狙不带33=单用（狙击20+破盾3），不算礼物。',
    mandatoryMonsters: [109],
    requires: [
      (badges, ids) => ids.has(109) && hasBadge(badges, 33) && (hasBadge(badges, 18) || hasBadge(badges, 24))
        && (ids.has(122) || ids.has(120) || ids.has(108)), // 礼物对象必须在卡组
    ],
    typicalBadges: [33, 18, 24],
  },
  shield: {
    desc: '盾流：预防11/反甲30/加固28 ≥2，塞雷118（预防加固反甲）配合帝国110+铁甲117，盾炮作核心威胁。',
    mandatoryMonsters: [],
    requires: [
      (badges) => [11, 28, 30].filter(b => hasBadge(badges, b)).length >= 2,
    ],
    typicalBadges: [11, 28, 30, 12],
  },
};

// ---------- 徽章模板（按怪兽，权威版，来源：用户提供的常用怪兽徽章库） ----------
// 徽章 ID：破盾3 凋零2 韧性23 鲁莽22 反击21 献祭27 协同29 厚皮8 结阵守12 丛林之影26 复活18
// 大厨17 狙击20 穿透1 礼物33 炸弹24 贤者16 反应装甲30 元素涌动4 回复光环6 巫毒32 助跑5
// 蓄能10 延伸9 加固28 预防11 吸血7 独狼攻15 结阵攻13 中毒25

/** monsterId → 徽章组合（4 费取前 3 个、2 费取前 2 个；每个内层数组 = 一种标准配法） */
export const BADGE_TEMPLATES: Record<number, number[][]> = {
  101: [[3, 2, 23], [3, 2, 22], [3, 2, 27], [3, 2, 29]],  // 肃清：破盾凋零韧性/鲁莽/献祭/协同
  102: [[3, 22, 21], [3, 22, 2], [3, 22, 8]],              // 祭祀：破盾鲁莽反击/凋零/厚皮
  103: [[8, 12], [8, 23], [8, 26], [8, 18]],                // 学徒：厚皮结阵守/韧性/丛林之影/复活
  105: [[8, 17]],                                           // 祈祷：厚皮大厨
  107: [[20, 1]],                                           // 咒法：狙击穿透
  108: [[3, 22, 21], [3, 22, 23], [3, 21, 23], [11, 28, 30]], // 救星：破盾鲁莽反击/韧性/反击韧性、预防加固反甲(盾流)
  109: [[20, 3], [20, 18], [33, 24], [33, 18]],             // 银狙：狙击破盾/复活、礼物炸弹/复活
  110: [[8, 23], [23, 16], [23, 30]],                       // 帝国：厚皮韧性/韧性贤者/韧性反甲
  111: [[23, 3], [4, 23]],                                  // 见习：韧性破盾/元素涌动韧性
  112: [[8, 6]],                                            // 大剑(守卫者之剑)：厚皮回环
  113: [[20, 3]],                                           // 矿爆：狙击破盾
  114: [[32, 3], [1, 3], [20, 3], [20, 1]],                 // 突突：巫毒/穿透/狙击破盾、狙击穿透
  116: [[5, 3], [32, 24]],                                  // 钻头：助跑破盾/巫毒炸弹
  115: [[32, 24, 18], [23, 6, 10]],                         // 铲土：巫毒炸弹复活/韧性回环蓄能
  117: [[3, 9], [32, 24], [8, 3], [3, 22], [8, 2]],         // 铁甲：破盾延伸/巫毒炸弹/厚皮破盾/破盾鲁莽/厚皮凋零
  118: [[11, 28, 30], [3, 22, 21]],                         // 塞雷：预防加固反甲/破盾鲁莽反击
  119: [[32, 24], [5, 3]],                                  // 忍猴：巫毒炸弹/助跑破盾
  120: [[3, 22, 21], [3, 22, 8], [2, 22, 21], [3, 22, 2]], // 金猴：破盾鲁莽反击/厚皮、凋零鲁莽反击、破盾鲁莽凋零
  122: [[8, 7], [8, 2], [8, 15]],                           // 丛林：厚皮吸血/凋零/独狼攻
  123: [[13, 3], [3, 10]],                                  // 棒球：结阵攻破盾/破盾蓄能
  124: [[10, 9], [25, 9], [3, 9]],                          // 三振王：蓄能/中毒/破盾 + 延伸
  125: [[2, 27], [8, 6]],                                   // 战壕：凋零献祭/厚皮回环
  // 灵活位（无固定徽章，见流派"元素来源"）：
  104: [[8, 4], [3, 4], [27, 35]],                          // 散弹：元素手（厚皮/破盾+元素涌动、献祭接力）
  106: [[32, 24], [27, 35]],                                // 冲锋：巫毒炸弹/献祭接力
  121: [[3, 2], [18, 2], [23, 3]],                          // 僧猴：破盾凋零/复活凋零/韧性破盾
};

// ---------- 核心函数 ----------

/** 徽章上限：4费 3 个、2费 2 个 */
export function badgeLimit(id: number): number {
  return costOf(id) >= 4 ? 3 : 2;
}

/**
 * 关键怪必配（交接文档 HANDOFF_RL.md 第七节，卡组生成必须遵守，漏了会被误判为弱）：
 *   - 祷徒：冲锋106(巫毒32+炸弹24) + 钻头116
 *   - 半冲：冲锋106 + 钻头116 + 突突114
 *   - 全冲：铁甲117 + 钻头116 + 冲锋106 + 突突114 + 咒法107，第 6 只按核心选：
 *     塞雷/全二 → 矿爆113；救星/金猴/铲土 → 忍猴119（对应第八节"按核心套模板"）
 */
export function keyMonstersFor(arch: ArchKey, core: CoreKey): number[] {
  if (arch === 'prayer') return [106, 116];
  if (arch === 'halfrush') return [106, 116, 114];
  const base = [117, 116, 106, 114, 107];
  const extra = (core === 'seri' || core === 'all2') ? 113 : 119;
  return [...base, extra];
}

/**
 * 卡组 → 参考阵型模板名（交接文档第八节 + deck_separation.ts 的 ARCH_REF_BY_ARCH）：
 *   祷徒→泉水剑、半冲→坚果救星；全冲按核心：塞雷→梯子塞雷、全二→全二冲、其余→经典救星。
 */
export function templateNameFor(arch: ArchKey, core: CoreKey): string {
  if (arch === 'prayer') return '泉水剑';
  if (arch === 'halfrush') return '坚果救星';
  if (core === 'seri') return '梯子塞雷';
  if (core === 'all2') return '全二冲';
  return '经典救星';
}

/** 检测架构：有学徒103 → 祷徒（体系论定义：祷徒 = 学徒祈祷；守卫112不改变半冲身份）；有祈祷105 → 半冲；否则全冲 */
export function detectArch(ids: Set<number>): ArchKey {
  if (ids.has(103)) return 'prayer';
  if (ids.has(105)) return 'halfrush';
  return 'fullrush';
}

/** 检测核心：卡组内唯一 4 费怪；无 4 费 → 全二；多个 → 'multi'（异常） */
export function detectCore(ids: Set<number>): CoreKey | 'multi' {
  const fours = [...ids].filter(id => costOf(id) >= 4);
  if (fours.length === 0) return 'all2';
  if (fours.length > 1) return 'multi';
  const id = fours[0];
  for (const [k, v] of Object.entries(CORE_TABLE) as [CoreKey, { monsterId: number | null }][]) {
    if (v.monsterId === id) return k;
  }
  return 'multi';
}

/** 检测辅助体系：dof / 盾流 / 礼物（按徽章+怪兽判据），多个并存时按优先级取一个 */
export function detectAux(badges: Set<number>, ids: Set<number>): AuxKey {
  if (AUX_RULES.dof.requires[0](badges, ids)) return 'dof';
  if (AUX_RULES.shield.requires[0](badges, ids)) return 'shield';
  if (AUX_RULES.gift.requires[0](badges, ids)) return 'gift';
  return 'none';
}

export interface Classification {
  arch: ArchKey;
  core: CoreKey | 'multi';
  aux: AuxKey;
}

/** 卡组 → (架构, 核心, 辅助) */
export function classifyDeck(team: DeckSlot[]): Classification {
  const ids = new Set(team.map(s => s.monsterId));
  const badges = new Set(team.flatMap(s => s.badgeIds));
  return { arch: detectArch(ids), core: detectCore(ids), aux: detectAux(badges, ids) };
}

/** 卡组合法性校验，返回错误列表（空 = 合法） */
export function validateDeck(team: DeckSlot[]): string[] {
  const errs: string[] = [];
  const ids = new Set(team.map(s => s.monsterId));
  const badges = new Set(team.flatMap(s => s.badgeIds));
  if (team.length > DECK_SLOTS) errs.push(`槽位 ${team.length} > ${DECK_SLOTS}`);
  const totalCost = team.reduce((s, x) => s + costOf(x.monsterId), 0);
  if (totalCost > DECK_BUDGET) errs.push(`总费用 ${totalCost} > ${DECK_BUDGET}`);
  if (team.length !== ids.size) errs.push('卡组内有重复怪兽');
  for (const s of team) {
    if (s.badgeIds.length > badgeLimit(s.monsterId)) {
      errs.push(`${s.monsterId} 徽章数 ${s.badgeIds.length} > 上限 ${badgeLimit(s.monsterId)}`);
    }
  }
  const c = classifyDeck(team);
  const rule = ARCH_RULES[c.arch];
  if (c.core === 'multi') errs.push('多个 4 费核心（当前本体仅支持单核心）');
  if (c.core !== 'multi' && c.core !== 'all2' && !CORE_ARCHS[c.core].includes(c.arch)) {
    errs.push(`核心 ${CORE_TABLE[c.core].name} 与架构 ${c.arch} 不兼容`);
  }
  for (const f of rule.forbidden) {
    if (ids.has(f)) errs.push(`架构 ${c.arch} 禁带 ${f}`);
  }
  for (const m of rule.mandatory) {
    if (!ids.has(m)) errs.push(`架构 ${c.arch} 必带 ${m}`);
  }
  // 辅助体系要求（检测出的体系必须满足）
  const aux = AUX_RULES[c.aux];
  for (const req of aux.requires) {
    if (!req(badges, ids)) errs.push(`辅助体系 ${c.aux} 徽章/怪兽要求未满足`);
  }
  for (const m of aux.mandatoryMonsters) {
    if (!ids.has(m)) errs.push(`辅助体系 ${c.aux} 必带 ${m}`);
  }
  return errs;
}

/** 枚举全部合法模板（M2 卡组搜索的生成骨架） */
export function enumerateTemplates(): Template[] {
  const out: Template[] = [];
  for (const arch of ARCH_KEYS) {
    const rule = ARCH_RULES[arch];
    for (const core of Object.keys(CORE_TABLE) as CoreKey[]) {
      if (core !== 'all2' && !CORE_ARCHS[core].includes(arch)) continue;
      for (const aux of AUX_KEYS) {
        // 礼物需要 4 费核心作目标（银狙+90 攻给核心）
        if (aux === 'gift' && core === 'all2') continue;
        const mandatory = new Set<number>([...rule.mandatory]);
        const coreId = CORE_TABLE[core].monsterId;
        if (coreId !== null) mandatory.add(coreId);
        for (const m of AUX_RULES[aux].mandatoryMonsters) mandatory.add(m);
        const mandatoryList = [...mandatory];
        const budgetLeft = DECK_BUDGET - mandatoryList.reduce((s, id) => s + costOf(id), 0);
        const slotsLeft = DECK_SLOTS - mandatoryList.length;
        if (budgetLeft < 0 || slotsLeft < 0) continue;
        out.push({
          arch, core, aux,
          mandatory: mandatoryList,
          forbidden: rule.forbidden,
          slotsLeft,
          budgetLeft,
          spawnCurve: rule.spawnCurve,
        });
      }
    }
  }
  return out;
}

/** 某模板的角色池（供生成用：架构偏好池，去重、去禁带、去必带、排除非本模板的 4 费核心） */
export function poolForTemplate(t: Template): number[] {
  const pool = new Set<number>();
  for (const list of Object.values(ARCH_RULES[t.arch].poolPref)) {
    for (const id of list) pool.add(id);
  }
  for (const f of t.forbidden) pool.delete(f);
  for (const m of t.mandatory) pool.delete(m);
  // 排除非本模板核心的 4 费怪（防双核心）
  const coreId = CORE_TABLE[t.core].monsterId;
  for (const id of [...pool]) {
    if (costOf(id) >= 4 && id !== coreId) pool.delete(id);
  }
  return [...pool];
}

/** 生成先验：给定怪兽返回徽章模板（4费取前3、2费取前2），未知怪返回空 */
export function badgeTemplateFor(id: number): number[] {
  const tpls = BADGE_TEMPLATES[id];
  if (!tpls || tpls.length === 0) return [];
  return tpls[0].slice(0, badgeLimit(id));
}
