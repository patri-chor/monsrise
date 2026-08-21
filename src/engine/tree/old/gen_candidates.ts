// ============================================================
// 候选卡组生成器（M2 起点）：65 模板代表 + 冷门怪补覆盖
//
// 两批次：
//   A. 主批次：65 个模板各 1 个代表（真实骨架优先，用户已认可）
//   B. 补覆盖批次：对使用率不足的怪（见习111/僧猴121/棒球123/战壕125 零使用，
//      银狙109/丛林122 偏低），从可用模板中强制该怪生成候选
// 徽章：辅助体系感知（dof 必带凋零2、盾流用盾徽、礼物银狙带33；单用银狙=狙击破盾）
// 去重：按完整卡组（怪兽集合+徽章）去重
//
// 运行：npx vite-node --script src/engine/tree/gen_candidates.ts
// 产出：reports/deck_candidates.json + 覆盖统计
// ============================================================

import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { FORMATION_LIBRARY } from '../../ai/formation_library';
import {
  enumerateTemplates, poolForTemplate, validateDeck, badgeLimit,
  BADGE_TEMPLATES, costOf, keyMonstersFor, templateNameFor,
  type DeckSlot, type AuxKey, type Template,
} from './deck_ontology';

// ---------- 徽章选择（辅助体系感知） ----------

function pickBadges(monsterId: number, aux: AuxKey, prefer: number): number[] {
  const tpls = BADGE_TEMPLATES[monsterId];
  if (!tpls || tpls.length === 0) return [];
  const limit = badgeLimit(monsterId);
  if (aux === 'shield') {
    const shield = tpls.find(t => t.includes(11) || t.includes(28) || t.includes(30));
    if (shield) return shield.slice(0, limit);
  }
  if (aux === 'gift' && monsterId === 109) {
    const gift = tpls.find(t => t.includes(33));
    if (gift) return gift.slice(0, limit);
  }
  if (aux === 'dof') {
    // 凋零2 优先（放大器，用户定案：dof 必须有凋零，否则元素徽章无作用）
    const wither = tpls.find(t => t.includes(2));
    if (wither) return wither.slice(0, limit);
    // 其次元素来源（25 中毒 / 4 元素涌动）
    const elem = tpls.find(t => t.some(b => b === 25 || b === 4));
    if (elem) return elem.slice(0, limit);
  }
  const t = tpls[Math.min(prefer, tpls.length - 1)];
  return t.slice(0, limit);
}

function mandatoryBadges(id: number, aux: AuxKey): number[] {
  if (id === 105) return [8, 17];           // 祈祷：厚皮大厨
  if (id === 103) return [8, 12];           // 学徒：结阵守（贴祈祷，防咒法）
  if (id === 109) return [24, 33];          // 银狙（礼物）：炸弹礼物
  return pickBadges(id, aux, 0);
}

// ---------- 填充偏好（按架构角色池顺序 + 110 优先） ----------

const FILL_PREF: Record<string, number[]> = {
  prayer: [110, 112, 124, 104, 114, 109, 113, 121, 122, 106, 116, 119],
  halfrush: [110, 112, 124, 114, 104, 113, 109, 121, 122, 123, 111, 125, 106, 116, 119],
  fullrush: [110, 117, 116, 106, 107, 113, 114, 119, 104, 109, 124, 122],
};

