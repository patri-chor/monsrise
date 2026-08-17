// ============================================================
// T005 — Existing Formation Tree Decision Cycle Runner
//
// 目的：在真实既有阵型上验证观测驱动决策树优化器，
// 顺序执行 smoke 评估与候选生成，产物严格隔离输出到 reports/tree-cycle/。
// 绝不调用 apply_optimized.ts，绝不污染 FORMATION_LIBRARY。
// ============================================================

import '../env';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { FORMATION_LIBRARY } from '../../ai/formation_library';
import { optimizeFormation } from './branch_induct';
import { formationToEvol } from './evol_gene';
import { evalVsEarly } from './eval_vs_early';
import { computeTreeFingerprint } from './search_experience';

export interface TreeCycleCandidateResult {
  id: string;
  name: string;
  archetype: string;
  hasExistingBranch: boolean;
  baseTreeFingerprint: string;
  optimizedTreeFingerprint: string | null;
  improved: boolean;
  verdict: 'ADOPTED' | 'NO_OP_UNIMPROVED' | 'NO_OP_NO_BRANCH';
  forkRound: number | null;
  maskLabel: string | null;
  triggerCoverage: {
    matched: number;
    totalObserved: number;
    coverageRate: number;
  } | null;
  untriggeredReasons: {
    prematureEnd: number;
    noHand: number;
    maskMismatch: number;
  } | null;
  validation: {
    searchSeedBase: number;
    validationSeedBase: number;
    gamesPerOpp: number;
    before: { win: number; draw: number; loss: number; undefeated: number };
    after: { win: number; draw: number; loss: number; undefeated: number };
    undefeatedDelta: number;
    lossDelta: number;
  } | null;
  baselineVsEarly: {
    before: { w: number; d: number; l: number; undefeated: number } | null;
    after: { w: number; d: number; l: number; undefeated: number } | null;
  };
  appliedToLibrary: false;
  formationCandidate: any | null;
  elapsedMs: number;
}

export interface TreeCycleRunOptions {
  targets?: string[]; // 阵型名称列表
  gamesPerOpp?: number;
  ebGames?: number;
  outDir?: string;
}

export function loadBundleAI(): any {
  const w = globalThis as any;
  const code = readFileSync(resolve('public/ai-bundle.iife.js'), 'utf8');
  const factory = new Function('window', 'globalThis', '"use strict";\n' + code + '\n;return BattleAI;');
  const b = factory(w, w);
  return b?.BattleAI ?? w.BattleAI;
}

