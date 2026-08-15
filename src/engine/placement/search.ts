// ============================================================
// 单步贪心搜索（方案二）：逐个放怪，每一步对候选 (怪兽,格子) 用真实回合战斗模拟评估。
// 评估 = 当前部分棋盘 + 该候选 + 贪心补齐剩余预算，打一场完整回合战斗（对手 = 敌方本轮基线计划）。
// 全确定性：搜索内部不使用随机；候选按固定顺序遍历、平局严格裁决（monsterId/x/y）。
// 模拟在重建棋盘上进行（真实引擎数据），跑完恢复 gameEngine/vfx，主流程零污染。
// ============================================================

import { DB_MONSTERS, DB_BADGES } from '../../game/Database';
import type { PlacedMonster } from '../../game/GameEngine';
import { gameEngine } from '../../game/GameEngine';
import { battleSystem } from '../../game/BattleSystem';
import { vfx } from '../../game/VfxManager';
import type { Placement } from '../types';
import type { BoardSnapshot } from './snapshot';
import { scorePlacement } from './heuristic';
import { planRoundPlacements } from './decide';
import { snapCounts, type CandidateCtx } from '../train/features';

const BATTLE_DT = 0.04; // 25 帧/秒，与网页 Director 固定逻辑步长 FIXED_DT 一致（战斗结果可复现）

const ZONE: Record<'p1' | 'p2', { min: number; max: number }> = {
  p1: { min: 0, max: 4 },
  p2: { min: 6, max: 10 },
};

export interface SearchOptions {
  /** 每个怪兽候选格子数（启发式预筛 top-N），默认 3 */
  candidateCells?: number;
  /** 单场评估战斗超时兜底（秒），默认 40 */
  battleTimeoutSec?: number;
  /** 己方视角（训练样本胜负标签判定用） */
  side: 'p1' | 'p2';
  /** 阵型分支树本回合计划（人工先验特征） */
  treePlan?: { monsterId: number; x: number; y: number }[];
  /** 每个候选评估后回调（训练器数据收集钩子） */
  onCandidate?: (ctx: CandidateCtx) => void;
  /** 每步提交最优候选后回调（残局库收集钩子） */
  onSearchStep?: (info: {
    myMonsters: { dbId: number; x: number; y: number }[];
    enemyMonsters: { dbId: number; x: number; y: number }[];
    round: number;
    budget: number;
    action: { monsterId: number; x: number; y: number };
  }) => void;
  /** 本回合树计划动作优先（训练数据侧修正：开局坦克）；仅 R1 等指定回合传入 */
  forceTreeAction?: { monsterId: number; x: number; y: number }[];
}

interface Cand {
  monsterId: number;
  badgeIds: number[];
  x: number;
  y: number;
}

// ---------- 模拟棋盘重建 ----------

/** 本轮新放置的怪兽（桥接层构造模拟棋盘用） */
export function newSimMonster(placement: Placement, team: 1 | 2, round: number): PlacedMonster {
  const dbMonster = DB_MONSTERS.find(d => d.id === placement.monsterId);
  if (!dbMonster) throw new Error(`search: unknown monster id ${placement.monsterId}`);
  const badges = placement.badgeIds
    .map(id => DB_BADGES.find(b => b.id === id))
    .filter((b): b is typeof DB_BADGES[number] => !!b);
  return {
    id: `${team === 1 ? 'p1' : 'p2'}_r${round}_x${placement.x}_y${placement.y}`,
    dbId: dbMonster.id,
    data: dbMonster,
    badges,
    gridX: placement.x,
    gridY: placement.y,
    initialGridX: placement.x,
    initialGridY: placement.y,
    placedRound: round,
    team,
    hp: dbMonster.hp,
    maxHp: dbMonster.hp,
    atk: dbMonster.atk,
    ats: dbMonster.ats,
    range: dbMonster.range,
    speed: dbMonster.speed,
    shield: 0,
    skillCdProgress: 0,
    isDead: false,
    statusEffects: [],
    state: 'idle',
  };
}

/** 幸存者副本（startBattle 会重置全部战斗属性，只需保留身份/位置/徽章） */
function copySurvivor(m: PlacedMonster): PlacedMonster {
  return { ...m, badges: m.badges.slice(), isDead: false, statusEffects: [], state: 'idle' };
}

// ---------- 回合战斗模拟 ----------

