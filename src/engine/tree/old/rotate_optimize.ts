// ============================================================
// 轮流优化：对 7 个阵型逐个跑自主分支优化（optimizeFormation），
// 每个阵型优化后保存产物，最后统一 vs 规则随机评估，对比 v1 基线。
//
// 运行：npx vite-node --script src/engine/tree/rotate_optimize.ts [每对手局数] [vs随机局数]
//   例：npx vite-node --script src/engine/tree/rotate_optimize.ts 4 20
// ============================================================

import '../env';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { registerAllBadges } from '../../game/BadgeSystem';
import { FORMATION_LIBRARY } from '../../ai/formation_library';
import type { EvolFormation } from './evol_gene';
import { formationToEvol } from './evol_gene';
import { optimizeFormation } from './branch_induct';
import { playOne, initCost } from './eval_vs_random';

registerAllBadges();

function loadBundle(): any {
  const w = globalThis as any;
  const code = readFileSync(resolve('public/ai-bundle.iife.js'), 'utf8');
  const factory = new Function('window', 'globalThis', '"use strict";\n' + code + '\n;return BattleAI;');
  const b = factory(w, w);
  return b?.BattleAI ?? w.BattleAI;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** vs 规则随机评估单个阵型（口径同 batch_eval：随机卡组 + 前坦克后射手 + 先手后手各半） */
function evalVsRandom(BundleAI: any, f: EvolFormation, decks: { monsterId: number; badgeIds: number[] }[][], games: number, seedBase: number): { w: number; d: number; l: number } {
  const deckRng = mulberry32(seedBase);
  let w = 0, d = 0, l = 0;
  for (let g = 0; g < games; g++) {
    const oppDeck = decks[Math.floor(deckRng() * decks.length)];
    const evoSide: 1 | 2 = g % 2 === 0 ? 1 : 2;
    const r = playOne(BundleAI, f, oppDeck, evoSide, seedBase + g);
    w += r.w; d += r.d; l += r.l;
  }
  return { w, d, l };
}

function main(): void {
  const gamesPerOpp = Number(process.argv[2] || 4);   // 优化阶段每对手局数
  const evalGames = Number(process.argv[3] || 20);     // 最终 vs 规则随机局数

  const BundleAI = loadBundle();
  initCost();
  const decks = FORMATION_LIBRARY.map(f => f.team.filter(s => s.monsterId > 0));

  console.log(`=== 轮流优化 7 阵型（优化每对手${gamesPerOpp}局，评估vs随机${evalGames}局） ===\n`);

  const results: { name: string; optimized: EvolFormation; improved: boolean; maskLabel: string }[] = [];

  for (const src of FORMATION_LIBRARY) {
    console.log(`\n\n########## 优化阵型：${src.name} ##########`);
    const out = optimizeFormation(BundleAI, src, gamesPerOpp);
    if (out) {
      results.push({ name: src.name, optimized: out.optimized, improved: out.improved, maskLabel: out.maskLabel });
    } else {
      results.push({ name: src.name, optimized: formationToEvol(src), improved: false, maskLabel: '无分裂' });
    }
  }

  // 统一评估：优化后 vs 规则随机，对比 v1 基线
  console.log(`\n\n=== 优化后 7 阵型 vs 规则随机（${evalGames}局/阵型） ===`);
  console.log('| 阵型 | v1不败率 | 优化后不败率 | 胜/平/负 | 变化 |');
  console.log('|---|---|---|---|---|---|');

  const V1_UD: Record<string, number> = {
    泉水剑: 100.0, 坚果救星: 95.0, 全二冲: 75.0, 经典救星: 95.0, 全二永平: 95.0, 肃清: 95.0, 梯子塞雷: 75.0,
  };

  let totalW = 0, totalD = 0, totalL = 0;
  const payload: any[] = [];

  for (const r of results) {
    const ev = evalVsRandom(BundleAI, r.optimized, decks, evalGames, 5000 + r.name.length * 1000);
    const t = ev.w + ev.d + ev.l;
    const ud = ((ev.w + ev.d) / t * 100).toFixed(1);
    const v1 = V1_UD[r.name] ?? 0;
    const delta = (parseFloat(ud) - v1).toFixed(1);
    console.log(`| ${r.name} | ${v1}% | ${ud}% | ${ev.w}/${ev.d}/${ev.l} | ${parseFloat(delta) >= 0 ? '+' : ''}${delta}% ${r.improved ? `[${r.maskLabel}]` : '(未改善)'} |`);
    totalW += ev.w; totalD += ev.d; totalL += ev.l;
    payload.push({
      name: r.name,
      improved: r.improved,
      maskLabel: r.maskLabel,
      vsRandom: { win: ev.w, draw: ev.d, loss: ev.l },
      formation: { name: r.optimized.name, archetype: r.optimized.archetype, team: r.optimized.team, tree: r.optimized.root },
    });
  }

  const tAll = totalW + totalD + totalL;
  const avgUd = ((totalW + totalD) / tAll * 100).toFixed(1);
  console.log(`| **平均** | 90.0% | ${avgUd}% | ${totalW}/${totalD}/${totalL} | ${(parseFloat(avgUd) - 90.0).toFixed(1)}% |`);

  const outPath = resolve('reports/rotate_results.json');
  writeFileSync(outPath, JSON.stringify({ type: 'rotate_optimize_result', gamesPerOpp, evalGames, results: payload }, null, 2));
  console.log(`\n结果已保存 → ${outPath}`);
}

main();
