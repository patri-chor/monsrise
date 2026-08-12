// ============================================================
// 模型评估：训练后的模型 vs 贪心/搜索，跑 N 局（含换边）看胜率
// 对阵：formation_library 全部 7 阵型确定性随机配对（与 collector 同款 pickPair）
// 运行：npx vite-node --script src/engine/train/evaluate.ts <局数> [对手=greedy|search] [模型路径]
// ============================================================

import { playFullGame } from '../play_full_game';
import { FORMATION_LIBRARY } from '../../ai/formation_library';
import { loadModel } from './model_planner';
import type { MatchResult } from '../types';
import type { Formation } from '../../ai/types';

// 对阵池：全部 7 个阵型（含阵型树），每局确定性随机配对（可复现）
const FORMATIONS = FORMATION_LIBRARY;

function mulberry32(seed: number): () => number {
  let t = seed + 0x6D2B79F5;
  return () => {
    t += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickPair(seed: number): [Formation, Formation] {
  const rng = mulberry32(seed);
  const a = Math.floor(rng() * FORMATIONS.length);
  let b = Math.floor(rng() * (FORMATIONS.length - 1));
  if (b >= a) b++;
  return [FORMATIONS[a], FORMATIONS[b]];
}

interface BatchStats {
  games: number;
  aWins: number;
  bWins: number;
  draws: number;
  abnormal: number;
  elapsedMs: number;
  /** 棋盘侧胜场（模型批用它看模型侧胜率：模型(p1) 看 p1Wins，模型(p2) 看 p2Wins） */
  p1Wins: number;
  p2Wins: number;
}

function runBatch(
  n: number,
  planner: 'greedy' | 'search' | 'model',
  modelSide: 'p1' | 'p2' | 'both',
  label: string,
): BatchStats {
  process.env.PLANNER = planner;
  if (planner === 'model') {
    process.env.MODEL_SIDE = modelSide;
  } else {
    process.env.SEARCH_SIDE = 'both';
  }
  const st: BatchStats = { games: 0, aWins: 0, bWins: 0, draws: 0, abnormal: 0, elapsedMs: 0, p1Wins: 0, p2Wins: 0 };
  const t0 = Date.now();
  for (let i = 0; i < n; i++) {
    const [fa, fb] = pickPair(i + 1);
    const swap = i % 2 === 1;
    const r: MatchResult = playFullGame(swap ? fb.team : fa.team, swap ? fa.team : fb.team, {
      seed: i + 1,
      treeA: swap ? fb.tree : fa.tree,
      treeB: swap ? fa.tree : fb.tree,
      // 与训练一致：R1 强制阵型树计划（开局坦克，游戏设计先验）
      forceTreeRounds: [1],
    });
    const aWon = (r.winner === 1 && !swap) || (r.winner === 2 && swap);
    if (r.winner === 0) st.draws++;
    else if (aWon) st.aWins++;
    else st.bWins++;
    if (r.winner === 1) st.p1Wins++;
    else if (r.winner === 2) st.p2Wins++;
    if (r.roundsPlayed < 1 || r.roundsPlayed > 5 || r.p1Score + r.p2Score !== r.roundResults.filter(x => x !== 0).length) {
      st.abnormal++;
      console.log(`  异常局 #${i + 1}: ${JSON.stringify(r)}`);
    }
  }
  st.games = n;
  st.elapsedMs = Date.now() - t0;
  console.log(`[${label}] ${n} 局 | A=${((st.aWins / n) * 100).toFixed(1)}% B=${((st.bWins / n) * 100).toFixed(1)}% 平=${((st.draws / n) * 100).toFixed(1)}% | p1侧=${((st.p1Wins / n) * 100).toFixed(1)}% p2侧=${((st.p2Wins / n) * 100).toFixed(1)}% | 异常 ${st.abnormal} | ${(st.elapsedMs / 1000).toFixed(1)}s`);
  return st;
}

// CLI 入口
if (process.argv[1] && process.argv[1].endsWith('evaluate.ts')) {
  const games = Number(process.argv[2]) || 10;
  const opponent = (process.argv[3] || 'greedy') as 'greedy' | 'search';
  const modelPath = process.argv[4] || 'reports/model.json';
  if (opponent !== 'greedy' && opponent !== 'search') {
    console.error('对手仅支持 greedy 或 search');
    process.exit(1);
  }
  process.env.MODEL_PATH = modelPath;
  loadModel(modelPath);

  console.log(`=== 模型 vs ${opponent}（各 ${games} 局，7 阵型随机配对，含换边）===\n`);
  // 基线：双方 greedy/搜索（无模型）
  runBatch(games, opponent, 'both', `基线 ${opponent} vs ${opponent}`);
  // 模型在 p1 侧 vs greedy/搜索 p2 侧
  runBatch(games, 'model', 'p1', `模型(p1) vs ${opponent}(p2)`);
  // 模型在 p2 侧 vs greedy/搜索 p1 侧
  runBatch(games, 'model', 'p2', `模型(p2) vs ${opponent}(p1)`);
  // 双方都模型（稳定性）
  runBatch(games, 'model', 'both', '模型 vs 模型');
}