export interface SimOutcome {
  d1: number; // P1 本回合得分增量（0/1）
  d2: number; // P2 本回合得分增量（0/1）
  hpP1: number; hpP2: number;
  killsP1: number; killsP2: number;
  /** 战斗后存活怪（桥接层 self-play 推进棋盘用） */
  survivors: { dbId: number; x: number; y: number; team: 1 | 2; hp: number; maxHp: number; badgeIds: number[] }[];
}

export function simulateRoundBattle(board: PlacedMonster[], round: number, timeoutSec: number): SimOutcome {
  // 保存引擎状态，模拟后恢复，保证主流程零污染
  const saved = {
    board: gameEngine.boardMonsters,
    p1: gameEngine.p1Score,
    p2: gameEngine.p2Score,
    state: gameEngine.state,
    round: gameEngine.currentRound,
    replaySeed: (gameEngine as any)._replaySeed as number,
    stats: gameEngine.combatStats,
    isReplaying: gameEngine.isReplaying,
  };

  gameEngine.currentRound = round;
  gameEngine.boardMonsters = board;
  const s1 = gameEngine.p1Score;
  const s2 = gameEngine.p2Score;

  // 开局清 vfx：restartGame/startBattle 不清残留，上一局飞行子弹会污染本次模拟
  // （训练沙盒 vs 网页战斗逐位一致的关键前提）。
  vfx.particles.length = 0;
  vfx.backgroundParticles.length = 0;
  vfx.projectiles.length = 0;
  vfx.floatingTexts.length = 0;
  vfx.auraCircles = [];

  // 与 play_full_game 完全相同的战斗循环；startBattle 内用 round*1000+456 重置种子，
  // 所有候选在同一随机流下评估 → 结果可直接比较
  battleSystem.startBattle();
  let elapsed = 0;
  while (battleSystem.active && elapsed < timeoutSec) {
    battleSystem.update(BATTLE_DT);
    vfx.update(BATTLE_DT);
    elapsed += BATTLE_DT;
  }
  if (battleSystem.active) {
    (battleSystem as any).endBattle(null); // 超时兜底，记平局
  }

  const boardAfter = gameEngine.boardMonsters;
  const alive = boardAfter.filter(m => !m.isDead);
  const hpP1 = alive.filter(m => m.team === 1).reduce((s, m) => s + m.hp, 0);
  const hpP2 = alive.filter(m => m.team === 2).reduce((s, m) => s + m.hp, 0);
  const killsP1 = boardAfter.filter(m => m.team === 1 && m.isDead).length;
  const killsP2 = boardAfter.filter(m => m.team === 2 && m.isDead).length;

  const outcome: SimOutcome = {
    d1: gameEngine.p1Score - s1,
    d2: gameEngine.p2Score - s2,
    hpP1,
    hpP2,
    killsP1,
    killsP2,
    // 与真实主流程 resetBoardForNextRound 一致：所有非召唤怪（含本回合战死的）复活并回到放置原位，
    // 怪不会跨回合消失，战斗只决定得分；仅移除召唤物/召唤类怪兽（summon_、dbId 126、isSummon）
    survivors: boardAfter
      .filter(m => !m.id.startsWith('summon_') && m.dbId !== 126 && !m.data.isSummon)
      .map(m => ({
        dbId: m.dbId,
        x: m.initialGridX,
        y: m.initialGridY,
        team: m.team as 1 | 2,
        hp: m.hp,
        maxHp: m.maxHp,
        badgeIds: m.badges.map(b => b.id),
      })),
  };

  // 恢复引擎状态 + 清理 VFX 残留（弹幕/粒子不得跨模拟泄漏）
  gameEngine.boardMonsters = saved.board;
  gameEngine.p1Score = saved.p1;
  gameEngine.p2Score = saved.p2;
  gameEngine.state = saved.state;
  gameEngine.currentRound = saved.round;
  (gameEngine as any)._replaySeed = saved.replaySeed;
  gameEngine.combatStats = saved.stats;
  gameEngine.isReplaying = saved.isReplaying;
  vfx.particles.length = 0;
  vfx.backgroundParticles.length = 0;
  vfx.projectiles.length = 0;
  vfx.floatingTexts.length = 0;
  vfx.auraCircles = [];

  return outcome;
}

// ---------- 候选评估 ----------

