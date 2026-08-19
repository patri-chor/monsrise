// ============================================================
// src/engine/tree/product_training/stage1_episode.ts
// T041R 严格不同的 Stage-1 聚焦优化尝试与账本持久化
//
// 规范要求：
//   - 必须包含至少 3 次真实、不同的优化尝试 (distinct attempt identities)
//   - 每次尝试必须具备不同的 candidateFingerprint / atomicChanges / targetDiagnosis
//   - 每次尝试执行完整的 Strong Pool 11 x P1/P2 评测并记录独立 vector 引用
//   - 记录 countable: true，杜绝重复记录伪造完成度
// ============================================================

import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import type { FeatureMask } from '../evol_gene';
import { cloneEvolFormation, walkEvolNodes } from '../evol_gene';
import {
  computeCandidateFingerprint,
  getControllablePlacements,
  isLegalP2Coord,
} from './02_candidates';
import type { CandidateEntry } from './04_screen';
import { T037_OUTPUT_DIR } from './04_screen';

export const STAGE1_EPISODE_LEDGER_PATH = resolve(`${T037_OUTPUT_DIR}/stage1_episode_ledger.jsonl`);

export interface Stage1EpisodeAttemptRecord {
  recordId: string;
  attemptIdentity: string; // 稳定哈希
  countable: boolean;
  dedupeReason: string | null;
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

export function computeAttemptIdentity(opts: {
  candidateFingerprint: string;
  parentFingerprint: string;
  operatorFamily: string;
  atomicChanges: any[];
  targetOpponentId: string;
  targetSide: number;
}): string {
  return createHash('sha256')
    .update(JSON.stringify(opts))
    .digest('hex')
    .slice(0, 16);
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

/** 校验候选是否满足 3 次不同的 Stage-1 优化尝试门禁 */
export function isStage1EpisodeComplete(candidateId: string, attemptsThreshold: number = 3): boolean {
  const records = loadCandidateStage1Attempts(candidateId);
  const distinctIds = new Set(records.filter(r => r.countable).map(r => r.attemptIdentity));
  return distinctIds.size >= attemptsThreshold;
}

/** 针对弱项诊断生成 3 个真实不同的 Stage-1 优化候选 */
export function generateDistinctStage1AttemptCandidates(opts: {
  baseCandidate: CandidateEntry;
  weakOpponentId: string;
  weakSide: 1 | 2;
  cycleOrdinal: number;
}): CandidateEntry[] {
  const { baseCandidate, weakOpponentId, weakSide, cycleOrdinal } = opts;
  const parentEvol = baseCandidate.evol;
  const parentFp = computeCandidateFingerprint(parentEvol);
  const srcId = baseCandidate.meta.sourceId;
  const candidates: CandidateEntry[] = [];

  // Attempt 1: 针对 weakOpponent 进行可控放置位置的局部平移 (+1 Y)
  const controllable = getControllablePlacements(parentEvol, new Set());
  if (controllable.length > 0) {
    const target = controllable[0];
    const clone = cloneEvolFormation(parentEvol);
    const node = walkEvolNodes(clone.root).find(n => n.id === target.nodeId);
    if (node) {
      const p = node.placements.find(x => x.monsterId === target.monsterId && x.x === target.x && x.y === target.y);
      if (p && isLegalP2Coord(p.x, Math.min(4, p.y + 1))) {
        const fromY = p.y;
        p.y = Math.min(4, p.y + 1);
        const fp = computeCandidateFingerprint(clone);
        candidates.push({
          meta: {
            candidateId: `cand:${srcId}:s1_att1_${weakOpponentId}_m${target.monsterId}`,
            sourceId: srcId,
            sourceName: baseCandidate.meta.sourceName,
            sourceFingerprint: parentFp,
            parentCandidateId: baseCandidate.meta.candidateId,
            operatorFamily: 'spatial_local',
            delta: {
              operatorFamily: 'spatial_local',
              nodeId: target.nodeId,
              monsterId: target.monsterId,
              fromX: p.x, fromY, toX: p.x, toY: p.y,
              description: `Stage-1 attempt 1: relocate m${target.monsterId} against weak ${weakOpponentId}`,
            } as any,
            canonicalFingerprint: fp,
            rejected: false,
            rejectionReason: null,
            createdAt: new Date().toISOString(),
          },
          evol: clone,
        });
      }
    }
  }

  // Attempt 2: 针对 weakSide 进行条件策略分支微调 (side-aware adjustment)
  const clone2 = cloneEvolFormation(parentEvol);
  const r1Node = walkEvolNodes(clone2.root).find(n => n.round === 1);
  if (r1Node && r1Node.placements.length > 0) {
    const targetSide = weakSide;
    const branchMask: FeatureMask = { side: targetSide, main: null, subs: [], keys: [] };
    const branchPlacements = r1Node.placements.map(p => ({
      monsterId: p.monsterId,
      x: p.x === 10 ? 9 : p.x + 1,
      y: p.y,
    }));
    r1Node.children = r1Node.children || [];
    r1Node.children.push({
      id: `b_s1_${targetSide}_${r1Node.id}_c${cycleOrdinal}`,
      round: 1,
      condition: branchMask,
      placements: branchPlacements,
      children: [],
    });
    const fp2 = computeCandidateFingerprint(clone2);
    candidates.push({
      meta: {
        candidateId: `cand:${srcId}:s1_att2_side${targetSide}_branch`,
        sourceId: srcId,
        sourceName: baseCandidate.meta.sourceName,
        sourceFingerprint: parentFp,
        parentCandidateId: baseCandidate.meta.candidateId,
        operatorFamily: 'strategy_schedule_branch',
        delta: {
          operatorFamily: 'strategy_schedule_branch',
          rounds: [1],
          hasR1Branch: true,
          hasR2PlusBranch: false,
          description: `Stage-1 attempt 2: side-aware branch for side ${targetSide}`,
        } as any,
        canonicalFingerprint: fp2,
        rejected: false,
        rejectionReason: null,
        createdAt: new Date().toISOString(),
      },
      evol: clone2,
    });
  }

  // Attempt 3: 协同局部微调 (针对第二可控怪兽或整体 X 平移)
  const clone3 = cloneEvolFormation(parentEvol);
  const target3 = controllable.length > 1 ? controllable[1] : controllable[0];
  if (target3) {
    const node = walkEvolNodes(clone3.root).find(n => n.id === target3.nodeId);
    if (node) {
      const p = node.placements.find(x => x.monsterId === target3.monsterId);
      if (p && isLegalP2Coord(p.x, Math.max(0, p.y - 1))) {
        const fromY = p.y;
        p.y = Math.max(0, p.y - 1);
        const fp3 = computeCandidateFingerprint(clone3);
        candidates.push({
          meta: {
            candidateId: `cand:${srcId}:s1_att3_shift_m${target3.monsterId}`,
            sourceId: srcId,
            sourceName: baseCandidate.meta.sourceName,
            sourceFingerprint: parentFp,
            parentCandidateId: baseCandidate.meta.candidateId,
            operatorFamily: 'spatial_local',
            delta: {
              operatorFamily: 'spatial_local',
              nodeId: target3.nodeId,
              monsterId: target3.monsterId,
              fromX: p.x, fromY, toX: p.x, toY: p.y,
              description: `Stage-1 attempt 3: shift m${target3.monsterId} to y=${p.y}`,
            } as any,
            canonicalFingerprint: fp3,
            rejected: false,
            rejectionReason: null,
            createdAt: new Date().toISOString(),
          },
          evol: clone3,
        });
      }
    }
  }

  return candidates;
}
