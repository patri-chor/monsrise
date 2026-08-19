// ============================================================
// src/engine/tree/product_training/stage1_episode.ts
// T041 严格 Stage-1 聚焦优化 Episode 门禁与账本持久化
//
// 规范要求：
//   - 进入 MELEE 前必须包含至少 3 次针对强阵弱项的实际单算子优化尝试
//   - 每次尝试必须真实运行 11 个强阵对手 × P1/P2 的评测向量
//   - 记录触发的弱项诊断、血缘、算子变更、评测向量与结果
//   - 严禁任何虚构/跳过行，未完成 3 次尝试严禁 dispatch Melee
// ============================================================

import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { T037_OUTPUT_DIR } from './04_screen';

export const STAGE1_EPISODE_LEDGER_PATH = resolve(`${T037_OUTPUT_DIR}/stage1_episode_ledger.jsonl`);

export interface Stage1EpisodeAttemptRecord {
  recordId: string;
  evidenceClass: 'AGGREGATE_EXPLORATION_ONLY';
  cycleId: string;
  sourceId: string;
  candidateId: string;
  parentFingerprint: string;
  candidateFingerprint: string;
  attemptOrdinal: number; // 1, 2, 3...
  operatorFamily: string;
  atomicChanges: Array<{ type: string; description: string; [key: string]: any }>;
  triggeredDiagnosis: {
    weakOpponentId: string;
    weakSide: 1 | 2;
    weakOpponentScore: number;
    diagnosisReason: string;
  };
  strongPoolVectorRef: string;
  totalGames: number;
  attemptScore: number;
  sourceRelativeScore: number;
  attemptOutcome: 'IMPROVED' | 'STABLE_NON_REGRESSED' | 'REGRESSED';
  nextParentSelection: 'ADVANCE_AS_PARENT' | 'RETAIN_PREVIOUS_PARENT';
  recordedAt: string;
}

export function appendStage1EpisodeRecord(rec: Stage1EpisodeAttemptRecord): void {
  appendFileSync(STAGE1_EPISODE_LEDGER_PATH, JSON.stringify(rec) + '\n', 'utf8');
}

export function loadCandidateStage1Attempts(candidateId: string): Stage1EpisodeAttemptRecord[] {
  if (!existsSync(STAGE1_EPISODE_LEDGER_PATH)) return [];
  const lines = readFileSync(STAGE1_EPISODE_LEDGER_PATH, 'utf8').split('\n').filter(Boolean);
  return lines
    .map(l => {
      try { return JSON.parse(l) as Stage1EpisodeAttemptRecord; } catch { return null; }
    })
    .filter((r): r is Stage1EpisodeAttemptRecord => r !== null && r.candidateId === candidateId);
}

/** 校验候选是否满足 3 次 Stage-1 优化尝试门禁 */
export function isStage1EpisodeComplete(candidateId: string, attemptsThreshold: number = 3): boolean {
  const records = loadCandidateStage1Attempts(candidateId);
  return records.length >= attemptsThreshold;
}