function evaluateCandidate(
  snap: BoardSnapshot,
  cand: Cand,
  plan: Placement[],
  survivors: PlacedMonster[],
  enemyPlan: Placement[],
  myTeam: 1 | 2,
  round: number,
  budget: number,
  timeoutSec: number,
): number {
  // 候选落定后的部分棋盘 + 贪心补齐剩余预算
  const candGrid = snap.grid.map(row => [...row]);
  for (const p of plan) candGrid[p.y][p.x] = { monsterId: p.monsterId } as unknown as PlacedMonster;
  candGrid[cand.y][cand.x] = { monsterId: cand.monsterId } as unknown as PlacedMonster;

  const myLight = snap.myMonsters.map(m => ({ dbId: m.dbId, gridX: m.gridX, gridY: m.gridY }) as unknown as PlacedMonster);
  for (const p of plan) myLight.push({ dbId: p.monsterId, gridX: p.x, gridY: p.y } as unknown as PlacedMonster);
  myLight.push({ dbId: cand.monsterId, gridX: cand.x, gridY: cand.y } as unknown as PlacedMonster);

  const partialSnap: BoardSnapshot = {
    side: snap.side,
    round,
    hand: snap.hand,
    grid: candGrid,
    myMonsters: myLight,
    enemyMonsters: snap.enemyMonsters,
    budget: budget - (DB_MONSTERS.find(m => m.id === cand.monsterId)!.cost),
  };
  const fill = planRoundPlacements(partialSnap);

  // 组装模拟棋盘：幸存者（双方）+ 己方（已提交 + 候选 + 补齐）+ 敌方计划
  const board: PlacedMonster[] = survivors.map(copySurvivor);
  for (const p of plan) board.push(newSimMonster(p, myTeam, round));
  board.push(newSimMonster(cand, myTeam, round));
  for (const p of fill) board.push(newSimMonster(p, myTeam, round));
  const enemyTeam = myTeam === 1 ? 2 : 1;
  for (const p of enemyPlan) board.push(newSimMonster(p, enemyTeam, round));

  const o = simulateRoundBattle(board, round, timeoutSec);
  // 评分：回合胜负 >> 击杀差 >> 存活血量差（全部从己方视角）
  const d = myTeam === 1 ? o.d1 - o.d2 : o.d2 - o.d1;
  const kills = myTeam === 1 ? o.killsP1 - o.killsP2 : o.killsP2 - o.killsP1;
  const hp = myTeam === 1 ? o.hpP1 - o.hpP2 : o.hpP2 - o.hpP1;
  return d * 1_000_000_000 + kills * 1_000_000 + hp;
}

// ---------- 主入口 ----------

/**
 * 单步贪心搜索规划器。
 * @param snap 本回合快照（雾战裁剪，供决策合法性/手牌/预算）
 * @param enemyPlan 敌方本轮基线计划（评估时作为对手）
 * @param opts 候选格数等配置
 */
