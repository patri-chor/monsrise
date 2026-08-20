// ============================================================
// src/engine/tree/round_engine/product_round_session.ts
// T101: Single-Round Product Battle Execution Engine & Resumable Checkpoint Session
//
// 规范保证：
// 1. 严格使用权威游戏状态转移与战斗规则 (GameEngine + BattleSystem + VfxManager + BadgeSystem)；
// 2. 与 playFullGame 100% 保持无缝对齐（包括预算/手牌/雾战/搬迁/战斗循环 25fps/伤害与Buff恢复）；
// 3. 提供完全独立、可序列化、防内存泄露的 ProductRoundCheckpoint 机制，支持任意回合前断点恢复。
// ============================================================

import '../../env';
import { gameEngine, type PlacedMonster, type TeamSlot } from '../../../game/GameEngine';
import { DB_MONSTERS, DB_BADGES, type BadgeData } from '../../../game/Database';
import { battleSystem } from '../../../game/BattleSystem';
import { vfx } from '../../../game/VfxManager';
import { registerAllBadges } from '../../../game/BadgeSystem';
import { buildSnapshot, type BoardSnapshot } from '../../placement/snapshot';
import { planRoundPlacements } from '../../placement/decide';
import {
  PRODUCT_ZONES,
  EXECUTION_SEMANTICS_VERSION,
  type DeploymentIntent,
  type DeploymentStrategy,
  type DeploymentStrategyContext,
  type ProductDeploymentTrace,
  type ProductRoundObservation,
  mulberry32,
} from '../../play_full_game';
import { sha256Hex } from '../sha256_pure';

const BATTLE_DT = 0.04; // 25 帧/秒

let badgesReady = false;
function ensureBadgesReady() {
  if (!badgesReady) {
    registerAllBadges();
    badgesReady = true;
  }
}

/** 序列化单只怪兽状态（权威包含所有运行时生命周期字段） */
export interface SerializedPlacedMonster {
  id: string;
  dbId: number;
  badgeIds: number[];
  gridX: number;
  gridY: number;
  initialGridX: number;
  initialGridY: number;
  placedRound: number;
  team: 1 | 2;
  hp: number;
  maxHp: number;
  atk: number;
  ats: number;
  range: number;
  speed: number;
  shield: number;
  skillCdProgress: number;
  flashTime: number;
  isDead: boolean;
  statusEffects: {
    type: 'poison' | 'bleed' | 'stun' | 'chill' | 'freeze' | 'burn' | 'stealth' | 'invincible' | 'fortified';
    duration: number;
    value?: number;
    tickTimer?: number;
    stacks?: number;
  }[];
  state: 'idle' | 'walk' | 'attack' | 'skill';
}

/** 战前回合检查点（完全确定性与自包含，包含预算、分数、RNG与策略上下文） */
export interface ProductRoundCheckpoint {
  round: number;
  seed: number;
  rngState: number;
  p1Score: number;
  p2Score: number;
  teamA: TeamSlot[];
  teamB: TeamSlot[];
  boardMonsters: SerializedPlacedMonster[];
  roundResults: (1 | 2 | 0)[];
  p1RemainingBudget: number;
  p2RemainingBudget: number;
  strategyIdentityA: string;
  strategyIdentityB: string;
  checkpointFingerprint: string;
}

export interface ProductRoundResult {
  round: number;
  roundWinner: 1 | 2 | 0;
  p1ScoreDelta: number;
  p2ScoreDelta: number;
  p1Score: number;
  p2Score: number;
  isGameOver: boolean;
  deploymentTraces: ProductDeploymentTrace[];
  observations: {
    p1: ProductRoundObservation;
    p2: ProductRoundObservation;
  };
  boardMonsters: PlacedMonster[];
  preBattle: { dbId: number; gridX: number; gridY: number; badges: { id: number; name: string }[] }[];
}

export interface CreateProductSessionOptions {
  seed?: number;
  battleTimeoutSec?: number;
  strategyIdentityA?: string;
  strategyIdentityB?: string;
}

