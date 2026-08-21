// ============================================================
// 进化基因 —— 树级阵型表示（区别于人工编辑用的 Formation.tree）
//
// 设计原则（用户确认）：
//   - 基因 = 固定卡组 + 放置树 + 特殊放置器（固定保留）
//   - 分支触发条件 = 三层识别标签 FeatureMask（识别系统学习化）
//   - 特殊怪兽索敌（矿爆锁祈祷行/铁甲贴队友/咒法安全位…）是已验证算法，
//     执行时复用 bundle 内部 special/aim calculator，不纳入基因
//
// FeatureMask = 三层识别标签（用户定案，见 docs/tree_strategy/README.md）：
//   1. 主标签（互斥，短路）：祷徒 prayer > 半冲 halfrush > 全冲 fullrush
//      - 祷徒   = 有学徒103，或 有祈祷105+守卫112
//      - 半冲   = 有祈祷105 且 无学徒103
//      - 全冲   = 突突114/矿爆113/咒法107 中 ≥2 个
//   2. 附加标签（不互斥，可叠加，含主标签最多 3 个）：
//      - dof   = (凋零2 或 元素涌动4) 或 (中毒25+三振王124) 或 肃清哥101
//      - 盾流  = 预防11/反甲30/加固28 中 ≥2 个
//      - 礼物  = 礼物33 徽章
//   3. 关键怪（第二层，预留；本轮判据 = 手牌/场上出现该怪）：
//      - 钻头116 / 冲锋106 / 铁甲117 / 忍猴119 / 突突114 / 咒法107 / 矿爆113
//
// 匹配语义：分支 FeatureMask 命中 ⟺
//   (main 为空 或 main == 识别主标签) 且 subs ⊆ 识别附加标签 且 keys ⊆ 识别关键怪。
// 分支按特异性（main 非空 + subs 数 + keys 数）降序，第一个命中的优先；主分支兜底。
// ============================================================

import type { Formation, FormationTeamSlot } from '../ai/types';

// ---------- 三层识别标签 ----------

/** 主标签（互斥，短路判定） */
export type MainArchetype = 'prayer' | 'halfrush' | 'fullrush';

/** 附加标签（可叠加） */
export type SubArchetype = 'dof' | 'shield' | 'gift';

/** 关键怪（第二层，预留） */
export type KeyMonster = 'drill' | 'rush' | 'iron' | 'ninja' | 'tutu' | 'spell' | 'mine';

export interface FeatureMask {
  /** 先后手约束：1=p1侧(先手) / 2=p2侧(后手) / null=不限（用户洞察：左右主场不对称） */
  side: 1 | 2 | null;
  /** 主标签约束；null = 不限制主标签 */
  main: MainArchetype | null;
  /** 附加标签约束（需全部命中） */
  subs: SubArchetype[];
  /** 关键怪约束（需全部在场） */
  keys: KeyMonster[];
}

export function emptyMask(): FeatureMask {
  return { side: null, main: null, subs: [], keys: [] };
}

export function isEmptyMask(m: FeatureMask): boolean {
  return m.side === null && m.main === null && m.subs.length === 0 && m.keys.length === 0;
}

// ---------- 识别输入与结果 ----------

export interface ArchetypeInput {
  /** 对手手牌（前 4 张）怪兽 ID */
  handIds: Set<number>;
  /** 对手手牌徽章 ID */
  handBadges: Set<number>;
  /** 对手场上已部署怪 ID */
  boardIds: Set<number>;
}

export interface RecognizedArchetype {
  main: MainArchetype | null;
  subs: SubArchetype[];
  keys: KeyMonster[];
}

// 关键怪 ID 映射（第二层）
const KEY_MONSTER_IDS: Record<KeyMonster, number> = {
  drill: 116,  // 钻头
  rush: 106,   // 冲锋
  iron: 117,   // 铁甲猴
  ninja: 119,  // 忍小猴
  tutu: 114,   // 突突突矿工
  spell: 107,  // 咒法骑士
  mine: 113,   // 爆破大师（矿爆）
};

/**
 * 识别对手的三层标签。
 * 输入范围：对手前 4 张手牌（含徽章）+ 场上已部署怪。
 */
