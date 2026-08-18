// ============================================================
// playFullGame —— 地基：给定两套阵容，打一场完整对局并返回胜负
// 流程：5 回合（预算累计 4/8/12/14/16），每回合双方盲放 → 战斗一场，先 3 胜
// 基座：当前游戏栈（GameEngine 回合/预算 + BattleSystem 真实战斗）
// ============================================================

import './env'; // 环境桩必须最先执行
import { gameEngine } from '../game/GameEngine';
import type { PlacedMonster, TeamSlot } from '../game/GameEngine';
import { DB_MONSTERS } from '../game/Database';
import { battleSystem } from '../game/BattleSystem';
import { vfx } from '../game/VfxManager';
import { registerAllBadges } from '../game/BadgeSystem';
import type { MatchResult, Placement } from './types';
import { buildSnapshot } from './placement/snapshot';
import type { BoardSnapshot } from './placement/snapshot';
import { planRoundPlacements } from './placement/decide';
import { planForRound } from '../ai/formation_tree';
import type { FormationTree } from '../ai/types';
import { planRoundPlacementsSearch } from './placement/search';

const BATTLE_DT = 0.04; // 25 帧/秒，与网页 Director 固定逻辑步长一致

/** T032 A.5/D.1：产品路径执行语义版本（进入每个产品轨迹事件与 manifest） */
export const EXECUTION_SEMANTICS_VERSION = 'play_full_game_product_path_v1';

/** 产品棋盘区（p1: x0-4, p2: x6-10） */
export const PRODUCT_ZONES: Record<1 | 2, { min: number; max: number }> = {
  1: { min: 0, max: 4 },
  2: { min: 6, max: 10 },
};

// ---------- T032 A：声明式部署策略契约 ----------

/** 一个已排序的声明式部署意图（策略只产出意图，产品入口全权校验/执行） */
export interface DeploymentIntent {
  monsterId: number;
  plannedX: number;
  plannedY: number;
  /** 可选分支/决策溯源（树策略提供；缺省 = 无分支） */
  branch?: { branchId: string; branchLabel?: string } | null;
}

/** 策略可读的只读上下文（禁止篡改游戏状态 / 直接放置 / 计算扣费） */
export interface DeploymentStrategyContext {
  /** 产品棋盘侧：1 = p1(teamA) / 2 = p2(teamB) */
  side: 1 | 2;
  /** 来源侧身份标识（如阵型名） */
  identity: string;
  round: number;
  seed: number;
  /** 确定性 RNG（seed+side+round 派生） */
  rng: () => number;
  /** 来源完整卡组 */
  team: TeamSlot[];
  /** 本回合可放置手牌（= 完整卡组；已上场怪由 ownMonsters 推断） */
  hand: TeamSlot[];
  /** 己方场上（前几回合已部署） */
  ownMonsters: PlacedMonster[];
  /** 敌方已揭晓场（雾战裁剪徽章） */
  enemyMonsters: PlacedMonster[];
  /** 敌方已揭晓手牌（前 4 槽位） */
  enemyRevealedHand: TeamSlot[];
  /** 本回合剩余预算 */
  budget: number;
  /** 己方棋盘区（产品坐标） */
  zone: { min: number; max: number };
}

export type DeploymentStrategy = (ctx: DeploymentStrategyContext) => DeploymentIntent[];

// ---------- T032 A.5：产品轨迹事件 ----------

export interface ProductDeploymentTrace {
  executionSemanticsVersion: string;
  round: number;
  /** 产品棋盘侧 */
  side: 1 | 2;
  /** 来源侧 */
  sourceSide: 1 | 2;
  identity: string;
  monsterId: number;
  attemptOrder: number;
  plannedX: number;
  plannedY: number;
  actualX: number | null;
  actualY: number | null;
  accepted: boolean;
  rejectionReason: string | null;
  budgetBefore: number;
  costCharged: number;
  budgetAfter: number;
  branch: { branchId: string; branchLabel?: string } | null;
}

