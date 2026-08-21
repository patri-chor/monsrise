// ============================================================
// 变体生成器 v2：从种子阵型生成同流派/相近性能的变体。
//
// v2 改进（用户定案）：
//   1. 换怪候选池 = 结构化池（架构骨架 ∪ 核心 ∪ 战术 ∪ 组合件 ∪ 输出位 ∪ 生存位），
//      而非全 25 怪任意换 —— 与组装器共用同一套候选定义，保持同流派结构。
//   2. 换怪后按新怪角色重新定位（坦克/战术→前排、射手/法师→后排），并可整体平移。
//   3. 动态 games：粗筛 games=1 → 高分(≥种子+margin)直接接受；低分 games=3 重评确认；
//      差(<种子−ε)丢弃。
//
// 运行：npx vite-node --script src/engine/tree/variant_generate.ts <种子阵型名> [变体数] [ε] [margin] [worker数]
// 产出：reports/variants_<种子>.json
// ============================================================

import '../env';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { registerAllBadges } from '../../game/BadgeSystem';
import { FORMATION_LIBRARY } from '../../ai/formation_library';
import {
  formationToEvol, cloneEvolFormation, walkEvolNodes, type EvolFormation,
} from './evol_gene';
import { swapMonsters, moveEarlier, shiftPosition } from './tree_ops';
import { evaluateBatchParallel } from './arena_parallel';
import {
  BADGE_TEMPLATES, badgeLimit, costOf, detectArch, type ArchKey,
} from './deck_ontology';
import { hasEffect, baseRole, TACTIC_IDS } from './monster_taxonomy';
import { ALL_MODULES } from './flow_library';

registerAllBadges();

const ARCH_SKELETON: Record<string, number[]> = {
  prayer: [103, 105], halfrush: [105, 110], fullrush: [110],
};
const FOUR_COST = [101, 102, 108, 115, 118, 120];
const ALL2 = [104, 106, 107, 109, 110, 111, 112, 113, 114, 116, 117, 119, 121, 122, 123, 124, 125];

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function badgesFor(id: number): number[] {
  const tpls = BADGE_TEMPLATES[id];
  return tpls && tpls.length ? [...tpls[0]].slice(0, badgeLimit(id)) : [];
}

/** 结构化换怪候选池：架构骨架 ∪ 核心 ∪ 战术 ∪ 组合件 ∪ 输出位 ∪ 生存位（与组装器同源） */
function deckPool(arch: ArchKey): number[] {
  const pool = new Set<number>();
  for (const id of ARCH_SKELETON[arch] ?? []) pool.add(id);
  for (const id of FOUR_COST) pool.add(id);
  for (const id of TACTIC_IDS) pool.add(id);
  for (const id of ALL2) if (hasEffect(id, '输出') || hasEffect(id, '爆发')) pool.add(id);
  for (const id of ALL2) if (hasEffect(id, '生存')) pool.add(id);
  for (const c of ALL_MODULES) for (const id of [...c.required, ...c.combos.flat()]) pool.add(id);
  return [...pool];
}

// ---------- 换怪 + 重新定位 ----------

/** 按角色重新定位：坦克/战士/战术→前排(x=6)，射手/法师→后排(x=10)，y 保持 */
function relocateToRole(f: EvolFormation, monsterId: number): void {
  const role = baseRole(monsterId);
  const isFront = role === '坦克' || role === '战士' || TACTIC_IDS.includes(monsterId);
  const targetX = isFront ? 6 : 10;
  for (const n of walkEvolNodes(f.root)) {
    for (const p of n.placements) {
      if (p.monsterId === monsterId) p.x = targetX;
    }
  }
}

/** 换卡组怪：结构化池内换 + 按角色重新定位 + 四费不进 R4+ */
function swapDeckMonster(f: EvolFormation, arch: ArchKey, rng: () => number): EvolFormation | null {
  const teamIds = f.team.map(s => s.monsterId);
  const fromId = teamIds[Math.floor(rng() * teamIds.length)];
  const totalCost = f.team.reduce((s, x) => s + costOf(x.monsterId), 0);
  const candidates = deckPool(arch).filter(id =>
    !teamIds.includes(id) && (totalCost - costOf(fromId) + costOf(id)) <= 18,
  );
  if (candidates.length === 0) return null;
  const toId = candidates[Math.floor(rng() * candidates.length)];

  const out = cloneEvolFormation(f);
  out.team = out.team.map(s => s.monsterId === fromId ? { monsterId: toId, badgeIds: badgesFor(toId) } : s);
  let ok = true;
  for (const n of walkEvolNodes(out.root)) {
    for (const p of n.placements) {
      if (p.monsterId === fromId) {
        if (costOf(toId) >= 4 && n.round >= 4) { ok = false; break; }
        p.monsterId = toId;
      }
    }
    if (!ok) break;
  }
  if (!ok) return null;
  relocateToRole(out, toId);  // 按新怪角色重新定位
  return out;
}

