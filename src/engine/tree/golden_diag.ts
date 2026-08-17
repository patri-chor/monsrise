// ============================================================
// 礼物金猴 —— 逐轮崩盘诊断（引擎修复后）
// 短板：vs 全二冲（生存力 16.7%/0%）vs 泉水剑（综合力 16.7%/16.7%）
// 用 arena 的 roundScores 逐轮期望分定位崩盘点。
// 运行：npx vite-node --script src/engine/tree/golden_diag.ts [games]
// ============================================================

import '../env';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { battleSystem } from '../../game/BattleSystem';
import { registerAllBadges } from '../../game/BadgeSystem';
import { FORMATION_LIBRARY } from '../../ai/formation_library';
import { formationToEvol } from './evol_gene';
import { playSpecVsSpec, type SideSpec } from './arena';

registerAllBadges();

function loadBundle(): any {
  const w = globalThis as any;
  const code = readFileSync(resolve('public/ai-bundle.iife.js'), 'utf8');
  const factory = new Function('window', 'globalThis', '"use strict";\n' + code + '\n;return BattleAI;');
  const b = factory(w, w);
  return b?.BattleAI ?? w.BattleAI;
}

const MONSTER_NAME: Record<number, string> = {
  108: '救星', 109: '银狙', 110: '帝国', 105: '祈祷', 116: '钻头', 104: '散弹',
  114: '突突', 119: '忍猴', 120: '金猴', 124: '三振', 103: '学徒', 106: '冲锋',
  107: '咒法', 113: '矿爆', 117: '铁甲', 101: '肃清', 118: '塞雷', 125: '战壕', 122: '丛林',
};
const nm = (id: number) => MONSTER_NAME[id] ?? String(id);

function main(): void {
  const games = Number(process.argv[2] || 16);
  const BundleAI = loadBundle();
  const candidate = formationToEvol(FORMATION_LIBRARY.find(f => f.name === '礼物金猴')!);

  // 礼物吃到率观测
  const orig = battleSystem.findClosestAlly.bind(battleSystem);
  let giftLog: { toId: number; golden: boolean }[] = [];
  battleSystem.findClosestAlly = ((m: any) => {
    const ally = orig(m);
    if (m.dbId === 109) giftLog.push({ toId: ally ? ally.dbId : -1, golden: ally?.dbId === 120 });
    return ally;
  }) as any;

  const targets = ['全二冲', '泉水剑', '全二永平'].map(n => FORMATION_LIBRARY.find(f => f.name === n)!);

  for (const target of targets) {
    console.log(`\n=== vs ${target.name} ===`);
    for (const aSide of [1, 2] as const) {
      const sideLabel = aSide === 1 ? '先手' : '后手';
      const roundAcc = [0, 0, 0, 0, 0];
      let w = 0, d = 0, l = 0;
      const before = giftLog.length;
      for (let i = 0; i < games; i++) {
        const r = playSpecVsSpec(BundleAI, { kind: 'evol', f: candidate }, { kind: 'native', f: target }, aSide, 20000 + i);
        w += r.w; d += r.d; l += r.l;
        for (let k = 0; k < 5; k++) roundAcc[k] += r.roundScores[k] ?? 0;
      }
      const gifts = giftLog.slice(before);
      const golden = gifts.filter(g => g.golden).length;
      console.log(`  ${sideLabel}: ${w}胜/${d}平/${l}负 不败${((w+d)/games*100).toFixed(0)}% | 逐轮[${roundAcc.map(v => (v/games).toFixed(2)).join(',')}] | 银狙礼物${gifts.length}次→金猴${golden}(${gifts.length?(golden/gifts.length*100).toFixed(0):'-'}%)`);
    }
  }
}

main();
