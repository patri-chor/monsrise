// ============================================================
// 礼物救星 —— 祷徒分支救星位置精确验证
// focused_climb 发现救星(8,2)→(8,3) 修 vs 全二永平后手，但全局移动污染主分支。
// 精确改动：只移动祷徒分支 n7 的救星(108)，主分支 n3 保持 (8,2)。
// 运行：npx vite-node --script src/engine/tree/savior_verify.ts [games]
// ============================================================

import '../env';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { FORMATION_LIBRARY } from '../../ai/formation_library';
import type { EvolFormation } from './evol_gene';
import { formationToEvol } from './evol_gene';
import { moveWithinZoneAtNode } from './tree_ops';
import { playSpecVsSpec, type SideSpec } from './arena';

function loadBundle(): any {
  const w = globalThis as any;
  const code = readFileSync(resolve('public/ai-bundle.iife.js'), 'utf8');
  const factory = new Function('window', 'globalThis', '"use strict";\n' + code + '\n;return BattleAI;');
  const b = factory(w, w);
  return b?.BattleAI ?? w.BattleAI;
}

function main(): void {
  const games = Number(process.argv[2] || 12);
  const BundleAI = loadBundle();
  const base = formationToEvol(FORMATION_LIBRARY.find(f => f.name === '礼物救星')!);

  // 只在祷徒分支 n7 移动救星 → (8,3)
  const moved = moveWithinZoneAtNode(base, 'n7', 108, 8, 3);
  if (!moved) { console.error('移动失败'); process.exit(1); }

  // 完整分离测试：三靶 × 先手/后手分开
  const targets = ['全二永平', '全二冲', '泉水剑'].map(n => FORMATION_LIBRARY.find(f => f.name === n)!);

  for (const [label, cand] of [['原始', base], ['祷徒分支救星(8,3)', moved]] as [string, EvolFormation][]) {
    console.log(`\n=== ${label} 完整分离测试 ===`);
    for (const t of targets) {
      let first = { w: 0, d: 0, l: 0 }, second = { w: 0, d: 0, l: 0 };
      for (let i = 0; i < games; i++) {
        const aSide: 1 | 2 = i % 2 === 0 ? 1 : 2;
        const r = playSpecVsSpec(BundleAI, { kind: 'evol', f: cand }, { kind: 'native', f: t }, aSide, 18000 + i);
        const acc = aSide === 1 ? first : second;
        acc.w += r.w; acc.d += r.d; acc.l += r.l;
      }
      const uf = (a: {w:number;d:number;l:number}) => ((a.w + a.d) / (a.w + a.d + a.l) * 100).toFixed(0);
      console.log(`  vs ${t.name}: 先手 ${first.w}胜/${first.d}平/${first.l}负 (${uf(first)}%) | 后手 ${second.w}胜/${second.d}平/${second.l}负 (${uf(second)}%)`);
    }
  }
}

main();
