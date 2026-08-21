// ============================================================
// 礼物金猴 —— 银狙 R3 站位扫描
// 目标：找让「银狙死亡时金猴(120)成为最近友方」的银狙站位。
// 礼物机制：findClosestAlly 用实时坐标欧氏距离，取第一个严格更近者。
// 银狙带炸弹24(开局损80%血=200血)+礼物33，死得快，触发礼物早。
// 扫描：银狙 R3 在射手后排合法列(x∈[8,10], y∈[0,4])内移动，
//   统计金猴吃礼物率。金猴 R2 位置固定(8,1)（RL侧，先不动）。
// 运行：npx vite-node --script src/engine/tree/gift_scan.ts [gamesPerPos]
// ============================================================

import '../env';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { battleSystem } from '../../game/BattleSystem';
import { registerAllBadges } from '../../game/BadgeSystem';
import { FORMATION_LIBRARY } from '../../ai/formation_library';
import type { EvolFormation } from './evol_gene';
import { formationToEvol, walkEvolNodes } from './evol_gene';
import { moveWithinZoneAtNode } from './tree_ops';
import { playSpecVsSpec, type SideSpec } from './arena';

registerAllBadges();

function loadBundle(): any {
  const w = globalThis as any;
  const code = readFileSync(resolve('public/ai-bundle.iife.js'), 'utf8');
  const factory = new Function('window', 'globalThis', '"use strict";\n' + code + '\n;return BattleAI;');
  const b = factory(w, w);
  return b?.BattleAI ?? w.BattleAI;
}

function main(): void {
  const gamesPerPos = Number(process.argv[2] || 4);
  const BundleAI = loadBundle();
  const base = formationToEvol(FORMATION_LIBRARY.find(f => f.name === '礼物金猴')!);
  const prayerTarget = FORMATION_LIBRARY.find(f => f.name === '泉水剑')!;

  // 银狙 R3 节点 id（主链）
  const r3 = walkEvolNodes(base.root).find(n => n.round === 3 && !n.condition.main)!;
  const silverSlot = r3.placements.find(p => p.monsterId === 109)!;

  const orig = battleSystem.findClosestAlly.bind(battleSystem);
  let giftTo: { toId: number; golden: boolean }[] = [];
  battleSystem.findClosestAlly = ((m: any) => {
    const ally = orig(m);
    if (m.dbId === 109) giftTo.push({ toId: ally ? ally.dbId : -1, golden: ally?.dbId === 120 });
    return ally;
  }) as any;

  console.log(`=== 银狙 R3 站位扫描（vs 泉水剑/祷徒，${gamesPerPos} 局/位置） ===`);
  console.log(`原始银狙位置: (${silverSlot.x},${silverSlot.y})，金猴 R2 固定(8,1)\n`);

  const results: { x: number; y: number; goldenRate: number; gifts: number; undefeated: number }[] = [];

  for (let x = 8; x <= 10; x++) {
    for (let y = 0; y <= 4; y++) {
      if (x === silverSlot.x && y === silverSlot.y) continue;
      const candidate = moveWithinZoneAtNode(base, r3.id, 109, x, y);
      if (!candidate) continue;

      const before = giftTo.length;
      let w = 0, d = 0, l = 0;
      const spec: SideSpec = { kind: 'evol', f: candidate };
      for (let i = 0; i < gamesPerPos; i++) {
        const aSide: 1 | 2 = i % 2 === 0 ? 1 : 2;
        const r = playSpecVsSpec(BundleAI, spec, { kind: 'native', f: prayerTarget }, aSide, 8000 + x * 100 + y * 10 + i);
        w += r.w; d += r.d; l += r.l;
      }
      const gifts = giftTo.slice(before);
      const golden = gifts.filter(g => g.golden).length;
      const goldenRate = gifts.length ? golden / gifts.length : -1;
      const undefeated = (w + d) / (w + d + l);
      results.push({ x, y, goldenRate, gifts: gifts.length, undefeated });
      console.log(`(${x},${y}): 礼物${gifts.length}次 金猴吃到 ${goldenRate >= 0 ? (goldenRate * 100).toFixed(0) + '%' : '-'} | 不败 ${(undefeated * 100).toFixed(0)}%`);
    }
  }

  results.sort((a, b) => b.goldenRate - a.goldenRate);
  console.log('\n=== 金猴吃礼物率 Top5 ===');
  for (const r of results.slice(0, 5)) {
    console.log(`(${r.x},${r.y}): 吃到率 ${(r.goldenRate * 100).toFixed(0)}% (礼物${r.gifts}次) 不败${(r.undefeated * 100).toFixed(0)}%`);
  }
}

main();