function fillDeck(t: Template, forceExtra: number[] = []): { team: DeckSlot[]; unfillable: string | null } {
  const team: DeckSlot[] = t.mandatory.map(id => ({ monsterId: id, badgeIds: mandatoryBadges(id, t.aux) }));
  let budget = t.budgetLeft;
  let slots = t.slotsLeft;
  const used = new Set(t.mandatory);

  // 关键怪强制填充（最高优先级，交接文档第七节：漏了会被误判为弱）
  const forceFills: number[] = [];
  for (const km of keyMonstersFor(t.arch, t.core)) {
    if (!used.has(km)) forceFills.push(km);
  }
  // 辅助强制填充（次优先级）
  if (t.aux === 'dof' && !t.mandatory.includes(124) && !used.has(124)) forceFills.push(124); // dof：三振(中毒25+凋零2)
  if (t.aux === 'shield' && !used.has(110)) forceFills.push(110); // 盾流：帝国盾徽
  if (t.aux === 'gift' && !used.has(122) && !used.has(120) && !used.has(108)) forceFills.push(122); // 礼物：对象丛林
  for (const f of forceExtra) if (!used.has(f)) forceFills.push(f); // 补覆盖：强制目标怪

  const pool = poolForTemplate(t);
  const order = [...forceFills, ...FILL_PREF[t.arch].filter(id => pool.includes(id) && !forceFills.includes(id))];
  for (const id of pool) {
    if (!order.includes(id)) order.push(id);
  }

  for (const id of order) {
    if (slots <= 0 || budget <= 0) break;
    if (used.has(id)) continue;
    const cost = costOf(id);
    if (cost > budget) continue;
    team.push({ monsterId: id, badgeIds: pickBadges(id, t.aux, 0) });
    used.add(id);
    budget -= cost;
    slots--;
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    const errs = validateDeck(team);
    if (errs.length === 0) {
      // 关键怪校验：缺关键怪 = 不合格卡组（交接文档第七节硬约束）
      const ids = new Set(team.map(s => s.monsterId));
      const missingKey = keyMonstersFor(t.arch, t.core).filter(id => !ids.has(id));
      if (missingKey.length > 0) {
        return { team, unfillable: `缺关键怪 ${missingKey.join(',')}` };
      }
      return { team, unfillable: null };
    }
    if (attempt < 2) {
      for (const s of team) {
        if (BADGE_TEMPLATES[s.monsterId] && BADGE_TEMPLATES[s.monsterId].length > 1) {
          s.badgeIds = pickBadges(s.monsterId, t.aux, attempt + 1);
        }
      }
      continue;
    }
    return { team, unfillable: errs.join('; ') };
  }
  return { team, unfillable: 'unknown' };
}

interface Candidate {
  template: string;
  arch: string;
  core: string;
  aux: string;
  templateName: string;
  team: DeckSlot[];
  totalCost: number;
  unfillable: string | null;
  matchesExisting: string | null;
  coverageFill: string | null;
}

const NAME: Record<number, string> = {
  101: '肃清', 102: '祭祀', 103: '学徒', 104: '散弹', 105: '祈祷', 106: '冲锋', 107: '咒法',
  108: '救星', 109: '银狙', 110: '帝国', 111: '见习', 112: '守卫', 113: '矿爆', 114: '突突',
  115: '铲土', 116: '钻头', 117: '铁甲', 118: '塞雷', 119: '忍猴', 120: '金猴', 121: '僧猴',
  122: '丛林', 123: '棒球', 124: '三振', 125: '战壕',
};

const CORE_SHORT: Record<string, string> = {
  savior: '救星', priest: '祭祀', suqing: '肃清', seri: '塞雷', golden: '金猴', digger: '铲土', all2: '全二',
};
const ARCH_SHORT: Record<string, string> = { prayer: '祷徒', halfrush: '半冲', fullrush: '全冲' };
const AUX_SHORT: Record<string, string> = { none: '', dof: '+dof', gift: '+礼物', shield: '+盾流' };

