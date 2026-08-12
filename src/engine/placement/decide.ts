// ============================================================
// 放置决策入口：对开回合快照生成某方的整轮放置计划（贪心）
// 纯函数 —— 盲放（雾战），不依赖对方本轮放置
// ============================================================

import { DB_MONSTERS } from '../../game/Database';
import type { PlacedMonster } from '../../game/GameEngine';
import type { Placement } from '../types';
import type { BoardSnapshot } from './snapshot';
import { scorePlacement } from './heuristic';

const ZONE: Record<'p1' | 'p2', { min: number; max: number }> = {
  p1: { min: 0, max: 4 },
  p2: { min: 6, max: 10 },
};

export function planRoundPlacements(snap: BoardSnapshot): Placement[] {
  const zone = ZONE[snap.side];
  const plan: Placement[] = [];
  const placedIds = new Set(snap.myMonsters.map(m => m.dbId));
  const localGrid = snap.grid.map(row => [...row]);
  let budget = snap.budget;

  while (true) {
    let best: (Placement & { score: number }) | null = null;

    for (const card of snap.hand) {
      if (placedIds.has(card.monsterId)) continue;
      const monster = DB_MONSTERS.find(m => m.id === card.monsterId);
      if (!monster || monster.cost > budget) continue;

      for (let y = 0; y < 5; y++) {
        for (let x = zone.min; x <= zone.max; x++) {
          if (localGrid[y][x] !== null) continue;
          const score = scorePlacement(monster, card.badgeIds, x, y, snap);
          // 确定性平局裁决：分高者胜；同分取 monsterId/x/y 较小者
          const isBetter =
            !best ||
            score > best.score ||
            (score === best.score &&
              (card.monsterId < best.monsterId ||
                (card.monsterId === best.monsterId && x < best.x) ||
                (card.monsterId === best.monsterId && x === best.x && y < best.y)));
          if (isBetter) {
            best = { monsterId: card.monsterId, badgeIds: card.badgeIds, x, y, score };
          }
        }
      }
    }

    if (!best) break;
    plan.push({ monsterId: best.monsterId, badgeIds: best.badgeIds, x: best.x, y: best.y });
    placedIds.add(best.monsterId);
    const cost = DB_MONSTERS.find(m => m.id === best!.monsterId)!.cost;
    budget -= cost;
    localGrid[best.y][best.x] = { monsterId: best.monsterId } as unknown as PlacedMonster;
  }

  return plan;
}