export function recognizeArchetype(inp: ArchetypeInput): RecognizedArchetype {
  const has = (id: number) => inp.handIds.has(id) || inp.boardIds.has(id);
  const badge = (id: number) => inp.handBadges.has(id);

  // === 主标签（互斥，短路：祷徒 > 半冲 > 全冲）===
  let main: MainArchetype | null = null;
  const hasPrayer = has(105);      // 祈祷
  const hasApprentice = has(103);  // 学徒
  const hasGuard = has(112);       // 守卫
  if (hasApprentice || (hasPrayer && hasGuard)) {
    main = 'prayer'; // 一旦有学徒，不管其他 → 祷徒
  } else if (hasPrayer) {
    main = 'halfrush';
  } else {
    // 突突114/矿爆113/咒法107 中 ≥2 个 → 全冲
    const rushCount = [114, 113, 107].filter(has).length;
    if (rushCount >= 2) main = 'fullrush';
  }

  // === 附加标签（可叠加）===
  const subs: SubArchetype[] = [];
  // dof = 凋零2 或 (中毒25+三振王124) 或 肃清哥101（元素涌动4 已按用户要求移除，误报太多）
  if (badge(2) || (badge(25) && has(124)) || has(101)) subs.push('dof');
  // 盾流 = 预防11/反甲30/加固28 中 ≥2
  const shieldCount = [11, 30, 28].filter(badge).length;
  if (shieldCount >= 2) subs.push('shield');
  // 礼物 = 礼物33
  if (badge(33)) subs.push('gift');

  // === 关键怪（第二层，本轮 = 手牌/场上出现该怪）===
  const keys: KeyMonster[] = [];
  for (const k of Object.keys(KEY_MONSTER_IDS) as KeyMonster[]) {
    if (has(KEY_MONSTER_IDS[k])) keys.push(k);
  }

  return { main, subs, keys };
}

/** 分支 FeatureMask 是否命中识别结果（mySide = 候选先后手 1/2） */
export function matchMask(mask: FeatureMask, rec: RecognizedArchetype, mySide: 1 | 2): boolean {
  if (mask.side !== null && mask.side !== mySide) return false;
  if (mask.main !== null && mask.main !== rec.main) return false;
  if (!mask.subs.every(s => rec.subs.includes(s))) return false;
  if (!mask.keys.every(k => rec.keys.includes(k))) return false;
  return true;
}

/** 分支特异性（side 非空 + main 非空 + subs 数 + keys 数），用于分支优先级排序 */
export function maskSpecificity(m: FeatureMask): number {
  return (m.side !== null ? 10000 : 0) + (m.main !== null ? 1000 : 0) + m.subs.length * 10 + m.keys.length;
}

// ---------- 进化树节点 ----------

export interface EvolPlacement {
  monsterId: number;
  x: number;  // p2 视角 6-10
  y: number;  // 0-4
}

export interface EvolNode {
  id: string;
  round: number;            // 0=根, 1-5=局数
  condition: FeatureMask;   // 作为分支时的触发标签（根恒空）
  placements: EvolPlacement[]; // 本节点落子（有序 = 放置优先级）
  children: EvolNode[];
}

import type { CalculatorContextPolicy } from './calculator_policy';
import { canonicalizeCalculatorPolicy } from './calculator_policy';

export interface EvolFormation {
  name: string;
  archetype: string;
  team: FormationTeamSlot[];   // 固定卡组（含徽章）
  root: EvolNode;
  calculatorPolicy?: CalculatorContextPolicy | null;
}

// ---------- 转换 ----------

export function cloneMask(m: FeatureMask): FeatureMask {
  return { side: m.side, main: m.main, subs: [...m.subs], keys: [...m.keys] };
}

/** 深拷贝进化树节点 */
export function cloneEvolNode(n: EvolNode): EvolNode {
  return {
    id: n.id,
    round: n.round,
    condition: cloneMask(n.condition),
    placements: n.placements.map(p => ({ monsterId: p.monsterId, x: p.x, y: p.y })),
    children: n.children.map(c => cloneEvolNode(c)),
  };
}

export function cloneEvolFormation(f: EvolFormation): EvolFormation {
  return {
    name: f.name,
    archetype: f.archetype,
    team: f.team.map(s => ({ monsterId: s.monsterId, badgeIds: [...s.badgeIds] })),
    root: cloneEvolNode(f.root),
    calculatorPolicy: f.calculatorPolicy ? canonicalizeCalculatorPolicy(f.calculatorPolicy) : null,
  };
}

/** 前序遍历所有节点（含根） */
export function walkEvolNodes(n: EvolNode, out: EvolNode[] = []): EvolNode[] {
  out.push(n);
  for (const c of n.children) walkEvolNodes(c, out);
  return out;
}

/** 节点 id → FeatureMask 映射（供 patch selectBranch 时按 bundle node.id 查标签） */
export function buildConditionMap(root: EvolNode): Map<string, FeatureMask> {
  const map = new Map<string, FeatureMask>();
  for (const n of walkEvolNodes(root)) {
    map.set(n.id, n.condition);
  }
  return map;
}

const MAIN_LABEL: Record<MainArchetype, string> = {
  prayer: '祷徒', halfrush: '半冲', fullrush: '全冲',
};
const SUB_LABEL: Record<SubArchetype, string> = {
  dof: 'dof', shield: '盾流', gift: '礼物',
};
const KEY_LABEL: Record<KeyMonster, string> = {
  drill: '钻头', rush: '冲锋', iron: '铁甲', ninja: '忍猴', tutu: '突突', spell: '咒法', mine: '矿爆',
};

