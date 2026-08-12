// ============================================================
// 引擎层通用类型
// ============================================================

export type PlayerSide = 'p1' | 'p2';

/** 单次放置决策（供 gameEngine.placeMonster 落地） */
export interface Placement {
  monsterId: number;
  badgeIds: number[];
  x: number;
  y: number;
}

/** 一场完整对局的结果 */
export interface MatchResult {
  /** 胜者：1=P1, 2=P2, 0=平局 */
  winner: 0 | 1 | 2;
  p1Score: number;
  p2Score: number;
  /** 每回合结果：1/2/0 */
  roundResults: (1 | 2 | 0)[];
  /** 实际进行的回合数（先 3 胜可提前结束） */
  roundsPlayed: number;
  elapsedMs: number;
}
