// 临时 smoke：验证 public bundle 的 buildTeam(全怪兽) / decide 无头调用是否抛异常（人机对战入口流程）
import '../env';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DB_MONSTERS } from '../../game/Database';

const w = globalThis as any;
const code = readFileSync(resolve('public/ai-bundle.iife.js'), 'utf8');
const factory = new Function('window', 'globalThis', '"use strict";\n' + code + '\n;return BattleAI;');
const B = factory(w, w)?.BattleAI ?? w.BattleAI;

if (!B) { console.log('SMOKE FAIL: BattleAI 未找到'); process.exit(1); }

try {
  const ai = new B();
  ai.setDifficulty('normal');
  const hand = DB_MONSTERS.filter(m => !m.isSummon).map(m => ({ monsterId: m.id, badgeIds: [] }));
  console.log(`SMOKE: 手牌 ${hand.length} 张`);
  const r = ai.buildTeam(hand);
  console.log(`SMOKE OK: 选卡 ${r.cards.length} 张, 阵型=${r.formationName} score=${r.matchScore}`);
  console.log('cards:', JSON.stringify(r.cards.map(c => c.monsterId)));
} catch (e) {
  console.log('SMOKE ERROR:', (e as Error).message);
  console.log((e as Error).stack?.split('\n').slice(0, 6).join('\n'));
}
