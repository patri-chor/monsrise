// ============================================================
// 树优化器 —— 模拟退火爬山（替代遗传算法，对树结构搜索更高效）
//
// 为什么比 GA 快：GA 每代评估整个种群（N 个体 × 每靶多局），
// 但真正有用的只是"当前最优 + 一次成功变异"。爬山法每步只评估
// 1 个变异体（接受则保留、拒绝则回退），同样评估预算下能探索
// 约 N 倍于 GA 的步数。
//
// 模拟退火：温度从高到低，前期允许接受更差解（跳出局部最优），
// 后期退化为纯爬山（精细收敛）。
//
// 适应度 = arena 分离测试 weakest（3靶×先/后手 6 格最弱不败率，maximin 补短板）。
// 每步用 gamesPerTarget 快评（噪声容忍，用于排序），
// 最终 best 用更多局数精评。
//
// 运行：npx vite-node --script src/engine/train/hill_climb.ts [种子阵型] [步数] [每靶局数] [输出路径] [seed]
// ============================================================

import { readFileSync, writeFileSync } from 'node:fs';
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

/** 收集所有可变异条件的节点 */
function condNodes(f: EvolFormation): EvolNode[] {
  return walkEvolNodes(f.root).filter(n => n.round >= 1);
}

/** 单次随机变异（与 evolution2.mutate 同算子集） */
function mutate(f: EvolFormation, rng: () => number): EvolFormation | null {
  const ids = teamIds(f);
  const mPool = monsterFeaturePool();
  const bPool = badgeFeaturePool();
  for (let attempt = 0; attempt < 10; attempt++) {
    const r = rng();
    let out: EvolFormation | null = null;
    if (r < 0.15 && ids.length >= 2) {
      const i = Math.floor(rng() * ids.length);
      let j = Math.floor(rng() * ids.length);
      if (j === i) j = (j + 1) % ids.length;
      out = swapMonsters(f, ids[i], ids[j]);
    } else if (r < 0.28) {
      const monsterId = ids[Math.floor(rng() * ids.length)];
      const rounds = walkEvolNodes(f.root)
        .filter(n => n.round >= 2 && n.placements.some(p => p.monsterId === monsterId))
        .map(n => n.round);
      if (rounds.length === 0) continue;
      const fromRound = rounds[Math.floor(rng() * rounds.length)];
      const toRound = 1 + Math.floor(rng() * (fromRound - 1));
      out = moveEarlier(f, monsterId, fromRound, toRound);
    } else if (r < 0.38) {
      const nodes = walkEvolNodes(f.root).filter(n => n.placements.length >= 2);
      if (nodes.length === 0) continue;
      const node = nodes[Math.floor(rng() * nodes.length)];
      const i = Math.floor(rng() * node.placements.length);
      let j = Math.floor(rng() * node.placements.length);
      if (j === i) j = (j + 1) % node.placements.length;
      out = swapRoundOrder(f, node.id, i, j);
    } else if (r < 0.52) {
      const monsterId = ids[Math.floor(rng() * ids.length)];
      const dx = Math.floor(rng() * 5) - 2;
      const dy = Math.floor(rng() * 5) - 2;
      out = shiftPosition(f, monsterId, dx, dy);
    } else if (r < 0.72) {
      const nodes = condNodes(f);
      if (nodes.length === 0) continue;
      const node = nodes[Math.floor(rng() * nodes.length)];
      out = mutateCondition(f, node.id, mPool, bPool, rng);
    } else if (r < 0.86) {
      out = addBranch(f, mPool, bPool, rng);
    } else {
      out = removeBranch(f, rng);
    }
    if (out) return out;
  }
  return null;
}

export interface HillClimbResult {
  best: EvolFormation;
  bestFitness: number;
  bestArena: ArenaResult;
  steps: number;
  accepted: number;
  history: { step: number; fitness: number; bestFitness: number; temp: number }[];
}

/**
 * 模拟退火爬山优化放置树（卡组固定）。
 * @param T0 初始温度（相对 adScore 0-1 的尺度）
 * @param Tmin 终止温度
 * @param alpha 降温系数（每步）
 */
