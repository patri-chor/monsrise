// ============================================================
// 自主分支 —— 决策树归纳（branch induction）
//
// 用户定案：
//   - 面对"输的分"，先看胜率是否不为 0（有赢有输）
//   - 分析"赢的对局 vs 输的对局"的标签差异，把赢的标签固化为新分支
//   - 固化后，该分支覆盖的情况从后续搜索排除，对剩余情况继续优化
//   - 暂不加预剪枝（后续再加样本量/收益阈值）
//
// 分裂特征（候选标签）：
//   - side（先后手 1/2）
//   - main（对手流派 prayer/halfrush/fullrush）
//   - subs（dof/shield/gift 有无）
//   - keys（钻头/冲锋/铁甲/忍猴/突突/咒法/矿爆 有无）
//
// 信息增益（二元分裂 win/loss）：
//   IG(feature) = H(all) - Σ (|subset|/|all|) * H(subset)
//   选 IG 最大的特征建分支。
//
// 运行：npx vite-node --script src/engine/tree/branch_induct.ts [种子] [对手] [侧] [局数]
// ============================================================

import '../env';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { FORMATION_LIBRARY } from '../../ai/formation_library';
import type { Formation } from '../../ai/types';
import type { EvolFormation, FeatureMask, EvolNode } from './evol_gene';
import { formationToEvol, recognizeArchetype, maskToLabel, summarizeEvolFormation, matchMask, isEmptyMask, walkEvolNodes } from './evol_gene';
import { addBranch, replaceMonster, moveWithinZoneAtNode, isPositionIrrelevant, roleOf, getLastValidationError } from './tree_ops';
import { playSpecVsSpec, type SideSpec } from './arena';
import { ExperienceBank, replaceKey, moveKey } from './search_experience';

const MONSTER_NAME: Record<number, string> = {
  101: '肃清哥', 102: '大祭司', 103: '学徒', 104: '散弹', 105: '祈祷', 106: '冲锋', 107: '咒法',
  108: '救星', 109: '银狙', 110: '帝国', 111: '见习', 112: '守卫', 113: '矿爆', 114: '突突',
  115: '铲土', 116: '钻头', 117: '铁甲', 118: '塞雷', 119: '忍猴', 120: '金猴', 121: '僧猴',
  122: '丛林猴', 123: '棒球', 124: '三振', 125: '战壕', 126: '祭司',
};
const nm = (id: number) => MONSTER_NAME[id] ?? String(id);

function loadBundle(): any {
  const w = globalThis as any;
  const code = readFileSync(resolve('public/ai-bundle.iife.js'), 'utf8');
  const factory = new Function('window', 'globalThis', '"use strict";\n' + code + '\n;return BattleAI;');
  const b = factory(w, w);
  return b?.BattleAI ?? w.BattleAI;
}

/** 熵：-p*log2(p) - (1-p)*log2(1-p)，p=0 或 1 时为 0 */
function entropy(p: number): number {
  if (p <= 0 || p >= 1) return 0;
  return -p * Math.log2(p) - (1 - p) * Math.log2(1 - p);
}

/** 信息增益：按标签 splitter 把样本分成两组，算 win 率的熵减 */
function infoGain(samples: { win: boolean; has: boolean }[]): number {
  const n = samples.length;
  if (n === 0) return 0;
  const winCount = samples.filter(s => s.win).length;
  const hAll = entropy(winCount / n);

  const withFeature = samples.filter(s => s.has);
  const withoutFeature = samples.filter(s => !s.has);
  if (withFeature.length === 0 || withoutFeature.length === 0) return 0; // 无区分度

  const hWith = entropy(withFeature.filter(s => s.win).length / withFeature.length);
  const hWithout = entropy(withoutFeature.filter(s => s.win).length / withoutFeature.length);
  const hSplit = (withFeature.length / n) * hWith + (withoutFeature.length / n) * hWithout;
  return hAll - hSplit;
}

interface Sample {
  win: boolean;
  side: 1 | 2;
  main: string | null;
  subs: string[];
  keys: string[];
}

