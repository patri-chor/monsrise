// ============================================================
// 卡组强度测定 v2 —— 分离测试驱动 + 前两分架构搜索
//
// 用户定案：
//   - 分离测试（单独测生存/输出）更快更准，替代"vs 规则随机"综合口径
//   - 复用模板树得不到新架构，前两分（R1/R2）要单独搜索
//
// 流程：
//   1. 读 deck_candidates_v2.json（已补关键怪）
//   2. 每个卡组：套同流派模板树作初始 → 只搜 R1/R2 的位置（目标=分离指标）
//   3. 用分离测试测定：生存 vs 全二冲（扛高爆发）、输出 vs 全二永平（击杀高生存）
//
// 运行：npx vite-node --script src/engine/tree/deck_separation.ts [每靶局数] [--only 关键词]
// ============================================================

import '../env';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { registerAllBadges } from '../../game/BadgeSystem';
import { FORMATION_LIBRARY } from '../../ai/formation_library';
import type { EvolFormation } from './evol_gene';
import { formationToEvol, cloneEvolFormation, walkEvolNodes } from './evol_gene';
import { roleOf, costOf, isPositionIrrelevant, moveWithinZoneAtNode, replaceMonster } from './tree_ops';
import { playSpecVsSpec, type SideSpec } from './arena';

registerAllBadges();

function loadBundle(): any {
  const w = globalThis as any;
  const code = readFileSync(resolve('public/ai-bundle.iife.js'), 'utf8');
  const factory = new Function('window', 'globalThis', '"use strict";\n' + code + '\n;return BattleAI;');
  const b = factory(w, w);
  return b?.BattleAI ?? w.BattleAI;
}

const FOUR_COST = new Set([101, 102, 108, 115, 118, 120]);

/** arch → 兜底模板（candidate 无 templateName 时用） */
const ARCH_REF_BY_ARCH: Record<string, string> = {
  prayer: '泉水剑', halfrush: '坚果救星', fullrush: '全二冲',
};

/** 把参考阵型树映射到候选卡组（role/cost 贪心映射 + 四费怪必须落在 R1-R3） */
export function mapRefTreeToDeck(ref: EvolFormation, deckTeam: { monsterId: number; badgeIds: number[] }[]): EvolFormation {
  const out = cloneEvolFormation(ref);
  out.team = deckTeam.map(s => ({ monsterId: s.monsterId, badgeIds: [...s.badgeIds] }));

  // 收集参考树每个槽位（nodeId, round, 原怪）
  const slots: { nodeId: string; round: number; refId: number }[] = [];
  for (const n of walkEvolNodes(ref.root)) {
    for (const p of n.placements) slots.push({ nodeId: n.id, round: n.round, refId: p.monsterId });
  }

  const pool = deckTeam.map(s => s.monsterId);
  const used = new Set<number>();
  const dRole = (id: number) => roleOf(id);
  const dCost = (id: number) => costOf(id);

  // 贪心映射（同ID → 同cost同role → 同cost → 同role → 任意），
  // 但四费怪只能映射到 round<4 的槽位
  const assign = (pred: (rid: number, d: number) => boolean): void => {
    for (const s of slots) {
      if (used.has(s.refId)) continue;
      // 四费怪不能进 R4/R5
      const cands = pool.filter(d => !used.has(d) && pred(s.refId, d) && (!FOUR_COST.has(d) || s.round < 4));
      if (cands.length === 0) continue;
      // 选最匹配的
      const c = cands[0];
      // 找对应槽位替换
      const node = walkEvolNodes(out.root).find(n => n.id === s.nodeId)!;
      const p = node.placements.find(q => q.monsterId === s.refId);
      if (p) { p.monsterId = c; used.add(c); }
    }
  };

  // 1. 同 ID
  assign((rid, d) => d === rid);
  // 2. 同 cost 同 role
  assign((rid, d) => dCost(d) === costOf(rid) && dRole(d) === roleOf(rid));
  // 3. 同 cost
  assign((rid, d) => dCost(d) === costOf(rid));
  // 4. 同 role
  assign((rid, d) => dRole(d) === roleOf(rid));
  // 5. 任意剩余（四费仍限 R1-R3）
  assign(() => true);

  return out;
}

/** 分离测试：生存（vs 全二冲）+ 输出（vs 全二永平），返回两维不败率 */
function separationEval(BundleAI: any, f: EvolFormation, games: number): { survival: number; output: number; adScore: number } {
  const survival = evalTarget(BundleAI, f, '全二冲', games);   // 扛高爆发
  const output = evalTarget(BundleAI, f, '全二永平', games);   // 击杀高生存
  return { survival, output, adScore: (survival + output) / 2 };
}

