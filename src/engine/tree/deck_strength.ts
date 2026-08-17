// ============================================================
// 卡组强度测定（阶段1：同流派模板树 + 树侧真实引擎）
//
// 背景：用户用"流派(arch)+核心(core)+辅助(aux)"生成了大量候选卡组
//   （reports/deck_candidates.json），但卡组只有 team（怪+徽章）没有放置树。
//   之前 deck_eval.py 用启发式贪心放置评估，把好卡组测废（泉水剑 37.5% vs 真实 100%）。
//
// 方案（用户定案：同流派模板树）：
//   1. 按 arch 选参考阵型（prayer→泉水剑 / halfrush→坚果救星 / fullrush→全二冲）
//   2. 套用参考阵型的放置树，按 role/cost 把参考树的怪映射到候选卡组的怪
//   3. 用树侧真实引擎（playOne）评估 vs 规则随机 / vs 7 套 bundle
//
// 运行：npx vite-node --script src/engine/tree/deck_strength.ts [每对手局数] [--only 关键词]
// ============================================================

import '../env';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { registerAllBadges } from '../../game/BadgeSystem';
import { FORMATION_LIBRARY } from '../../ai/formation_library';
import type { EvolFormation } from './evol_gene';
import { formationToEvol, cloneEvolFormation, walkEvolNodes } from './evol_gene';
import { roleOf, costOf } from './tree_ops';
import { playOne, initCost } from './eval_vs_random';
import { playSpecVsSpec, type SideSpec } from './arena';

registerAllBadges();

function loadBundle(): any {
  const w = globalThis as any;
  const code = readFileSync(resolve('public/ai-bundle.iife.js'), 'utf8');
  const factory = new Function('window', 'globalThis', '"use strict";\n' + code + '\n;return BattleAI;');
  const b = factory(w, w);
  return b?.BattleAI ?? w.BattleAI;
}

/** 把参考阵型的树映射到候选卡组：一对一贪心（同ID → 同cost同role → 同cost → 同role → 任意） */
function mapRefTreeToDeck(ref: EvolFormation, deckTeam: { monsterId: number; badgeIds: number[] }[]): EvolFormation {
  const out = cloneEvolFormation(ref);
  out.name = ref.name; // 保留参考名便于调试，实际 team 换成候选卡组
  out.team = deckTeam.map(s => ({ monsterId: s.monsterId, badgeIds: [...s.badgeIds] }));

  // 参考树里用到的怪（去重）
  const refIds = new Set<number>();
  for (const n of walkEvolNodes(ref.root)) for (const p of n.placements) refIds.add(p.monsterId);

  // 候选卡组怪池（可映射）
  const pool = deckTeam.map(s => s.monsterId);
  const used = new Set<number>();
  const mapping = new Map<number, number>(); // refId -> deckId

  const deckRole = (id: number) => roleOf(id);
  const deckCost = (id: number) => costOf(id);

  // 1. 同 ID 直接映射
  for (const rid of refIds) {
    if (pool.includes(rid) && !used.has(rid)) {
      mapping.set(rid, rid);
      used.add(rid);
    }
  }
  // 2. 同 cost + 同 role
  for (const rid of refIds) {
    if (mapping.has(rid)) continue;
    const cand = pool.find(d => !used.has(d) && deckCost(d) === costOf(rid) && deckRole(d) === roleOf(rid));
    if (cand !== undefined) { mapping.set(rid, cand); used.add(cand); }
  }
  // 3. 同 cost
  for (const rid of refIds) {
    if (mapping.has(rid)) continue;
    const cand = pool.find(d => !used.has(d) && deckCost(d) === costOf(rid));
    if (cand !== undefined) { mapping.set(rid, cand); used.add(cand); }
  }
  // 4. 同 role
  for (const rid of refIds) {
    if (mapping.has(rid)) continue;
    const cand = pool.find(d => !used.has(d) && deckRole(d) === roleOf(rid));
    if (cand !== undefined) { mapping.set(rid, cand); used.add(cand); }
  }
  // 5. 任意剩余
  for (const rid of refIds) {
    if (mapping.has(rid)) continue;
    const cand = pool.find(d => !used.has(d));
    if (cand !== undefined) { mapping.set(rid, cand); used.add(cand); }
  }

  // 应用映射：替换树里每个 placement 的 monsterId
  for (const n of walkEvolNodes(out.root)) {
    for (const p of n.placements) {
      const to = mapping.get(p.monsterId);
      if (to !== undefined) p.monsterId = to;
    }
  }
  return out;
}

interface Candidate {
  template: string;
  arch: string;
  core: string;
  aux: string;
  team: { monsterId: number; badgeIds: number[] }[];
}

function loadCandidates(path: string): Candidate[] {
  const data = JSON.parse(readFileSync(path, 'utf8'));
  return data.candidates.map((c: any) => ({
    template: c.template,
    arch: c.arch,
    core: c.core,
    aux: c.aux,
    team: c.team.map((s: any) => ({ monsterId: s.monsterId, badgeIds: [...s.badgeIds] })),
  }));
}

