// ============================================================
// 放置决策用的只读棋盘快照
// 决策层只读快照、不碰 gameEngine 单例（为后续搜索/minimax 留干净的输入面）
// 雾战规则：快照在开回合时构建 —— 只含己方全部 + 对方前几回合已揭晓的怪兽
// ============================================================

import type { GameEngine, PlacedMonster, TeamSlot } from '../../game/GameEngine';
import type { PlayerSide } from '../types';

export interface BoardSnapshot {
  side: PlayerSide;
  round: number;
  /** 完整手牌（未放置部分由 placedIds 过滤） */
  hand: TeamSlot[];
  /** 11x5 棋盘占用（己方全部 + 对方已揭晓） */
  grid: (PlacedMonster | null)[][];
  myMonsters: PlacedMonster[];
  enemyMonsters: PlacedMonster[];
  /** 本回合累计剩余预算 */
  budget: number;
}

export function buildSnapshot(engine: GameEngine, side: PlayerSide, hand: TeamSlot[], enemyHand?: TeamSlot[]): BoardSnapshot {
  const myTeam = side === 'p1' ? 1 : 2;

  // 雾战：对战开始前敌方仅前 4 槽位（topUI 可见）的怪兽徽章可见，其余徽章不进入快照
  const revealedIds = enemyHand
    ? new Set(enemyHand.slice(0, 4).map(s => s.monsterId).filter(id => id > 0))
    : null;
  const sanitizeEnemy = (m: PlacedMonster): PlacedMonster =>
    (!revealedIds || revealedIds.has(m.dbId)) ? m : { ...m, badges: [] };

  const myMonsters = engine.boardMonsters.filter(m => m.team === myTeam);
  const enemyMonsters = engine.boardMonsters.filter(m => m.team !== myTeam).map(sanitizeEnemy);

  const grid: (PlacedMonster | null)[][] = [];
  for (let y = 0; y < 5; y++) {
    const row: (PlacedMonster | null)[] = [];
    for (let x = 0; x < 11; x++) {
      const occ = engine.boardMonsters.find(m => m.gridX === x && m.gridY === y);
      row.push(occ ? (occ.team === myTeam ? occ : sanitizeEnemy(occ)) : null);
    }
    grid.push(row);
  }

  return {
    side,
    round: engine.currentRound,
    hand,
    grid,
    myMonsters,
    enemyMonsters,
    budget: side === 'p1' ? engine.p1RemainingBudget : engine.p2RemainingBudget,
  };
}
