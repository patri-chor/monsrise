// ============================================================
// v0 放置启发式打分（先验，静态；升级路径见交接文档 #8：数据驱动换成搜索层）
// 占用/越界/预算/去重已由 decide.ts 过滤，这里只对合法落点打分
// ============================================================

import type { MonsterData } from '../../game/Database';
import type { BoardSnapshot } from './snapshot';

/** 邻接增益徽章（相邻友方生效）：结阵守12/结阵攻13/协同进攻29/贤者16 */
const ADJ_BADGES = new Set([12, 13, 29, 16]);
/** 光环/连线核心怪：帝国110/祈祷105/金面猴王120/学徒103 */
const AURA_IDS = new Set([110, 105, 120, 103]);

export function scorePlacement(
  monster: MonsterData,
  badgeIds: number[],
  x: number,
  y: number,
  snap: BoardSnapshot,
): number {
  const my = snap.side === 'p1';
  // 前向距离：P1 越靠右（x 大）越近中线；P2 反之
  const frontDist = my ? x : 10 - x; // 0..4
  const backDist = my ? 4 - x : x - 6; // 0..4

  let score = 0;

  // 1) 阵型位：近战/坦克靠前，远程/蓄力靠后；
  //    冲锋106/钻头116 视作近战（突进线），咒法107/忍猴119 视作远程（安全位）
  const front =
    monster.id === 106 || monster.id === 116
      ? true
      : monster.id === 107 || monster.id === 119
        ? false
        : monster.type === 'melee';
  score += front ? frontDist * 10 : backDist * 10;

  // 2) y 分散：同排己方超过 1 只则扣分，避免被 AOE 一锅端
  const sameRow = snap.myMonsters.filter(m => m.gridY === y).length;
  score -= Math.max(0, sameRow - 1) * 6;

  // 3) 邻接增益粗匹配：带邻接徽章或光环核心怪，贴友军小加分
  const wantsAdj = badgeIds.some(b => ADJ_BADGES.has(b)) || AURA_IDS.has(monster.id);
  if (wantsAdj) {
    const dx = [0, 0, -1, 1];
    const dy = [-1, 1, 0, 0];
    for (let i = 0; i < 4; i++) {
      const nx = x + dx[i];
      const ny = y + dy[i];
      if (nx < 0 || nx >= 11 || ny < 0 || ny >= 5) continue;
      if (snap.myMonsters.some(m => m.gridX === nx && m.gridY === ny)) {
        score += 4;
        break;
      }
    }
  }

  return score;
}
