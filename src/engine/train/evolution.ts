// ============================================================
// 遗传算法阵容探索：进化出新怪兽+徽章组合的阵容
// 适应度 = 对 formation_library 全部 7 阵型的平均胜率（greedy 快速评估，确定性 seed）
// 运行：npx vite-node --script src/engine/train/evolution.ts <种群> <代数> [输出路径]
// 注：评估用 greedy 对战（快）；进化出的阵容可再用搜索/模型精评
// ============================================================

import { writeFileSync as fsWrite } from 'node:fs';
import { playFullGame } from '../play_full_game';
import { DB_MONSTERS, DB_BADGES } from '../../game/Database';
import { FORMATION_LIBRARY } from '../../ai/formation_library';
import type { TeamSlot } from '../../game/GameEngine';

// ---------- 基因池 ----------

// 怪兽池：非召唤、非 126
const MONSTER_POOL = DB_MONSTERS.filter(m => !m.isSummon && m.id !== 126);
// 徽章池：排除未实现徽章（与 badge_presets 一致）
const BADGE_POOL = DB_BADGES.filter(b => ![14, 15, 19, 31, 34].includes(b.id));

const SLOTS = 8;
const MAX_TOTAL_COST = 16; // 5 回合满编预算上限，防止全 4 费不可下阵容

const OPPONENTS = FORMATION_LIBRARY.map(f => f.team);

interface Genome {
  slots: TeamSlot[];
}