/** 收集某对手某侧的样本：每局记录 (该分是否赢, 对手标签) */
function collectSamples(
  BundleAI: any,
  candidate: EvolFormation,
  target: any,
  aSide: 1 | 2,
  focusRound: number, // 关注的分（1-5）
  games: number,
): Sample[] {
  const specA: SideSpec = { kind: 'evol', f: candidate };
  const specB: SideSpec = { kind: 'native', f: target };
  // 对手标签（对手卡组固定，开局即知）
  const targetIds = target.team.filter((s: any) => s.monsterId > 0).map((s: any) => s.monsterId);
  const targetBadges = target.team.flatMap((s: any) => s.badgeIds);
  const rec = recognizeArchetype({ handIds: new Set(targetIds.slice(0, 4)), handBadges: new Set(targetBadges), boardIds: new Set(targetIds) });

  const samples: Sample[] = [];
  for (let i = 0; i < games; i++) {
    const r = playSpecVsSpec(BundleAI, specA, specB, aSide, 2000 + i);
    const score = r.roundScores[focusRound - 1];
    if (score === undefined) continue; // 对局提前结束（该分未打），不计入样本
    // 注意：score=0 是平局，平局已"不输"，算作 win（分支归纳目标=让输的分不输）
    samples.push({
      win: score >= 0,
      side: aSide,
      main: rec.main,
      subs: rec.subs,
      keys: rec.keys,
    });
  }
  return samples;
}

/** 对所有候选标签算信息增益，返回最优分裂 */
function bestSplit(samples: Sample[]): { kind: string; value: string; mask: FeatureMask; ig: number } | null {
  const candidates: { kind: string; value: string; has: (s: Sample) => boolean; mask: FeatureMask }[] = [];

  // side 特征
  if (new Set(samples.map(s => s.side)).size > 1) {
    candidates.push({ kind: 'side', value: '2(后手)', has: s => s.side === 2, mask: { side: 2, main: null, subs: [], keys: [] } });
    candidates.push({ kind: 'side', value: '1(先手)', has: s => s.side === 1, mask: { side: 1, main: null, subs: [], keys: [] } });
  }
  // main 特征
  const mains = [...new Set(samples.map(s => s.main).filter((x): x is string => !!x))];
  for (const m of mains) {
    candidates.push({ kind: 'main', value: m, has: s => s.main === m, mask: { side: null, main: m as any, subs: [], keys: [] } });
  }
  // subs 特征
  const subs = [...new Set(samples.flatMap(s => s.subs))];
  for (const sb of subs) {
    candidates.push({ kind: 'sub', value: sb, has: s => s.subs.includes(sb), mask: { side: null, main: null, subs: [sb as any], keys: [] } });
  }
  // keys 特征
  const keys = [...new Set(samples.flatMap(s => s.keys))];
  for (const k of keys) {
    candidates.push({ kind: 'key', value: k, has: s => s.keys.includes(k), mask: { side: null, main: null, subs: [], keys: [k as any] } });
  }

  // === 二元组合候选（关键：主标签太粗时，需 main+sub / main+key 细分）===
  // 例：全二冲(fullrush) vs 经典救星(fullrush+shield) vs 梯子塞雷(fullrush+shield)
  //     单 main=fullrush 分不开，但 main=fullrush+sub=shield 能区分。
  // 数量受控：只在样本实际出现的标签内组合，且每类上限少量。
  for (const m of mains.slice(0, 3)) {
    for (const sb of subs.slice(0, 3)) {
      candidates.push({
        kind: 'main+sub', value: `${m}+${sb}`,
        has: s => s.main === m && s.subs.includes(sb),
        mask: { side: null, main: m as any, subs: [sb as any], keys: [] },
      });
    }
    for (const k of keys.slice(0, 7)) {
      candidates.push({
        kind: 'main+key', value: `${m}+${k}`,
        has: s => s.main === m && s.keys.includes(k),
        mask: { side: null, main: m as any, subs: [], keys: [k as any] },
      });
    }
  }
  for (const sb of subs.slice(0, 3)) {
    for (const k of keys.slice(0, 7)) {
      candidates.push({
        kind: 'sub+key', value: `${sb}+${k}`,
        has: s => s.subs.includes(sb) && s.keys.includes(k),
        mask: { side: null, main: null, subs: [sb as any], keys: [k as any] },
      });
    }
  }

  let best: { kind: string; value: string; mask: FeatureMask; ig: number } | null = null;
  for (const c of candidates) {
    const ig = infoGain(samples.map(s => ({ win: s.win, has: c.has(s) })));
    if (best === null || ig > best.ig) {
      best = { kind: c.kind, value: c.value, mask: c.mask, ig };
    }
  }
  return best && best.ig > 0 ? best : null;
}

