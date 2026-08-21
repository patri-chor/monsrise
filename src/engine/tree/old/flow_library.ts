// ============================================================
// 模块库（统一）：开局 / 组合 / 流派 三类模块，单怪模块由 monster_taxonomy 提供。
//
// 设计（用户定案）：
//   - 每模块有余量：required 必带、optional 全备选（选 0~k 个）、combos 两怪/三怪组合。
//   - fitCores/fitArchs 适配约束「保留参数，但当前先不设任何限制」，学习后逐步加少量限制。
//   - 流派常与徽章直接相关：dof=要有凋零2（元素手可随便换）、炸弹=首先要有炸弹24。
//
// 模块类型：
//   opening 开局模块（R1 预算 4 的落子组合，来自用户开局库）
//   combo   小组合模块（盾炮/秒杀/偷后排/范围克制祷徒）
//   flow    流派模块（dof/盾流/礼物/永平/炸弹）
//   single  单怪模块（由 monster_taxonomy.MONSTER_EFFECTS 直接提供，无需在此登记）
// ============================================================

import { MONSTER_EFFECTS, type EffectTag } from './monster_taxonomy';

export type ModuleKind = 'opening' | 'combo' | 'flow';

export interface Module {
  id: string;
  kind: ModuleKind;
  desc: string;
  /** 必带怪兽（可为空） */
  required: number[];
  /** 备选池（有余量，组装时选 0~k 个，不必全选） */
  optional: number[];
  /** 两怪/三怪组合（每个内层数组 = 一个组合） */
  combos: number[][];
  /** 适配核心（保留参数，当前不限） */
  fitCores: string[];
  /** 适配架构（保留参数，当前不限） */
  fitArchs: string[];
  /** 徽章要求（组装/校验时判据；空 = 无要求） */
  badgeReq?: (badges: Set<number>, ids: Set<number>) => boolean;
  /** 徽章联动（加入该模块时，这些怪切换徽章，多个变体随机选一；如盾炮→帝国换盾徽章） */
  badgeSwitch?: Record<number, number[][]>;
}

// ---------- 工具 ----------

const has = (badges: Set<number>, b: number) => badges.has(b);
const hasAny = (ids: Set<number>, ...list: number[]) => list.some(id => ids.has(id));

// ---------- 开局模块（用户开局库） ----------

export const OPENING_MODULES: Module[] = [
  { id: '开帝国钻头', kind: 'opening', desc: '帝国+钻头', required: [110, 116], optional: [], combos: [], fitCores: [], fitArchs: [] },
  { id: '开帝国三振', kind: 'opening', desc: '帝国+三振王', required: [110, 124], optional: [], combos: [], fitCores: [], fitArchs: [] },
  { id: '开帝国祈祷', kind: 'opening', desc: '帝国+祈祷', required: [110, 105], optional: [], combos: [], fitCores: [], fitArchs: [] },
  { id: '开铁甲帝国', kind: 'opening', desc: '铁甲+帝国', required: [117, 110], optional: [], combos: [], fitCores: [], fitArchs: [] },
  { id: '开帝国忍猴', kind: 'opening', desc: '帝国+忍猴', required: [110, 119], optional: [], combos: [], fitCores: [], fitArchs: [] },
  { id: '开帝国散弹', kind: 'opening', desc: '帝国+散弹', required: [110, 104], optional: [], combos: [], fitCores: [], fitArchs: [] },
  { id: '开帝国大剑', kind: 'opening', desc: '帝国+大剑', required: [110, 112], optional: [], combos: [], fitCores: [], fitArchs: [] },
  { id: '开帝国棒球', kind: 'opening', desc: '帝国(韧性贤者)+棒球(破盾丛林之影)', required: [110, 123], optional: [], combos: [], fitCores: [], fitArchs: [] },
  { id: '开救星', kind: 'opening', desc: '救星(破盾鲁莽反击/带韧性)', required: [108], optional: [], combos: [], fitCores: [], fitArchs: [] },
  { id: '开肃清', kind: 'opening', desc: '肃清', required: [101], optional: [], combos: [], fitCores: [], fitArchs: [] },
  { id: '开铲土', kind: 'opening', desc: '铲土', required: [115], optional: [], combos: [], fitCores: [], fitArchs: [] },
];

// ---------- 组合模块（小组合） ----------

