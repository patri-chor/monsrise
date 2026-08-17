// ============================================================
// 应用优化结果 v2（apply optimized）—— 覆盖 + 自动剪枝 + 重跑胜率表
//
// 流程（用户定案）：
//   1. 读 reports/optimized/*.json 里 improved 的阵型
//   2. 每个改进阵型先做后剪枝（删冗余分支，先手+后手全局不败率判据）
//   3. EvolFormation → Formation 转回，覆盖写回 formation_library.ts
//   4. 重跑全对阵胜率表（reports/胜率表格.md 固定更新）
//   5. 更新 cycle_state.json（optCount+1，lastWinrate=新胜率）
//
// 运行：npx vite-node --script src/engine/tree/apply_optimized.ts [--dry] [--prune-games N] [--matrix-games N] [--worker N]
// ============================================================

import '../env';
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { registerAllBadges } from '../../game/BadgeSystem';
import { FORMATION_LIBRARY } from '../../ai/formation_library';
import type { Formation } from '../../ai/types';
import type { EvolFormation, EvolNode, FeatureMask } from './evol_gene';
import { maskToLabel } from './evol_gene';
import { pruneFormation } from './prune';
import { fullMatrixEvaluate } from './round_robin';
import { writeMatrixReports, loadCycleState, saveCycleState } from './winrate_matrix';

registerAllBadges();

// ---------- 从 optimize_one 保存的 JSON 恢复 EvolFormation ----------

function reviveNode(raw: any): EvolNode {
  const cond: FeatureMask = {
    side: raw.condition?.side ?? null,
    main: raw.condition?.main ?? null,
    subs: raw.condition?.subs ?? [],
    keys: raw.condition?.keys ?? [],
  };
  return {
    id: raw.id,
    round: raw.round,
    condition: cond,
    placements: (raw.placements ?? []).map((p: any) => ({ monsterId: p.monsterId, x: p.x, y: p.y })),
    children: (raw.children ?? []).map((c: any) => reviveNode(c)),
  };
}

function reviveFormation(raw: any): EvolFormation {
  return {
    name: raw.name ?? 'optimized',
    archetype: raw.archetype ?? 'half_rush',
    team: (raw.team ?? []).map((s: any) => ({ monsterId: s.monsterId, badgeIds: [...(s.badgeIds ?? [])] })),
    root: reviveNode(raw.tree ?? raw.root),
  };
}

// ---------- EvolFormation → Formation（condition → label） ----------

function toFormation(src: Formation, evolved: EvolFormation): Formation {
  const badgeOf = (monsterId: number) => evolved.team.find(s => s.monsterId === monsterId)?.badgeIds ?? [];
  const toTree = (n: EvolNode): any => ({
    id: n.id,
    round: n.round,
    label: maskToLabel(n.condition),
    comment: '',
    placement: n.placements.map(p => ({ monsterId: p.monsterId, badgeIds: badgeOf(p.monsterId), x: p.x, y: p.y })),
    children: n.children.map(toTree),
  });
  return {
    ...src,
    archetype: evolved.archetype,
    team: evolved.team.map(s => ({ monsterId: s.monsterId, badgeIds: [...s.badgeIds] })),
    tree: toTree(evolved.root),
  };
}

function loadBundle(): any {
  const w = globalThis as any;
  const code = readFileSync(resolve('public/ai-bundle.iife.js'), 'utf8');
  const factory = new Function('window', 'globalThis', '"use strict";\n' + code + '\n;return BattleAI;');
  const b = factory(w, w);
  return b?.BattleAI ?? w.BattleAI;
}

