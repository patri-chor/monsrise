// ============================================================
// playFullGame —— 地基：给定两套阵容，打一场完整对局并返回胜负
// 流程：5 回合（预算累计 4/8/12/14/16），每回合双方盲放 → 战斗一场，先 3 胜
// 基座：当前游戏栈（GameEngine 回合/预算 + BattleSystem 真实战斗）
// ============================================================

import './env'; // 环境桩必须最先执行
import { gameEngine } from '../game/GameEngine';
import type { PlacedMonster, TeamSlot } from '../game/GameEngine';
import { battleSystem } from '../game/BattleSystem';
import { vfx } from '../game/VfxManager';
import { registerAllBadges } from '../game/BadgeSystem';
import type { MatchResult, Placement } from './types';
import { buildSnapshot } from './placement/snapshot';
import { planRoundPlacements } from './placement/decide';
import { planForRound } from '../ai/formation_tree';
import type { FormationTree } from '../ai/types';
import { planRoundPlacementsSearch } from './placement/search';

const BATTLE_DT = 0.04; // 25 帧/秒，与网页 Director 固定逻辑步长一致

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
    const baseA = planRoundPlacements(snapA);
    const baseB = planRoundPlacements(snapB);
    const planA = searchEnabledFor('p1', round)
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
    const planB = searchEnabledFor('p2', round)
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
    for (const p of planA) gameEngine.placeMonster(p, p.x, p.y, true);
    for (const p of planB) gameEngine.placeMonster(p, p.x, p.y, false);
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
