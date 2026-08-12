// ============================================================
// 数据收集器：跑 N 局 search 自对弈，把每个候选 (特征, 搜索评分, 对局胜负) 追加写 JSONL
// 标签 = 多局价值：该候选所在对局，己方最终胜负（胜=1 负=-1 平=0）
// 特征含阵型树意图（开局坦克等人工先验）
// 运行：npx vite-node --script src/engine/train/collector.ts <局数> [searchN] [输出路径]
// ============================================================

import fs from 'node:fs';
import path from 'node:path';
import { playFullGame } from '../play_full_game';
import { FORMATION_LIBRARY } from '../../ai/formation_library';
import { encodeCandidate, FEATURE_NAMES } from './features';
import type { Formation } from '../../ai/types';

// 训练阵容池：formation_library 全部 7 个阵型，每局确定性随机配对（含 4 费阵型）
const FORMATIONS = FORMATION_LIBRARY;

/** Mulberry32：与 GameEngine.random 同款，保证同 seed 同配对（可复现） */
function mulberry32(seed: number): () => number {
  let t = seed + 0x6D2B79F5;
  return () => {
    t += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 确定性随机挑两个不同阵型作为本局 A/B（返回含阵型树） */
function pickPair(seed: number): [Formation, Formation] {
  const rng = mulberry32(seed);
  const a = Math.floor(rng() * FORMATIONS.length);
  let b = Math.floor(rng() * (FORMATIONS.length - 1));
  if (b >= a) b++;
  return [FORMATIONS[a], FORMATIONS[b]];
}

export interface CollectResult {
  games: number;
  samples: number;
  elapsedMs: number;
  outPath: string;
}

export function collectData(games: number, searchN: number, outPath: string): CollectResult {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const fd = fs.openSync(outPath, 'w');
  fs.writeSync(fd, JSON.stringify({ type: 'meta', featureNames: FEATURE_NAMES, searchN, generatedAt: new Date().toISOString() }) + '\n');

  process.env.PLANNER = 'search';
  process.env.SEARCH_N = String(searchN);
  process.env.SEARCH_SIDE = 'both';

  let samples = 0;
  const t0 = Date.now();
  for (let i = 0; i < games; i++) {
    const swap = i % 2 === 1; // 每局换边，抵消先后手偏差
    const [fa, fb] = pickPair(i + 1);
    const teamA = swap ? fb.team : fa.team;
    const teamB = swap ? fa.team : fb.team;
    const gameSamples: { features: number[]; label: number; score: number; side: 'p1' | 'p2'; round: number; chosen: boolean }[] = [];
    const r = playFullGame(teamA, teamB, {
      seed: i + 1,
      treeA: swap ? fb.tree : fa.tree,
      treeB: swap ? fa.tree : fb.tree,
      // 数据侧修正：R1 强制按阵型树计划（坦克开局），让训练数据含"开局坦克且胜率高"的样本
      forceTreeRounds: [1],
      onCandidate: ctx => {
        gameSamples.push({
          features: encodeCandidate(ctx),
          label: 0,
          score: ctx.score,
          side: ctx.side,
          round: ctx.round,
          chosen: !!ctx.chosen,
        });
      },
    });
    // 局末打多局价值标签：仅被搜索/树选中的候选携带胜负信号（胜=1 负=-1 平=0），
    // 未选中的候选标 0（中性）——否则同一对局所有候选共享标签，噪声会淹没"坦克开局"这类先验
    const p1Won = r.winner === 1;
    const p2Won = r.winner === 2;
    for (const s of gameSamples) {
      if (!s.chosen) continue;
      const myWon = s.side === 'p1' ? p1Won : p2Won;
      const myLost = s.side === 'p1' ? p2Won : p1Won;
      s.label = myWon ? 1 : myLost ? -1 : 0;
      fs.writeSync(fd, JSON.stringify(s) + '\n');
      samples++;
    }
    console.log(`  #${i + 1} ${swap ? '换边' : '正边'} ${fa.name} vs ${fb.name} winner=${r.winner} 比分 ${r.p1Score}:${r.p2Score} 回合${r.roundsPlayed} 样本${gameSamples.length}`);
  }
  fs.closeSync(fd);
  const elapsedMs = Date.now() - t0;
  console.log(`样本 ${samples} 条（${games} 局）耗时 ${(elapsedMs / 1000).toFixed(1)}s → ${outPath}`);
  return { games, samples, elapsedMs, outPath };
}

// CLI 入口
if (process.argv[1] && process.argv[1].endsWith('collector.ts')) {
  const games = Number(process.argv[2]) || 30;
  const searchN = Number(process.argv[3]) || 2;
  const outPath = process.argv[4] || 'reports/train_data.jsonl';
  collectData(games, searchN, outPath);
}
