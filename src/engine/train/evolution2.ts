// ============================================================
// P1 — 树级遗传算法（evolution2）
// 基因 = EvolFormation（固定卡组 + 放置树 + 特征掩码分支条件）。
// 适应度 = arena 分离测试（formation engine 真实执行 + 多维靶）。
//
// 用户确认的搜索空间：先固定卡组，只进化放置树
// （分支骨架 + 落子顺序/位置 + 特征掩码触发条件）。
//
// 变异算子（tree_ops.ts）：swapMonsters / moveEarlier / swapRoundOrder /
// shiftPosition / mutateCondition / addBranch / removeBranch。
// 适应度主指标 = adScore（攻击/生存/盾流/dof 四维不败率均值）。
//
// 运行：npx vite-node --script src/engine/train/evolution2.ts [种群] [代数] [每靶局数] [输出路径] [seed]
// ============================================================

import { writeFileSync as fsWrite, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DB_BADGES } from '../../game/Database';
import { FORMATION_LIBRARY } from '../../ai/formation_library';
import type { EvolFormation, EvolNode } from './evol_gene';
import {
  cloneEvolFormation, walkEvolNodes, summarizeEvolFormation, formationToEvol,
} from './evol_gene';
import {
  swapMonsters, moveEarlier, swapRoundOrder, shiftPosition,
  mutateCondition, addBranch, removeBranch,
  monsterFeaturePool, badgeFeaturePool,
} from './tree_ops';
import { evaluateArena, formatArenaResult, type ArenaResult } from './arena';

const BADGE_POOL = DB_BADGES.filter(b => ![14, 15, 19, 31, 34].includes(b.id)).map(b => b.id);

