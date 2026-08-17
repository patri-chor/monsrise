// ============================================================
// 对战指标度量与综合评分 (Match Metrics)
//
// 指标定义：
//   - trainingScore = (win + 0.5 * draw) / total
//   - pureWinRate = win / total
//   - undefeatedRate = (win + draw) / total
// ============================================================

export interface MatchMetrics {
  win: number;
  draw: number;
  loss: number;
  total: number;
  trainingScore: number;  // 0.0 ~ 1.0 (主要决策指标)
  pureWinRate: number;    // 0.0 ~ 1.0 (胜率)
  undefeatedRate: number; // 0.0 ~ 1.0 (不败率)
}

export function calculateMatchMetrics(win: number, draw: number, loss: number): MatchMetrics {
  const total = win + draw + loss;
  const trainingScore = total > 0 ? (win + 0.5 * draw) / total : 0;
  const pureWinRate = total > 0 ? win / total : 0;
  const undefeatedRate = total > 0 ? (win + draw) / total : 0;

  return {
    win,
    draw,
    loss,
    total,
    trainingScore,
    pureWinRate,
    undefeatedRate,
  };
}

export function createEmptyMatchMetrics(): MatchMetrics {
  return {
    win: 0,
    draw: 0,
    loss: 0,
    total: 0,
    trainingScore: 0,
    pureWinRate: 0,
    undefeatedRate: 0,
  };
}

export function formatMatchMetrics(m: MatchMetrics): string {
  const scorePct = (m.trainingScore * 100).toFixed(1);
  const undPct = (m.undefeatedRate * 100).toFixed(1);
  const winPct = (m.pureWinRate * 100).toFixed(1);
  return `训练分 ${scorePct}%（${m.win}胜/${m.draw}平/${m.loss}负，不败率 ${undPct}%，纯胜率 ${winPct}%）`;
}