/** 换徽章：从权威徽章库（BADGE_TEMPLATES）里换不同变体 */
function mutateBadgeTpl(f: EvolFormation, rng: () => number): EvolFormation | null {
  const ids = f.team.map(s => s.monsterId);
  const id = ids[Math.floor(rng() * ids.length)];
  const tpls = BADGE_TEMPLATES[id];
  if (!tpls || tpls.length < 2) return null;
  const cur = f.team.find(s => s.monsterId === id)!.badgeIds.join(',');
  const others = tpls.filter(t => t.slice(0, badgeLimit(id)).join(',') !== cur);
  if (others.length === 0) return null;
  const out = cloneEvolFormation(f);
  out.team.find(s => s.monsterId === id)!.badgeIds = [...others[Math.floor(rng() * others.length)]].slice(0, badgeLimit(id));
  return out;
}

/** 组合件变体：补全组合（required 怪 + 至少一个徽章联动目标怪），组合怪已在卡组则保留并强制换新徽章 */
function applyCombo(f: EvolFormation, rng: () => number): EvolFormation | null {
  const combo = ALL_MODULES[Math.floor(rng() * ALL_MODULES.length)];
  console.log(`[applyCombo] 选到 ${combo.id} required=[${combo.required}] switch=[${Object.keys(combo.badgeSwitch ?? {}).join(',')}]`);
  const out = cloneEvolFormation(f);
  let changed = false;

  // 换入辅助：把 toId 换入（换掉 fromId），四费不进 R4+
  const swapIn = (toId: number, fromId: number): boolean => {
    const totalCost = out.team.reduce((s, x) => s + costOf(x.monsterId), 0);
    if (totalCost - costOf(fromId) + costOf(toId) > 18) return false;
    out.team = out.team.map(s => s.monsterId === fromId ? { monsterId: toId, badgeIds: badgesFor(toId) } : s);
    for (const n of walkEvolNodes(out.root)) {
      for (const p of n.placements) {
        if (p.monsterId === fromId) {
          if (costOf(toId) >= 4 && n.round >= 4) return false;
          p.monsterId = toId;
        }
      }
    }
    relocateToRole(out, toId);
    return true;
  };

  // 组合相关怪（required + badgeSwitch 目标）：换出时不能换它们
  const switchIds = Object.keys(combo.badgeSwitch ?? {}).map(Number);
  const keepIds = new Set([...combo.required, ...switchIds]);
  const swapFrom = (): number | null => {
    const candidates = out.team.filter(s => !keepIds.has(s.monsterId)).map(s => s.monsterId);
    return candidates.length ? candidates[Math.floor(rng() * candidates.length)] : null;
  };

  // 1) required 怪确保在卡组（不在则补入；在则保留）
  for (const req of combo.required) {
    if (!out.team.some(s => s.monsterId === req)) {
      const fromId = swapFrom();
      if (fromId === null || !swapIn(req, fromId)) return null;
      changed = true;
    }
  }

  // 2) 徽章联动目标怪：至少一个在卡组（盾炮需盾怪/礼物需银狙/炸弹需载体）
  if (switchIds.length > 0 && !switchIds.some(id => out.team.some(s => s.monsterId === id))) {
    const toId = switchIds[Math.floor(rng() * switchIds.length)];
    const fromId = swapFrom();
    if (fromId === null || !swapIn(toId, fromId)) return null;
    changed = true;
  }

  // 3) 徽章联动（强制：组合怪在卡组就换新徽章）
  if (combo.badgeSwitch) {
    for (const [idStr, variants] of Object.entries(combo.badgeSwitch)) {
      const slot = out.team.find(s => s.monsterId === Number(idStr));
      if (!slot) continue;
      const chosen = variants[Math.floor(rng() * variants.length)];
      if (slot.badgeIds.join(',') !== chosen.join(',')) {
        slot.badgeIds = [...chosen];
        changed = true;
      }
    }
  }

  return changed ? out : null;
}