/** 判断某对手阵型是否命中 mask。
 *  side 分支（mask.side != null）：条件只看候选侧，与对手标签无关 → 所有对手都命中。
 *  标签分支（mask.side == null）：按对手三层标签匹配。 */
function oppMatches(opp: Formation, mask: FeatureMask): boolean {
  if (mask.side !== null) return true;
  const ids = opp.team.filter(s => s.monsterId > 0).map(s => s.monsterId);
  const badges = opp.team.flatMap(s => s.badgeIds);
  const rec = recognizeArchetype({ handIds: new Set(ids.slice(0, 4)), handBadges: new Set(badges), boardIds: new Set(ids) });
  return matchMask(mask, rec, 1);
}

/** 两个 mask 是否完全相同（用于定位刚建的分支节点） */
function maskEqual(a: FeatureMask, b: FeatureMask): boolean {
  return a.side === b.side && a.main === b.main
    && a.subs.length === b.subs.length && a.subs.every(s => b.subs.includes(s))
    && a.keys.length === b.keys.length && a.keys.every(k => b.keys.includes(k));
}

/** 主链 R1..(forkRound-1) 已上场怪集合（这些怪分支子树不能再放，placeMonster 会拒绝重复） */
function preUsedMonsters(f: EvolFormation, forkRound: number): Set<number> {
  const used = new Set<number>();
  let cur: EvolNode | null = f.root;
  while (cur && cur.round < forkRound) {
    for (const p of cur.placements) used.add(p.monsterId);
    cur = cur.children.find(c => isEmptyMask(c.condition)) ?? cur.children[0] ?? null;
  }
  return used;
}

/** 分支子树内除 (exceptNodeId, exceptMonsterId) 外已占用的怪集合（防跨回合重复） */
function branchUsedMonsters(branchNodes: EvolNode[], exceptNodeId: string, exceptMonsterId: number): Set<number> {
  const used = new Set<number>();
  for (const n of branchNodes) {
    for (const p of n.placements) {
      if (n.id === exceptNodeId && p.monsterId === exceptMonsterId) continue;
      used.add(p.monsterId);
    }
  }
  return used;
}

/** 整局五局三胜结果（分叉跨多回合后，评估须看整局而非单回合） */
function collectMatch(BundleAI: any, f: EvolFormation, opp: Formation, aSide: 1 | 2, games: number): { win: number; draw: number; loss: number } {
  const specA: SideSpec = { kind: 'evol', f };
  const specB: SideSpec = { kind: 'native', f: opp };
  let win = 0, draw = 0, loss = 0;
  for (let i = 0; i < games; i++) {
    const r = playSpecVsSpec(BundleAI, specA, specB, aSide, 2000 + i);
    win += r.w; draw += r.d; loss += r.l;
  }
  return { win, draw, loss };
}

/** 评估个体：对「命中 mask 的对手」统计整局不败率（胜+平）/总。
 *  side 分支只在对应侧评估；标签分支在先手+后手两侧都评估（避免单侧优化伤害另一侧）。 */