/** 特征掩码 → 可读标签（调试/日志用）。必须用中文关键词，因为 bundle 内部
 *  getRoundPlan 有 isPrayerBranch = label.includes('祷徒') 的判断（祷徒分支跳过变体），
 *  selectVariant 也有 label 相关分支；用英文 tag 名会破坏这些内部逻辑 → 行为漂移。 */
export function maskToLabel(m: FeatureMask): string {
  if (isEmptyMask(m)) return '主分支';
  const parts: string[] = [];
  if (m.side !== null) parts.push(m.side === 1 ? '先手' : '后手');
  if (m.main) parts.push(MAIN_LABEL[m.main]);
  for (const s of m.subs) parts.push(SUB_LABEL[s]);
  for (const k of m.keys) parts.push(KEY_LABEL[k]);
  return parts.join('/');
}

/** 进化树节点 → bundle 可注入的 tree 节点（loadCustomFormation 格式） */
export function evolNodeToBundleTree(n: EvolNode, team: FormationTeamSlot[]): any {
  const badgeOf = (monsterId: number) => team.find(s => s.monsterId === monsterId)?.badgeIds ?? [];
  return {
    id: n.id,
    round: n.round,
    label: maskToLabel(n.condition),
    comment: '',
    placement: n.placements.map(p => ({
      monsterId: p.monsterId,
      badgeIds: badgeOf(p.monsterId),
      x: p.x,
      y: p.y,
    })),
    children: n.children.map(c => evolNodeToBundleTree(c, team)),
  };
}

/** EvolFormation → bundle loadCustomFormation 注入格式 */
export function evolToBundleFormation(e: EvolFormation): {
  name: string;
  archetype: string;
  team: FormationTeamSlot[];
  tree: any;
} {
  return {
    name: e.name,
    archetype: e.archetype,
    team: e.team.map(s => ({ monsterId: s.monsterId, badgeIds: [...s.badgeIds] })),
    tree: evolNodeToBundleTree(e.root, e.team),
  };
}

// ---------- 从 FORMATION_LIBRARY 转初始基因（label → 三层标签翻译） ----------

/**
 * 把人工编辑的 label 翻译成三层识别标签。
 * 迁移映射（现有 bundle label 关键词）：
 *   祷徒/祈祷 → main=prayer；全冲 → main=fullrush；
 *   三振/dof → subs=[dof]；钻头 → keys=[drill]。
 * 注意「全冲」≠「冲锋」：/冲锋/ 不匹配"全冲"，/全冲/ 不匹配"冲锋"。
 */
export function labelToMask(label: string): FeatureMask {
  const m = emptyMask();
  if (!label) return m;
  if (/祷徒|祈祷/.test(label)) m.main = 'prayer';
  if (/全冲/.test(label)) m.main = 'fullrush';
  if (/三振|dof/.test(label)) m.subs.push('dof');
  if (/钻头/.test(label)) m.keys.push('drill');
  if (/冲锋/.test(label)) m.keys.push('rush');
  return m;
}

/** 从 FormationLibrary 的 Formation 提取进化基因（含 tree 转 EvolNode） */
function bundleNodeToEvol(n: any): EvolNode {
  return {
    id: n.id,
    round: n.round,
    condition: labelToMask(n.label ?? ''),
    placements: (n.placement ?? []).map((p: any) => ({ monsterId: p.monsterId, x: p.x, y: p.y })),
    children: (n.children ?? []).map((c: any) => bundleNodeToEvol(c)),
  };
}

export function formationToEvol(f: Formation): EvolFormation {
  const teamSlots: FormationTeamSlot[] = (f.team ?? []).map((s: any) =>
    typeof s === 'number'
      ? { monsterId: s, badgeIds: [] }
      : { monsterId: s.monsterId, badgeIds: s.badgeIds ? [...s.badgeIds] : [] },
  ).filter(s => s.monsterId > 0);

  return {
    name: f.name,
    archetype: f.archetype,
    team: teamSlots,
    root: bundleNodeToEvol(f.tree),
  };
}

// ---------- 诊断 ----------

/** 打印进化阵型摘要（含分支标签），人工检查用 */
export function summarizeEvolFormation(e: EvolFormation): string {
  const lines: string[] = [`阵型 ${e.name} (archetype=${e.archetype}) 卡组[${e.team.map(s => s.monsterId).join(',')}]`];
  for (const n of walkEvolNodes(e.root)) {
    if (n.round === 0) continue;
    const ps = n.placements.map(p => `${p.monsterId}@(${p.x},${p.y})`).join(', ');
    const cond = isEmptyMask(n.condition) ? '' : ` [标签: ${maskToLabel(n.condition)}]`;
    lines.push(`  R${n.round} ${ps}${cond}`);
  }
  return lines.join('\n');
}
