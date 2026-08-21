// ============================================================
// 礼物金猴 —— 银狙死亡瞬间的完整友方分布观测
// 目标：搞清银狙死亡时，各友方与银狙的距离，为什么礼物给错对象。
// 输出：每次银狙死亡 → 银狙坐标 + 全部存活友方(坐标,距离平方,id)
// 运行：npx vite-node --script src/engine/tree/_gift_check.ts [games]
// ============================================================

import '../env';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { battleSystem } from '../../game/BattleSystem';
import { registerAllBadges } from '../../game/BadgeSystem';
import { gameEngine } from '../../game/GameEngine';
import { FORMATION_LIBRARY } from '../../ai/formation_library';
import { formationToEvol } from './evol_gene';
import { playSpecVsSpec } from './arena';

registerAllBadges();

function loadBundle(): any {
  const w = globalThis as any;
  const code = readFileSync(resolve('public/ai-bundle.iife.js'), 'utf8');
  const factory = new Function('window', 'globalThis', '"use strict";\n' + code + '\n;return BattleAI;');
  const b = factory(w, w);
  return b?.BattleAI ?? w.BattleAI;
}

const MONSTER_NAME: Record<number, string> = {
  101: '剑士', 102: '祭祀', 103: '学徒', 105: '祈祷', 106: '冲锋', 107: '咒法',
  109: '银狙', 110: '帝国', 113: '矿爆', 114: '突突', 116: '钻头', 117: '铁甲',
  118: '忍猴', 119: '忍猴', 120: '金猴', 124: '三振', 125: '战壕', 126: '祭司',
};
const nm = (id: number) => MONSTER_NAME[id] ?? String(id);

function main(): void {
  const games = Number(process.argv[2] || 2);
  const BundleAI = loadBundle();
  const candidate = formationToEvol(FORMATION_LIBRARY.find(f => f.name === '礼物金猴')!);
  const prayerTarget = FORMATION_LIBRARY.find(f => f.name === '泉水剑')!;

  const orig = battleSystem.findClosestAlly.bind(battleSystem);
  let deathNo = 0;
  battleSystem.findClosestAlly = ((m: any) => {
    const ally = orig(m);
    if (m.dbId === 109) {
      deathNo++;
      console.log(`\n[银狙死亡 #${deathNo}] 银狙@(${m.gridX},${m.gridY}) atk=${m.atk} team=${m.team}`);
      const allies = gameEngine.boardMonsters
        .filter(a => a.team === m.team && !a.isDead && a.id !== m.id)
        .map(a => ({ id: a.dbId, pos: `(${a.gridX},${a.gridY})`, d2: (a.gridX - m.gridX) ** 2 + (a.gridY - m.gridY) ** 2 }))
        .sort((a, b) => a.d2 - b.d2);
      for (const a of allies) {
        console.log(`    ${nm(a.id)}@${a.pos} dist²=${a.d2}${a.d2 === Math.min(...allies.map(x => x.d2)) ? ' ← 最近' : ''}`);
      }
      console.log(`    → 礼物实际给了 ${ally ? nm(ally.dbId) + '@(' + ally.gridX + ',' + ally.gridY + ')' : '无'}`);
    }
    return ally;
  }) as any;

  for (let i = 0; i < games; i++) {
    const aSide: 1 | 2 = i % 2 === 0 ? 1 : 2;
    const r = playSpecVsSpec(
      BundleAI,
      { kind: 'evol', f: candidate },
      { kind: 'native', f: prayerTarget },
      aSide, 5000 + i,
    );
    console.log(`[对局${i + 1} side${aSide}] ${r.w}胜/${r.d}平/${r.l}负 ${r.summary}`);
  }
}

main();