function main(): void {
  const templates = enumerateTemplates();
  const out: Candidate[] = [];

  // ---- 批次 A：65 模板代表 ----
  for (const t of templates) {
    const { team, unfillable: uf } = fillDeck(t);
    out.push(mkCandidate(t, team, uf, null));
  }

  // ---- 覆盖统计 ----
  const coverage: Record<number, number> = {};
  for (const c of out) for (const s of c.team) coverage[s.monsterId] = (coverage[s.monsterId] ?? 0) + 1;

  // ---- 批次 B：补覆盖（零使用 + 低使用） ----
  const mustAdd = Object.keys(NAME).map(Number).filter(id => !coverage[id]);       // 0 次
  // 低次且值得补强：银狙109/丛林122 单用价值高（用户点名"用得少"），见习/僧猴/棒球/战壕 零次
  const boost = [109, 122, 111, 121, 123, 125].filter(id => !mustAdd.includes(id));
  const targets = [...mustAdd, ...boost];
  for (const target of targets) {
    // 可用模板：该怪在池内；每怪最多 3 个（架构多样）
    const usable = templates.filter(t => poolForTemplate(t).includes(target));
    const picked: Template[] = [];
    for (const t of usable) {
      if (picked.length >= 3) break;
      if (!picked.some(p => p.arch === t.arch)) picked.push(t); // 每架构取 1
    }
    for (const t of picked) {
      const { team, unfillable: uf } = fillDeck(t, [target]);
      out.push(mkCandidate(t, team, uf, NAME[target]));
    }
  }

  // ---- 去重：按完整卡组（怪兽集合 + 徽章） ----
  const key = (c: Candidate) => c.team.map(s => `${s.monsterId}[${[...s.badgeIds].sort().join(',')}]`).sort().join('|');
  const seen = new Set<string>();
  const deduped: Candidate[] = [];
  for (const c of out) {
    const k = key(c);
    if (seen.has(k)) continue;
    seen.add(k);
    deduped.push(c);
  }

  // ---- 输出 ----
  const unfillable = deduped.filter(c => c.unfillable).length;
  console.log(`=== 候选卡组（批次A 65 代表 + 批次B 补覆盖 ${out.length - 65}，按完整卡组去重后 ${deduped.length}） ===\n`);
  let aCount = 0, bCount = 0;
  for (const c of deduped) {
    if (c.unfillable) {
      console.log(`✗ ${c.template}${c.coverageFill ? `(+${c.coverageFill})` : ''}: 无法填充（${c.unfillable}）`);
      continue;
    }
    const deckStr = c.team.map(s => NAME[s.monsterId]).join(' ');
    const tag = c.coverageFill ? `  ←补覆盖:${c.coverageFill}` : '';
    if (c.coverageFill) bCount++; else aCount++;
    console.log(`  ${c.template}${tag}: ${deckStr}`);
  }

  // ---- 覆盖统计 ----
  const cov2: Record<number, number> = {};
  for (const c of deduped) for (const s of c.team) cov2[s.monsterId] = (cov2[s.monsterId] ?? 0) + 1;
  const zero = Object.keys(NAME).map(Number).filter(id => !cov2[id]);
  const sorted = Object.entries(cov2).sort((a, b) => a[1] - b[1]);
  console.log(`\n=== 覆盖统计（去重后） ===`);
  for (const [id, n] of sorted) console.log(`  ${NAME[Number(id)]}: ${n}`);
  console.log(`  未使用: ${zero.length ? zero.map(id => NAME[id]).join(', ') : '无'} ✅`);

  mkdirSync(dirname(resolve('reports/deck_candidates_v2.json')), { recursive: true });
  // 可读版（全量，含 unfillable 标记）
  writeFileSync(resolve('reports/deck_candidates.json'), JSON.stringify({ candidates: deduped }, null, 2));
  // 机器版（供 deck_separation.ts 消费：只含可填充卡组 + templateName 字段）
  const fillable = deduped.filter(c => !c.unfillable).map(c => ({
    template: c.template, arch: c.arch, core: c.core, aux: c.aux,
    templateName: c.templateName, team: c.team,
  }));
  writeFileSync(resolve('reports/deck_candidates_v2.json'), JSON.stringify({ candidates: fillable }, null, 2));
  console.log(`\n完成：去重后 ${deduped.length} 套（A=${aCount} B=${bCount}），可填充 ${fillable.length}，无法填充 ${unfillable}`);
  console.log('保存 → reports/deck_candidates_v2.json（供 deck_separation.ts）');
}

function mkCandidate(t: Template, team: DeckSlot[], unfillable: string | null, coverageFill: string | null): Candidate {
  const ids = new Set(team.map(s => s.monsterId));
  const match = FORMATION_LIBRARY.find(e => e.team.filter(s => s.monsterId > 0).length === ids.size
    && [...ids].every(id => e.team.some(s => s.monsterId === id)));
  return {
    template: `${ARCH_SHORT[t.arch]}+${CORE_SHORT[t.core]}${AUX_SHORT[t.aux]}`,
    arch: t.arch, core: t.core, aux: t.aux,
    templateName: templateNameFor(t.arch, t.core),
    team, totalCost: team.reduce((s, x) => s + costOf(x.monsterId), 0),
    unfillable, matchesExisting: match ? match.name : null, coverageFill,
  };
}

main();