export const COMBO_MODULES: Module[] = [
  {
    id: '盾炮', kind: 'combo', desc: '铁甲+盾怪=盾炮（帝国/塞雷/救星），盾怪带盾徽章 1~3 个',
    required: [117], optional: [110, 118, 108], combos: [[117, 110], [117, 118], [117, 108]],
    fitCores: [], fitArchs: [],
    badgeSwitch: {
      110: [[23, 30], [11, 28], [28, 30]], // 帝国：韧性反甲 / 预防加固 / 加固反甲
      118: [[11, 28, 30]],                 // 塞雷：预防加固反甲
      108: [[11, 28, 30]],                 // 救星：预防加固反甲
    },
  },
  {
    id: '秒杀', kind: 'combo', desc: '咒法+突突/钻头=定点秒杀',
    required: [107], optional: [114, 116], combos: [[107, 114], [107, 116]],
    fitCores: [], fitArchs: [],
  },
  {
    id: '偷后排', kind: 'combo', desc: '钻头/忍猴偷后排',
    required: [], optional: [116, 119], combos: [[116], [119]],
    fitCores: [], fitArchs: [],
  },
  {
    id: '范围克制祷徒', kind: 'combo', desc: '矿爆+三振王范围克制祷徒（两个都是备选）',
    required: [], optional: [113, 124], combos: [[113, 124]],
    fitCores: [], fitArchs: [],
  },
];

// ---------- 流派模块 ----------

export const FLOW_MODULES: Module[] = [
  {
    id: 'dof', kind: 'flow',
    desc: '凋零徽章(必须) + 元素手(可随便换)。凋零对象=所有射手/铁甲/救星，可带两个凋零(射手+元素手)。',
    required: [],
    optional: [101, 104, 108, 109, 113, 114, 117, 120, 121, 122, 124], // 凋零载体(射手+铁甲+救星) + 元素手(肃清/三振/散弹)
    combos: [],
    fitCores: [], fitArchs: [],
    badgeReq: (badges, ids) => has(badges, 2)
      && (has(badges, 4) || has(badges, 25) || has(badges, 27) || hasAny(ids, 101, 124, 104)),
  },
  {
    id: '盾流', kind: 'flow',
    desc: '自身产盾怪（帝国/救星/塞雷）+ 反应装甲 + 铁甲盾炮',
    required: [], optional: [110, 108, 118, 117], combos: [[118, 110], [117, 110]],
    fitCores: [], fitArchs: [],
    badgeReq: (badges) => [11, 28, 30].filter(b => has(badges, b)).length >= 2,
  },
  {
    id: '礼物', kind: 'flow',
    desc: '银狙(礼物33+复活18/炸弹24) → 增伤给高攻速/大范围怪（对象 6 个）',
    required: [109], optional: [108, 120, 102, 122, 114, 124],
    combos: [[109, 108], [109, 120], [109, 102], [109, 122], [109, 114], [109, 124]],
    fitCores: [], fitArchs: [],
    badgeReq: (badges, ids) => has(badges, 33) && ids.has(109) && (has(badges, 18) || has(badges, 24))
      && hasAny(ids, 108, 120, 102, 122, 114, 124),
    badgeSwitch: { 109: [[33, 24], [33, 18]] },  // 银狙切礼物炸弹/复活
  },
  {
    id: '永平', kind: 'flow',
    desc: '生存流：全带生存怪即永平，输出怪越多越远离永平',
    required: [], optional: [110, 105, 103, 112, 115, 125, 108, 118],
    combos: [],
    fitCores: [], fitArchs: [],
    badgeReq: (badges) => hasAny(badges, 8, 23, 18, 6), // 生存徽章：厚皮/韧性/复活/回复光环
    badgeSwitch: {
      110: [[8, 23]], 105: [[8, 17]], 103: [[8, 12], [8, 23], [8, 26], [8, 18]],
      112: [[8, 6]], 125: [[8, 6], [2, 27]], 115: [[23, 6, 10]],
    },
  },
  {
    id: '炸弹', kind: 'flow',
    desc: '铲土/肃清(巫毒32+炸弹24+复活18) 用铁甲投掷，首先要炸弹',
    required: [117], optional: [115, 101], combos: [[117, 115], [117, 101]],
    fitCores: [], fitArchs: [],
    badgeReq: (badges, ids) => has(badges, 24) && hasAny(ids, 115, 101),
    badgeSwitch: { 115: [[32, 24, 18]], 101: [[32, 24, 18]] },  // 载体切巫毒炸弹复活
  },
];

// ---------- 汇总与查询 ----------

export const ALL_MODULES: Module[] = [...OPENING_MODULES, ...COMBO_MODULES, ...FLOW_MODULES];

/** 按流派/组合 id 查模块 */
export function moduleById(id: string): Module | undefined {
  return ALL_MODULES.find(m => m.id === id);
}

/** 单怪模块（从作用标签生成，统一结构） */
export function singleModule(id: number): Module {
  const effects: EffectTag[] = MONSTER_EFFECTS[id] ?? [];
  return {
    id: `单${id}`, kind: 'combo', desc: `单怪 ${id}（${effects.join('/')}）`,
    required: [id], optional: [], combos: [], fitCores: [], fitArchs: [],
  };
}
