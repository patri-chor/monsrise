// ============================================================
// _probe_recognition.ts —— 验证梯子塞雷/经典救星 对金猴(祷徒)的识别
// 直接调 recognizeOpponent + 手动走 selectBranch 逻辑
// 运行：npx vite-node --script src/engine/tree/product_training/_probe_recognition.ts
// ============================================================
import '../../env';
import { loadCurrentStrong11Opponents } from './benchmark_pools';
import { formationToEvol } from '../evol_gene';

// 从 bundle 的 FormationEngine 拿识别逻辑（public/ai-bundle.iife.js）
const fs = require('node:fs') as typeof import('node:fs');
const code = fs.readFileSync('D:/develope/对战ai/public/ai-bundle.iife.js', 'utf8');
const w = globalThis as any;
const factory = new Function('window', 'globalThis', '"use strict";\n' + code + '\n;return BattleAI;');
const ex = factory(w, w);
const BundleAI = ex?.BattleAI ?? w.BattleAI;

// 找 FormationEngine
const ai = new BundleAI();
const fe = (ai as any).pipeline?.getFormationEngine?.();
const feProto = fe ? Object.getPrototypeOf(fe) : null;
let recognize = (feProto as any)?.recognizeOpponent;
if (typeof recognize !== 'function') {
  // 尝试 static
  recognize = (fe?.constructor as any)?.recognizeOpponent ?? (fe as any)?.constructor?.recognizeOpponent;
}
if (typeof recognize !== 'function') {
  console.log('recognizeOpponent 未找到，尝试全局');
  recognize = (w as any).recognizeOpponent;
}
console.log('recognizeOpponent 类型:', typeof recognize);

function main() {
  const { opponents } = loadCurrentStrong11Opponents();
  const golden = opponents.find(o => (o as any).id === 'golden_boom') as any;

  console.log('\n=== 金猴(golden_boom) 手牌/徽章 ===');
  const team = golden.team as { monsterId: number; badgeIds: number[] }[];
  console.log('手牌:', team.map(t => t.monsterId).join(','));
  console.log('徽章:', [...new Set(team.flatMap(t => t.badgeIds))].join(','));

  // 构造识别输入（bundle 的 recognizeOpponent 需要什么？看签名）
  // 尝试几种调用
  const handIds = new Set(team.map(t => t.monsterId));
  const handBadges = new Set(team.flatMap(t => t.badgeIds));
  const boardIds = new Set<number>();

  for (const [side, fei] of [['梯子塞雷(laddersel)', 'laddersel'], ['经典救星(classicsavior)', 'classicsavior'], ['全二冲(all2rush)', 'all2rush']]) {
    const opp = opponents.find(o => (o as any).id === fei) as any;
    console.log(`\n=== ${side} 识别 金猴 ===`);
    // 用该阵型的 FormationEngine 实例
    const aiX = new BundleAI();
    aiX.buildTeam(opp.team);
    const feX = (aiX as any).pipeline?.getFormationEngine?.();
    const rec = (feX?.constructor as any)?.recognizeOpponent?.(handIds, handBadges, boardIds);
    console.log('识别结果:', rec);
    // 找该阵型 R1 分支并手动 match
    if (feX) {
      try {
        const f = (feX as any).getSelectedFormation?.();
        const tree = f?.tree ?? (opp as any).tree;
        const branches = tree?.children ?? [];
        console.log('R1 分支:', branches.map((b: any) => `${b.id}:${b.label}`).join(' | '));
      } catch (e) {
        console.log('读分支失败:', (e as Error).message);
      }
    }
  }
}

main();