function evalMatchOnMatched(BundleAI: any, f: EvolFormation, mask: FeatureMask, games: number): { win: number; draw: number; loss: number; undefeated: number } {
  let win = 0, draw = 0, loss = 0;
  const sides: (1 | 2)[] = mask.side !== null ? [mask.side] : [1, 2];
  for (const opp of FORMATION_LIBRARY) {
    if (!oppMatches(opp, mask)) continue;
    for (const side of sides) {
      const m = collectMatch(BundleAI, f, opp, side, games);
      win += m.win; draw += m.draw; loss += m.loss;
    }
  }
  const total = win + draw + loss;
  return { win, draw, loss, undefeated: total ? (win + draw) / total : 0 };
}

/**
 * 优化新分支内部：针对命中 mask 的对手，对新分支子树（condition===mask 的根节点
 * 及其全部后代）做单替换穷举 + 位置搜索，选使整局不败率最优的走法。
 * 评估用整局不败率——分叉覆盖多个回合（崩盘起点→第5局），单回合指标会误导。
 *
 * 搜索数量限制（用户定案"往前推一个回合但要限制搜索数量"）：
 *   1. 可用怪池 = 卡组 - 前置主链已上场怪（placeMonster 拒绝重复，放不进的是无效替换）
 *   2. 子树内去重：候选怪不能已在分支子树其他槽（跨回合重复同样被拒）
 *   3. 单替换穷举（不做双替换）
 */
function optimizeBranch(BundleAI: any, branched: EvolFormation, mask: FeatureMask, forkRound: number, games: number, exp: ExperienceBank, formationId: string): EvolFormation {
  const teamIds = branched.team.filter(s => s.monsterId > 0).map(s => s.monsterId);
  const preUsed = preUsedMonsters(branched, forkRound);
  let current = branched;
  let curEval = evalMatchOnMatched(BundleAI, current, mask, games);
  let skippedByExp = 0, newlyInvalid = 0;
  console.log(`  新分支初始（命中对手整局）：${curEval.win}胜/${curEval.draw}平/${curEval.loss}负 不败率 ${(curEval.undefeated * 100).toFixed(0)}%`);

  for (let iter = 0; iter < 10; iter++) {
    // 定位分支子树：condition===mask 的根节点 + 其全部后代
    const roots = walkEvolNodes(current.root).filter(n => !isEmptyMask(n.condition) && maskEqual(n.condition, mask));
    const branchNodes: EvolNode[] = [];
    for (const r of roots) branchNodes.push(...walkEvolNodes(r));

    if (branchNodes.length === 0) {
      console.log('  未找到分支节点（可能标签未命中任何节点），停止优化。');
      break;
    }

    let bestChild: EvolFormation | null = null;
    let bestRate = curEval.undefeated;
    let bestDesc = '';
    let evaluated = 0;

    for (const node of branchNodes) {
      // P1 单替换穷举（可用怪池 = 卡组 - 前置已用怪 - 子树其他槽已用怪）
      for (const slot of node.placements) {
        const subtreeUsed = branchUsedMonsters(branchNodes, node.id, slot.monsterId);
        for (const toMid of teamIds) {
          if (toMid === slot.monsterId) continue;
          if (preUsed.has(toMid)) continue;         // 前置主链已上场，替换后放不进去
          if (subtreeUsed.has(toMid)) continue;      // 子树内重复
          const key = replaceKey(formationId, node.id, slot.monsterId, toMid);
          if (exp.isKnownInvalid(key)) { skippedByExp++; continue; }
          const child = replaceMonster(current, node.id, slot.monsterId, toMid);
          if (!child) {
            const reason = getLastValidationError() ?? '结构非法';
            exp.markInvalid(key, reason);
            newlyInvalid++;
            continue;
          }
          evaluated++;
          const e = evalMatchOnMatched(BundleAI, child, mask, games);
          if (e.undefeated > bestRate) {
            bestRate = e.undefeated;
            bestChild = child;
            bestDesc = `替换 R${node.round} 节点${node.id}：${nm(slot.monsterId)} → ${nm(toMid)}`;
          }
        }
      }
      // P2 位置搜索（普通怪，规则内换格；特殊怪位置无效跳过）
      for (const slot of node.placements) {
        if (isPositionIrrelevant(slot.monsterId)) continue;
        const role = roleOf(slot.monsterId);
        const isBackline = role === '法师' || role === '射手';
        const cols = isBackline ? [8, 9, 10] : [6, 7, 8];
        for (const x of cols) {
          for (let y = 0; y < 5; y++) {
            const key = moveKey(formationId, node.id, slot.monsterId, x, y);
            if (exp.isKnownInvalid(key)) { skippedByExp++; continue; }
            const child = moveWithinZoneAtNode(current, node.id, slot.monsterId, x, y);
            if (!child) {
              const reason = getLastValidationError() ?? '结构非法';
              exp.markInvalid(key, reason);
              newlyInvalid++;
              continue;
            }
            evaluated++;
            const e = evalMatchOnMatched(BundleAI, child, mask, games);
            if (e.undefeated > bestRate) {
              bestRate = e.undefeated;
              bestChild = child;
              bestDesc = `移动 ${nm(slot.monsterId)} → (${x},${y})`;
            }
          }
        }
      }
    }

    console.log(`  第${iter + 1}轮：评估 ${evaluated} 个候选（跳过经验库无效 ${skippedByExp} 个），最优 ${(bestRate * 100).toFixed(0)}%`);
    if (bestChild && bestRate > curEval.undefeated) {
      current = bestChild;
      curEval = evalMatchOnMatched(BundleAI, current, mask, games);
      console.log(`    [采纳] ${bestDesc} → ${(curEval.undefeated * 100).toFixed(0)}%（${curEval.win}胜/${curEval.draw}平/${curEval.loss}负）`);
    } else {
      console.log(`    [无改进] 最优候选 ${(bestRate * 100).toFixed(0)}% ≤ 当前 ${(curEval.undefeated * 100).toFixed(0)}%，停止。`);
      break;
    }
  }
  console.log(`  [经验库] 分支优化累计：跳过历史无效 ${skippedByExp} 个，新增无效 ${newlyInvalid} 个`);
  return current;
}