export function planRoundPlacementsSearch(
  snap: BoardSnapshot,
  enemyPlan: Placement[],
  opts: SearchOptions = { side: 'p1' }, // side 必填，所有真实调用均显式传入；默认值仅作类型占位
): Placement[] {
  const N = opts.candidateCells ?? 3;
  const timeoutSec = opts.battleTimeoutSec ?? 45; // 40s 战斗 + 缓冲兜底
  const zone = ZONE[snap.side];
  const myTeam = snap.side === 'p1' ? 1 : 2;
  const round = snap.round;

  // 幸存者取真实引擎棋盘：战斗模拟需要完整真实数据（雾战裁剪只作用于决策输入快照）
  const survivors = gameEngine.boardMonsters.filter(m => !m.isDead);

  const plan: Placement[] = [];
  const placedIds = new Set<number>(snap.myMonsters.map(m => m.dbId));
  const localGrid = snap.grid.map(row => [...row]);
  let budget = snap.budget;
  // 树计划动作优先队列（数据侧修正：如 R1 坦克开局）。搜索照跑产生候选样本，
  // 但提交时若队里有可放置的树动作则优先采用，用尽即止；仅用于开局等少数回合。
  const forceQueue = opts.forceTreeAction ? [...opts.forceTreeAction] : [];

  while (true) {
    // 当前已提交部分的轻量己方列表（用于候选格打分与补齐防重）
    const myLight = snap.myMonsters.map(m => ({ dbId: m.dbId, gridX: m.gridX, gridY: m.gridY }) as unknown as PlacedMonster);
    for (const p of plan) myLight.push({ dbId: p.monsterId, gridX: p.x, gridY: p.y } as unknown as PlacedMonster);
    const curSnap: BoardSnapshot = { ...snap, grid: localGrid, myMonsters: myLight };

    // 1) 候选生成：每个可用怪兽启发式 top-N 格
    const candidates: Cand[] = [];
    for (const card of snap.hand) {
      if (placedIds.has(card.monsterId)) continue;
      const monster = DB_MONSTERS.find(m => m.id === card.monsterId);
      if (!monster || monster.cost > budget) continue;

      const cells: { x: number; y: number; score: number }[] = [];
      for (let y = 0; y < 5; y++) {
        for (let x = zone.min; x <= zone.max; x++) {
          if (localGrid[y][x] !== null) continue;
          cells.push({ x, y, score: scorePlacement(monster, card.badgeIds, x, y, curSnap) });
        }
      }
      // 确定性排序：分数降序，平局取 x/y 小者
      cells.sort((a, b) => b.score - a.score || a.x - b.x || a.y - b.y);
      for (const c of cells.slice(0, N)) {
        candidates.push({ monsterId: card.monsterId, badgeIds: card.badgeIds, x: c.x, y: c.y });
      }
    }
    if (candidates.length === 0) break;

    // 2) 评估每个候选：完整回合战斗模拟
    let best: Cand | null = null;
    let bestScore = -Infinity;
    // 本轮所有候选 ctx 缓存：提交确定后统一回调（带 chosen 标记，供标签加权）
    const candCtxs: CandidateCtx[] = [];
    for (const cand of candidates) {
      const score = evaluateCandidate(snap, cand, plan, survivors, enemyPlan, myTeam, round, budget, timeoutSec);
      // 训练器钩子：导出 (候选, 搜索评分) 样本
      const { rowDensity, adjFriendly } = snapCounts(curSnap, cand.x, cand.y);
      candCtxs.push({
        cand: { monsterId: cand.monsterId, badgeIds: cand.badgeIds, x: cand.x, y: cand.y },
        score,
        round,
        budget,
        side: opts.side,
        treePlan: opts.treePlan,
        myCount: curSnap.myMonsters.length,
        enemyCount: snap.enemyMonsters.length,
        rowDensity,
        adjFriendly,
      });
      const isBetter =
        best === null ||
        score > bestScore ||
        (score === bestScore &&
          (cand.monsterId < best.monsterId ||
            (cand.monsterId === best.monsterId && cand.x < best.x) ||
            (cand.monsterId === best.monsterId && cand.x === best.x && cand.y < best.y)));
      if (isBetter) {
        best = cand;
        bestScore = score;
      }
    }
    if (!best) break;

    // 3) 提交：树计划动作优先（数据侧修正：如 R1 坦克开局），否则用搜索最优候选
    let chosen: Cand | null = best;
    if (forceQueue.length > 0) {
      const idx = forceQueue.findIndex(ta => {
        const card = snap.hand.find(h => h.monsterId === ta.monsterId && !placedIds.has(h.monsterId));
        const monster = card ? DB_MONSTERS.find(m => m.id === ta.monsterId) : undefined;
        return (
          !!card && !!monster && monster.cost <= budget &&
          ta.x >= zone.min && ta.x <= zone.max && ta.y >= 0 && ta.y < 5 &&
          localGrid[ta.y][ta.x] === null
        );
      });
      if (idx >= 0) {
        const ta = forceQueue.splice(idx, 1)[0];
        const card = snap.hand.find(h => h.monsterId === ta.monsterId)!;
        chosen = { monsterId: ta.monsterId, badgeIds: card.badgeIds, x: ta.x, y: ta.y };
      }
    }

    // 统一回调：被选中的候选标记 chosen=true（训练器用它做标签加权）
    if (opts.onCandidate) {
      for (const cc of candCtxs) {
        opts.onCandidate({
          ...cc,
          chosen:
            cc.cand.monsterId === chosen.monsterId &&
            cc.cand.x === chosen.x &&
            cc.cand.y === chosen.y,
        });
      }
    }

    if (opts.onSearchStep) {
      opts.onSearchStep({
        myMonsters: myLight.map(m => ({ dbId: m.dbId, x: m.gridX, y: m.gridY })),
        enemyMonsters: snap.enemyMonsters.map(m => ({ dbId: m.dbId, x: m.gridX, y: m.gridY })),
        round,
        budget,
        action: { monsterId: chosen.monsterId, x: chosen.x, y: chosen.y },
      });
    }
    plan.push({ monsterId: chosen.monsterId, badgeIds: chosen.badgeIds, x: chosen.x, y: chosen.y });
    placedIds.add(chosen.monsterId);
    budget -= DB_MONSTERS.find(m => m.id === chosen.monsterId)!.cost;
    localGrid[chosen.y][chosen.x] = { monsterId: chosen.monsterId } as unknown as PlacedMonster;
  }

  return plan;
}