function main(): void {
  const games = Number(process.argv[2] || 8);
  const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : undefined;
  const stage2Only = process.argv.includes('--stage2');

  const BundleAI = loadBundle();
  initCost();

  const refs: Record<string, EvolFormation> = {};
  // 按名字取三个参考（同流派模板树）
  refs.prayer = formationToEvol(FORMATION_LIBRARY.find(f => f.name === '泉水剑')!);
  refs.halfrush = formationToEvol(FORMATION_LIBRARY.find(f => f.name === '坚果救星')!);
  refs.fullrush = formationToEvol(FORMATION_LIBRARY.find(f => f.name === '全二冲')!);

  const cands = loadCandidates(resolve('reports/deck_candidates.json'));
  // 按 template 去重（coverage 填充会产生同名但徽章不同的卡组，取第一个）
  const seenTemplate = new Set<string>();
  const dedupCands = cands.filter(c => {
    if (seenTemplate.has(c.template)) return false;
    seenTemplate.add(c.template);
    return true;
  });
  let list = only ? dedupCands.filter(c => c.template.includes(only)) : dedupCands;

  // 阶段2：只测阶段1存活的卡组（不败率 >= 阈值）
  const THRESHOLD = 0.8;
  if (stage2Only) {
    const s1 = JSON.parse(readFileSync(resolve('reports/deck_strength_stage1.json'), 'utf8'));
    const aliveNames = new Set(s1.results.filter((r: any) => r.ud >= THRESHOLD).map((r: any) => r.template));
    list = cands.filter(c => aliveNames.has(c.template));
    console.log(`[阶段2] 阶段1存活 ${aliveNames.size} 个卡组，进入 vs bundle 精评`);
  }

  const rows: { template: string; arch: string; vsRuleUd: number; bW: number; bD: number; bL: number; bUd: number }[] = [];

  // 阶段1 vs 规则随机（若未指定 --stage2，先跑）
  let ruleMap = new Map<string, number>();
  if (!stage2Only) {
    console.log(`=== 阶段1：${list.length} 卡组 vs 规则随机（${games} 局） ===`);
    const deckPool = FORMATION_LIBRARY.map(f => f.team.filter(s => s.monsterId > 0));
    for (const c of list) {
      const evolved = mapRefTreeToDeck(refs[c.arch], c.team);
      let w = 0, d = 0, l = 0;
      for (let g = 0; g < games; g++) {
        const oppDeck = deckPool[g % deckPool.length];
        const evoSide: 1 | 2 = g % 2 === 0 ? 1 : 2;
        const r = playOne(BundleAI, evolved, oppDeck, evoSide, 3000 + g);
        w += r.w; d += r.d; l += r.l;
      }
      const ud = (w + d) / (w + d + l);
      ruleMap.set(c.template, ud);
    }
    console.log('');
  } else {
    const s1 = JSON.parse(readFileSync(resolve('reports/deck_strength_stage1.json'), 'utf8'));
    for (const r of s1.results) ruleMap.set(r.template, r.ud);
  }

  // 阶段2 vs 7 套 bundle（真实强度）
  console.log(`=== 阶段2：${list.length} 卡组 vs 7 套 bundle（每对手 ${games} 局） ===`);
  for (const c of list) {
    const evolved = mapRefTreeToDeck(refs[c.arch], c.team);
    const specA: SideSpec = { kind: 'evol', f: evolved };
    let bW = 0, bD = 0, bL = 0;
    for (const opp of FORMATION_LIBRARY) {
      const specB: SideSpec = { kind: 'native', f: opp };
      for (let g = 0; g < games; g++) {
        const aSide: 1 | 2 = g % 2 === 0 ? 1 : 2;
        const r = playSpecVsSpec(BundleAI, specA, specB, aSide, 5000 + g);
        bW += r.w; bD += r.d; bL += r.l;
      }
    }
    const bUd = (bW + bD) / (bW + bD + bL);
    rows.push({ template: c.template, arch: c.arch, vsRuleUd: ruleMap.get(c.template) ?? 0, bW, bD, bL, bUd });
    console.log(`  ${c.template} [${c.arch}]: vs bundle 不败率 ${(bUd * 100).toFixed(0)}% (${bW}胜/${bD}平/${bL}负) | vs rule ${((ruleMap.get(c.template) ?? 0) * 100).toFixed(0)}%`);
  }

  // 排名（按 vs bundle 不败率）
  rows.sort((a, b) => b.bUd - a.bUd);
  console.log('\n=== 最终排名（vs bundle 不败率降序） ===');
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    console.log(`  ${i + 1}. ${r.template}  bundle=${(r.bUd * 100).toFixed(0)}%  rule=${(r.vsRuleUd * 100).toFixed(0)}%`);
  }

  const outPath = resolve(stage2Only ? 'reports/deck_strength_stage2.json' : 'reports/deck_strength_full.json');
  writeFileSync(outPath, JSON.stringify({ games, results: rows }, null, 2));
  console.log(`\n结果已保存 → ${outPath}`);
}

main();
