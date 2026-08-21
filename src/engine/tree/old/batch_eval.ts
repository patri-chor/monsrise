// ============================================================
// 批量评估：7 阵型 vs 规则随机（随机卡组 + 前坦克后射手 + 跨回合手牌）
// 输出胜率数据表，用于追踪各版本（模型标号 v1/v2/...）。
// 运行：npx vite-node --script src/engine/tree/batch_eval.ts [局数] [模型版本号]
// ============================================================

import '../env';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { registerAllBadges } from '../../game/BadgeSystem';
import { FORMATION_LIBRARY } from '../../ai/formation_library';
import type { EvolFormation } from './evol_gene';
import { formationToEvol } from './evol_gene';
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

function main(): void {
  const games = Number(process.argv[2] || 20);
  const version = process.argv[3] || 'v1';

  const BundleAI = loadBundle();
  initCost();
  const decks = FORMATION_LIBRARY.map(f => f.team.filter(s => s.monsterId > 0));

  console.log(`=== 7 阵型 vs 规则随机（${games}局/阵型，模型 ${version}）===`);
  console.log('| 阵型 | 纯胜率 | 不败率 | 胜/平/负 |');
  console.log('|---|---|---|---|---|');

  const t0 = Date.now();
  const rows: { name: string; w: number; d: number; l: number }[] = [];
  let totalW = 0, totalD = 0, totalL = 0;

  for (const f of FORMATION_LIBRARY) {
    const evolved: EvolFormation = formationToEvol(f);
    const deckRng = mulberry32(12345 + f.team.length);
    let w = 0, d = 0, l = 0;
    for (let g = 0; g < games; g++) {
      const oppDeck = decks[Math.floor(deckRng() * decks.length)];
      const evoSide: 1 | 2 = g % 2 === 0 ? 1 : 2;
      const r = playOne(BundleAI, evolved, oppDeck, evoSide, 3000 + g);
      w += r.w; d += r.d; l += r.l;
    }
    const t = w + d + l;
    const wr = (w / t * 100).toFixed(1);
    const ud = ((w + d) / t * 100).toFixed(1);
    console.log(`| ${f.name} | ${wr}% | ${ud}% | ${w}/${d}/${l} |`);
    rows.push({ name: f.name, w, d, l });
    totalW += w; totalD += d; totalL += l;
  }

  const tAll = totalW + totalD + totalL;
  const avgWr = (totalW / tAll * 100).toFixed(1);
  const avgUd = ((totalW + totalD) / tAll * 100).toFixed(1);
  console.log(`| **平均** | ${avgWr}% | ${avgUd}% | ${totalW}/${totalD}/${totalL} |`);
  console.log(`\n耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main();