export async function runTreeCycle(options: TreeCycleRunOptions = {}): Promise<TreeCycleCandidateResult[]> {
  const BundleAI = loadBundleAI();
  const gamesPerOpp = options.gamesPerOpp ?? 3;
  const ebGames = options.ebGames ?? 10;
  const outDir = resolve(options.outDir ?? 'reports/tree-cycle');

  if (!existsSync(outDir)) {
    mkdirSync(outDir, { recursive: true });
  }

  // 默认 Smoke 阵型：1 个已有分支（礼物救星），1 个无条件分支（全二冲）
  const targetNames = options.targets && options.targets.length > 0
    ? options.targets
    : ['礼物救星', '全二冲'];

  console.log(`\n=== 开始执行 T005 既有阵型决策树优化周期 (Targets: ${targetNames.join(', ')}, Games/Opp: ${gamesPerOpp}, Output: ${outDir}) ===\n`);

  const results: TreeCycleCandidateResult[] = [];

  for (const name of targetNames) {
    const src = FORMATION_LIBRARY.find(f => f.name === name);
    if (!src) {
      console.warn(`[TreeCycle] 阵型 '${name}' 未在 FORMATION_LIBRARY 找到，跳过。`);
      continue;
    }

    const t0 = Date.now();
    const evol = formationToEvol(src);
    const baseFp = computeTreeFingerprint(evol);
    const hasBranch = !!(evol.root && evol.root.condition);

    console.log(`------------------------------------------------------------`);
    console.log(`[评估阵型] ${src.name} (已有分支: ${hasBranch ? '是' : '否'}, BaseFingerprint: ${baseFp})`);

    // 基线 vs Early Bundle
    let beforeEb: { w: number; d: number; l: number; undefeated: number } | null = null;
    try {
      beforeEb = evalVsEarly(evol, ebGames);
      console.log(`  [EB基线] 不败率 ${(beforeEb.undefeated * 100).toFixed(1)}% (${beforeEb.w}胜/${beforeEb.d}平/${beforeEb.l}负, ${ebGames}局)`);
    } catch (e) {
      console.warn(`  [EB基线] 评估跳过或失败: ${(e as Error).message}`);
    }

    // 运行观测驱动优化
    let optResult: any = null;
    try {
      optResult = optimizeFormation(BundleAI, src, gamesPerOpp);
    } catch (e) {
      console.error(`  [优化异常] ${src.name}: ${(e as Error).message}`);
    }

    const elapsedMs = Date.now() - t0;
    const improved = optResult?.improved === true;
    const optEvol = optResult?.optimized ?? null;
    const optFp = optEvol ? computeTreeFingerprint(optEvol) : null;

    let afterEb: { w: number; d: number; l: number; undefeated: number } | null = null;
    if (improved && optEvol) {
      try {
        afterEb = evalVsEarly(optEvol, ebGames);
        console.log(`  [EB验收] 优化后不败率 ${(afterEb.undefeated * 100).toFixed(1)}% (${afterEb.w}胜/${afterEb.d}平/${afterEb.l}负)`);
      } catch (e) {
        console.warn(`  [EB验收] 评估跳过或失败: ${(e as Error).message}`);
      }
    }

    let verdict: 'ADOPTED' | 'NO_OP_UNIMPROVED' | 'NO_OP_NO_BRANCH' = 'NO_OP_NO_BRANCH';
    if (improved) {
      verdict = 'ADOPTED';
    } else if (optResult && optResult.forkRound) {
      verdict = 'NO_OP_UNIMPROVED';
    }

    const valData = optResult?.searchValidation;
    const beforeVal = optResult?.before;
    const afterVal = optResult?.after;

    const candidateResult: TreeCycleCandidateResult = {
      id: src.id,
      name: src.name,
      archetype: src.archetype,
      hasExistingBranch: hasBranch,
      baseTreeFingerprint: baseFp,
      optimizedTreeFingerprint: optFp,
      improved,
      verdict,
      forkRound: optResult?.forkRound ?? null,
      maskLabel: optResult?.maskLabel ?? null,
      triggerCoverage: valData?.triggerCoverage ?? null,
      untriggeredReasons: valData?.untriggeredReasons ?? null,
      validation: (beforeVal && afterVal) ? {
        searchSeedBase: valData?.searchSeedBase ?? 0,
        validationSeedBase: valData?.validationSeedBase ?? 0,
        gamesPerOpp,
        before: beforeVal,
        after: afterVal,
        undefeatedDelta: afterVal.undefeated - beforeVal.undefeated,
        lossDelta: afterVal.loss - beforeVal.loss,
      } : null,
      baselineVsEarly: {
        before: beforeEb,
        after: afterEb,
      },
      appliedToLibrary: false,
      formationCandidate: improved && optEvol ? {
        name: optEvol.name,
        archetype: optEvol.archetype,
        team: optEvol.team,
        tree: optEvol.root,
      } : null,
      elapsedMs,
    };

    results.push(candidateResult);

    // 独立持久化该阵型产物至 reports/tree-cycle/{id}.json
    const outJsonPath = join(outDir, `${src.id}.json`);
    writeFileSync(outJsonPath, JSON.stringify(candidateResult, null, 2), 'utf8');
    console.log(`  -> 结果已保存至: ${outJsonPath}`);
  }

  // 生成 summary.md
  generateSummaryMarkdown(results, outDir, { gamesPerOpp, ebGames });

  return results;
}

