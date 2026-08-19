// ============================================================
// src/engine/tree/product_training/stage_ladder.ts
// T040 长程训练阶梯状态机、跃迁判定、血缘追踪与搜索覆盖账本
//
// 规范要求：
//   - 训练阶段定义：STAGE_3_EARLY_BUNDLE -> STAGE_2_STRONG_POOL -> STAGE_1_STRONG_EPISODE -> MELEE -> EXPERIMENTAL_FRONTIER
//   - Melee 失败退回 Stage 1（绝不能退回 Stage 3）
//   - Specialist 候选标记为 SPECIALIST_EXPERIMENTAL，不覆盖通用的 EXPERIMENTAL_FRONTIER
//   - 严禁 candidate-vs-parent 自博弈
//   - 严禁 3-target separation / adScore 压缩分数，使用完整 per-cell 向量
// ============================================================

import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { T037_OUTPUT_DIR } from './04_screen';

export const STAGE_TRAINING_LEDGER_PATH = resolve(`${T037_OUTPUT_DIR}/stage_training_ledger.jsonl`);
export const BENCHMARK_CELL_RESULTS_PATH = resolve(`${T037_OUTPUT_DIR}/benchmark_cell_results.jsonl`);
export const CANDIDATE_LINEAGE_PATH = resolve(`${T037_OUTPUT_DIR}/candidate_lineage.jsonl`);
export const SEARCH_COVERAGE_PATH = resolve(`${T037_OUTPUT_DIR}/search_coverage.jsonl`);

// ---- 阶段定义 ----

export type TrainingStage =
  | 'STAGE_3_EARLY_BUNDLE'
  | 'STAGE_2_STRONG_POOL'
  | 'STAGE_1_STRONG_EPISODE'
  | 'MELEE'
  | 'EXPERIMENTAL_FRONTIER';

// ---- 状态转换记录 ----

export interface StageTrainingLedgerRecord {
  recordId: string;
  evidenceClass: 'AGGREGATE_EXPLORATION_ONLY';
  cycleId: string;
  sourceId: string;
  candidateId: string;
  candidateFingerprint: string;
  parentFingerprint: string | null;
  operatorFamily: string;
  previousStage: TrainingStage;
  nextStage: TrainingStage;
  transitionDecision: 'STAGE_PROMOTED' | 'STAGE_RETAINED' | 'MELEE_DIAGNOSE_RETURN_STAGE_1' | 'SPECIALIST_BRANCH';
  isSpecialist: boolean;
  score: number;
  sourceRelativeScore: number;
  weakestOpponentId: string;
  weakestOpponentScore: number;
  weakestSide: 1 | 2;
  transitionReason: string;
  timestamp: string;
}

// ---- 完整 Per-Cell 向量记录 ----

export interface CellVectorItem {
  opponentId: string;
  side: 1 | 2;
  w: number;
  d: number;
  l: number;
  score: number;
}

export interface BenchmarkCellResultRecord {
  recordId: string;
  evidenceClass: 'AGGREGATE_EXPLORATION_ONLY';
  cycleId: string;
  candidateId: string;
  sourceId: string;
  poolName: string;
  benchmarkRevision: string;
  totalCells: number;
  totalGames: number;
  overallW: number;
  overallD: number;
  overallL: number;
  trainingScore: number;
  sourceRelativeScore: number;
  weakestSideScore: number;
  weakestOpponentScore: number;
  cellVectors: CellVectorItem[];
  recordedAt: string;
}

// ---- 血缘追踪记录 ----

export interface CandidateLineageRecord {
  recordId: string;
  candidateId: string;
  candidateFingerprint: string;
  parentCandidateId: string | null;
  parentFingerprint: string | null;
  sourceId: string;
  operatorFamily: string;
  atomicChanges: Array<{ type: string; description: string; [key: string]: any }>;
  createdAt: string;
}

// ---- 搜索覆盖记录 ----

export interface SearchCoverageRecord {
  recordId: string;
  sourceId: string;
  directionId: string;
  operatorFamily: string;
  targetNodeOrPlacement: string;
  status: 'TESTED_ACTIVE' | 'TESTED_EPISODE_EXHAUSTED' | 'PAUSED_CURRENT_SEARCH_SPACE';
  attemptsCount: number;
  bestRelativeScore: number;
  lastUpdated: string;
}

// ---- 工具函数 ----

export function appendLedgerRecord(rec: StageTrainingLedgerRecord): void {
  appendFileSync(STAGE_TRAINING_LEDGER_PATH, JSON.stringify(rec) + '\n', 'utf8');
}

