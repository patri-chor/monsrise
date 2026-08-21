// ============================================================
// run_l2_eval.ts —— 轻量 L2 胜率评测
// 用法：npx vite-node --script src/engine/tree/product_training/run_l2_eval.ts [--target golden_boom] [--games 5]
// 输出：目标阵型 vs 其余 10 个 T0 冻结源的 score70（L2 得分标准）与逐对手 breakdown
// ============================================================
import '../../env';
import { loadCurrentStrong11Opponents } from './benchmark_pools';
import {
  evaluateFormationAgainstPool,
  normalizeToEvalSpec,
  type EvalOpponentSpec,
} from './eval_engine';

function parseArgs(): { targetId: string; games: number } {
  const args = process.argv.slice(2);
  const targetId = args.find(a => a.startsWith('--target='))?.split('=')[1] ?? 'golden_boom';
  const games = parseInt(args.find(a => a.startsWith('--games='))?.split('=')[1] ?? '5', 10);
  return { targetId, games };
}

function main() {
  const { targetId, games } = parseArgs();
  const { opponents, members } = loadCurrentStrong11Opponents();

  const targetFormation = opponents.find(o => (o as any).id === targetId);
  if (!targetFormation) {
    console.error(`目标阵型 ${targetId} 不在 11 个 T0 冻结源中。可用: ${opponents.map(o => (o as any).id).join(', ')}`);
    process.exit(1);
  }

  const target = normalizeToEvalSpec(targetFormation as any);
  const restOpponents: EvalOpponentSpec[] = opponents
    .filter(o => (o as any).id !== targetId)
    .map(o => normalizeToEvalSpec(o as any) as EvalOpponentSpec);

  console.log(`\n=== L2 评测: ${target.name} (${target.id}) vs ${restOpponents.length} 个 T0 冻结源 ===`);
  console.log(`  每对手 ${games}局/side（共 ${games * 2}局/对手），总 ${games * 2 * restOpponents.length} 局\n`);

  const result = evaluateFormationAgainstPool(target, restOpponents, games, 100000);

  console.log(`  总分: W${result.w} / D${result.d} / L${result.l}  (共 ${result.totalGames} 局)`);
  console.log(`  纯胜率: ${(result.winRate * 100).toFixed(1)}%`);
  console.log(`  不败率(胜+平): ${(result.noLossRate * 100).toFixed(1)}%`);
  console.log(`  L2 score70 (胜+0.7平): ${(result.score70 * 100).toFixed(1)}%`);
  console.log(`  侧1: W${result.side1Stats.w}/D${result.side1Stats.d}/L${result.side1Stats.l} | 侧2: W${result.side2Stats.w}/D${result.side2Stats.d}/L${result.side2Stats.l}`);
  console.log(`\n  逐对手 breakdown:`);
  for (const opp of restOpponents) {
    const b = result.opponentBreakdown[opp.id];
    if (!b) continue;
    console.log(
      `    ${opp.id.padEnd(18)} W${b.w}/D${b.d}/L${b.l}  score70=${(b.score70 * 100).toFixed(1)}%`,
    );
  }
  console.log('');
}

main();