function main(): void {
  const seedName = process.argv[2] || '肃清';
  const gamesPerOpp = Number(process.argv[3] || 4);

  const BundleAI = loadBundle();
  const src = FORMATION_LIBRARY.find(f => f.name === seedName);
  if (!src) { console.error('阵型不存在'); process.exit(1); }

  const out = optimizeFormation(BundleAI, src, gamesPerOpp);
  if (!out) return;

  // 保存优化结果（供人工检查 / deploy_evolved 部署验证）
  const outPath = resolve('reports/branch_induct_result.json');
  const json = {
    type: 'branch_induct_result',
    seedFormation: seedName,
    forkRound: out.forkRound,
    mask: out.mask,
    maskLabel: out.maskLabel,
    before: out.before,
    after: out.after,
    formation: { name: out.optimized.name, archetype: out.optimized.archetype, team: out.optimized.team, tree: out.optimized.root },
  };
  writeFileSync(outPath, JSON.stringify(json, null, 2));
  console.log(`\n优化结果已保存 → ${outPath}`);
}

/**
 * 自主分支优化（可复用）：分析 → 诊断崩盘 → 建分支 → 优化新分支 → 整局重评。
 * 返回 { optimized, improved, forkRound, mask, maskLabel, before, after }；
 * 若无法分裂或优化后整局不败率未改善，返回 null（调用方保持原阵型）。
 */
