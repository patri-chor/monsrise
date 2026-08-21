// ============================================================
// 礼物金猴 —— 分支构建 + 验证
// 用户定案：
//   - 面对全冲(fullrush)：上钻头(116)反制咒法(107)
//   - 面对祷徒(prayer)：上银狙(109)礼物徽章33，死亡给金猴+90攻击
//   - 关键指标：金猴(120)能否吃到礼物（检查攻击力加成）
//
// 结构：礼物金猴 8 怪 18 费 > 16 预算，钻头/银狙不能同路径，
//   故在 R3（银狙上场回合）分叉：
//     主分支(空条件,兜底=祷徒等) → R3 银狙(109)
//     全冲分支(main=fullrush)   → R3 钻头(116)替换银狙
//
// 运行：npx vite-node --script src/engine/tree/golden_branch.ts [games]
// ============================================================

import '../env';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { battleSystem } from '../../game/BattleSystem';
import { registerAllBadges } from '../../game/BadgeSystem';
import { gameEngine } from '../../game/GameEngine';
import { FORMATION_LIBRARY } from '../../ai/formation_library';
import type { EvolFormation } from './evol_gene';
import { formationToEvol, summarizeEvolFormation, walkEvolNodes } from './evol_gene';
import { playSpecVsSpec, type SideSpec } from './arena';

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
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MONSTER_NAME: Record<number, string> = {
  101: '剑士', 102: '祭祀', 103: '学徒', 105: '祈祷', 106: '冲锋', 107: '咒法',
  109: '银狙', 110: '帝国', 113: '矿爆', 114: '突突', 116: '钻头', 117: '铁甲',
  118: '忍猴', 119: '忍猴', 120: '金猴', 124: '三振', 125: '战壕', 126: '祭司',
};
const nm = (id: number) => MONSTER_NAME[id] ?? String(id);

/**
 * 读取礼物金猴分支（已写回 formation_library）：
 *   - 主链(空条件) → R3 银狙(109)@(8,0)（礼物给金猴）
 *   - fullrush 分支(label"对方是全冲"→main=fullrush) → R3 钻头(116)（反制咒法）
 */
function buildGoldenBranch(): EvolFormation {
  const src = FORMATION_LIBRARY.find(f => f.name === '礼物金猴')!;
  return formationToEvol(src);
}

function main(): void {
  const games = Number(process.argv[2] || 6);
  const BundleAI = loadBundle();
  const branched = buildGoldenBranch();
  console.log('=== 礼物金猴分支结构 ===');
  console.log(summarizeEvolFormation(branched));
  console.log('');

  // 对手：全二冲（fullrush）、泉水剑（prayer）
  const fullrushTarget = FORMATION_LIBRARY.find(f => f.name === '全二冲')!;
  const prayerTarget = FORMATION_LIBRARY.find(f => f.name === '泉水剑')!;

  // 礼物指标：monkey-patch findClosestAlly，记录银狙死亡时礼物给了谁 + 加攻值
  const orig = battleSystem.findClosestAlly.bind(battleSystem);
  const giftLog: { toId: number; goldenGot: boolean; atk: number; giftAtk: number }[] = [];
  battleSystem.findClosestAlly = ((m: any) => {
    const ally = orig(m);
    if (m.dbId === 109) {
      const giftAtk = Math.round(m.atk * 0.3);
      giftLog.push({ toId: ally ? ally.dbId : -1, goldenGot: ally?.dbId === 120, atk: m.atk, giftAtk });
    }
    return ally;
  }) as any;

  const spec: SideSpec = { kind: 'evol', f: branched };

  function runTarget(label: string, target: any, seedBase: number): void {
    console.log(`\n=== vs ${label}（${games} 局 × 先/后手） ===`);
    const before = giftLog.length;
    let w = 0, d = 0, l = 0;
    for (let i = 0; i < games; i++) {
      const aSide: 1 | 2 = i % 2 === 0 ? 1 : 2;
      const r = playSpecVsSpec(BundleAI, spec, { kind: 'native', f: target }, aSide, seedBase + i);
      w += r.w; d += r.d; l += r.l;
    }
    const total = w + d + l;
    console.log(`战绩: ${w}胜/${d}平/${l}负 不败率 ${((w + d) / total * 100).toFixed(0)}%`);
    const gifts = giftLog.slice(before);
    const goldenGot = gifts.filter(g => g.goldenGot).length;
    console.log(`银狙死亡触发礼物 ${gifts.length} 次，金猴吃到 ${goldenGot} 次 (${gifts.length ? (goldenGot / gifts.length * 100).toFixed(0) : '-'}%)`);
    if (gifts.length > 0) {
      const by = new Map<number, number>();
      for (const g of gifts) by.set(g.toId, (by.get(g.toId) ?? 0) + 1);
      console.log(`  去向: ${[...by.entries()].map(([id, n]) => `${nm(id)}×${n}`).join(', ')}`);
      // 金猴吃到时的攻击力加成（关键指标）
      const goldenGifts = gifts.filter(g => g.goldenGot);
      if (goldenGifts.length > 0) {
        const atks = goldenGifts.map(g => g.atk);
        const adds = goldenGifts.map(g => g.giftAtk);
        console.log(`  金猴吃礼物时：银狙攻击力 [${[...new Set(atks)].join(', ')}] → 加攻 [${[...new Set(adds)].join(', ')}]（金猴48→${48 + Math.max(...adds)}）`);
      }
    }
  }

  runTarget('全二冲(fullrush)', fullrushTarget, 6000);
  runTarget('泉水剑(prayer)', prayerTarget, 7000);
}

main();