function evalTarget(BundleAI: any, f: EvolFormation, targetName: string, games: number): number {
  const target = FORMATION_LIBRARY.find(fm => fm.name === targetName)!;
  const specA: SideSpec = { kind: 'evol', f };
  const specB: SideSpec = { kind: 'native', f: target };
  let w = 0, d = 0, l = 0;
  for (let i = 0; i < games; i++) {
    const aSide: 1 | 2 = i % 2 === 0 ? 1 : 2;
    const r = playSpecVsSpec(BundleAI, specA, specB, aSide, 4000 + i);
    w += r.w; d += r.d; l += r.l;
  }
  return (w + d) / (w + d + l);
}

/** 快评：固定后手，games 局取不败率（搜索候选用；games 小=快但噪声大） */
function evalTargetQuick(BundleAI: any, f: EvolFormation, targetName: string, seed: number, games = 3): number {
  const target = FORMATION_LIBRARY.find(fm => fm.name === targetName)!;
  const specA: SideSpec = { kind: 'evol', f };
  const specB: SideSpec = { kind: 'native', f: target };
  let ud = 0;
  for (let i = 0; i < games; i++) {
    const r = playSpecVsSpec(BundleAI, specA, specB, 2, seed + i * 101);
    ud += r.w + r.d;
  }
  return ud / games; // 0~1 不败率
}

/** R1/R2 槽位配置签名（防震荡：禁止回到已访问配置） */
function earlyConfigKey(f: EvolFormation): string {
  const parts: string[] = [];
  for (const n of walkEvolNodes(f.root)) {
    if (n.round >= 1 && n.round <= 2) {
      for (const p of n.placements) parts.push(`${n.round}:${p.monsterId}@${p.x},${p.y}`);
    }
  }
  return parts.join('|');
}

const FOUR_COST_IDS = new Set([101, 102, 108, 115, 118, 120]);

/**
 * 全面搜索 R1/R2 前两分架构（换怪 + 换位置），目标 = 分离 adScore 均值。
 * 用户定案：
 *   - 复用模板树得不到新架构（核心怪换掉后站位需求变了，如救星需贴队友而非继承祭祀后排位）
 *   - 前两分单独搜，既换怪（哪只先上）又换位置（贴队友/前后排）
 * 性能优化（限制搜索数量）：
 *   - 只搜 R1/R2 槽位，单替换（换怪）+ 单移动（换位置，普通怪）
 *   - 定向单靶快评：先测两维，只对"更弱的一维"评估候选（games=1，仅后手），
 *     避免每次候选跑 2 靶 × 多局
 */
function searchEarlyRounds(BundleAI: any, f: EvolFormation, _games: number, maxIter = 3): EvolFormation {
  let current = f;
  const teamIds = current.team.filter(s => s.monsterId > 0).map(s => s.monsterId);
  const taboo = new Set<string>(); // 防震荡：已访问配置不再回退
  taboo.add(earlyConfigKey(current));
  const QG = 2; // 快评局数（后手）

  for (let iter = 0; iter < maxIter; iter++) {
    // 当前两维（快评：各 QG 局后手），确定更弱的一维作为本轮优化方向
    const baseSurvival = evalTargetQuick(BundleAI, current, '全二冲', 5000, QG);
    const baseOutput = evalTargetQuick(BundleAI, current, '全二永平', 5001, QG);
    const weakDim: 'survival' | 'output' = baseSurvival <= baseOutput ? 'survival' : 'output';
    const weakTarget = weakDim === 'survival' ? '全二冲' : '全二永平';
    const baseWeak = weakDim === 'survival' ? baseSurvival : baseOutput;

    // 收集 R1/R2 槽位
    const slots: { nodeId: string; round: number; monsterId: number }[] = [];
    for (const n of walkEvolNodes(current.root)) {
      if (n.round >= 1 && n.round <= 2) {
        for (const p of n.placements) slots.push({ nodeId: n.id, round: n.round, monsterId: p.monsterId });
      }
    }
    const usedOutside = new Set<number>();
    for (const n of walkEvolNodes(current.root)) {
      if (n.round < 1 || n.round > 2) for (const p of n.placements) usedOutside.add(p.monsterId);
    }

    let bestChild: EvolFormation | null = null;
    let bestScore = baseWeak;
    let bestDesc = '';
    let evaluated = 0;

    for (const slot of slots) {
      // P1 换怪：单替换（同 cost 优先，排除已上场怪 + 四费约束）
      for (const toMid of teamIds) {
        if (toMid === slot.monsterId) continue;
        if (usedOutside.has(toMid)) continue;
        if (slot.round >= 4 && FOUR_COST_IDS.has(toMid)) continue;
        if (costOf(toMid) !== costOf(slot.monsterId)) continue; // 同费替换，保持预算
        const child = replaceMonster(current, slot.nodeId, slot.monsterId, toMid);
        if (!child) continue;
        if (taboo.has(earlyConfigKey(child))) continue; // 防震荡
        evaluated++;
        const sc = evalTargetQuick(BundleAI, child, weakTarget, 6000 + evaluated, QG);
        if (sc > bestScore) {
          bestScore = sc;
          bestChild = child;
          bestDesc = `R${slot.round} ${slot.monsterId}→${toMid}`;
        }
      }
      // P2 换位置：单移动（普通怪，规则内前后排）
      if (isPositionIrrelevant(slot.monsterId)) continue;
      const role = roleOf(slot.monsterId);
      const isBackline = role === '法师' || role === '射手';
      const cols = isBackline ? [8, 9, 10] : [6, 7, 8];
      for (const x of cols) {
        for (let y = 0; y < 5; y++) {
          const child = moveWithinZoneAtNode(current, slot.nodeId, slot.monsterId, x, y);
          if (!child) continue;
          if (taboo.has(earlyConfigKey(child))) continue; // 防震荡
          evaluated++;
          const sc = evalTargetQuick(BundleAI, child, weakTarget, 6000 + evaluated, QG);
          if (sc > bestScore) {
            bestScore = sc;
            bestChild = child;
            bestDesc = `R${slot.round} ${slot.monsterId}→(${x},${y})`;
          }
        }
      }
    }

    if (bestChild && bestScore > baseWeak) {
      current = bestChild;
      taboo.add(earlyConfigKey(current));
      console.log(`    搜索第${iter + 1}轮：采纳「${bestDesc}」${weakDim} ${(baseWeak * 100).toFixed(0)}%→${(bestScore * 100).toFixed(0)}%（评估${evaluated}候选）`);
    } else {
      break;
    }
  }
  return current;
}