export interface ProductRoundObservation {
  round: number;
  side: 1 | 2;
  handIds: number[];
  handBadges: number[];
  boardIds: number[];
}

/** 确定性小 PRNG（mulberry32）—— 策略 rng 派生用 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 曼哈顿螺旋就近寻空位（产品路径拥有搬迁语义；zone 内） */
function relocateNear(x: number, y: number, zone: { min: number; max: number }, occupied: Set<string>): [number, number] | null {
  for (let d = 1; d <= 8; d++) {
    for (let dy = -d; dy <= d; dy++) {
      for (let dx = -d; dx <= d; dx++) {
        if (Math.abs(dx) + Math.abs(dy) !== d) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < zone.min || nx > zone.max || ny < 0 || ny > 4) continue;
        if (occupied.has(`${nx},${ny}`)) continue;
        return [nx, ny];
      }
    }
  }
  return null;
}

/** 由快照构建策略上下文（只读） */
function strategyContext(
  side: 1 | 2,
  snap: BoardSnapshot,
  seed: number,
  identity: string,
  enemyTeam: TeamSlot[],
): DeploymentStrategyContext {
  const zone = PRODUCT_ZONES[side];
  return {
    side,
    identity,
    round: snap.round,
    seed,
    rng: mulberry32((seed * 7919 + side * 104729 + snap.round * 15485863) >>> 0),
    team: snap.hand,
    hand: snap.hand,
    ownMonsters: snap.myMonsters,
    enemyMonsters: snap.enemyMonsters,
    enemyRevealedHand: enemyTeam.slice(0, 4),
    budget: snap.budget,
    zone,
  };
}

/**
 * 阵型树计划坐标镜像：formation_library 的树以 AI 侧（p2，x 6-10）视角标注坐标，
 * 当阵型在 p1 侧时需镜像 x' = 10 - x（保持"到中线距离"语义一致，y 不变）
 */
function mirrorPlanFor(side: 'p1' | 'p2', plan: { monsterId: number; x: number; y: number }[]): { monsterId: number; x: number; y: number }[] {
  return side === 'p1' ? plan.map(p => ({ ...p, x: 10 - p.x })) : plan;
}

// 搜索规划器开关（环境变量，运行时惰性读取——允许 benchmark 等调用方在进程内先改写 env 再调用）
// PLANNER: 'greedy'（默认）| 'search'
// SEARCH_SIDE: 'p1' | 'p2' | 'both'（默认 both，即双方都搜索）
// SEARCH_N: 每个怪兽候选格数（默认 3）
// SEARCH_TIMEOUT: 单场评估战斗超时秒（默认 45，40s 战斗 + 缓冲兜底）
// SEARCH_ROUNDS: 限定回合范围，如 '1-3'；缺省全部回合
function searchEnabledFor(side: 'p1' | 'p2', round: number): boolean {
  if (process.env.PLANNER !== 'search') return false;
  const searchSide = process.env.SEARCH_SIDE ?? 'both';
  if (searchSide !== 'both' && searchSide !== side) return false;
  const roundsRaw = process.env.SEARCH_ROUNDS;
  if (roundsRaw) {
    const [a, b] = roundsRaw.split('-').map(Number);
    return round >= a && round <= (b ?? a);
  }
  return true;
}

// 粒子纯视觉，无头模拟完全跳过；子弹/技能投掷物（onArrive/onHit 战斗逻辑）保留
vfx.particlesEnabled = false;

let badgesReady = false;

