// ============================================================
// 模型推理放置器：用训练好的模型给候选动作打分（蒸馏搜索评分），
// 每步选最优放置直到预算尽 —— 无模拟，速度远快于搜索
// ============================================================

import fs from 'node:fs';
import { DB_MONSTERS } from '../../game/Database';
import type { PlacedMonster } from '../../game/GameEngine';
import type { Placement } from '../types';
import type { BoardSnapshot } from '../placement/snapshot';
import { encodeCandidate, snapCounts, type CandidateCtx } from './features';
import { predictRF, type TrainedModel } from './train';

const ZONE: Record<'p1' | 'p2', { min: number; max: number }> = {
  p1: { min: 0, max: 4 },
  p2: { min: 6, max: 10 },
};

let cachedModel: TrainedModel | null = null;
let cachedPath = '';

/** 加载模型（按路径缓存，CLI/Node 用 fs） */
export function loadModel(path: string): TrainedModel {
  if (cachedModel && cachedPath === path) return cachedModel;
  cachedModel = JSON.parse(fs.readFileSync(path, 'utf8')) as TrainedModel;
  cachedPath = path;
  return cachedModel;
}

let urlModel: TrainedModel | null = null;

/** 从 URL 加载模型（浏览器用 fetch；模型作为静态资源发布） */
export async function loadModelFromUrl(url: string): Promise<TrainedModel> {
  if (urlModel) return urlModel;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`loadModelFromUrl: HTTP ${res.status}`);
  urlModel = (await res.json()) as TrainedModel;
  return urlModel;
}

/** 模型打分（随机森林预测多局价值；兼容旧线性模型） */
export function modelScore(ctx: CandidateCtx, model: TrainedModel): number {
  const feats = encodeCandidate(ctx);
  if (model.type === 'rf' && model.trees) {
    return predictRF(model.trees, feats);
  }
  // 兼容旧线性模型（ridge）
  const w = model.weights ?? [];
  let s = w[0] ?? 0;
  for (let f = 0; f < feats.length; f++) {
    const z = (feats[f] - (model.mean?.[f] ?? 0)) / (model.std?.[f] ?? 1);
    s += z * (w[f + 1] ?? 0);
  }
  return s;
}

/** 模型驱动的整轮放置计划（treePlan=阵型树本回合计划，与训练特征一致）
 *  forceTreeAction=阵型树动作优先（如开局坦克，游戏设计先验），首动作采用后其余由模型决定 */
export function planRoundPlacementsModel(
  snap: BoardSnapshot,
  model: TrainedModel,
  treePlan?: { monsterId: number; x: number; y: number }[],
  forceTreeAction?: { monsterId: number; x: number; y: number }[],
): Placement[] {
  const zone = ZONE[snap.side];
  const plan: Placement[] = [];
  const placedIds = new Set(snap.myMonsters.map(m => m.dbId));
  const localGrid = snap.grid.map(row => [...row]);
  let budget = snap.budget;
  const round = snap.round;
  const forceQueue = forceTreeAction ? [...forceTreeAction] : [];

  while (true) {
    // 树计划动作优先（推理侧开局强制坦克；校验可放置后采用）
    if (forceQueue.length > 0) {
      const idx = forceQueue.findIndex(ta => {
        const card = snap.hand.find(h => h.monsterId === ta.monsterId && !placedIds.has(h.monsterId));
        const m = card ? DB_MONSTERS.find(d => d.id === ta.monsterId) : undefined;
        return (
          !!card && !!m && m.cost <= budget &&
          ta.x >= zone.min && ta.x <= zone.max && ta.y >= 0 && ta.y < 5 &&
          localGrid[ta.y][ta.x] === null
        );
      });
      if (idx >= 0) {
        const ta = forceQueue.splice(idx, 1)[0];
        const card = snap.hand.find(h => h.monsterId === ta.monsterId)!;
        plan.push({ monsterId: ta.monsterId, badgeIds: card.badgeIds, x: ta.x, y: ta.y });
        placedIds.add(ta.monsterId);
        budget -= DB_MONSTERS.find(m => m.id === ta.monsterId)!.cost;
        localGrid[ta.y][ta.x] = { monsterId: ta.monsterId } as unknown as PlacedMonster;
        continue;
      }
    }

    // 当前已提交部分的轻量己方列表
    const myLight = snap.myMonsters.map(m => ({ dbId: m.dbId, gridX: m.gridX, gridY: m.gridY }) as unknown as PlacedMonster);
    for (const p of plan) myLight.push({ dbId: p.monsterId, gridX: p.x, gridY: p.y } as unknown as PlacedMonster);
    const curSnap: BoardSnapshot = { ...snap, grid: localGrid, myMonsters: myLight };

    let best: (Placement & { score: number }) | null = null;
    for (const card of snap.hand) {
      if (placedIds.has(card.monsterId)) continue;
      const monster = DB_MONSTERS.find(m => m.id === card.monsterId);
      if (!monster || monster.cost > budget) continue;

      for (let y = 0; y < 5; y++) {
        for (let x = zone.min; x <= zone.max; x++) {
          if (localGrid[y][x] !== null) continue;
          const { rowDensity, adjFriendly } = snapCounts(curSnap, x, y);
          const score = modelScore(
            {
              cand: { monsterId: card.monsterId, badgeIds: card.badgeIds, x, y },
              score: 0,
              round,
              budget,
              side: snap.side,
              treePlan,
              myCount: myLight.length,
              enemyCount: snap.enemyMonsters.length,
              rowDensity,
              adjFriendly,
            },
            model,
          );
          // 确定性平局裁决：分数高者胜；同分取 monsterId/x/y 较小者
          const isBetter =
            !best ||
            score > best.score ||
            (score === best.score &&
              (card.monsterId < best.monsterId ||
                (card.monsterId === best.monsterId && x < best.x) ||
                (card.monsterId === best.monsterId && x === best.x && y < best.y)));
          if (isBetter) best = { monsterId: card.monsterId, badgeIds: card.badgeIds, x, y, score };
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
