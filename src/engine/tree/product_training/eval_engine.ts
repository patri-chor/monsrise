// ============================================================
// src/engine/tree/product_training/eval_engine.ts
// 标准产品路径对战评测内核 (零 Side-Inversion 漏洞 / 严格互斥镜像计分)
// ============================================================

import '../../env';
import { FORMATION_LIBRARY } from '../../../ai/formation_library';
import type { Formation } from '../../../ai/types';
import { formationToEvol, type EvolFormation } from '../evol_gene';
import { treeStrategyFor } from '../product_tree_strategy';
import { playFullGame } from '../../play_full_game';

import { computeCandidateFingerprint } from './02_candidates';

export interface EvalTargetSpec {
  id: string;
  name: string;
  team: any[];
  evol: EvolFormation;
  canonicalFingerprint?: string;
  calculatorPolicyFingerprint?: string;
  provenance?: string;
}

export interface EvalOpponentSpec {
  id: string;
  name: string;
  team: any[];
  evol: EvolFormation;
  canonicalFingerprint?: string;
  calculatorPolicyFingerprint?: string;
  provenance?: string;
}

export interface BatchPayloadGateResult {
  valid: boolean;
  expectedFingerprint: string;
  resolvedSnapshotFingerprint: string;
  preparedEvolFingerprint: string;
  error?: string;
}

/**
 * T053 C: 批次级 Payload 身份门禁 (Batch-Level Payload Identity Gate)
 * 断言：expected active-library fingerprint == resolved snapshot fingerprint == computeCandidateFingerprint(prepared evol)
 */
export function verifyBatchPayloadIdentity(
  expectedActiveLibraryFp: string,
  resolvedSnapshot: { canonicalFingerprint: string; evol: EvolFormation },
): BatchPayloadGateResult {
  const preparedEvolFp = computeCandidateFingerprint(resolvedSnapshot.evol);
  const valid =
    expectedActiveLibraryFp === resolvedSnapshot.canonicalFingerprint &&
    resolvedSnapshot.canonicalFingerprint === preparedEvolFp;

  return {
    valid,
    expectedFingerprint: expectedActiveLibraryFp,
    resolvedSnapshotFingerprint: resolvedSnapshot.canonicalFingerprint,
    preparedEvolFingerprint: preparedEvolFp,
    error: valid ? undefined : `Payload identity mismatch: library=${expectedActiveLibraryFp}, snapshot=${resolvedSnapshot.canonicalFingerprint}, prepared=${preparedEvolFp}`,
  };
}

export interface OpponentMatchMetrics {
  opponentId: string;
  w: number;
  d: number;
  l: number;
  totalGames: number;
  score70: number;
}

export interface FormationEvalResult {
  targetId: string;
  w: number;
  d: number;
  l: number;
  totalGames: number;
  winRate: number;
  drawRate: number;
  lossRate: number;
  noLossRate: number;
  score70: number;
  side1Stats: { w: number; d: number; l: number };
  side2Stats: { w: number; d: number; l: number };
  opponentBreakdown: Record<string, OpponentMatchMetrics>;
}

/**
 * 将任意阵型格式规范化为 EvalTargetSpec
 */
export function normalizeToEvalSpec(input: Formation | EvolFormation | { id: string; name: string; team: any[]; evol?: any }): EvalTargetSpec {
  if ('team' in input && Array.isArray(input.team) && input.team.length > 0) {
    const evol = (input as any).evol ?? formationToEvol(input as Formation);
    return {
      id: input.id,
      name: input.name,
      team: input.team,
      evol,
    };
  }
  if ('name' in input && 'placements' in input) {
    const evol = input as EvolFormation;
    // 寻找原 team 或构造
    const matched = FORMATION_LIBRARY.find(f => f.name === evol.name);
    return {
      id: (input as any).id ?? (matched ? matched.id : `evol_${evol.name}`),
      name: evol.name,
      team: matched ? matched.team : [],
      evol,
    };
  }
  throw new Error(`Cannot normalize input to EvalTargetSpec: ${JSON.stringify(input)}`);
}

/**
 * 核心对局单局执行函数 (严格镜像计分，杜绝双侧加分 Bug)
 */
