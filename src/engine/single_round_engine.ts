import type { RoundBoardState, RoundBoardEdit } from './round_board';
import { RoundBoardStateFactory } from './round_board_factory';
import { computeObservableRoundSummary, type ObservableRoundOutput } from './product_match_runner';
import { gameEngine, type PlacedMonster, type TeamSlot } from '../game/GameEngine';
import { DB_MONSTERS, DB_BADGES, type BadgeData } from '../game/Database';
import { battleSystem } from '../game/BattleSystem';
import { vfx } from '../game/VfxManager';
import { registerAllBadges, badgeOnPlace, badgeGetAtsMultiplier } from '../game/BadgeSystem';
import { PRODUCT_ZONES } from './play_full_game';

const BATTLE_DT = 0.04;

let badgesReady = false;
function ensureBadgesReady() {
  if (!badgesReady) {
    registerAllBadges();
    badgesReady = true;
  }
}

export interface SingleRoundResult {
  round: number;
  roundWinner: 1 | 2 | 0;
  p1ScoreDelta: number;
  p2ScoreDelta: number;
  p1Score: number;
  p2Score: number;
  observableOutput: ObservableRoundOutput;
  baseStateFingerprint: string;
  editedStateFingerprint: string;
  acceptedActions: Array<{ side: 1 | 2; monsterId: number; x: number; y: number }>;
  rejectedActions: Array<{ side: 1 | 2; monsterId: number; reason: string }>;
}

export class SingleRoundEngine {
  public static runSingleRound(
    base: RoundBoardState,
    edits: RoundBoardEdit[] = []
  ): SingleRoundResult {
    ensureBadgesReady();

    const state = edits.length > 0 ? RoundBoardStateFactory.cloneWithEdits(base, edits) : base;

    // 1. 初始化引擎单例
    gameEngine.restartGame();
    gameEngine.mode = 'ai';
    gameEngine.currentRound = state.targetRound;
    gameEngine.p1Score = state.p1ScoreBeforeRound;
    gameEngine.p2Score = state.p2ScoreBeforeRound;
    gameEngine.teams = [
      state.teamA.map(s => ({ monsterId: s.monsterId, badgeIds: [...s.badgeIds] })),
      state.teamB.map(s => ({ monsterId: s.monsterId, badgeIds: [...s.badgeIds] })),
    ];
    gameEngine.selectedTeamIndex = 0;
    gameEngine.setReplaySeed(state.rngStateBeforeRound ?? state.seed);

    // 清空特效
    vfx.particles.length = 0;
    vfx.backgroundParticles.length = 0;
    vfx.projectiles.length = 0;
    vfx.floatingTexts.length = 0;
    vfx.auraCircles = [];

    // 2. 放置历史已部署单位（R1..R-1，重置为满血初始状态）
    gameEngine.boardMonsters = [];
    const occupied = new Set<string>();

    for (const u of state.deployedUnits) {
      const dbMonster = DB_MONSTERS.find(m => m.id === u.monsterId);
      if (!dbMonster) continue;

      const badges: BadgeData[] = u.badgeIds
        .map(id => DB_BADGES.find(b => b.id === id))
        .filter((b): b is BadgeData => !!b);

      const gx = typeof u.originalX === 'number' ? u.originalX : 0;
      const gy = typeof u.originalY === 'number' ? u.originalY : 0;

      const placed: PlacedMonster = {
        id: u.instanceId,
        dbId: u.monsterId,
        data: dbMonster,
        badges,
        gridX: gx,
        gridY: gy,
        initialGridX: gx,
        initialGridY: gy,
        placedRound: u.deployedRound,
        team: u.side,
        hp: dbMonster.hp,
        maxHp: dbMonster.hp,
        atk: dbMonster.atk,
        ats: dbMonster.ats,
        range: dbMonster.range,
        speed: dbMonster.speed,
        shield: 0,
        skillCdProgress: 0,
        flashTime: 0,
        isDead: false,
        statusEffects: [],
        state: 'idle',
      };

      badgeOnPlace(placed);
      placed.ats *= badgeGetAtsMultiplier(placed);

      gameEngine.boardMonsters.push(placed);
      occupied.add(`${u.originalX},${u.originalY}`);
    }

    // 3. 执行本回合待定部署动作 (Pending Actions)
    const acceptedActions: Array<{ side: 1 | 2; monsterId: number; x: number; y: number }> = [];
    const rejectedActions: Array<{ side: 1 | 2; monsterId: number; reason: string }> = [];

    for (const act of state.pendingActions) {
      const zone = PRODUCT_ZONES[act.side];
      const isLegalZone = act.x >= zone.min && act.x <= zone.max && act.y >= 0 && act.y <= 4;
      const isCellFree = !occupied.has(`${act.x},${act.y}`);

      const remainingBudget = act.side === 1 ? gameEngine.p1RemainingBudget : gameEngine.p2RemainingBudget;
      const dbMonster = DB_MONSTERS.find(m => m.id === act.monsterId);
      const cost = dbMonster?.cost ?? 2;

      if (isLegalZone && isCellFree && remainingBudget >= cost) {
        const slot: TeamSlot = { monsterId: act.monsterId, badgeIds: act.badgeIds };
        const placed = gameEngine.placeMonster(slot, act.x, act.y, act.side === 1);
        if (placed) {
          occupied.add(`${placed.gridX},${placed.gridY}`);
          acceptedActions.push({ side: act.side, monsterId: act.monsterId, x: placed.gridX, y: placed.gridY });
        } else {
          rejectedActions.push({ side: act.side, monsterId: act.monsterId, reason: 'place_rejected' });
        }
      } else {
        const reason = !isLegalZone ? 'illegal_zone' : !isCellFree ? 'cell_occupied' : 'insufficient_budget';
        rejectedActions.push({ side: act.side, monsterId: act.monsterId, reason });
      }
    }

    // 4. 运行单回合战斗模拟
    const s1Before = gameEngine.p1Score;
    const s2Before = gameEngine.p2Score;

    battleSystem.startBattle();
    let elapsed = 0;
    while (battleSystem.active && elapsed < 40) {
      battleSystem.update(BATTLE_DT);
      vfx.update(BATTLE_DT);
      elapsed += BATTLE_DT;
    }
    if (battleSystem.active) {
      (battleSystem as any).endBattle(null);
    }

    const p1ScoreDelta = gameEngine.p1Score - s1Before;
    const p2ScoreDelta = gameEngine.p2Score - s2Before;
    const roundWinner: 1 | 2 | 0 = p1ScoreDelta === p2ScoreDelta ? 0 : p1ScoreDelta > p2ScoreDelta ? 1 : 2;

    const observableOutput = computeObservableRoundSummary(
      state.targetRound,
      roundWinner,
      gameEngine.p1Score,
      gameEngine.p2Score,
      gameEngine.boardMonsters
    );

    return {
      round: state.targetRound,
      roundWinner,
      p1ScoreDelta,
      p2ScoreDelta,
      p1Score: gameEngine.p1Score,
      p2Score: gameEngine.p2Score,
      observableOutput,
      baseStateFingerprint: base.stateFingerprint,
      editedStateFingerprint: state.stateFingerprint,
      acceptedActions,
      rejectedActions,
    };
  }
}