export interface PlayOptions {
  /** 随机种子（同种子同结果，可复现） */
  seed?: number;
  /** 单场战斗模拟超时兜底（秒），防死循环 */
  battleTimeoutSec?: number;
  /** 每回合战斗结算后回调（可视化用；boardMonsters 含本轮死亡标记，reset 前调用） */
  onRoundEnd?: (info: {
    round: number;
    boardMonsters: PlacedMonster[];
    /** 战前完整棋盘（布阵阶段：幸存者 + 本轮新增） */
    preBattle: { dbId: number; gridX: number; gridY: number; badges: { id: number; name: string }[] }[];
    planA: Placement[];
    planB: Placement[];
    p1Score: number;
    p2Score: number;
    winner: 1 | 2 | 0;
  }) => void;
  /** 双方阵型分支树（人工先验：开局坦克/按回合展开） */
  treeA?: FormationTree;
  treeB?: FormationTree;
  /** 强制按树计划执行的回合（如 [1] 开局坦克）；仅 PLANNER=search 时生效 */
  forceTreeRounds?: number[];
  // ---------- T032 A：可选产品路径部署策略 ----------
  /** A(teamA/p1) 侧声明式策略；缺省 = 当前产品贪心/搜索规划行为（保持兼容） */
  strategyA?: DeploymentStrategy;
  /** B(teamB/p2) 侧声明式策略；缺省 = 当前产品贪心/搜索规划行为（保持兼容） */
  strategyB?: DeploymentStrategy;
  /** A 侧策略身份标识（manifest/轨迹用） */
  strategyIdentityA?: string;
  /** B 侧策略身份标识（manifest/轨迹用） */
  strategyIdentityB?: string;
  /** 产品部署轨迹事件回调（真实放置/预算/接受拒绝） */
  onDeploymentTrace?: (e: ProductDeploymentTrace) => void;
  /** 产品回合观察回调（雾战：敌方前 4 手牌 + 场上已揭晓） */
  onRoundObservation?: (obs: ProductRoundObservation) => void;
}

/**
 * 产品路径部署执行（策略意图）：产品入口全权校验/放置/搬迁/扣费/记录。
 * 策略只产出声明式意图；本函数不返回新意图，只真实执行。
 */
function deployStrategyIntents(
  side: 1 | 2,
  round: number,
  identity: string,
  intents: DeploymentIntent[],
  team: TeamSlot[],
  snap: BoardSnapshot,
  emitTrace?: (e: ProductDeploymentTrace) => void,
): void {
  const zone = PRODUCT_ZONES[side];
  const isP1 = side === 1;
  const occupied = new Set<string>(snap.myMonsters.map(m => `${m.gridX},${m.gridY}`));
  const placedThisRound = new Set<number>();
  let attemptOrder = 0;

  const reject = (
    intent: DeploymentIntent,
    reason: string,
    budgetBefore: number,
    budgetAfter: number = budgetBefore,
  ) => {
    emitTrace?.({
      executionSemanticsVersion: EXECUTION_SEMANTICS_VERSION,
      round,
      side,
      sourceSide: side,
      identity,
      monsterId: intent.monsterId,
      attemptOrder,
      plannedX: intent.plannedX,
      plannedY: intent.plannedY,
      actualX: null,
      actualY: null,
      accepted: false,
      rejectionReason: reason,
      budgetBefore,
      costCharged: 0,
      budgetAfter,
      branch: intent.branch ?? null,
    });
  };

  for (const intent of intents) {
    attemptOrder++;
    const budgetBefore = isP1 ? gameEngine.p1RemainingBudget : gameEngine.p2RemainingBudget;
    const slot = team.find(s => s.monsterId === intent.monsterId);
    if (!slot) {
      reject(intent, 'not_in_hand', budgetBefore);
      continue;
    }
    if (placedThisRound.has(intent.monsterId)) {
      reject(intent, 'already_placed_this_round', budgetBefore);
      continue;
    }
    const db = DB_MONSTERS.find(m => m.id === intent.monsterId);
    const cost = db?.cost ?? 0;
    if (cost > budgetBefore) {
      reject(intent, 'insufficient_budget', budgetBefore);
      continue;
    }
    let tx = intent.plannedX;
    let ty = intent.plannedY;
    if (tx < zone.min || tx > zone.max || ty < 0 || ty > 4) {
      const r = relocateNear(tx, ty, zone, occupied);
      if (!r) {
        reject(intent, 'planned_outside_zone_no_free_cell', budgetBefore);
        continue;
      }
      tx = r[0];
      ty = r[1];
    } else if (occupied.has(`${tx},${ty}`)) {
      const r = relocateNear(tx, ty, zone, occupied);
      if (!r) {
        reject(intent, 'collision_no_free_cell', budgetBefore);
        continue;
      }
      tx = r[0];
      ty = r[1];
    }
    const placed = gameEngine.placeMonster({ monsterId: intent.monsterId, badgeIds: slot.badgeIds }, tx, ty, isP1);
    const budgetAfter = isP1 ? gameEngine.p1RemainingBudget : gameEngine.p2RemainingBudget;
    if (placed) {
      occupied.add(`${placed.gridX},${placed.gridY}`);
      placedThisRound.add(intent.monsterId);
      emitTrace?.({
        executionSemanticsVersion: EXECUTION_SEMANTICS_VERSION,
        round,
        side,
        sourceSide: side,
        identity,
        monsterId: intent.monsterId,
        attemptOrder,
        plannedX: intent.plannedX,
        plannedY: intent.plannedY,
        actualX: placed.gridX,
        actualY: placed.gridY,
        accepted: true,
        rejectionReason: null,
        budgetBefore,
        costCharged: Math.max(0, budgetBefore - budgetAfter),
        budgetAfter,
        branch: intent.branch ?? null,
      });
    } else {
      reject(intent, 'placeMonster_rejected', budgetBefore, budgetAfter);
    }
  }
}