export function hillClimb(
  BundleAI: any,
  seedFormation: EvolFormation,
  steps: number,
  gamesPerTarget: number,
  seed: number,
  T0 = 0.10,
  Tmin = 0.005,
  alpha = 0.985,
  evalGamesPerTarget?: number, // 最终精评局数（默认 gamesPerTarget，但建议 >=8 降噪）
): HillClimbResult {
  const rng = mulberry32(seed);
  let current = cloneEvolFormation(seedFormation);
  // 适应度 = weakest（最弱格不败率），优先补短板
  let currentFit = evaluateArena(BundleAI, current, gamesPerTarget).weakest;

  let best = cloneEvolFormation(current);
  let bestFit = currentFit;
  let bestArena: ArenaResult | null = null;
  let accepted = 0;
  const history: HillClimbResult['history'] = [];
  let T = T0;

  for (let step = 0; step < steps; step++) {
    const child = mutate(current, rng);
    if (child) {
      const childFit = evaluateArena(BundleAI, child, gamesPerTarget).weakest;
      const delta = childFit - currentFit;
      // 退火接受准则：更优必接受，更差以 exp(delta/T) 概率接受
      if (delta >= 0 || rng() < Math.exp(delta / T)) {
        current = child;
        currentFit = childFit;
        accepted++;
        if (childFit > bestFit) {
          bestFit = childFit;
          best = cloneEvolFormation(child);
        }
      }
    }
    T = Math.max(Tmin, T * alpha);
    if (step % 5 === 0 || step === steps - 1) {
      console.log(`  步${step + 1}/${steps} 当前 ${(currentFit * 100).toFixed(1)}% 最佳 ${(bestFit * 100).toFixed(1)}% 温度 ${T.toFixed(4)}`);
    }
    history.push({ step: step + 1, fitness: currentFit, bestFitness: bestFit, temp: T });
  }

  // 最终精评（更多局数降噪，验证真实增益）
  const finalGames = evalGamesPerTarget ?? Math.max(gamesPerTarget, 8);
  bestArena = evaluateArena(BundleAI, best, finalGames);
  return { best, bestFitness: bestFit, bestArena: bestArena!, steps, accepted, history };
}

// ---------- CLI ----------

if (process.argv[1] && process.argv[1].endsWith('hill_climb.ts')) {
  const seedName = process.argv[2] || '肃清';
  const steps = Number(process.argv[3]) || 40;
  const gamesPerTarget = Number(process.argv[4]) || 2;
  const outPath = process.argv[5] || 'reports/hill_climb_result.json';
  const seed = Number(process.argv[6]) || 42;
  const evalGames = Number(process.argv[7]) || 8; // 最终精评局数

  const w = globalThis as any;
  let BundleAI: any = null;
  try {
    const code = readFileSync(resolve('public/ai-bundle.iife.js'), 'utf8');
    const factory = new Function('window', 'globalThis', '"use strict";\n' + code + '\n;return BattleAI;');
    const bundleExports = factory(w, w);
    BundleAI = bundleExports?.BattleAI ?? w.BattleAI ?? null;
  } catch (e) {
    console.error(`[hill_climb] bundle 加载失败: ${(e as Error).message}`);
    process.exit(1);
  }
  if (!BundleAI) { console.error('bundle 未加载'); process.exit(1); }

  const src = FORMATION_LIBRARY.find(f => f.name === seedName);
  if (!src) { console.error(`种子阵型不存在: ${seedName}`); process.exit(1); }

  const t0 = Date.now();
  const result = hillClimb(BundleAI, formationToEvol(src), steps, gamesPerTarget, seed, 0.10, 0.005, 0.985, evalGames);
  const ms = Date.now() - t0;
  console.log(`\n=== 模拟退火爬山完成（${steps} 步，${(ms / 1000).toFixed(0)}s，接受 ${result.accepted} 次）===`);
  console.log(`最佳分离分：${(result.bestFitness * 100).toFixed(1)}%`);
  console.log(summarizeEvolFormation(result.best));
  console.log(formatArenaResult(result.best.name, result.bestArena));
  const json = {
    type: 'hill_climb_result',
    seedFormation: seedName,
    bestFitness: result.bestFitness,
    steps: result.steps,
    accepted: result.accepted,
    history: result.history,
    arena: result.bestArena,
    formation: {
      name: result.best.name,
      archetype: result.best.archetype,
      team: result.best.team,
      tree: result.best.root,
    },
  };
  writeFileSync(outPath, JSON.stringify(json, null, 2));
  console.log(`结果已保存 → ${outPath}`);
}
