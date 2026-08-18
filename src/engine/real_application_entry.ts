// ============================================================
// 真实应用入口适配器（Real Product Entry Adapter）
//
// 唯一职责：调用产品自有公开对局入口 `playFullGame`（src/engine/play_full_game.ts）
// 并把它产生的真实执行结果改编为规范事件记录（CanonicalGameTrace）。
//
// 隔离约束（T031 B.2）：本文件及其传递导入（playFullGame → game/placement/ai 模块）
// 一律不得 import/调用 src/engine/tree 下的任何符号：
//   arena.ts / playSpecVsSpec / PersistentSimPool / fine_grained_worker。
// 本文件刻意不 import 任何 tree 代码 —— 由独立静态门禁 assertRealAdapterClean()
// 在每次门禁比较前强制验证。
// ============================================================

import { playFullGame } from './play_full_game';
import { gameEngine } from '../game/GameEngine';
import type { TeamSlot } from '../game/GameEngine';
import type { Formation } from '../ai/types';
import type {
  CanonicalGameTrace,
  CanonicalDeployment,
  CanonicalObservation,
} from './canonical_trace';

/** Formation → TeamSlot[]（产品入口 playFullGame 的输入形状） */
function toTeamSlots(f: Formation): TeamSlot[] {
  return (f.team ?? [])
    .filter((s: any) => (typeof s === 'number' ? s : (s?.monsterId ?? 0)) > 0)
    .map((s: any) =>
      typeof s === 'number'
        ? { monsterId: s, badgeIds: [] }
        : { monsterId: s.monsterId, badgeIds: [...(s.badgeIds ?? [])] },
    );
}

/**
 * 真实产品入口执行：`playFullGame(sourceTeam, opponentTeam)` 固定以 teamA 为 p1。
 * side=1 → 源阵容为 p1（先手）；side=2 → 源阵容为 p2（后手，交换 teamA/teamB）。
 * 通过包裹 gameEngine.placeMonster 捕获每次部署（实际坐标/接受拒绝/预算前-扣费-后），
 * 在每回合首次放置时捕获雾战观察（对手前 4 手牌 + 场上已揭晓怪）。
 *
 * 返回源视角规范轨迹；不产生分支选择（贪心规划器无树分支），branches 恒为空。
 */
export function executeRealApplicationEntry(
  formationA: Formation,
  formationB: Formation,
  side: 1 | 2,
  seed: number,
): CanonicalGameTrace {
  const sourceTeam = toTeamSlots(formationA);
  const oppTeam = toTeamSlots(formationB);

  // side 必须到达产品执行输入：side=1 源为 teamA(p1)，side=2 源为 teamB(p2)
  const teamA = side === 1 ? sourceTeam : oppTeam;
  const teamB = side === 1 ? oppTeam : sourceTeam;

  const deployments: CanonicalDeployment[] = [];
  const observations: CanonicalObservation[] = [];
  const perRoundPerSide: Map<string, number> = new Map();
  const observedRounds = new Set<number>();
  // 雾战：对手前 4 槽位可见（与树侧 arena 观察口径一致）
  const enemyRevealed = teamB.slice(0, 4);
  const enemyHandIds = enemyRevealed.map(s => s.monsterId).sort((a, b) => a - b);
  const enemyHandBadges = enemyRevealed.flatMap(s => s.badgeIds ?? []).sort((a, b) => a - b);

  const origPlaceMonster = gameEngine.placeMonster.bind(gameEngine);
  let active = true;

  (gameEngine as any).placeMonster = (
    slot: TeamSlot,
    gridX: number,
    gridY: number,
    isPlayer1: boolean,
  ) => {
    const boardSide: 1 | 2 = isPlayer1 ? 1 : 2;
    const budgetBefore = isPlayer1 ? gameEngine.p1RemainingBudget : gameEngine.p2RemainingBudget;

    // 每回合首次放置时记录雾战观察：敌方（相对源侧）当前场上已揭晓怪
    const round = gameEngine.currentRound;
    if (!observedRounds.has(round)) {
      observedRounds.add(round);
      const enemyBoardIds = gameEngine.boardMonsters
        .filter(m => m.team !== side)
        .map(m => m.dbId)
        .sort((a, b) => a - b);
      observations.push({
        round,
        side,
        handIds: enemyHandIds,
        handBadges: enemyHandBadges,
        boardIds: enemyBoardIds,
      });
    }

    const result = origPlaceMonster(slot, gridX, gridY, isPlayer1);
    const budgetAfter = isPlayer1 ? gameEngine.p1RemainingBudget : gameEngine.p2RemainingBudget;
    const costCharged = Math.max(0, budgetBefore - budgetAfter);

    const key = `${round}:${boardSide}`;
    const attemptOrder = (perRoundPerSide.get(key) ?? 0) + 1;
    perRoundPerSide.set(key, attemptOrder);

    deployments.push({
      round,
      side: boardSide,
      sourceSide: side,
      monsterId: slot.monsterId,
      attemptOrder,
      plannedX: gridX,
      plannedY: gridY,
      accepted: result !== null,
      actualX: result !== null ? gridX : undefined,
      actualY: result !== null ? gridY : undefined,
      rejectionReason: result !== null ? undefined : 'PLACEMENT_REJECTED',
      budgetBefore,
      costCharged: result !== null ? costCharged : 0,
      budgetAfter: result !== null ? budgetAfter : budgetBefore,
    });
    return result;
  };

  let matchResult;
  try {
    matchResult = playFullGame(teamA, teamB, { seed });
  } finally {
    if (active) {
      (gameEngine as any).placeMonster = origPlaceMonster;
      active = false;
    }
  }

  const roundScores: number[] = matchResult.roundResults.map(r => {
    if (r === 0) return 0;
    const sourceWinRound = (side === 1 && r === 1) || (side === 2 && r === 2);
    return sourceWinRound ? 1 : -1;
  });

  const sourceWon = (side === 1 && matchResult.winner === 1) || (side === 2 && matchResult.winner === 2);
  const sourceLost = (side === 1 && matchResult.winner === 2) || (side === 2 && matchResult.winner === 1);

  return {
    sourceId: formationA.id ?? formationA.name,
    sourceName: formationA.name,
    opponentId: formationB.id ?? formationB.name,
    opponentName: formationB.name,
    side,
    seed,
    finalW: sourceWon ? 1 : 0,
    finalD: matchResult.winner === 0 ? 1 : 0,
    finalL: sourceLost ? 1 : 0,
    roundScores,
    branches: [], // 贪心规划器无树分支选择（见 EXCLUDED 文档与报告）
    observations,
    deployments,
  };
}