/** 回合观察（雾战：敌方前 4 槽位手牌 + 场上已揭晓怪） */
function emitRoundObservation(
  side: 1 | 2,
  snap: BoardSnapshot,
  enemyTeam: TeamSlot[],
  cb?: (obs: ProductRoundObservation) => void,
): void {
  if (!cb) return;
  const revealed = enemyTeam.slice(0, 4);
  cb({
    round: snap.round,
    side,
    handIds: revealed.map(s => s.monsterId).sort((a, b) => a - b),
    handBadges: revealed.flatMap(s => s.badgeIds ?? []).sort((a, b) => a - b),
    boardIds: snap.enemyMonsters.map(m => m.dbId).sort((a, b) => a - b),
  });
}

/** 默认产品放置：保持原调用（无搬迁），附加轨迹记录（不改变行为） */
function recordDefaultDeployment(
  side: 1 | 2,
  round: number,
  p: Placement,
  attemptOrder: number,
  budgetBefore: number,
  budgetAfter: number,
  result: PlacedMonster | null,
  emitTrace?: (e: ProductDeploymentTrace) => void,
): void {
  if (!emitTrace) return;
  emitTrace({
    executionSemanticsVersion: EXECUTION_SEMANTICS_VERSION,
    round,
    side,
    sourceSide: side,
    identity: 'product-default',
    monsterId: p.monsterId,
    attemptOrder,
    plannedX: p.x,
    plannedY: p.y,
    actualX: result?.gridX ?? null,
    actualY: result?.gridY ?? null,
    accepted: result !== null,
    rejectionReason: result !== null ? null : 'placeMonster_rejected',
    budgetBefore,
    costCharged: result !== null ? Math.max(0, budgetBefore - budgetAfter) : 0,
    budgetAfter,
    branch: null,
  });
}