function generateSummaryMarkdown(
  results: TreeCycleCandidateResult[],
  outDir: string,
  meta: { gamesPerOpp: number; ebGames: number }
): void {
  const lines: string[] = [
    '# T005 既有阵型决策树优化周期结果汇总 (Tree Cycle Summary)',
    '',
    `> 运行时间: ${new Date().toISOString()}`,
    `> 配置: 每对手局数 ${meta.gamesPerOpp}, vs Early基线局数 ${meta.ebGames}`,
    `> 产物隔离目录: \`${outDir}\``,
    `> 活跃库保护状态: \`FORMATION_LIBRARY\` 100% 未修改 (appliedToLibrary: false)`,
    '',
    '## 1. 阵型优化与验证结果清单',
    '',
    '| 阵型名称 | 原有分支 | 拟分叉回合 | 标签 / 掩码 | 触发覆盖率 | 验证集不败率 (前→后) | 门禁判定 | 耗时 |',
    '|---|---|---|---|---|---|---|---|',
  ];

  for (const r of results) {
    const origBranch = r.hasExistingBranch ? '有' : '无';
    const fork = r.forkRound ? `R${r.forkRound}` : '-';
    const label = r.maskLabel ?? '-';
    const cov = r.triggerCoverage
      ? `${r.triggerCoverage.matched}/${r.triggerCoverage.totalObserved} (${(r.triggerCoverage.coverageRate * 100).toFixed(0)}%)`
      : '-';
    const val = r.validation
      ? `${(r.validation.before.undefeated * 100).toFixed(0)}% → ${(r.validation.after.undefeated * 100).toFixed(0)}% (${r.validation.undefeatedDelta >= 0 ? '+' : ''}${(r.validation.undefeatedDelta * 100).toFixed(0)}%)`
      : '-';
    const verdictLabel = r.verdict === 'ADOPTED'
      ? '✅ 采纳 (+5% 达标)'
      : r.verdict === 'NO_OP_UNIMPROVED'
        ? '⏸️ 未达标 (合法 No-op)'
        : '⏸️ 无分支候选 (No-op)';
    const sec = `${(r.elapsedMs / 1000).toFixed(1)}s`;

    lines.push(`| ${r.name} | ${origBranch} | ${fork} | ${label} | ${cov} | ${val} | ${verdictLabel} | ${sec} |`);
  }

  lines.push('');
  lines.push('## 2. 详细触发与未触发诊断 (Trigger Diagnostics)');
  lines.push('');

  for (const r of results) {
    lines.push(`### ${r.name} (${r.id})`);
    lines.push(`- **Base Tree Fingerprint**: \`${r.baseTreeFingerprint}\``);
    if (r.optimizedTreeFingerprint) {
      lines.push(`- **Optimized Tree Fingerprint**: \`${r.optimizedTreeFingerprint}\``);
    }
    lines.push(`- **Verdict**: \`${r.verdict}\` (Improved: \`${r.improved}\`)`);
    if (r.untriggeredReasons) {
      lines.push(`- **未触发原因分布**: 提前结束对局 \`${r.untriggeredReasons.prematureEnd}\` 局，无手牌观测 \`${r.untriggeredReasons.noHand}\` 局，掩码不匹配 \`${r.untriggeredReasons.maskMismatch}\` 局`);
    }
    if (r.baselineVsEarly.before) {
      const b = r.baselineVsEarly.before;
      lines.push(`- **Early Bundle Baseline (Before)**: 不败率 ${(b.undefeated * 100).toFixed(1)}% (${b.w}胜 / ${b.d}平 / ${b.l}负)`);
    }
    if (r.baselineVsEarly.after) {
      const a = r.baselineVsEarly.after;
      lines.push(`- **Early Bundle Baseline (After)**: 不败率 ${(a.undefeated * 100).toFixed(1)}% (${a.w}胜 / ${a.d}平 / ${a.l}负)`);
    }
    lines.push('');
  }

  const summaryPath = join(outDir, 'summary.md');
  writeFileSync(summaryPath, lines.join('\n'), 'utf8');
  console.log(`\n[TreeCycle] 汇总报告已生成: ${summaryPath}`);
}

// CLI 执行
if (process.argv[1] && process.argv[1].endsWith('tree_cycle_runner.ts')) {
  const args = process.argv.slice(2);
  const isSmoke = args.includes('--smoke');
  const targets = isSmoke ? ['礼物救星', '全二冲'] : (args.length > 0 && !args[0].startsWith('--') ? [args[0]] : ['礼物救星', '全二冲']);
  const games = Number(args.find(a => a.startsWith('--games='))?.split('=')[1] ?? 3);

  runTreeCycle({ targets, gamesPerOpp: games }).catch(e => {
    console.error(e);
    process.exit(1);
  });
}