function mulberry32(seed: number): () => number {
  let t = seed + 0x6D2B79F5;
  return () => {
    t += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function badgeLimitFor(cost: number): number {
  return cost >= 4 ? 3 : 2;
}

function randomGenome(rng: () => number): Genome {
  const pool = [...MONSTER_POOL];
  const slots: TeamSlot[] = [];
  let totalCost = 0;
  for (let i = 0; i < SLOTS; i++) {
    const idx = Math.floor(rng() * pool.length);
    const m = pool.splice(idx, 1)[0];
    if (!m) break;
    totalCost += m.cost;
    const maxBadges = badgeLimitFor(m.cost);
    const badgeCount = Math.floor(rng() * (maxBadges + 1)); // 0..maxBadges
    const badgeIds: number[] = [];
    for (let b = 0; b < badgeCount; b++) {
      let bid = BADGE_POOL[Math.floor(rng() * BADGE_POOL.length)].id;
      while (badgeIds.includes(bid)) bid = BADGE_POOL[Math.floor(rng() * BADGE_POOL.length)].id;
      badgeIds.push(bid);
    }
    slots.push({ monsterId: m.id, badgeIds });
  }
  // 若总费用超限，去掉末尾槽位直至不超
  while (totalCost > MAX_TOTAL_COST && slots.length > 0) {
    const removed = slots.pop()!;
    totalCost -= MONSTER_POOL.find(m => m.id === removed.monsterId)?.cost ?? 0;
  }
  return { slots };
}

function totalCostOf(g: Genome): number {
  return g.slots.reduce((s, slot) => s + (MONSTER_POOL.find(m => m.id === slot.monsterId)?.cost ?? 0), 0);
}

/** 适应度：对 7 阵型对手各 1 局（seed=对手索引*7919+个体哈希），返回 0..7 胜场数 */
function fitness(g: Genome, seedBase: number): number {
  let wins = 0;
  for (let o = 0; o < OPPONENTS.length; o++) {
    const seed = seedBase * 1000 + o;
    const r = playFullGame(g.slots, OPPONENTS[o], { seed });
    if (r.winner === 1) wins += 1;
    else if (r.winner === 0) wins += 0.5;
  }
  return wins;
}

function crossover(a: Genome, b: Genome, rng: () => number): Genome {
  const cut = 1 + Math.floor(rng() * (SLOTS - 1));
  const slots = [...a.slots.slice(0, cut), ...b.slots.slice(cut)];
  // 去重：怪兽重复时用父本另一方补齐或剔除
  const seen = new Set<number>();
  const out: TeamSlot[] = [];
  for (const s of slots) {
    if (!seen.has(s.monsterId)) {
      seen.add(s.monsterId);
      out.push(s);
    }
  }
  // 补齐不足 8 槽：从池中补（不重复、总费不超）
  const missing = MONSTER_POOL.filter(m => !seen.has(m.id));
  let totalCost = totalCostOf({ slots: out });
  for (const m of missing) {
    if (out.length >= SLOTS) break;
    if (totalCost + m.cost > MAX_TOTAL_COST) continue;
    const maxBadges = badgeLimitFor(m.cost);
    const badgeCount = Math.floor(rng() * (maxBadges + 1));
    const badgeIds: TeamSlot['badgeIds'] = [];
    for (let b = 0; b < badgeCount; b++) {
      let bid = BADGE_POOL[Math.floor(rng() * BADGE_POOL.length)].id;
      while (badgeIds.includes(bid)) bid = BADGE_POOL[Math.floor(rng() * BADGE_POOL.length)].id;
      badgeIds.push(bid);
    }
    out.push({ monsterId: m.id, badgeIds });
    totalCost += m.cost;
  }
  return { slots: out };
}

function mutate(g: Genome, rng: () => number): Genome {
  const slots = g.slots.map(s => ({ ...s, badgeIds: [...s.badgeIds] }));
  const r = rng();
  if (r < 0.5) {
    // 变异：替换一个槽位的怪兽
    if (slots.length > 0) {
      const idx = Math.floor(rng() * slots.length);
      const used = new Set(slots.map(s => s.monsterId));
      const candidates = MONSTER_POOL.filter(m => !used.has(m.id));
      if (candidates.length > 0) {
        const m = candidates[Math.floor(rng() * candidates.length)];
        const maxBadges = badgeLimitFor(m.cost);
        const badgeCount = Math.floor(rng() * (maxBadges + 1));
        const badgeIds: TeamSlot['badgeIds'] = [];
        for (let b = 0; b < badgeCount; b++) {
          let bid = BADGE_POOL[Math.floor(rng() * BADGE_POOL.length)].id;
          while (badgeIds.includes(bid)) bid = BADGE_POOL[Math.floor(rng() * BADGE_POOL.length)].id;
          badgeIds.push(bid);
        }
        slots[idx] = { monsterId: m.id, badgeIds };
      }
    }
  } else {
    // 变异：给随机一个槽位加/换一个徽章
    if (slots.length > 0) {
      const idx = Math.floor(rng() * slots.length);
      const slot = slots[idx];
      const maxBadges = badgeLimitFor(MONSTER_POOL.find(m => m.id === slot.monsterId)?.cost ?? 2);
      if (slot.badgeIds.length >= maxBadges) {
        slot.badgeIds.splice(Math.floor(rng() * slot.badgeIds.length), 1);
      } else {
        let bid = BADGE_POOL[Math.floor(rng() * BADGE_POOL.length)].id;
        while (slot.badgeIds.includes(bid)) bid = BADGE_POOL[Math.floor(rng() * BADGE_POOL.length)].id;
        slot.badgeIds.push(bid);
      }
    }
  }
  return { slots };
}

export interface EvolutionResult {
  best: Genome;
  bestFitness: number;
  generations: number;
  population: number;
  history: { gen: number; bestFitness: number; avgFitness: number }[];
}

export function evolve(population: number, generations: number, seed: number): EvolutionResult {
  const rng = mulberry32(seed);
  const POP = Math.max(4, population);

  // 初始种群：7 个已知阵型 + 随机补齐
  const pop: Genome[] = OPPONENTS.map(team => ({ slots: team.map(s => ({ ...s, badgeIds: [...s.badgeIds] })) }));
  while (pop.length < POP) pop.push(randomGenome(rng));

  const evalFitness = (g: Genome, idx: number): number => fitness(g, seed + idx);

  let best: Genome | null = null;
  let bestFitness = -1;
  const history: EvolutionResult['history'] = [];

  for (let gen = 0; gen < generations; gen++) {
    const scores = pop.map((g, i) => ({ g, s: evalFitness(g, i) }));
    let genBest = -1;
    let sum = 0;
    for (const x of scores) {
      sum += x.s;
      if (x.s > genBest) genBest = x.s;
      if (x.s > bestFitness) {
        bestFitness = x.s;
        best = { slots: x.g.slots.map(s => ({ ...s, badgeIds: [...s.badgeIds] })) };
      }
    }
    history.push({ gen: gen + 1, bestFitness: genBest, avgFitness: sum / scores.length });
    console.log(`  第${gen + 1}代 最佳 ${(genBest / OPPONENTS.length * 100).toFixed(1)}% 平均 ${(sum / scores.length / OPPONENTS.length * 100).toFixed(1)}%`);

    if (gen === generations - 1) break;

    // 锦标赛选择 + 交叉 + 变异 → 下一代
    const next: Genome[] = [];
    // 精英保留最优
    const elite = scores.reduce((a, b) => (b.s > a.s ? b : a));
    next.push({ slots: elite.g.slots.map(s => ({ ...s, badgeIds: [...s.badgeIds] })) });
    while (next.length < POP) {
      const tourn = (): Genome => {
        const i1 = Math.floor(rng() * scores.length);
        const i2 = Math.floor(rng() * scores.length);
        return scores[i1].s >= scores[i2].s ? scores[i1].g : scores[i2].g;
      };
      const a = tourn();
      const b = tourn();
      let child: Genome;
      if (rng() < 0.7) child = crossover(a, b, rng);
      else child = { slots: a.slots.map(s => ({ ...s, badgeIds: [...s.badgeIds] })) };
      if (rng() < 0.4) child = mutate(child, rng);
      next.push(child);
    }
    pop.length = 0;
    pop.push(...next);
  }

  return { best: best!, bestFitness, generations, population: POP, history };
}

// CLI 入口
if (process.argv[1] && process.argv[1].endsWith('evolution.ts')) {
  const popSize = Number(process.argv[2]) || 20;
  const gens = Number(process.argv[3]) || 10;
  const outPath = process.argv[4] || 'reports/evolution_result.json';
  const seed = Number(process.argv[5]) || 42;
  const t0 = Date.now();
  const result = evolve(popSize, gens, seed);
  console.log(`\n=== 进化完成（${popSize} 种群 × ${gens} 代，耗时 ${((Date.now() - t0) / 1000).toFixed(0)}s）===`);
  console.log(`最佳胜率：${(result.bestFitness / OPPONENTS.length * 100).toFixed(1)}%（${result.bestFitness}/${OPPONENTS.length} 对手）`);
  console.log('最优阵容:');
  result.best.slots.forEach(s => {
    const m = DB_MONSTERS.find(x => x.id === s.monsterId);
    console.log(`  ${s.monsterId} ${m?.name} [${s.badgeIds.join(',')}] (费${m?.cost})`);
  });
  const json = {
    type: 'evolution_result',
    bestFitness: result.bestFitness,
    opponents: OPPONENTS.length,
    history: result.history,
    team: result.best.slots,
  };
  fsWrite(outPath, JSON.stringify(json, null, 2));
  console.log(`结果已保存 → ${outPath}`);
}