export function optimizeFormation(
  BundleAI: any,
  src: Formation,
  gamesPerOpp: number,
): { optimized: EvolFormation; improved: boolean; forkRound: number; mask: FeatureMask; maskLabel: string; before: { win: number; draw: number; loss: number; undefeated: number }; after: { win: number; draw: number; loss: number; undefeated: number } } | null {
  const candidate = formationToEvol(src);

  // 经验库：加载历史无效候选（跨轮回复用）
  const exp = new ExperienceBank();
  exp.load();

  console.log(`=== 分支归纳分析：${src.name} 先手+后手 vs 全部 ${FORMATION_LIBRARY.length} 阵型（每对手每侧${gamesPerOpp}局，经验库 ${exp.size} 条）===`);

  // 多对手收集样本：对每个对手阵型，先手+后手各打 gamesPerOpp 局，记录 (胜负, 对手标签, 侧)。
  // side 进入特征空间 → 若主场不对称显著，bestSplit 会优先按 side 建分支（先手走法/后手走法）。
  let bestOverall: { round: number; split: { kind: string; value: string; mask: FeatureMask; ig: number }; winRate: number } | null = null;

  for (let round = 1; round <= 5; round++) {
    const allSamples: Sample[] = [];
    for (const opp of FORMATION_LIBRARY) {
      allSamples.push(...collectSamples(BundleAI, candidate, opp, 1, round, gamesPerOpp));
      allSamples.push(...collectSamples(BundleAI, candidate, opp, 2, round, gamesPerOpp));
    }
    const winCount = allSamples.filter(s => s.win).length;
    const winRate = winCount / allSamples.length;
    const split = bestSplit(allSamples);
    console.log(`R${round}: 胜率 ${(winRate * 100).toFixed(0)}%（${winCount}赢/${allSamples.length - winCount}输）${split ? ` 分裂 ${split.kind}=${split.value} IG=${split.ig.toFixed(3)}` : ''}`);
    if (split && (!bestOverall || split.ig > bestOverall.split.ig)) {
      bestOverall = { round, split, winRate };
    }
  }

  if (!bestOverall) {
    console.log('\n无有效分裂（所有分要么全赢要么标签无区分度），无需建分支。');
    return null;
  }

  console.log(`\n=== 最优分裂：R${bestOverall.round} 按 ${bestOverall.split.kind}=${bestOverall.split.value} 建分支 ===`);
  console.log(`分支标签 [${maskToLabel(bestOverall.split.mask)}]，信息增益 ${bestOverall.split.ig.toFixed(3)}`);

  // 诊断：命中 mask 的对手逐回合胜率，定位"崩盘起点"（分叉点应提前到崩盘开始处）
  const matchedOpps = FORMATION_LIBRARY.filter(o => oppMatches(o, bestOverall.split.mask));
  const diagSides: (1 | 2)[] = bestOverall.split.mask.side !== null ? [bestOverall.split.mask.side] : [1, 2];
  console.log(`\n=== 命中「${maskToLabel(bestOverall.split.mask)}」的对手（${matchedOpps.map(o => o.name).join('、')}）逐回合胜率诊断 ===`);
  const roundRates: { round: number; win: number; total: number; rate: number }[] = [];
  for (let round = 1; round <= 5; round++) {
    let win = 0, total = 0;
    for (const opp of matchedOpps) {
      for (const side of diagSides) {
        const s = collectSamples(BundleAI, candidate, opp, side, round, gamesPerOpp);
        win += s.filter(x => x.win).length;
        total += s.length;
      }
    }
    const rate = total ? win / total : 0;
    roundRates.push({ round, win, total, rate });
    console.log(`  R${round}: ${win}/${total} 胜率 ${(rate * 100).toFixed(0)}%`);
  }

  // 崩盘起点 = 第一个胜率跌破阈值的回合；分叉点往前推一个回合（用户定案：
  // "搜不到确实需要往前推一个回合"——R4 才分叉时卡组怪已被 R1-R3 用光，搜索空间塌缩，
  // 提前到 R3 让分支从 R3 就换节奏，拥有完整替换空间）
  const CRASH_THRESHOLD = 0.75;
  const crash = roundRates.find(x => x.rate < CRASH_THRESHOLD);
  const rawFork = crash ? crash.round : bestOverall.round;
  const forkRound = Math.max(1, rawFork - 1);
  if (crash) {
    console.log(`\n崩盘起点 R${crash.round}（胜率 ${(crash.rate * 100).toFixed(0)}% < ${(CRASH_THRESHOLD * 100).toFixed(0)}%）`);
    console.log(`分叉点往前推一个回合：R${rawFork} → R${forkRound}，覆盖 R${forkRound}~R5 整棵子树（避免分支怪池被前置回合用光）。`);
  } else {
    console.log(`\n无跌破阈值回合，分叉点 = IG 最高的 R${forkRound}。`);
  }

  // 建分支：在主链 forkRound 处复制主走法（含后续子树）作模板，根节点打上该标签
  const rng = mulberry32(777);
  console.log(`\n[建分支] 在 R${forkRound} 处按标签「${maskToLabel(bestOverall.split.mask)}」复制主链子树作模板`);
  const branched = addBranch(candidate, bestOverall.split.mask, rng, forkRound);
  if (!branched) {
    console.log('addBranch 失败（可能分支数已满）。');
    return null;
  }
  console.log('[建分支] 分支创建成功，新树结构：');
  console.log(summarizeEvolFormation(branched));

  // 优化新分支内部：只针对命中 mask 的对手，改进整棵分支子树（RforkRound~R5）
  console.log(`\n=== 优化新分支（R${forkRound}~R5，命中对手，整局不败率） ===`);
  const optimized = optimizeBranch(BundleAI, branched, bestOverall.split.mask, forkRound, gamesPerOpp, exp, src.id);
  exp.save();
  console.log('\n优化后树结构：');
  console.log(summarizeEvolFormation(optimized));

  // 验证：优化前后重测整局不败率（命中对手，先手+后手都测）
  console.log(`\n=== 整局不败率对比（优化前 vs 优化后） ===`);
  const beforeAll = evalMatchOnMatched(BundleAI, candidate, bestOverall.split.mask, gamesPerOpp);
  const afterAll = evalMatchOnMatched(BundleAI, optimized, bestOverall.split.mask, gamesPerOpp);
  console.log(`  [命中对手] 优化前 ${beforeAll.win}胜/${beforeAll.draw}平/${beforeAll.loss}负 (${(beforeAll.undefeated * 100).toFixed(0)}%) → 优化后 ${afterAll.win}胜/${afterAll.draw}平/${afterAll.loss}负 (${(afterAll.undefeated * 100).toFixed(0)}%)`);

  const verifySides: (1 | 2)[] = bestOverall.split.mask.side !== null ? [bestOverall.split.mask.side] : [1, 2];
  for (const opp of FORMATION_LIBRARY) {
    if (!oppMatches(opp, bestOverall.split.mask)) continue;
    let bw = 0, bd = 0, bl = 0, aw = 0, ad = 0, al = 0;
    for (const side of verifySides) {
      const b = collectMatch(BundleAI, candidate, opp, side, gamesPerOpp);
      const a = collectMatch(BundleAI, optimized, opp, side, gamesPerOpp);
      bw += b.win; bd += b.draw; bl += b.loss;
      aw += a.win; ad += a.draw; al += a.loss;
    }
    const bU = (bw + bd) / (bw + bd + bl);
    const aU = (aw + ad) / (aw + ad + al);
    console.log(`  ${opp.name}: ${bw}胜/${bd}平/${bl}负 (${(bU * 100).toFixed(0)}%) → ${aw}胜/${ad}平/${al}负 (${(aU * 100).toFixed(0)}%) ${aU >= bU ? '↑' : '↓'}`);
  }

  // 整局未改善 → 返回 null（保持原阵型，不采纳无效分支）
  const improved = afterAll.undefeated > beforeAll.undefeated + 1e-6;
  if (!improved) {
    console.log('\n整局不败率未改善，不采纳该分支（保持原阵型）。');
  }
  return {
    optimized: improved ? optimized : candidate,
    improved,
    forkRound,
    mask: bestOverall.split.mask,
    maskLabel: maskToLabel(bestOverall.split.mask),
    before: beforeAll,
    after: afterAll,
  };
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// 仅 CLI 直接运行时执行 main（被 import 时不执行）
if (process.argv[1] && process.argv[1].endsWith('branch_induct.ts')) {
  main();
}
