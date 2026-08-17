// ============================================================
// 怪兽作用标签（用户定案 v3）：基础 role 从 Database 读，这里加「作用标签」+「特殊机制」。
//
// 通用作用标签（4 个，服务展开选择 + 树优化器）：
//   生存=扛伤/回血/护盾   输出=持续伤害   爆发=开局短期高伤
//   战术=位移/冲锋/瞬移/投掷/走位（即 Database 的"特殊"）
//
// 特殊机制（2 个，单独系统，不混入通用标签）：
//   减益（三振王124，唯一）、反减益（战壕125，唯一）
//
// 无需标签：4 费核心（作为"核心"维度独立选择）+ 架构必带（学徒103/祈祷105 随架构带）。
//
// 关键约束：每个卡组必须带一点「战术」（冲锋106/钻头116/铁甲117/忍猴119 之一，
// 通常巫毒冲锋）。后期是巫毒博弈——用巫毒控制与反巫毒控制。
// ============================================================

import { DB_MONSTERS } from '../../game/Database';

export type EffectTag = '生存' | '输出' | '爆发' | '战术';
export type SpecialMechanism = '减益' | '反减益';

/** monsterId → 通用作用标签（空数组 = 无需标签：核心/架构必带/纯特殊机制） */
export const MONSTER_EFFECTS: Record<number, EffectTag[]> = {
  // —— 4 费核心（无需标签，核心维度独立） ——
  101: [],   // 肃清
  102: [],   // 祭祀
  108: [],   // 救星
  115: [],   // 铲土
  118: [],   // 塞雷
  120: [],   // 金猴
  // —— 架构必带（无需标签） ——
  103: [],   // 学徒
  105: [],   // 祈祷
  // —— 通用怪（作用标签） ——
  104: ['输出'],                // 散弹
  106: ['战术', '生存'],        // 冲锋：巫毒冲锋 + 承伤
  107: ['爆发'],                // 咒法：开局大炮
  109: ['输出', '爆发'],        // 银狙：狙击爆发
  110: ['生存'],                // 帝国：护盾
  111: ['生存', '输出'],        // 见习：旋风 + 生存
  112: ['生存'],                // 大剑(守卫)：治疗剑
  113: ['输出'],                // 矿爆：溅射
  114: ['输出', '爆发'],        // 突突：扫射 + 持续输出
  116: ['战术', '生存'],        // 钻头：钻地 + 护盾
  117: ['战术', '生存'],        // 铁甲：投掷 + 护盾
  119: ['战术', '输出'],        // 忍猴：瞬移刺客
  121: ['输出'],                // 僧猴：自残加攻
  122: ['输出'],                // 丛林：攻速
  123: ['输出'],                // 棒球：召唤
  // —— 特殊机制（单独系统） ——
  124: [],   // 三振王：减益（范围减速，几乎无输出），无通用作用标签
  125: ['生存', '输出'],  // 战壕：转化负面为血/攻（作用标签=生存+输出），另带「反减益」特殊机制
};

/** 特殊机制标注（单独系统） */
export const SPECIAL_MECHANISM: Record<number, SpecialMechanism[]> = {
  124: ['减益'],
  125: ['反减益'],
};

/** 战术怪（每卡组必带其一，通常巫毒冲锋106）。用户定案：只有冲锋/钻头/铁甲/忍猴四个特殊怪。 */
export const TACTIC_IDS: number[] = [106, 116, 117, 119];

/** 读 Database 的基础 role（坦克/战士/射手/法师/特殊） */
export function baseRole(id: number): string {
  return DB_MONSTERS.find(m => m.id === id)?.role ?? '战士';
}

export function effectsOf(id: number): EffectTag[] {
  return MONSTER_EFFECTS[id] ?? [];
}

export function hasEffect(id: number, tag: EffectTag): boolean {
  return effectsOf(id).includes(tag);
}

export function mechanismsOf(id: number): SpecialMechanism[] {
  return SPECIAL_MECHANISM[id] ?? [];
}

/** 按作用标签筛选怪兽池 */
export function filterByEffect(ids: number[], tag: EffectTag): number[] {
  return ids.filter(id => hasEffect(id, tag));
}

/** 输出位 = 带「输出」或「爆发」标签的怪（排除纯生存/纯战术） */
export function outputPool(ids: number[]): number[] {
  return ids.filter(id => hasEffect(id, '输出') || hasEffect(id, '爆发'));
}

/** 生存位 = 带「生存」标签的怪（永平流用） */
export function survivalPool(ids: number[]): number[] {
  return ids.filter(id => hasEffect(id, '生存'));
}

/** 校验卡组是否带战术（每卡组必带约束） */
export function hasTactic(ids: number[]): boolean {
  return ids.some(id => TACTIC_IDS.includes(id));
}
