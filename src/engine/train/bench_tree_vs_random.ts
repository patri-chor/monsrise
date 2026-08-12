// ============================================================
// 原生基准：阵型树计划（bundle 先验阵型）vs 随机合法放置
// 直接用 src/game 原生引擎（vite-node），不经 Python bridge，仅无渲染加速。
// bundle 侧 = 阵型树计划（planForRound 每回合展开，p1 侧镜像）+ 贪心补剩余预算；
// 随机侧 = randPlacementPlan（同卡组随机乱放，每回合花光预算）。
// 运行：npx vite-node --script src/engine/train/bench_tree_vs_random.ts [--deck 泉水剑|坚果救星|all] [--games 20] [--dt 0.1]
// 注意 --dt 大步长会改变攻击时序语义，结果仅供量级参考。
// ============================================================

import '../env';
import { gameEngine } from '../../game/GameEngine';
import type { PlacedMonster, TeamSlot } from '../../game/GameEngine';
import { battleSystem } from '../../game/BattleSystem';
import { vfx } from '../../game/VfxManager';
import { registerAllBadges } from '../../game/BadgeSystem';
import { DB_MONSTERS } from '../../game/Database';
import { buildSnapshot } from '../placement/snapshot';
import { planRoundPlacements } from '../placement/decide';
import { planForRound } from './features';
import { FORMATION_LIBRARY } from '../../ai/formation_library';
import type { FormationTree, FormationTeamSlot } from '../../ai/types';
import type { Placement } from '../types';

registerAllBadges();
vfx.particlesEnabled = false;

// ---------- CLI 参数 ----------
const ARGV: Record<string, string> = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith('--')) {
    const k = a.slice(2);
    const v = process.argv[i + 1];
    if (v !== undefined && !v.startsWith('--')) {
      ARGV[k] = v;
      i++;
    } else {
      ARGV[k] = 'true';
    }
  }
}
const DECK = ARGV.deck ?? 'all';
const N_GAMES = Number(ARGV.games ?? 20);
const BATTLE_DT = Number(ARGV.dt ?? 0.1);
const RUNS = Number(ARGV.runs ?? 3); // 同 seed 集重复测时次数（取中位数，消除抖动）
const timeoutSec = 120;

const ZONE: Record<1 | 2, { min: number; max: number }> = {
  1: { min: 0, max: 4 },
  2: { min: 6, max: 10 },
};

/** mulberry32 确定性伪随机（随机侧可复现，保证优化前后逐局结果可比） */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 同卡组随机合法放置（每回合独立随机，花光剩余预算） */
function randPlacementPlan(
  team: FormationTeamSlot[],
  side: 1 | 2,
  budgetLimit: number,
  my: PlacedMonster[],
  rng: () => number = Math.random,
): Placement[] {
  const zone = ZONE[side];
  const hand = [...team];
  const occupied = new Set(my.map(m => m.gridX * 10 + m.gridY));
  let budget = budgetLimit;
  const placed: Placement[] = [];
  while (true) {
    const affordable = hand.filter(c => DB_MONSTERS.find(d => d.id === c.monsterId)!.cost <= budget);
    const free: { x: number; y: number }[] = [];
    for (let y = 0; y < 5; y++) for (let x = zone.min; x <= zone.max; x++) if (!occupied.has(x * 10 + y)) free.push({ x, y });
    if (affordable.length === 0 || free.length === 0) break;
    const c = affordable[Math.floor(rng() * affordable.length)];
    const cell = free[Math.floor(rng() * free.length)];
    const m = DB_MONSTERS.find(d => d.id === c.monsterId)!;
    occupied.add(cell.x * 10 + cell.y);
    placed.push({ monsterId: c.monsterId, badgeIds: c.badgeIds, x: cell.x, y: cell.y });
    hand.splice(hand.indexOf(c), 1);
    budget -= m.cost;
  }
  return placed;
}

/**
 * 一侧放置：kind='tree' → 阵型树计划（p1 镜像 + 手牌/预算/占格过滤）+ 贪心补剩余预算；
 * kind='random' → randPlacementPlan。
 */