// ---------- dof 徽章协同 ----------

const ELEMENT_HAND_IDS = [101, 104, 124];   // 元素手（自带元素：肃清流血/散弹燃烧/三振寒冷）
const ELEMENT_BADGES = [4, 25, 27];         // 元素徽章（涌动/中毒/献祭）
const WITHER_BADGE = 2;                     // 凋零

/** dof 徽章协同（用户定案）：元素手用元素变体；输出怪（攻击手）带凋零，最多 2 只 */
function applyDofBadges(team: { monsterId: number; badgeIds: number[] }[]): void {
  const ids = team.map(s => s.monsterId);
  if (!ids.some(id => ELEMENT_HAND_IDS.includes(id))) return;  // 非 dof（无元素手）跳过

  // 1) 元素手 → 元素变体
  for (const s of team) {
    if (!ELEMENT_HAND_IDS.includes(s.monsterId)) continue;
    const tpls = BADGE_TEMPLATES[s.monsterId];
    const elem = tpls?.find(t => t.some(b => ELEMENT_BADGES.includes(b)));
    if (elem) s.badgeIds = [...elem].slice(0, badgeLimit(s.monsterId));
  }
  // 2) 攻击手（输出/爆发怪）→ 凋零变体，最多 2 只
  const attackers = team.filter(s => hasEffect(s.monsterId, '输出') || hasEffect(s.monsterId, '爆发'));
  let n = 0;
  for (const a of attackers) {
    if (n >= 2) break;
    const tpls = BADGE_TEMPLATES[a.monsterId];
    const wither = tpls?.find(t => t.includes(WITHER_BADGE));
    if (wither) { a.badgeIds = [...wither].slice(0, badgeLimit(a.monsterId)); n++; }
  }
}

/** 整体平移：所有怪一起平移 dx/dy（保持相对结构，安全小步平移） */
function shiftAll(f: EvolFormation, rng: () => number): EvolFormation | null {
  const dx = Math.floor(rng() * 3) - 1;  // -1..1
  const dy = Math.floor(rng() * 3) - 1;
  if (dx === 0 && dy === 0) return null;
  const out = cloneEvolFormation(f);
  for (const n of walkEvolNodes(out.root)) {
    for (const p of n.placements) {
      const nx = p.x + dx, ny = p.y + dy;
      if (nx < 6 || nx > 10 || ny < 0 || ny > 4) return null; // 越界则放弃
      p.x = nx; p.y = ny;
    }
  }
  return out;
}

// ---------- 单次变异（卡组 50% + 布局 50%） ----------

function mutate(f: EvolFormation, arch: ArchKey, rng: () => number): EvolFormation | null {
  const ids = f.team.map(s => s.monsterId);
  for (let attempt = 0; attempt < 10; attempt++) {
    const r = rng();
    let out: EvolFormation | null = null;
    if (r < 0.15) {
      out = applyCombo(f, rng);                         // 组合件变体（盾炮/秒杀/偷后排/范围克制）
    } else if (r < 0.40) {
      out = swapDeckMonster(f, arch, rng);              // 换怪（结构化池 + 重新定位）
    } else if (r < 0.52) {
      out = mutateBadgeTpl(f, rng);                     // 换徽章
    } else if (r < 0.64) {
      out = shiftAll(f, rng);                           // 整体平移
    } else if (r < 0.78) {
      const mid = ids[Math.floor(rng() * ids.length)];
      out = shiftPosition(f, mid, Math.floor(rng() * 5) - 2, Math.floor(rng() * 5) - 2); // 单怪换位
    } else if (r < 0.90 && ids.length >= 2) {
      const mid = ids[Math.floor(rng() * ids.length)];
      const rounds = walkEvolNodes(f.root)
        .filter(n => n.round >= 2 && n.placements.some(p => p.monsterId === mid))
        .map(n => n.round);
      if (rounds.length === 0) continue;
      const fromRound = rounds[Math.floor(rng() * rounds.length)];
      out = moveEarlier(f, mid, fromRound, 1 + Math.floor(rng() * (fromRound - 1))); // 换顺序
    } else if (ids.length >= 2) {
      const i = Math.floor(rng() * ids.length);
      let j = Math.floor(rng() * ids.length);
      if (j === i) j = (j + 1) % ids.length;
      out = swapMonsters(f, ids[i], ids[j]);            // 树内换怪角色
    }
    if (out) return out;
  }
  return null;
}