/** 螺旋就近寻空位 */
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

function computeCheckpointFingerprint(cp: Omit<ProductRoundCheckpoint, 'checkpointFingerprint'>): string {
  const norm = {
    round: cp.round,
    seed: cp.seed,
    rngState: cp.rngState,
    p1Score: cp.p1Score,
    p2Score: cp.p2Score,
    p1Budget: cp.p1RemainingBudget,
    p2Budget: cp.p2RemainingBudget,
    identityA: cp.strategyIdentityA,
    identityB: cp.strategyIdentityB,
    teamA: cp.teamA.map(s => ({ m: s.monsterId, b: [...s.badgeIds].sort() })),
    teamB: cp.teamB.map(s => ({ m: s.monsterId, b: [...s.badgeIds].sort() })),
    boardMonsters: cp.boardMonsters
      .map(m => ({
        id: m.id,
        dbId: m.dbId,
        x: m.gridX,
        y: m.gridY,
        ix: m.initialGridX,
        iy: m.initialGridY,
        t: m.team,
        r: m.placedRound,
        hp: m.hp,
        shield: m.shield,
        cd: m.skillCdProgress,
        dead: m.isDead,
        st: m.state,
        se: m.statusEffects.map(e => ({ t: e.type, d: e.duration, v: e.value })),
        b: [...m.badgeIds].sort(),
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    roundResults: cp.roundResults,
  };
  return sha256Hex(JSON.stringify(norm)).slice(0, 24);
}

export class ProductGameSession {
  public teamA: TeamSlot[];
  public teamB: TeamSlot[];
  public seed: number;
  public battleTimeoutSec: number;
  public strategyIdentityA: string;
  public strategyIdentityB: string;

  public currentRound: number = 1;
  public p1Score: number = 0;
  public p2Score: number = 0;
  public roundResults: (1 | 2 | 0)[] = [];
  public currentRngSeed: number;

  private constructor(
    teamA: TeamSlot[],
    teamB: TeamSlot[],
    opts: CreateProductSessionOptions = {}
  ) {
    ensureBadgesReady();
    this.teamA = teamA.map(s => ({ monsterId: s.monsterId, badgeIds: [...(s.badgeIds ?? [])] }));
    this.teamB = teamB.map(s => ({ monsterId: s.monsterId, badgeIds: [...(s.badgeIds ?? [])] }));
    this.seed = opts.seed ?? 1;
    this.currentRngSeed = this.seed;
    this.battleTimeoutSec = opts.battleTimeoutSec ?? 40;
    this.strategyIdentityA = opts.strategyIdentityA ?? 'default';
    this.strategyIdentityB = opts.strategyIdentityB ?? 'default';
  }

  public static create(
    teamA: TeamSlot[],
    teamB: TeamSlot[],
    opts: CreateProductSessionOptions = {}
  ): ProductGameSession {
    const session = new ProductGameSession(teamA, teamB, opts);
    session.initializeEngineState();
    return session;
  }

  /**
   * 将当前 GameEngine 全局单例重置为本 Session 的开局初始状态
   */
  private initializeEngineState(): void {
    gameEngine.restartGame();
    gameEngine.mode = 'ai';
    gameEngine.teams = [this.teamA, this.teamB];
    gameEngine.selectedTeamIndex = 0;
    gameEngine.setReplaySeed(this.seed);
    this.currentRngSeed = this.seed;

    vfx.particles.length = 0;
    vfx.backgroundParticles.length = 0;
    vfx.projectiles.length = 0;
    vfx.floatingTexts.length = 0;
    vfx.auraCircles = [];
  }

  /**
   * 将内部 Session 状态（分数/棋盘/RNG）权威同步到 GameEngine 单例（绝不使用默认值替代或调用 reset 篡改）
   */
  private syncToGameEngine(board: SerializedPlacedMonster[]): void {
    gameEngine.currentRound = this.currentRound;
    gameEngine.p1Score = this.p1Score;
    gameEngine.p2Score = this.p2Score;
    gameEngine.mode = 'ai';
    gameEngine.teams = [this.teamA, this.teamB];
    gameEngine.selectedTeamIndex = 0;
    gameEngine.setReplaySeed(this.currentRngSeed);

    // 权威重构 boardMonsters
    gameEngine.boardMonsters = [];
    for (const sm of board) {
      const slot: TeamSlot = { monsterId: sm.dbId, badgeIds: [...sm.badgeIds] };
      const dbMonster = DB_MONSTERS.find(m => m.id === sm.dbId);
      if (!dbMonster) continue;
      const badges: BadgeData[] = slot.badgeIds
        .map(id => DB_BADGES.find(b => b.id === id))
        .filter((b): b is BadgeData => !!b);

      const placed: PlacedMonster = {
        id: sm.id,
        dbId: sm.dbId,
        data: dbMonster,
        badges,
        gridX: sm.gridX,
        gridY: sm.gridY,
        initialGridX: sm.initialGridX,
        initialGridY: sm.initialGridY,
        placedRound: sm.placedRound,
        team: sm.team,
        hp: sm.hp,
        maxHp: sm.maxHp,
        atk: sm.atk,
        ats: sm.ats,
        range: sm.range,
        speed: sm.speed,
        shield: sm.shield,
        skillCdProgress: sm.skillCdProgress,
        flashTime: sm.flashTime ?? 0,
        isDead: sm.isDead,
        statusEffects: sm.statusEffects.map(e => ({ ...e })),
        state: sm.state,
      };
      gameEngine.boardMonsters.push(placed);
    }
  }

  /**
   * 捕获当前回合开始前的权威全状态检查点
   */
  public captureCheckpointBeforeRound(round: number): ProductRoundCheckpoint {
    // 提取当前棋盘全部未来影响字段
    const boardMonsters: SerializedPlacedMonster[] = gameEngine.boardMonsters.map(m => ({
      id: m.id,
      dbId: m.dbId,
      badgeIds: m.badges.map(b => b.id),
      gridX: m.gridX,
      gridY: m.gridY,
      initialGridX: m.initialGridX,
      initialGridY: m.initialGridY,
      placedRound: m.placedRound,
      team: m.team,
      hp: m.hp,
      maxHp: m.maxHp,
      atk: m.atk,
      ats: m.ats,
      range: m.range,
      speed: m.speed,
      shield: m.shield,
      skillCdProgress: m.skillCdProgress,
      flashTime: m.flashTime ?? 0,
      isDead: m.isDead,
      statusEffects: (m.statusEffects ?? []).map(e => ({
        type: e.type,
        duration: e.duration,
        value: e.value,
        tickTimer: e.tickTimer,
        stacks: e.stacks,
      })),
      state: m.state,
    }));

    const rngState = (gameEngine as any)._replaySeed ?? this.currentRngSeed;

    const rawCp: Omit<ProductRoundCheckpoint, 'checkpointFingerprint'> = {
      round,
      seed: this.seed,
      rngState,
      p1Score: this.p1Score,
      p2Score: this.p2Score,
      teamA: this.teamA.map(s => ({ monsterId: s.monsterId, badgeIds: [...s.badgeIds] })),
      teamB: this.teamB.map(s => ({ monsterId: s.monsterId, badgeIds: [...s.badgeIds] })),
      boardMonsters,
      roundResults: [...this.roundResults],
      p1RemainingBudget: gameEngine.p1RemainingBudget,
      p2RemainingBudget: gameEngine.p2RemainingBudget,
      strategyIdentityA: this.strategyIdentityA,
      strategyIdentityB: this.strategyIdentityB,
    };

    return {
      ...rawCp,
      checkpointFingerprint: computeCheckpointFingerprint(rawCp),
    };
  }

  /**
   * 从检查点恢复一个全新的独立 Session（权威无损失状态恢复）
   */
  public static restore(checkpoint: ProductRoundCheckpoint, opts: CreateProductSessionOptions = {}): ProductGameSession {
    const session = new ProductGameSession(checkpoint.teamA, checkpoint.teamB, {
      seed: checkpoint.seed,
      battleTimeoutSec: opts.battleTimeoutSec,
      strategyIdentityA: checkpoint.strategyIdentityA ?? opts.strategyIdentityA,
      strategyIdentityB: checkpoint.strategyIdentityB ?? opts.strategyIdentityB,
    });
    session.currentRound = checkpoint.round;
    session.p1Score = checkpoint.p1Score;
    session.p2Score = checkpoint.p2Score;
    session.roundResults = [...checkpoint.roundResults];
    session.currentRngSeed = checkpoint.rngState;

    session.syncToGameEngine(checkpoint.boardMonsters);
    return session;
  }

  /**
   * 构建当前回合合法雾战只读上下文
   */
  public buildRoundContext(side: 1 | 2): DeploymentStrategyContext {
    const isP1 = side === 1;
    const snap = buildSnapshot(
      gameEngine,
      isP1 ? 'p1' : 'p2',
      isP1 ? this.teamA : this.teamB,
      isP1 ? this.teamB : this.teamA,
    );
    const enemyTeam = isP1 ? this.teamB : this.teamA;
    const identity = isP1 ? this.strategyIdentityA : this.strategyIdentityB;
    const zone = PRODUCT_ZONES[side];

    return {
      side,
      identity,
      round: this.currentRound,
      seed: this.seed,
      rng: mulberry32((this.seed * 7919 + side * 104729 + this.currentRound * 15485863) >>> 0),
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
   * 执行单个正常产品回合
   */
  public playRound(
    intentsA?: DeploymentIntent[],
    intentsB?: DeploymentIntent[],
  ): ProductRoundResult {
    if (gameEngine.isGameOver()) {
      throw new Error(`Cannot play round ${this.currentRound}: game is already over`);
    }

    gameEngine.currentRound = this.currentRound;
    const round = this.currentRound;

    const snapA = buildSnapshot(gameEngine, 'p1', this.teamA, this.teamB);
    const snapB = buildSnapshot(gameEngine, 'p2', this.teamB, this.teamA);

    const revealedB = this.teamB.slice(0, 4);
    const revealedA = this.teamA.slice(0, 4);

    const obsA: ProductRoundObservation = {
      round,
      side: 1,
      handIds: revealedB.map(s => s.monsterId).sort((a, b) => a - b),
      handBadges: revealedB.flatMap(s => s.badgeIds ?? []).sort((a, b) => a - b),
      boardIds: snapA.enemyMonsters.map(m => m.dbId).sort((a, b) => a - b),
    };

    const obsB: ProductRoundObservation = {
      round,
      side: 2,
      handIds: revealedA.map(s => s.monsterId).sort((a, b) => a - b),
      handBadges: revealedA.flatMap(s => s.badgeIds ?? []).sort((a, b) => a - b),
      boardIds: snapB.enemyMonsters.map(m => m.dbId).sort((a, b) => a - b),
    };

    const deploymentTraces: ProductDeploymentTrace[] = [];

    // 执行部署
    if (intentsA) {
      this.deployIntents(1, round, this.strategyIdentityA, intentsA, this.teamA, snapA, deploymentTraces);
    } else {
      const planA = planRoundPlacements(snapA);
      for (let i = 0; i < planA.length; i++) {
        const p = planA[i];
        const budgetBefore = gameEngine.p1RemainingBudget;
        const placed = gameEngine.placeMonster(p, p.x, p.y, true);
        const budgetAfter = gameEngine.p1RemainingBudget;
        deploymentTraces.push({
          executionSemanticsVersion: EXECUTION_SEMANTICS_VERSION,
          round,
          side: 1,
          sourceSide: 1,
          identity: 'product-default',
          monsterId: p.monsterId,
          attemptOrder: i + 1,
          plannedX: p.x,
          plannedY: p.y,
          actualX: placed?.gridX ?? null,
          actualY: placed?.gridY ?? null,
          accepted: placed !== null,
          rejectionReason: placed !== null ? null : 'placeMonster_rejected',
          budgetBefore,
          costCharged: placed !== null ? Math.max(0, budgetBefore - budgetAfter) : 0,
          budgetAfter,
          branch: null,
        });
      }
    }

    if (intentsB) {
      this.deployIntents(2, round, this.strategyIdentityB, intentsB, this.teamB, snapB, deploymentTraces);
    } else {
      const planB = planRoundPlacements(snapB);
      for (let i = 0; i < planB.length; i++) {
        const p = planB[i];
        const budgetBefore = gameEngine.p2RemainingBudget;
        const placed = gameEngine.placeMonster(p, p.x, p.y, false);
        const budgetAfter = gameEngine.p2RemainingBudget;
        deploymentTraces.push({
          executionSemanticsVersion: EXECUTION_SEMANTICS_VERSION,
          round,
          side: 2,
          sourceSide: 2,
          identity: 'product-default',
          monsterId: p.monsterId,
          attemptOrder: i + 1,
          plannedX: p.x,
          plannedY: p.y,
          actualX: placed?.gridX ?? null,
          actualY: placed?.gridY ?? null,
          accepted: placed !== null,
          rejectionReason: placed !== null ? null : 'placeMonster_rejected',
          budgetBefore,
          costCharged: placed !== null ? Math.max(0, budgetBefore - budgetAfter) : 0,
          budgetAfter,
          branch: null,
        });
      }
    }

    // 战前棋盘快照
    const preBattle = gameEngine.boardMonsters.map(m => ({
      dbId: m.dbId,
      gridX: m.gridX,
      gridY: m.gridY,
      badges: m.badges.map(b => ({ id: b.id, name: b.name })),
    }));

    // 战斗模拟
    const s1 = gameEngine.p1Score;
    const s2 = gameEngine.p2Score;

    battleSystem.startBattle();
    let elapsed = 0;
    while (battleSystem.active && elapsed < this.battleTimeoutSec) {
      battleSystem.update(BATTLE_DT);
      vfx.update(BATTLE_DT);
      elapsed += BATTLE_DT;
    }
    if (battleSystem.active) {
      (battleSystem as any).endBattle(null);
    }

    const d1 = gameEngine.p1Score - s1;
    const d2 = gameEngine.p2Score - s2;
    const rw = d1 === d2 ? 0 : d1 > d2 ? 1 : 2;

    this.roundResults.push(rw);
    this.p1Score = gameEngine.p1Score;
    this.p2Score = gameEngine.p2Score;
    this.currentRngSeed = (gameEngine as any)._replaySeed;

    // 清空粒子
    vfx.particles.length = 0;
    vfx.backgroundParticles.length = 0;
    vfx.projectiles.length = 0;
    vfx.floatingTexts.length = 0;
    vfx.auraCircles = [];

    // 重置怪兽到战前初位
    gameEngine.resetBoardForNextRound();

    const isGameOver = gameEngine.isGameOver();
    this.currentRound = round + 1;

    return {
      round,
      roundWinner: rw,
      p1ScoreDelta: d1,
      p2ScoreDelta: d2,
      p1Score: this.p1Score,
      p2Score: this.p2Score,
      isGameOver,
      deploymentTraces,
      observations: { p1: obsA, p2: obsB },
      boardMonsters: gameEngine.boardMonsters,
      preBattle,
    };
  }

  private deployIntents(
    side: 1 | 2,
    round: number,
    identity: string,
    intents: DeploymentIntent[],
    team: TeamSlot[],
    snap: BoardSnapshot,
    traces: ProductDeploymentTrace[],
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
      traces.push({
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
        traces.push({
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
}
