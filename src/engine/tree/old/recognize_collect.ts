// ============================================================
// P3 — 识别学习数据收集
// 目标：把"识别系统"从硬编码 label 关键词 → 可学习的特征→分支映射。
//
// 收集方式：用多分支阵型（默认肃清）作为"学习者"，对每个对手阵型打对局，
// 在每个分支决策点记录 (对手手牌特征, 对手场上特征, 选中的分支, 该局胜负)，
// 输出 JSONL 样本。这些样本可直接：
//   1. 训练识别模型（对手特征 → 分支选择）；
//   2. 生成"分支触发条件 → 该条件胜率"的统计，指导 mutateCondition 的进化方向。
//
// 运行：npx vite-node --script src/engine/train/recognize_collect.ts [学习者阵型] [每对手局数] [输出路径]
// ============================================================

import '../env';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { FORMATION_LIBRARY } from '../../ai/formation_library';
import { formationToEvol } from './evol_gene';
import { playSpecVsSpec, type BranchDecision, type SideSpec } from './arena';

type Spec = SideSpec;

function loadBundle(bundlePath: string): any {
  const w = globalThis as any;
  try {
    const code = readFileSync(resolve(bundlePath), 'utf8');
    const factory = new Function('window', 'globalThis', '"use strict";\n' + code + '\n;return BattleAI;');
    const bundleExports = factory(w, w);
    return bundleExports?.BattleAI ?? w.BattleAI ?? null;
  } catch (e) {
    console.error(`[recognize] bundle 加载失败: ${(e as Error).message}`);
    return null;
  }
}

interface Sample {
  learner: string;
  opponent: string;
  round: number;
  handIds: number[];
  handBadges: number[];
  boardIds: number[];
  chosenBranchId: string;
  branchLabels: string[];
  outcome: 1 | 0 | -1;
}

function main(): void {
  const learnerName = process.argv[2] || '肃清';
  const gamesPerOpp = Number(process.argv[3]) || 6;
  const outPath = process.argv[4] || 'reports/recognize_samples.jsonl';
  const BundleAI = loadBundle('public/ai-bundle.iife.js');
  if (!BundleAI) { console.error('bundle 未加载'); process.exit(1); }

  const learner = FORMATION_LIBRARY.find(f => f.name === learnerName);
  if (!learner) { console.error(`学习者阵型不存在: ${learnerName}`); process.exit(1); }

  const learnerSpec: Spec = { kind: 'evol', f: formationToEvol(learner) };
  const samples: Sample[] = [];
  const t0 = Date.now();

  // 对每个对手阵型打 gamesPerOpp 局（交替先手/后手）
  for (const opp of FORMATION_LIBRARY) {
    const oppSpec: Spec = { kind: 'native', f: opp };
    for (let g = 0; g < gamesPerOpp; g++) {
      const aSide: 1 | 2 = g % 2 === 0 ? 1 : 2;
      playSpecVsSpec(BundleAI, learnerSpec, oppSpec, aSide, 5000 + g * 7, (d: BranchDecision, outcome) => {
        samples.push({
          learner: learnerName,
          opponent: opp.name,
          round: d.round,
          handIds: d.handIds,
          handBadges: d.handBadges,
          boardIds: d.boardIds,
          chosenBranchId: d.chosenBranchId,
          branchLabels: d.branchLabels,
          outcome,
        });
      });
    }
  }

  const ms = Date.now() - t0;
  writeFileSync(outPath, samples.map(s => JSON.stringify(s)).join('\n'), 'utf8');

  // 统计：每个分支在"有该特征"的决策点下的胜率
  console.log(`=== 识别学习样本收集完成 ===`);
  console.log(`样本数: ${samples.length}，耗时 ${(ms / 1000).toFixed(1)}s，输出 → ${outPath}`);
  console.log(`\n各分支决策点分布与胜率（outcome 均值，1=胜/0=平/-1=负）:`);
  const byBranch = new Map<string, { n: number; sum: number }>();
  for (const s of samples) {
    const key = s.chosenBranchId;
    if (!byBranch.has(key)) byBranch.set(key, { n: 0, sum: 0 });
    const e = byBranch.get(key)!;
    e.n++; e.sum += s.outcome;
  }
  for (const [branch, e] of [...byBranch.entries()].sort((a, b) => b[1].n - a[1].n)) {
    console.log(`  分支 ${branch}: ${e.n} 次决策, 平均结局 ${(e.sum / e.n).toFixed(2)}`);
  }
}

main();
