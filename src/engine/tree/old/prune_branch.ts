// ============================================================
// 后剪枝（post-pruning）：读取进化产物，逐个测试"删掉某条件分支"
// 对整局不败率的影响。判据：删掉后全局不败率不降 → 剪掉该分支。
//
// 只剪 condition 非空的分支（主分支兜底不剪）。
// 运行：npx vite-node --script src/engine/tree/prune_branch.ts [json路径] [侧] [每对手局数]
// ============================================================

import '../env';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { registerAllBadges } from '../../game/BadgeSystem';
import { FORMATION_LIBRARY } from '../../ai/formation_library';
import type { EvolFormation, EvolNode, FeatureMask } from './evol_gene';
import { maskToLabel, isEmptyMask, walkEvolNodes, cloneEvolFormation, summarizeEvolFormation } from './evol_gene';
import { playSpecVsSpec, type SideSpec } from './arena';

registerAllBadges();

function loadBundle(): any {
  const w = globalThis as any;
  const code = readFileSync(resolve('public/ai-bundle.iife.js'), 'utf8');
  const factory = new Function('window', 'globalThis', '"use strict";\n' + code + '\n;return BattleAI;');
  const b = factory(w, w);
  return b?.BattleAI ?? w.BattleAI;
}

/** JSON → EvolFormation */
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
    name: raw.name ?? 'evolved',
    archetype: raw.archetype ?? 'half_rush',
    team: (raw.team ?? []).map((s: any) => ({ monsterId: s.monsterId, badgeIds: [...(s.badgeIds ?? [])] })),
    root: reviveNode(raw.tree ?? raw.root),
  };
}

/** 全局整局不败率（7 阵型，候选后手 side） */
function evalGlobal(BundleAI: any, f: EvolFormation, aSide: 1 | 2, games: number): { win: number; draw: number; loss: number; undefeated: number } {
  const specA: SideSpec = { kind: 'evol', f };
  let win = 0, draw = 0, loss = 0;
  for (const opp of FORMATION_LIBRARY) {
    const specB: SideSpec = { kind: 'native', f: opp };
    for (let i = 0; i < games; i++) {
      const r = playSpecVsSpec(BundleAI, specA, specB, aSide, 2000 + i);
      win += r.w; draw += r.d; loss += r.l;
    }
  }
  const total = win + draw + loss;
  return { win, draw, loss, undefeated: total ? (win + draw) / total : 0 };
}

/** 移除指定 id 的分支节点（从父节点 children 删掉） */
function removeBranchById(f: EvolFormation, id: string): EvolFormation | null {
  const out = cloneEvolFormation(f);
  const nodes = walkEvolNodes(out.root);
  const target = nodes.find(n => n.id === id);
  if (!target || isEmptyMask(target.condition)) return null; // 主分支不剪
  // 找父节点（含该节点的 node）
  for (const n of nodes) {
    const idx = n.children.findIndex(c => c.id === id);
    if (idx >= 0) {
      n.children.splice(idx, 1);
      return out;
    }
  }
  return null;
}

/** 收集所有条件分支节点（condition 非空） */
function conditionBranches(f: EvolFormation): EvolNode[] {
  return walkEvolNodes(f.root).filter(n => !isEmptyMask(n.condition));
}

function main(): void {
  const jsonPath = process.argv[2] || 'reports/branch_induct_result.json';
  const aSide: 1 | 2 = Number(process.argv[3] || 2) === 1 ? 1 : 2;
  const games = Number(process.argv[4] || 4);

  const raw = JSON.parse(readFileSync(resolve(jsonPath), 'utf8'));
  const evolved = reviveFormation(raw.formation);
  const BundleAI = loadBundle();

  console.log(`=== 后剪枝分析：${evolved.name} ${aSide === 2 ? '后手' : '先手'}，每对手${games}局 ===`);
  const base = evalGlobal(BundleAI, evolved, aSide, games);
  console.log(`当前整局不败率: ${base.win}胜/${base.draw}平/${base.loss}负 (${(base.undefeated * 100).toFixed(1)}%)\n`);

  const branches = conditionBranches(evolved);
  console.log(`条件分支共 ${branches.length} 个：`);
  for (const b of branches) {
    console.log(`  [${b.id}] R${b.round} 标签「${maskToLabel(b.condition)}」`);
  }

  console.log('\n逐个测试剪除效果：');
  let pruned = evolved;
  let changed = true;
  let pass = 0;

  while (changed) {
    changed = false;
    const cands = conditionBranches(pruned);
    for (const b of cands) {
      const without = removeBranchById(pruned, b.id);
      if (!without) continue;
      const e = evalGlobal(BundleAI, without, aSide, games);
      const delta = e.undefeated - base.undefeated;
      const label = maskToLabel(b.condition);
      if (e.undefeated >= base.undefeated - 0.001) {
        // 剪掉后不降 → 冗余分支，剪
        pruned = without;
        changed = true;
        pass++;
        console.log(`  ✂ 剪掉 [${b.id}] R${b.round}「${label}」: ${(base.undefeated * 100).toFixed(1)}% → ${(e.undefeated * 100).toFixed(1)}% (Δ${(delta * 100).toFixed(1)}%) ✅ 冗余`);
        break; // 剪掉后重新评估基线
      } else {
        console.log(`  ✕ 保留 [${b.id}] R${b.round}「${label}」: ${(base.undefeated * 100).toFixed(1)}% → ${(e.undefeated * 100).toFixed(1)}% (Δ${(delta * 100).toFixed(1)}%) 有效`);
      }
    }
  }

  console.log(`\n=== 剪枝结果：${pass > 0 ? `剪掉 ${pass} 个冗余分支` : '无冗余分支，全部保留'} ===`);
  console.log(summarizeEvolFormation(pruned));
}

main();