function mulberry32(seed: number): () => number {
  let t = seed + 0x6D2B79F5;
  return () => {
    t += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function teamIds(f: EvolFormation): number[] {
  return f.team.filter(s => s.monsterId > 0).map(s => s.monsterId);
}

function rename(f: EvolFormation, name: string): EvolFormation {
  const out = cloneEvolFormation(f);
  out.name = name;
  return out;
}

/** 收集所有分支节点（condition 非空、可被变异条件的节点） */
function condNodes(f: EvolFormation): EvolNode[] {
  return walkEvolNodes(f.root).filter(n => n.round >= 1);
}

/**
 * 单次随机变异：从 7 种算子里选一个（权重向树结构算子倾斜），非法则重试。
 */
function mutate(f: EvolFormation, rng: () => number): EvolFormation | null {
  const ids = teamIds(f);
  const mPool = monsterFeaturePool();
  const bPool = badgeFeaturePool();
  for (let attempt = 0; attempt < 10; attempt++) {
    const r = rng();
    let out: EvolFormation | null = null;
    if (r < 0.15 && ids.length >= 2) {
      // 怪兽顺序互换
      const i = Math.floor(rng() * ids.length);
      let j = Math.floor(rng() * ids.length);
      if (j === i) j = (j + 1) % ids.length;
      out = swapMonsters(f, ids[i], ids[j]);
    } else if (r < 0.28) {
      // 顺序提前
      const monsterId = ids[Math.floor(rng() * ids.length)];
      const rounds = walkEvolNodes(f.root)
        .filter(n => n.round >= 2 && n.placements.some(p => p.monsterId === monsterId))
        .map(n => n.round);
      if (rounds.length === 0) continue;
      const fromRound = rounds[Math.floor(rng() * rounds.length)];
      const toRound = 1 + Math.floor(rng() * (fromRound - 1));
      out = moveEarlier(f, monsterId, fromRound, toRound);
    } else if (r < 0.38) {
      // 同节点顺序互换
      const nodes = walkEvolNodes(f.root).filter(n => n.placements.length >= 2);
      if (nodes.length === 0) continue;
      const node = nodes[Math.floor(rng() * nodes.length)];
      const i = Math.floor(rng() * node.placements.length);
      let j = Math.floor(rng() * node.placements.length);
      if (j === i) j = (j + 1) % node.placements.length;
      out = swapRoundOrder(f, node.id, i, j);
    } else if (r < 0.52) {
      // 位置改变
      const monsterId = ids[Math.floor(rng() * ids.length)];
      const dx = Math.floor(rng() * 5) - 2;
      const dy = Math.floor(rng() * 5) - 2;
      out = shiftPosition(f, monsterId, dx, dy);
    } else if (r < 0.72) {
      // 特征掩码变异（识别学习化核心）
      const nodes = condNodes(f);
      if (nodes.length === 0) continue;
      const node = nodes[Math.floor(rng() * nodes.length)];
      out = mutateCondition(f, node.id, mPool, bPool, rng);
    } else if (r < 0.86) {
      // 新增条件分支
      out = addBranch(f, mPool, bPool, rng);
    } else {
      // 删除非主分支
      out = removeBranch(f, rng);
    }
    if (out) return out;
  }
  return null;
}

export interface Evolution2Result {
  best: EvolFormation;
  bestFitness: number;
  bestArena: ArenaResult;
  generations: number;
  population: number;
  history: { gen: number; bestFitness: number; avgFitness: number }[];
}

/**
 * 树级进化。卡组固定（继承自初始种子阵型），只进化放置树。
 * gamesPerTarget 小=快但噪声大（用于每代排序）；best 用 max(gamesPerTarget,4) 精评。
 */
export function evolve2(
  BundleAI: any,
  population: number,
  generations: number,
  gamesPerTarget: number,
  seed: number,
  seedFormationName?: string,
): Evolution2Result {
  const rng = mulberry32(seed);
  const POP = Math.max(4, population);

  // 初始种群：若指定种子阵型则全部从它变异；否则 7 阵型 + 变异体
  const seeds = seedFormationName
    ? [FORMATION_LIBRARY.find(f => f.name === seedFormationName)!]
    : FORMATION_LIBRARY;
  const pop: EvolFormation[] = seeds.map((f, i) => rename(formationToEvol(f), `${f.name}_seed${i}`));
  while (pop.length < POP) {
    const base = seeds[Math.floor(rng() * seeds.length)];
    const m = mutate(rename(formationToEvol(base), `init${pop.length}`), rng);
    if (m) pop.push(m);
  }

  const evalFitness = (f: EvolFormation): number => {
    const r = evaluateArena(BundleAI, f, gamesPerTarget);
    return r.adScore;
  };

  let best: EvolFormation = cloneEvolFormation(pop[0]);
  let bestFitness = -1;
  let bestArena: ArenaResult | null = null;
  const history: Evolution2Result['history'] = [];

  for (let gen = 0; gen < generations; gen++) {
    const scored = pop.map(f => ({ f, s: evalFitness(f) }));
    let genBest = -1;
    let sum = 0;
    for (const x of scored) {
      sum += x.s;
      if (x.s > genBest) genBest = x.s;
      if (x.s > bestFitness) {
        bestFitness = x.s;
        best = cloneEvolFormation(x.f);
      }
    }
    if (bestArena === null) {
      bestArena = evaluateArena(BundleAI, best, Math.max(gamesPerTarget, 4));
    }
    history.push({ gen: gen + 1, bestFitness: genBest, avgFitness: sum / scored.length });
    console.log(`  第${gen + 1}代 最佳分离分 ${(genBest * 100).toFixed(1)}% 平均 ${(sum / scored.length * 100).toFixed(1)}%`);

    if (gen === generations - 1) break;

    // 精英保留 + 锦标赛选择 + 变异
    const next: EvolFormation[] = [];
    const elite = scored.reduce((a, b) => (b.s > a.s ? b : a));
    next.push(cloneEvolFormation(elite.f));
    while (next.length < POP) {
      const tourn = (): EvolFormation => {
        const i1 = Math.floor(rng() * scored.length);
        const i2 = Math.floor(rng() * scored.length);
        return scored[i1].s >= scored[i2].s ? scored[i1].f : scored[i2].f;
      };
      const parent = tourn();
      const child = mutate(parent, rng);
      next.push(child ? rename(child, `g${gen + 1}_${next.length}`) : cloneEvolFormation(parent));
    }
    pop.length = 0;
    pop.push(...next);
  }

  // 最终精评 best
  bestArena = evaluateArena(BundleAI, best, Math.max(gamesPerTarget, 4));

  return { best, bestFitness, bestArena: bestArena!, generations, population: POP, history };
}

// ---------- CLI ----------

if (process.argv[1] && process.argv[1].endsWith('evolution2.ts')) {
  const popSize = Number(process.argv[2]) || 12;
  const gens = Number(process.argv[3]) || 8;
  const gamesPerTarget = Number(process.argv[4]) || 2;
  const outPath = process.argv[5] || 'reports/evolution2_result.json';
  const seed = Number(process.argv[6]) || 42;
  const seedFormation = process.argv[7] || undefined;

  const w = globalThis as any;
  let BundleAI: any = null;
  try {
    const code = readFileSync(resolve('public/ai-bundle.iife.js'), 'utf8');
    const factory = new Function('window', 'globalThis', '"use strict";\n' + code + '\n;return BattleAI;');
    const bundleExports = factory(w, w);
    BundleAI = bundleExports?.BattleAI ?? w.BattleAI ?? null;
  } catch (e) {
    console.error(`[evolution2] bundle 加载失败: ${(e as Error).message}`);
    process.exit(1);
  }
  if (!BundleAI) { console.error('bundle 未加载'); process.exit(1); }

  const t0 = Date.now();
  const result = evolve2(BundleAI, popSize, gens, gamesPerTarget, seed, seedFormation);
  const ms = Date.now() - t0;
  console.log(`\n=== 树级进化完成（${popSize} 种群 × ${gens} 代，${(ms / 1000).toFixed(0)}s）===`);
  console.log(`最佳分离分（四维不败均值）：${(result.bestFitness * 100).toFixed(1)}%`);
  console.log(summarizeEvolFormation(result.best));
  console.log(formatArenaResult(result.best.name, result.bestArena));
  const json = {
    type: 'evolution2_result',
    bestFitness: result.bestFitness,
    history: result.history,
    arena: result.bestArena,
    formation: {
      name: result.best.name,
      archetype: result.best.archetype,
      team: result.best.team,
      tree: result.best.root,
    },
  };
  fsWrite(outPath, JSON.stringify(json, null, 2));
  console.log(`结果已保存 → ${outPath}`);
}