export function playSingleGameSymmetric(
  target: EvalTargetSpec,
  opponent: EvalOpponentSpec,
  side: 1 | 2,
  seed: number,
): 'W' | 'D' | 'L' {
  const targetStrat = treeStrategyFor(target.evol);
  const oppStrat = treeStrategyFor(opponent.evol);

  if (side === 1) {
    // target 在 P1 (左侧), opponent 在 P2 (右侧)
    const res = playFullGame(target.team, opponent.team, {
      seed,
      identityA: target.id,
      identityB: opponent.id,
      strategyA: targetStrat,
      strategyB: oppStrat,
    });
    if (res.winner === 1) return 'W';
    if (res.winner === 0) return 'D';
    return 'L';
  } else {
    // opponent 在 P1 (左侧), target 在 P2 (右侧)
    const res = playFullGame(opponent.team, target.team, {
      seed,
      identityA: opponent.id,
      identityB: target.id,
      strategyA: oppStrat,
      strategyB: targetStrat,
    });
    if (res.winner === 2) return 'W'; // P2 (target) 赢
    if (res.winner === 0) return 'D'; // 平局
    return 'L'; // P1 (opponent) 赢 -> target 输
  }
}

/**
 * 评估一个目标阵型对战一组对手池的完整表现
 * 
 * 严格不变量保证：
 * 1. 无论作为 Side 1 还是 Side 2 出战，自身赢才计 W，对方赢计 L，平局计 D
 * 2. 严格满足 W + D + L = totalGames
 * 3. score70 = (W + 0.70 * D) / totalGames
 */
export function evaluateFormationAgainstPool(
  target: EvalTargetSpec,
  opponents: EvalOpponentSpec[],
  gamesPerSide: number = 5,
  seedBase: number = 100000,
): FormationEvalResult {
  let totalW = 0, totalD = 0, totalL = 0;
  const side1 = { w: 0, d: 0, l: 0 };
  const side2 = { w: 0, d: 0, l: 0 };
  const opponentBreakdown: Record<string, OpponentMatchMetrics> = {};

  for (let oppIdx = 0; oppIdx < opponents.length; oppIdx++) {
    const opp = opponents[oppIdx];
    let oppW = 0, oppD = 0, oppL = 0;

    for (const side of [1, 2] as (1 | 2)[]) {
      for (let g = 0; g < gamesPerSide; g++) {
        const seed = seedBase + oppIdx * 1000 + side * 100 + g;
        const outcome = playSingleGameSymmetric(target, opp, side, seed);

        if (outcome === 'W') {
          totalW++;
          oppW++;
          if (side === 1) side1.w++; else side2.w++;
        } else if (outcome === 'D') {
          totalD++;
          oppD++;
          if (side === 1) side1.d++; else side2.d++;
        } else {
          totalL++;
          oppL++;
          if (side === 1) side1.l++; else side2.l++;
        }
      }
    }

    const oppTotal = oppW + oppD + oppL;
    opponentBreakdown[opp.id] = {
      opponentId: opp.id,
      w: oppW,
      d: oppD,
      l: oppL,
      totalGames: oppTotal,
      score70: oppTotal > 0 ? Number(((oppW + 0.70 * oppD) / oppTotal).toFixed(4)) : 0,
    };
  }

  const totalGames = totalW + totalD + totalL;
  const winRate = totalGames > 0 ? totalW / totalGames : 0;
  const drawRate = totalGames > 0 ? totalD / totalGames : 0;
  const lossRate = totalGames > 0 ? totalL / totalGames : 0;
  const noLossRate = totalGames > 0 ? (totalW + totalD) / totalGames : 0;
  const score70 = totalGames > 0 ? Number(((totalW + 0.70 * totalD) / totalGames).toFixed(4)) : 0;

  return {
    targetId: target.id,
    w: totalW,
    d: totalD,
    l: totalL,
    totalGames,
    winRate: Number(winRate.toFixed(4)),
    drawRate: Number(drawRate.toFixed(4)),
    lossRate: Number(lossRate.toFixed(4)),
    noLossRate: Number(noLossRate.toFixed(4)),
    score70,
    side1Stats: side1,
    side2Stats: side2,
    opponentBreakdown,
  };
}
