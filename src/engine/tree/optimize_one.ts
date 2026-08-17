// ============================================================
// 单阵型优化（optimize one）—— 独立进程运行，结果保存到独立文件
//
// 用途：cycle_optimize 并行启动多个本脚本（每个阵型一个进程），
//   各自优化、结果隔离到 reports/optimized/{id}.json，互不干扰。
//   全部跑完后由 apply_optimized 统一覆盖回 formation_library。
//
// 运行：npx vite-node --script src/engine/tree/optimize_one.ts [阵型名] [分支归纳局数]
// ============================================================

import '../env';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { FORMATION_LIBRARY } from '../../ai/formation_library';
import { optimizeFormation } from './branch_induct';
import { writeSingleRoundDecisionLog } from './decision_log';
import { evalVsEarly } from './eval_vs_early';
import { formationToEvol } from './evol_gene';

function loadBundle(): any {
  const w = globalThis as any;
  const code = readFileSync(resolve('public/ai-bundle.iife.js'), 'utf8');
  const factory = new Function('window', 'globalThis', '"use strict";\n' + code + '\n;return BattleAI;');
  const b = factory(w, w);
  return b?.BattleAI ?? w.BattleAI;
}

function main(): void {
  const name = process.argv[2];
  const gamesPerOpp = Number(process.argv[3] || 5);
  const ebGames = Number(process.argv[4] || 12); // vs 早期 bundle 局数

  const BundleAI = loadBundle();
  const src = FORMATION_LIBRARY.find(f => f.name === name);
  if (!src) { console.error(`阵型不存在: ${name}`); process.exit(1); }

  const t0 = Date.now();
  const candidate = formationToEvol(src);
  console.log(`\n[优化单阵型] ${src.name} 先手+后手 vs 全部 ${FORMATION_LIBRARY.length} 阵型（${gamesPerOpp}局/对手/侧）开始...`);

  // 优化前：vs 早期 bundle 基线（不变基准）
  let beforeEb: { w: number; d: number; l: number; undefeated: number; winRate: number } | null = null;
  try {
    beforeEb = evalVsEarly(candidate, ebGames);
    console.log(`[EB基线] ${src.name} vs 早期bundle 不败率 ${(beforeEb.undefeated * 100).toFixed(1)}%（${beforeEb.w}胜${beforeEb.d}平${beforeEb.l}负，${ebGames}局）`);
  } catch (e) {
    console.error(`[EB基线] 评估失败: ${(e as Error).message}`);
  }

  let result: any;
  try {
    result = optimizeFormation(BundleAI, src, gamesPerOpp);
  } catch (e) {
    console.error(`[优化单阵型] ${src.name} 异常: ${(e as Error).message}`);
    result = null;
  }

  const ms = Date.now() - t0;
  const improved = result?.improved === true;
  const optimized = result?.optimized ?? null;

  // 优化后：vs 早期 bundle
  let afterEb: { w: number; d: number; l: number; undefeated: number; winRate: number } | null = null;
  if (improved && optimized) {
    try {
      afterEb = evalVsEarly(optimized, ebGames);
      const delta = beforeEb ? (afterEb.undefeated - beforeEb.undefeated) : 0;
      console.log(`[EB验收] ${src.name} vs 早期bundle 不败率 ${(afterEb.undefeated * 100).toFixed(1)}%（${delta >= 0 ? '+' : ''}${(delta * 100).toFixed(1)}%）`);
    } catch (e) {
      console.error(`[EB验收] 评估失败: ${(e as Error).message}`);
    }
  }

  const outPath = resolve(`reports/optimized/${src.id}.json`);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify({
    type: 'optimize_one_result',
    id: src.id,
    name: src.name,
    gamesPerOpp,
    ebGames,
    elapsedMs: ms,
    improved,
    maskLabel: result?.maskLabel ?? null,
    forkRound: result?.forkRound ?? null,
    before: result?.before ?? null,
    after: result?.after ?? null,
    beforeEb,
    afterEb,
    // 优化后的完整阵型（EvolFormation：team + root，含 condition）
    formation: improved && optimized
      ? { name: optimized.name, archetype: optimized.archetype, team: optimized.team, tree: optimized.root }
      : null,
  }, null, 2));

  console.log(`[优化单阵型] ${src.name} 完成（${(ms / 1000).toFixed(0)}s）：${improved ? `采纳「${result.maskLabel}」@R${result.forkRound}` : '未采纳改进（保持原阵型）'}`);
  console.log(`[优化单阵型] 结果已保存 → ${outPath}`);

  // 优化不了 → 生成先手+后手两份单分决策日志，交用户手动决策
  if (!improved) {
    try {
      const p1 = `reports/decisions/${src.name}_先手.md`;
      const p2 = `reports/decisions/${src.name}_后手.md`;
      writeSingleRoundDecisionLog(BundleAI, src, 1, 4, p1);
      writeSingleRoundDecisionLog(BundleAI, src, 2, 4, p2);
      console.log(`[优化单阵型] 单分决策日志已输出 → ${p1}、${p2}`);
    } catch (e) {
      console.error(`[优化单阵型] 决策日志生成失败: ${(e as Error).message}`);
    }
  }
}

main();