// ---------- 主流程 ----------

async function main(): Promise<void> {
  const seedName = process.argv[2];
  if (!seedName) { console.error('用法：variant_generate.ts <种子阵型名> [变体数] [ε] [margin] [worker数]'); process.exit(1); }
  const variants = Number(process.argv[3] || 20);
  const epsilon = Number(process.argv[4] || 0.1);
  const margin = Number(process.argv[5] || 0.05);
  const wArg = Number(process.argv[6] || 0);
  const workers = wArg > 0 ? wArg : undefined;

  const seedFormation = FORMATION_LIBRARY.find(f => f.name === seedName);
  if (!seedFormation) { console.error(`阵型不存在: ${seedName}`); process.exit(1); }
  const seed = formationToEvol(seedFormation);
  const arch = detectArch(new Set(seed.team.map(s => s.monsterId)));
  const rng = mulberry32(42);

  console.log(`=== 变体生成 v2：${seedName}（${variants} 变体，ε=${epsilon}，margin=${margin}，动态 games） ===\n`);

  // 1) 生成变体（去重 + dof 徽章协同）
  const seen = new Set<string>();
  const list: { name: string; f: EvolFormation }[] = [];
  while (list.length < variants) {
    const v = mutate(seed, arch, rng);
    if (!v) continue;
    applyDofBadges(v.team);  // 元素手→元素变体、攻击手→凋零（最多 2 只）
    const key = v.team.map(s => `${s.monsterId}[${s.badgeIds.join(',')}]`).sort().join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    list.push({ name: `${seedName}_v${list.length + 1}`, f: v });
  }

  // 2) 粗筛：games=1 快速评估（种子 + 变体）
  const all = [{ name: seedName, f: seed }, ...list];
  const coarse = await evaluateBatchParallel(all, 1, workers);
  const baseline = coarse[0].adScore;

  // 3) 动态精评：高分直接接受，低分 games=3 重评
  const accepted: typeof coarse = [];
  const recheck: { idx: number; r: (typeof coarse)[number] }[] = [];
  for (let i = 1; i < coarse.length; i++) {
    const r = coarse[i];
    if (r.adScore >= baseline + margin) accepted.push(r);          // 高分直接接受
    else if (r.adScore >= baseline - epsilon) recheck.push({ idx: i, r }); // 低分重评
    // 其余 < 阈值，丢弃
  }

  let final = [...accepted];
  if (recheck.length > 0) {
    console.log(`粗筛 games=1：高分接受 ${accepted.length}，低分重评 ${recheck.length}（games=3）`);
    const recheckCands = recheck.map(x => all[x.idx]);
    const recheckRes = await evaluateBatchParallel(recheckCands, 3, workers);
    for (let i = 0; i < recheckRes.length; i++) {
      if (recheckRes[i].adScore >= baseline - epsilon) final.push(recheckRes[i]);
    }
  }

  console.log(`\n种子 ${seedName} 分离分 ${(baseline * 100).toFixed(1)}%（阈值 ≥ ${((baseline - epsilon) * 100).toFixed(1)}%）`);
  console.log(`保留 ${final.length}/${variants} 个变体（高分直收 ${accepted.length} + 重评确认 ${final.length - accepted.length}）\n`);

  final.sort((a, b) => b.adScore - a.adScore);
  const improved = final.filter(r => r.adScore > baseline + 1e-6).length;
  for (const r of final.slice(0, 30)) {
    const mark = r.adScore > baseline + 1e-6 ? '↑' : r.adScore >= baseline - 1e-6 ? '≈' : '↓';
    console.log(`  ${mark} ${r.name.padEnd(20)} 分离分 ${(r.adScore * 100).toFixed(1)}%`);
  }

  // 4) 输出
  const out = {
    seed: seedName, baseline, epsilon, margin, totalVariants: variants, keptCount: final.length, improved,
    kept: final.map(r => {
      const v = all.find(x => x.name === r.name)!;
      return {
        name: r.name, adScore: r.adScore, weakest: r.weakest,
        attack: r.attack, survival: r.survival, comprehensive: r.comprehensive, vsAll: r.vsAll,
        team: v.f.team, tree: v.f.root,
      };
    }),
  };
  const outPath = resolve(`reports/variants_${seedName}.json`);
  writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`\n保留 ${final.length} 个变体 → ${outPath}`);
}

main().catch(e => { console.error(e); process.exit(1); });