export function playFullGame(teamA: TeamSlot[], teamB: TeamSlot[], opts: PlayOptions = {}): MatchResult {
  if (!badgesReady) {
    registerAllBadges();
    badgesReady = true;
  }

  const seed = opts.seed ?? 1;
  const timeoutSec = opts.battleTimeoutSec ?? 40;
  const t0 = Date.now();

  gameEngine.restartGame();
  gameEngine.mode = 'ai'; // 启用预算（累计 4/8/12/14/16）
  gameEngine.teams = [teamA, teamB];
  gameEngine.selectedTeamIndex = 0;
  gameEngine.setReplaySeed(seed);
  // 开局清 vfx（防止上一局残留子弹污染，沙盒 vs 网页一致关键）
  vfx.particles.length = 0;
  vfx.backgroundParticles.length = 0;
  vfx.projectiles.length = 0;
  vfx.floatingTexts.length = 0;
  vfx.auraCircles = [];

  const roundResults: (1 | 2 | 0)[] = [];

  for (let round = 1; round <= gameEngine.maxRounds; round++) {
    if (gameEngine.isGameOver()) break;
    gameEngine.currentRound = round;

    // 双方盲放：各自对开回合快照独立出计划（雾战，互不可见本轮放置；敌方徽章仅前 4 槽位可见）
    // 先算双方贪心基线计划：搜索模式下作为敌方评估对手（本方真实计划若未启用搜索即用基线）
    const snapA = buildSnapshot(gameEngine, 'p1', teamA, teamB);
    const snapB = buildSnapshot(gameEngine, 'p2', teamB, teamA);

    // T032 A.5：产品轨迹——布阵前双方雾战观察
    emitRoundObservation(1, snapA, teamB, opts.onRoundObservation);
    emitRoundObservation(2, snapB, teamA, opts.onRoundObservation);

    // 策略优先（产品路径声明式策略），否则贪心/搜索基线（默认产品行为不变）
    const strategyIntentsA = opts.strategyA
      ? opts.strategyA(strategyContext(1, snapA, seed, opts.strategyIdentityA ?? 'default', teamB))
      : undefined;
    const strategyIntentsB = opts.strategyB
      ? opts.strategyB(strategyContext(2, snapB, seed, opts.strategyIdentityB ?? 'default', teamA))
      : undefined;

    const baseA = planRoundPlacements(snapA);
    const baseB = planRoundPlacements(snapB);
    const planA = strategyIntentsA
      ? strategyIntentsA.map(i => ({
          monsterId: i.monsterId,
          badgeIds: teamA.find(s => s.monsterId === i.monsterId)?.badgeIds ?? [],
          x: i.plannedX,
          y: i.plannedY,
        }))
      : searchEnabledFor('p1', round)
        ? planRoundPlacementsSearch(snapA, baseB, {
            candidateCells: Number(process.env.SEARCH_N) || 3,
            battleTimeoutSec: Number(process.env.SEARCH_TIMEOUT) || 45,
            side: 'p1',
            // 游戏设计先验：开局坦克；该回合树动作优先，其余由搜索决定
            forceTreeAction: (opts.forceTreeRounds ?? []).includes(round)
              ? mirrorPlanFor('p1', planForRound(opts.treeA, round))
              : undefined,
          })
        : baseA;
    const planB = strategyIntentsB
      ? strategyIntentsB.map(i => ({
          monsterId: i.monsterId,
          badgeIds: teamB.find(s => s.monsterId === i.monsterId)?.badgeIds ?? [],
          x: i.plannedX,
          y: i.plannedY,
        }))
      : searchEnabledFor('p2', round)
        ? planRoundPlacementsSearch(snapB, baseA, {
            candidateCells: Number(process.env.SEARCH_N) || 3,
            battleTimeoutSec: Number(process.env.SEARCH_TIMEOUT) || 45,
            side: 'p2',
            // 游戏设计先验：开局坦克；该回合树动作优先，其余由搜索决定
            forceTreeAction: (opts.forceTreeRounds ?? []).includes(round)
              ? planForRound(opts.treeB, round)
              : undefined,
          })
        : baseB;
    if (process.env.DEBUG_PLANS) {
      const fmt = (p: Placement[]) => p.map(x => `${x.monsterId}@${x.x},${x.y}`).join(' ') || '(无)';
      console.log(`[debug seed=${seed}] R${round} P1预算${gameEngine.p1RemainingBudget} P2预算${gameEngine.p2RemainingBudget}`);
      console.log(`[debug seed=${seed}] R${round} A:[${fmt(planA)}] B:[${fmt(planB)}]`);
    }
    // 部署：策略意图走产品部署（含搬迁/预算/轨迹）；默认计划保持原放置逻辑（仅附加轨迹记录）
    if (strategyIntentsA) {
      deployStrategyIntents(1, round, opts.strategyIdentityA ?? 'default', strategyIntentsA, teamA, snapA, opts.onDeploymentTrace);
    } else {
      for (let i = 0; i < planA.length; i++) {
        const p = planA[i];
        const budgetBefore = gameEngine.p1RemainingBudget;
        const placed = gameEngine.placeMonster(p, p.x, p.y, true);
        const budgetAfter = gameEngine.p1RemainingBudget;
        recordDefaultDeployment(1, round, p, i + 1, budgetBefore, budgetAfter, placed, opts.onDeploymentTrace);
      }
    }
    if (strategyIntentsB) {
      deployStrategyIntents(2, round, opts.strategyIdentityB ?? 'default', strategyIntentsB, teamB, snapB, opts.onDeploymentTrace);
    } else {
      for (let i = 0; i < planB.length; i++) {
        const p = planB[i];
        const budgetBefore = gameEngine.p2RemainingBudget;
        const placed = gameEngine.placeMonster(p, p.x, p.y, false);
        const budgetAfter = gameEngine.p2RemainingBudget;
        recordDefaultDeployment(2, round, p, i + 1, budgetBefore, budgetAfter, placed, opts.onDeploymentTrace);
      }
    }
    // 战前快照（布阵阶段完整棋盘：幸存者恢复原位 + 本轮新增），供可视化回调使用
    const preBattle = gameEngine.boardMonsters.map(m => ({
      dbId: m.dbId,
      gridX: m.gridX,
      gridY: m.gridY,
      badges: m.badges,
    }));

    // 战斗结算
    const s1 = gameEngine.p1Score;
    const s2 = gameEngine.p2Score;
    if (process.env.DEBUG_PLANS) {
      console.log(`[debug seed=${seed}] R${round} 战前 ${gameEngine.boardMonsters.map(m => `${m.dbId}@${m.gridX},${m.gridY}${m.isDead ? '死' : ''}`).join(' ')}`);
    }
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
    const d1 = gameEngine.p1Score - s1;
    const d2 = gameEngine.p2Score - s2;
    const rw = d1 === d2 ? 0 : d1 > d2 ? 1 : 2;
    roundResults.push(rw);
    if (process.env.DEBUG_PLANS) {
      console.log(`[debug seed=${seed}] R${round} 战斗结束 winner=${rw} 比分 ${gameEngine.p1Score}:${gameEngine.p2Score} monsters=${gameEngine.boardMonsters.length}`);
    }
    // 可视化回调：在 reset 前暴露本轮棋盘（含死亡标记）与双方计划
    opts.onRoundEnd?.({
      round,
      boardMonsters: gameEngine.boardMonsters,
      preBattle,
      planA,
      planB,
      p1Score: gameEngine.p1Score,
      p2Score: gameEngine.p2Score,
      winner: rw,
    });

    // 无头环境清理：清空 VFX 单例残留粒子/弹幕，避免跨局累积拖慢模拟
    vfx.particles.length = 0;
    vfx.backgroundParticles.length = 0;
    vfx.projectiles.length = 0;
    vfx.floatingTexts.length = 0;
    vfx.auraCircles = [];

    gameEngine.resetBoardForNextRound();
  }

  const winner: 0 | 1 | 2 =
    gameEngine.p1Score === gameEngine.p2Score ? 0 : gameEngine.p1Score > gameEngine.p2Score ? 1 : 2;

  return {
    winner,
    p1Score: gameEngine.p1Score,
    p2Score: gameEngine.p2Score,
    roundResults,
    roundsPlayed: roundResults.length,
    elapsedMs: Date.now() - t0,
  };
}