function placeSidePlan(
  side: 'p1' | 'p2',
  kind: 'tree' | 'random',
  tree: FormationTree | undefined,
  team: FormationTeamSlot[],
  enemyTeam: FormationTeamSlot[],
  rng: () => number = Math.random,
): void {
  const teamId = side === 'p1' ? 1 : 2;
  if (kind === 'tree' && tree) {
    const raw = planForRound(tree, gameEngine.currentRound);
    const mirrored =
      side === 'p1' ? raw.map(p => ({ monsterId: p.monsterId, badgeIds: p.badgeIds, x: 10 - p.x, y: p.y })) : raw;
    const occupied = new Set(
      gameEngine.boardMonsters.filter(m => m.team === teamId).map(m => m.gridX * 10 + m.gridY),
    );
    const hand = [...team];
    let budget = gameEngine[teamId === 1 ? 'p1RemainingBudget' : 'p2RemainingBudget'];
    for (const p of mirrored) {
      const idx = hand.findIndex(s => s.monsterId === p.monsterId);
      if (idx < 0) continue;
      const db = DB_MONSTERS.find(d => d.id === p.monsterId);
      if (!db || db.cost > budget) continue;
      if (occupied.has(p.x * 10 + p.y)) continue;
      hand.splice(idx, 1);
      budget -= db.cost;
      occupied.add(p.x * 10 + p.y);
      gameEngine.placeMonster(p, p.x, p.y, teamId === 1);
    }
    // 树计划只覆盖部分预算 → 贪心补剩余（手牌/预算/占格由快照自动扣除已放部分）
    const snap2 = buildSnapshot(gameEngine, side, team as TeamSlot[], enemyTeam as TeamSlot[]);
    const fill = planRoundPlacements(snap2);
    for (const p of fill) {
      gameEngine.placeMonster(p, p.x, p.y, teamId === 1);
    }
  } else {
    const rand = randPlacementPlan(
      team,
      teamId,
      gameEngine[teamId === 1 ? 'p1RemainingBudget' : 'p2RemainingBudget'],
      gameEngine.boardMonsters.filter(m => m.team === teamId),
      rng,
    );
    for (const p of rand) {
      gameEngine.placeMonster(p, p.x, p.y, teamId === 1);
    }
  }
}

/** 一局：bundleSide 用阵型树计划，对侧随机。返回 (bundle胜, 平, bundle负) + 结果摘要 */
function playOne(
  team: FormationTeamSlot[],
  tree: FormationTree,
  bundleSide: 1 | 2,
  treeFirst: boolean,
  seed: number,
): { w: number; d: number; l: number; summary: string } {
  gameEngine.restartGame();
  gameEngine.mode = 'ai';
  gameEngine.teams = [team as TeamSlot[], team as TeamSlot[]];
  gameEngine.setReplaySeed(seed);
  const scores = [0, 0];
  const roundResults: (0 | 1 | 2)[] = [];
  for (let round = 1; round <= gameEngine.maxRounds; round++) {
    if (gameEngine.isGameOver()) break;
    gameEngine.currentRound = round;
    const treeSide = bundleSide === 1 ? 'p1' : 'p2';
    const randSide = bundleSide === 1 ? 'p2' : 'p1';
    // 入数组顺序也必须正交（树侧先/随机侧先各半），否则树侧恒先入数组 → 先手 bias 假象
    // 随机侧用固定 rng（seed 派生），整局完全可复现 → 优化前后逐局可比
    const rng = mulberry32(seed * 2654435761 + round);
    if (treeFirst) {
      placeSidePlan(treeSide, 'tree', tree, team, team);
      placeSidePlan(randSide, 'random', undefined, team, team, rng);
    } else {
      placeSidePlan(randSide, 'random', undefined, team, team, rng);
      placeSidePlan(treeSide, 'tree', tree, team, team);
    }
    const s1 = gameEngine.p1Score;
    const s2 = gameEngine.p2Score;
    battleSystem.startBattle();
    let elapsed = 0;
    while (battleSystem.active && elapsed < timeoutSec) {
      battleSystem.update(BATTLE_DT);
      vfx.update(BATTLE_DT);
      elapsed += BATTLE_DT;
    }
    if (battleSystem.active) (battleSystem as any).endBattle(null);
    const d1 = gameEngine.p1Score - s1;
    const d2 = gameEngine.p2Score - s2;
    scores[0] += d1;
    scores[1] += d2;
    roundResults.push(d1 === d2 ? 0 : d1 > d2 ? 1 : 2);
    vfx.particles.length = 0;
    vfx.backgroundParticles.length = 0;
    vfx.projectiles.length = 0;
    vfx.floatingTexts.length = 0;
    vfx.auraCircles = [];
    gameEngine.resetBoardForNextRound();
  }
  const bw = bundleSide === 1 ? scores[0] : scores[1];
  const bl = bundleSide === 1 ? scores[1] : scores[0];
  const summary = `side${bundleSide}${treeFirst ? 'T' : 'F'} ${roundResults.join('')} ${scores[0]}:${scores[1]}`;
  if (bw === bl) return { w: 0, d: 1, l: 0, summary };
  return bw > bl ? { w: 1, d: 0, l: 0, summary } : { w: 0, d: 0, l: 1, summary };
}