function main(): void {
  const games = Number(process.argv[2] || 4);
  const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : undefined;
  const noSearch = process.argv.includes('--no-search');

  const BundleAI = loadBundle();
  // 模板按名字查（每个卡组带 templateName，fullrush 按 core 选不同模板）
  const refByName = new Map<string, EvolFormation>();
  for (const f of FORMATION_LIBRARY) refByName.set(f.name, formationToEvol(f));

  const data = JSON.parse(readFileSync(resolve('reports/deck_candidates_v2.json'), 'utf8'));
  const seen = new Set<string>();
  const cands = data.candidates.filter((c: any) => {
    if (seen.has(c.template)) return false;
    seen.add(c.template);
    return true;
  });
  const list = only ? cands.filter((c: any) => c.template.includes(only)) : cands;

  console.log(`=== 卡组分离测试（生存 vs 全二冲 / 输出 vs 全二永平，各 ${games} 局${noSearch ? '，不搜索前两分' : ''}） ===`);
  console.log(`共 ${list.length} 个卡组（v2 已补关键怪）\n`);

  const rows: any[] = [];
  for (const c of list) {
    const ref = refByName.get(c.templateName) ?? refByName.get(ARCH_REF_BY_ARCH[c.arch]);
    if (!ref) { console.log(`  [跳过] ${c.template}: 无模板`); continue; }
    const base = mapRefTreeToDeck(ref, c.team);
    // 搜索前两分架构；搜索后与模板树精测对比，只有真改善才采纳
    let evolved = base;
    if (!noSearch) {
      const searched = searchEarlyRounds(BundleAI, base, Math.min(2, games));
      const baseSe = separationEval(BundleAI, base, games);
      const searchSe = separationEval(BundleAI, searched, games);
      if (searchSe.adScore > baseSe.adScore) {
        evolved = searched;
        console.log(`  [搜索改善] ${c.template}: 分离分 ${(baseSe.adScore * 100).toFixed(0)}%→${(searchSe.adScore * 100).toFixed(0)}%`);
      }
      // 否则保持模板树
    }
    const se = separationEval(BundleAI, evolved, games);
    rows.push({ template: c.template, arch: c.arch, survival: se.survival, output: se.output, adScore: se.adScore });
    console.log(`  ${c.template} [${c.arch}]: 生存 ${(se.survival * 100).toFixed(0)}% 输出 ${(se.output * 100).toFixed(0)}% 分离分 ${(se.adScore * 100).toFixed(0)}%`);
  }

  rows.sort((a, b) => b.adScore - a.adScore);
  console.log('\n=== 排名（分离分降序） ===');
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    console.log(`  ${i + 1}. ${r.template}  生存${(r.survival * 100).toFixed(0)}% 输出${(r.output * 100).toFixed(0)}% 分离${(r.adScore * 100).toFixed(0)}%`);
  }

  writeFileSync(resolve('reports/deck_separation_result.json'), JSON.stringify({ games, results: rows }, null, 2));
  console.log(`\n结果已保存 → reports/deck_separation_result.json`);
}

// CLI 入口守卫：被 import 时不执行 main()（mapRefTreeToDeck 被 generate_variants 复用）
if (process.argv[1] && process.argv[1].endsWith('deck_separation.ts')) {
  main();
}