// ---------- 主流程 ----------

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const dry = argv.includes('--dry');
  const pickArg = (name: string, def: number) => {
    const i = argv.indexOf(name);
    return i >= 0 && argv[i + 1] ? Number(argv[i + 1]) : def;
  };
  const pruneGames = pickArg('--prune-games', 2);   // 剪枝每对手局数（低局数够判断「不降」）
  const matrixGames = pickArg('--matrix-games', 10); // 胜率表每配对每侧局数（至少 10）
  const workerArg = pickArg('--worker', 0);

  const optDir = resolve('reports/optimized');
  if (!existsSync(optDir)) {
    console.error('reports/optimized/ 不存在，先运行 cycle_optimize。');
    process.exit(1);
  }

  const files = readdirSync(optDir).filter(f => f.endsWith('.json'));
  const allResults = files.map(f => JSON.parse(readFileSync(resolve(optDir, f), 'utf8')));
  const improvedMap = new Map<string, any>();
  for (const r of allResults) {
    if (r.improved && r.formation) improvedMap.set(r.id, r.formation);
  }

  if (improvedMap.size === 0) {
    console.log('没有 improved 的阵型，无需覆盖。');
    process.exit(0);
  }

  console.log(`将覆盖 ${improvedMap.size} 个改进阵型（先剪枝再覆盖）：`);

  const BundleAI = loadBundle();
  const pruneReport: string[] = [];

  const newLib: Formation[] = FORMATION_LIBRARY.map(src => {
    const opt = improvedMap.get(src.id);
    if (!opt) return src;
    const evolved = reviveFormation(opt);
    // 后剪枝（先手+后手全局不败率判据）
    const pr = pruneFormation(BundleAI, evolved, pruneGames);
    pruneReport.push(`### ${src.name}`);
    pruneReport.push(...pr.log.map(l => `- ${l}`));
    pruneReport.push('');
    const newF = toFormation(src, pr.pruned);
    console.log(`  ✓ ${src.name}（${src.id}）剪枝 ${pr.prunedCount} 个冗余分支`);
    return newF;
  });

  if (dry) {
    console.log('\n[dry] 未写文件、未剪枝覆盖、未跑胜率表。');
    return;
  }

  // 写回 monsrise1 formation_library.ts：替换数组部分
  const libPath = resolve('src/ai/formation_library.ts');
  const src0 = readFileSync(libPath, 'utf8');
  const startMark = 'export const FORMATION_LIBRARY: Formation[] = [';
  const startIdx = src0.indexOf(startMark);
  if (startIdx < 0) {
    console.error('未找到 FORMATION_LIBRARY 数组标记，无法覆盖。');
    process.exit(1);
  }
  const arrayStart = startIdx + startMark.length;
  const arrayEnd = src0.indexOf('\n];', arrayStart);
  if (arrayEnd < 0) {
    console.error('未找到 FORMATION_LIBRARY 数组结尾，无法覆盖。');
    process.exit(1);
  }
  const jsonArray = JSON.stringify(newLib, null, 2);
  const newContent = src0.slice(0, arrayStart) + jsonArray.slice(1, -1) + src0.slice(arrayEnd + 1);
  writeFileSync(libPath, newContent, 'utf8');
  console.log(`\n已覆盖写回 → ${libPath}`);

  // 剪枝报告 md
  writeFileSync(resolve('reports/prune_report.md'), [
    '# 后剪枝报告（apply 自动）',
    '',
    `更新时间：${new Date().toLocaleString('zh-CN', { hour12: false })}`,
    `剪枝判据：先手+后手 vs 全部对手，删掉后全局不败率不降 → 剪掉（每对手 ${pruneGames} 局）`,
    '',
    ...pruneReport,
  ].join('\n'), 'utf8');
  console.log(`剪枝报告已写 → reports/prune_report.md`);

  // 重跑胜率表（优化后）
  console.log(`\n--- 重跑全对阵胜率表（优化后，${matrixGames} 局/配对） ---`);
  const matrix = await fullMatrixEvaluate(matrixGames, workerArg > 0 ? workerArg : undefined);
  writeMatrixReports(matrix);
  console.log('胜率表已更新 → reports/胜率表格.md');

  // 更新 cycle_state.json：
  //   1) 所有阵型：记录当前胜率基线（lastWinrate）——保证下次能检测「胜率下降」
  //   2) 本轮参与优化的阵型（reports/optimized/*.json）：optCount+1
  const state = loadCycleState();
  const newWinrate = new Map(matrix.ids.map((id, i) => [id, matrix.rowTotals[i].undefeated]));
  for (const f of FORMATION_LIBRARY) {
    const st = state[f.id] ?? { name: f.name, optCount: 0, lastWinrate: 0 };
    st.name = f.name;
    st.lastWinrate = newWinrate.get(f.id) ?? 0;
    state[f.id] = st;
  }
  const participatedIds = new Set(allResults.map(r => r.id));
  for (const id of participatedIds) {
    if (state[id]) state[id].optCount += 1;
  }
  saveCycleState(state);
  console.log(`cycle_state 已更新（${FORMATION_LIBRARY.length} 阵型基线 + ${participatedIds.size} 阵型 optCount+1）→ reports/cycle_state.json`);

  console.log(`\n注意：对战ai 源仓库（D:\\develope\\对战ai）的 formation_library.ts 需手动同步，并重编译 bundle。`);
}

main();