function main(): void {
  if (BATTLE_DT !== 0.1) {
    console.log(`[警告] --dt=${BATTLE_DT} 非标准步长：攻击时序语义已改变，结果仅供量级参考`);
  }
  const decks = DECK === 'all' ? FORMATION_LIBRARY : FORMATION_LIBRARY.filter(f => f.name === DECK);
  if (decks.length === 0) {
    console.log(`[错误] 未找到卡组 ${DECK}，可用: ${FORMATION_LIBRARY.map(f => f.name).join('/')}`);
    return;
  }
  const t0 = Date.now();
  let totalGames = 0;
  const rows: { name: string; w: number; d: number; l: number; ms: number }[] = [];
  for (const f of decks) {
    const team = f.team.filter(s => s.monsterId > 0);
    let w = 0, d = 0, l = 0;
    const perRunMs: number[] = [];
    let baseSummaries: string[] | null = null;
    for (let run = 0; run < RUNS; run++) {
      const rt0 = Date.now();
      let rw = 0, rd = 0, rl = 0;
      const runSummaries: string[] = [];
      for (let g = 0; g < N_GAMES; g++) {
        // 位置与入数组顺序 4 种组合正交（抵消左右位置 bias + 数组顺序 bias）：
        // g%4==0 树左+树先 / ==1 树左+随机先 / ==2 树右+树先 / ==3 树右+随机先
        const bundleSide: 1 | 2 = g % 2 === 0 ? 1 : 2;
        const treeFirst = (g % 4) < 2;
        const r = playOne(team, f.tree, bundleSide, treeFirst, 1000 + g);
        rw += r.w; rd += r.d; rl += r.l;
        const s = `${g}:${r.summary}`;
        runSummaries.push(s);
        if (run === 0) console.log(`  ${f.name} g${s}`);
      }
      perRunMs.push(Date.now() - rt0);
      totalGames += N_GAMES;
      if (run === 0) {
        w = rw; d = rd; l = rl;
        baseSummaries = runSummaries;
      } else if (baseSummaries && JSON.stringify(baseSummaries) !== JSON.stringify(runSummaries)) {
        console.log(`[警告] ${f.name} run${run} 结果摘要与 run0 不一致！`);
      }
    }
    const sortedMs = [...perRunMs].sort((a, b) => a - b);
    const medMs = sortedMs[Math.floor(sortedMs.length / 2)];
    rows.push({ name: f.name, w, d, l, ms: medMs });
    const ev = w + d + l;
    console.log(
      `[${f.name}] ${N_GAMES}局×${RUNS} 胜${w} 平${d} 负${l} 阵型侧胜率=${ev ? (w / ev * 100).toFixed(1) : 0}% ` +
        `各遍耗时=${perRunMs.join('/')}ms 中位数=${medMs}ms`,
    );
  }
  const totalMs = Date.now() - t0;
  console.log('');
  console.log('阵型 vs 随机 汇总（阵型侧胜率，耗时=多次测时中位数）：');
  for (const r of rows) {
    const ev = r.w + r.d + r.l;
    console.log(`  ${r.name.padEnd(6)}: ${(ev ? (r.w / ev * 100) : 0).toFixed(1)}%  (胜${r.w}/平${r.d}/负${r.l})  ${r.ms}ms`);
  }
  console.log(`共 ${totalGames} 局 总耗时${(totalMs / 1000).toFixed(1)}s dt=${BATTLE_DT} runs=${RUNS}`);
}

main();