export function appendCellResultRecord(rec: BenchmarkCellResultRecord): void {
  appendFileSync(BENCHMARK_CELL_RESULTS_PATH, JSON.stringify(rec) + '\n', 'utf8');
}

export function appendLineageRecord(rec: CandidateLineageRecord): void {
  appendFileSync(CANDIDATE_LINEAGE_PATH, JSON.stringify(rec) + '\n', 'utf8');
}

export function appendSearchCoverageRecord(rec: SearchCoverageRecord): void {
  appendFileSync(SEARCH_COVERAGE_PATH, JSON.stringify(rec) + '\n', 'utf8');
}

// ---- 阶段状态机跃迁决策 ----

export function evaluateStageTransition(opts: {
  currentStage: TrainingStage;
  cellVectors: CellVectorItem[];
  baselineScore: number;
  stage1EpisodesCompleted: number;
  improvesSpecificCounter: boolean;
  hasGeneralRegression: boolean;
}): {
  nextStage: TrainingStage;
  decision: 'STAGE_PROMOTED' | 'STAGE_RETAINED' | 'MELEE_DIAGNOSE_RETURN_STAGE_1' | 'SPECIALIST_BRANCH';
  isSpecialist: boolean;
  reason: string;
  overallScore: number;
  relScore: number;
  weakestOpponentId: string;
  weakestOpponentScore: number;
  weakestSide: 1 | 2;
} {
  const { currentStage, cellVectors, baselineScore, stage1EpisodesCompleted, improvesSpecificCounter, hasGeneralRegression } = opts;

  let totalW = 0, totalD = 0, totalL = 0;
  const oppScores: Record<string, { w: number; d: number; l: number; score: number }> = {};
  let side1W = 0, side1Games = 0;
  let side2W = 0, side2Games = 0;

  for (const cv of cellVectors) {
    totalW += cv.w;
    totalD += cv.d;
    totalL += cv.l;
    if (!oppScores[cv.opponentId]) oppScores[cv.opponentId] = { w: 0, d: 0, l: 0, score: 0 };
    oppScores[cv.opponentId].w += cv.w;
    oppScores[cv.opponentId].d += cv.d;
    oppScores[cv.opponentId].l += cv.l;

    if (cv.side === 1) { side1W += cv.w + 0.5 * cv.d; side1Games += (cv.w + cv.d + cv.l); }
    if (cv.side === 2) { side2W += cv.w + 0.5 * cv.d; side2Games += (cv.w + cv.d + cv.l); }
  }

  const totalGames = totalW + totalD + totalL;
  const overallScore = totalGames > 0 ? (totalW + 0.5 * totalD) / totalGames : 0;
  const relScore = overallScore - baselineScore;

  // 寻找最弱对手与最弱侧
  let weakestOpponentId = '';
  let weakestOpponentScore = 1.0;
  for (const [oppId, stat] of Object.entries(oppScores)) {
    const oppTotal = stat.w + stat.d + stat.l;
    const oppScore = oppTotal > 0 ? (stat.w + 0.5 * stat.d) / oppTotal : 0;
    stat.score = oppScore;
    if (oppScore < weakestOpponentScore) {
      weakestOpponentScore = oppScore;
      weakestOpponentId = oppId;
    }
  }

  const s1Score = side1Games > 0 ? side1W / side1Games : 0;
  const s2Score = side2Games > 0 ? side2W / side2Games : 0;
  const weakestSide: 1 | 2 = s1Score <= s2Score ? 1 : 2;

  // 专家分支判定
  if (improvesSpecificCounter && hasGeneralRegression) {
    return {
      nextStage: currentStage,
      decision: 'SPECIALIST_BRANCH',
      isSpecialist: true,
      reason: `Improves specific counter against ${weakestOpponentId} but exhibits general regression -> Retained as SPECIALIST_EXPERIMENTAL branch`,
      overallScore,
      relScore,
      weakestOpponentId,
      weakestOpponentScore,
      weakestSide,
    };
  }

  // 阶梯跃迁状态机
  if (currentStage === 'STAGE_3_EARLY_BUNDLE') {
    // Stage 3 -> Stage 2：Early Bundle 8 向量达标 (relScore >= -0.05 且 overallScore >= 0.70)
    if (relScore >= -0.05 && overallScore >= 0.70) {
      return {
        nextStage: 'STAGE_2_STRONG_POOL',
        decision: 'STAGE_PROMOTED',
        isSpecialist: false,
        reason: `Early Bundle 8 qualified: overallScore=${overallScore.toFixed(3)}, rel=${relScore.toFixed(3)} >= -0.05 -> Advance to Stage 2`,
        overallScore,
        relScore,
        weakestOpponentId,
        weakestOpponentScore,
        weakestSide,
      };
    } else {
      return {
        nextStage: 'STAGE_3_EARLY_BUNDLE',
        decision: 'STAGE_RETAINED',
        isSpecialist: false,
        reason: `Early Bundle 8 not qualified: rel=${relScore.toFixed(3)} < -0.05 -> Retained at Stage 3`,
        overallScore,
        relScore,
        weakestOpponentId,
        weakestOpponentScore,
        weakestSide,
      };
    }
  }

  if (currentStage === 'STAGE_2_STRONG_POOL') {
    // Stage 2 -> Stage 1：Strong Pool 11 向量达标 (relScore >= 0.000)
    if (relScore >= 0.000) {
      return {
        nextStage: 'STAGE_1_STRONG_EPISODE',
        decision: 'STAGE_PROMOTED',
        isSpecialist: false,
        reason: `Current Strong Pool 11 qualified: overallScore=${overallScore.toFixed(3)}, rel=${relScore.toFixed(3)} >= 0.000 -> Advance to Stage 1 episode`,
        overallScore,
        relScore,
        weakestOpponentId,
        weakestOpponentScore,
        weakestSide,
      };
    } else {
      return {
        nextStage: 'STAGE_2_STRONG_POOL',
        decision: 'STAGE_RETAINED',
        isSpecialist: false,
        reason: `Current Strong Pool 11 not non-regressed: rel=${relScore.toFixed(3)} < 0.000, weakest matchup=${weakestOpponentId} (${weakestOpponentScore.toFixed(3)}) -> Retained at Stage 2`,
        overallScore,
        relScore,
        weakestOpponentId,
        weakestOpponentScore,
        weakestSide,
      };
    }
  }

  if (currentStage === 'STAGE_1_STRONG_EPISODE') {
    // Stage 1 -> Melee：完成 Stage-1 focused episode (>= 1 次专注调优且整体稳定)
    if (stage1EpisodesCompleted >= 1 && relScore >= 0.000) {
      return {
        nextStage: 'MELEE',
        decision: 'STAGE_PROMOTED',
        isSpecialist: false,
        reason: `Stage 1 focused episode complete (${stage1EpisodesCompleted} episodes, rel=${relScore.toFixed(3)}) -> Advance to Melee mixed pool`,
        overallScore,
        relScore,
        weakestOpponentId,
        weakestOpponentScore,
        weakestSide,
      };
    } else {
      return {
        nextStage: 'STAGE_1_STRONG_EPISODE',
        decision: 'STAGE_RETAINED',
        isSpecialist: false,
        reason: `Stage 1 focused episode continuing (episodes=${stage1EpisodesCompleted}, targeting ${weakestOpponentId}/side${weakestSide})`,
        overallScore,
        relScore,
        weakestOpponentId,
        weakestOpponentScore,
        weakestSide,
      };
    }
  }

  if (currentStage === 'MELEE') {
    // Melee 评估：若稳定跨越混合池 -> EXPERIMENTAL_FRONTIER
    // 若失败 -> 返回 STAGE_1_STRONG_EPISODE 诊断优化（绝不退回 Stage 3）
    if (relScore >= 0.000 && weakestOpponentScore >= 0.40) {
      return {
        nextStage: 'EXPERIMENTAL_FRONTIER',
        decision: 'STAGE_PROMOTED',
        isSpecialist: false,
        reason: `Melee mixed pool stability verified (score=${overallScore.toFixed(3)}, rel=${relScore.toFixed(3)}, weakestMatchup=${weakestOpponentId}@${weakestOpponentScore.toFixed(3)}) -> EXPERIMENTAL_FRONTIER`,
        overallScore,
        relScore,
        weakestOpponentId,
        weakestOpponentScore,
        weakestSide,
      };
    } else {
      return {
        nextStage: 'STAGE_1_STRONG_EPISODE',
        decision: 'MELEE_DIAGNOSE_RETURN_STAGE_1',
        isSpecialist: false,
        reason: `Melee exposed weakness against ${weakestOpponentId} (${weakestOpponentScore.toFixed(3)}) / side ${weakestSide} -> Return to Stage 1 focused optimization`,
        overallScore,
        relScore,
        weakestOpponentId,
        weakestOpponentScore,
        weakestSide,
      };
    }
  }

  // 默认保持
  return {
    nextStage: currentStage,
    decision: 'STAGE_RETAINED',
    isSpecialist: false,
    reason: `Holding stage ${currentStage}`,
    overallScore,
    relScore,
    weakestOpponentId,
    weakestOpponentScore,
    weakestSide,
  };
}
