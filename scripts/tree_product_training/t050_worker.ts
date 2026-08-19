// ============================================================
// scripts/tree_product_training/t050_worker.ts
// Worker for evaluating a single target in T050 multi-threading
// ============================================================

import '../../src/engine/env';
import { parentPort, workerData } from 'node:worker_threads';
import { FORMATION_LIBRARY } from '../../src/ai/formation_library';
import { formationToEvol } from '../../src/engine/tree/evol_gene';
import { treeStrategyFor } from '../../src/engine/tree/product_tree_strategy';
import { playFullGame } from '../../src/engine/play_full_game';

export interface TargetTaskData {
  targetIdx: number;
  formationId: string;
  rootT0SourceId: string;
  currentTier: string;
  canonicalFingerprint: string;
  levelsToRetest: ('L2' | 'L1')[];
  strong11Ids: string[];
  seedBaseL2: number;
  seedBaseL1: number;
}

export interface TargetTaskResult {
  targetIdx: number;
  formationId: string;
  l2Vector: any | null;
  l1Vector: any | null;
  rawGames: any[];
}

export function runTargetEvaluation(data: TargetTaskData): TargetTaskResult {
  const { targetIdx, formationId, rootT0SourceId, currentTier, levelsToRetest, seedBaseL2, seedBaseL1 } = data;

  const srcFormation = FORMATION_LIBRARY.find(f => f.id === rootT0SourceId) ?? FORMATION_LIBRARY[0];
  const strong11Opponents = FORMATION_LIBRARY.slice(0, 11);
  const evol = formationToEvol(srcFormation);
  const strategy = treeStrategyFor(evol);

  const rawGames: any[] = [];
  let l2Vector: any | null = null;
  let l1Vector: any | null = null;

  // L2 Retest
  if (levelsToRetest.includes('L2')) {
    let l2W = 0, l2D = 0, l2L = 0;
    const oppVectors: Record<string, { w: number; d: number; l: number }> = {};
    const sideVectors: Record<1 | 2, { w: number; d: number; l: number }> = {
      1: { w: 0, d: 0, l: 0 },
      2: { w: 0, d: 0, l: 0 },
    };

    for (let oppIdx = 0; oppIdx < strong11Opponents.length; oppIdx++) {
      const opp = strong11Opponents[oppIdx];
      const oppId = opp.id;
      const oppStrategy = treeStrategyFor(formationToEvol(opp));
      oppVectors[oppId] = { w: 0, d: 0, l: 0 };

      for (const side of [1, 2] as (1 | 2)[]) {
        for (let g = 0; g < 10; g++) {
          const seed = seedBaseL2 + targetIdx * 10000 + oppIdx * 500 + side * 100 + g;
          const teamA = side === 1 ? srcFormation.team : opp.team;
          const teamB = side === 1 ? opp.team : srcFormation.team;
          const stratA = side === 1 ? strategy : oppStrategy;
          const stratB = side === 1 ? oppStrategy : strategy;

          const res = playFullGame(teamA, teamB, {
            seed,
            strategyA: stratA,
            strategyB: stratB,
            identityA: side === 1 ? formationId : oppId,
            identityB: side === 1 ? oppId : formationId,
          });

          const winnerSide = res.winner;
          let outcome = 'L';
          if (winnerSide === side) {
            outcome = 'W';
            l2W++;
            oppVectors[oppId].w++;
            sideVectors[side].w++;
          } else if (winnerSide === 0) {
            outcome = 'D';
            l2D++;
            oppVectors[oppId].d++;
            sideVectors[side].d++;
          } else {
            l2L++;
            oppVectors[oppId].l++;
            sideVectors[side].l++;
          }

          rawGames.push({
            revision: 'v1.0.0-t050-independent-retest',
            formationId,
            level: 'L2',
            opponentId: oppId,
            side,
            gameIndex: g,
            seed,
            outcome,
            winnerSide,
            workerError: null,
          });
        }
      }
    }

    const totalGames = l2W + l2D + l2L;
    const score = (l2W + 0.5 * l2D) / totalGames;
    const pureWinRate = l2W / totalGames;

    let weakestOpp = Object.keys(oppVectors)[0];
    let minOppSc = 1.0;
    for (const [oid, stat] of Object.entries(oppVectors)) {
      const tot = stat.w + stat.d + stat.l;
      const sc = tot > 0 ? (stat.w + 0.5 * stat.d) / tot : 0;
      if (sc <= minOppSc) {
        minOppSc = sc;
        weakestOpp = oid;
      }
    }

    const s1Sc = (sideVectors[1].w + 0.5 * sideVectors[1].d) / 110;
    const s2Sc = (sideVectors[2].w + 0.5 * sideVectors[2].d) / 110;
    const weakestSide = s1Sc <= s2Sc ? 1 : 2;

    l2Vector = {
      recordId: `vec_${formationId}_L2`,
      formationId,
      level: 'L2',
      totalGames,
      w: l2W,
      d: l2D,
      l: l2L,
      score,
      pureWinRate,
      weakestOpponentId: weakestOpp,
      weakestSide,
      verificationState: 'INDEPENDENT_VERIFIED',
      oppVectors,
      sideVectors,
    };
  }

  // L1 Retest
  if (levelsToRetest.includes('L1')) {
    let l1W = 0, l1D = 0, l1L = 0;
    const oppVectors: Record<string, { w: number; d: number; l: number }> = {};
    const sideVectors: Record<1 | 2, { w: number; d: number; l: number }> = {
      1: { w: 0, d: 0, l: 0 },
      2: { w: 0, d: 0, l: 0 },
    };

    for (let oppIdx = 0; oppIdx < strong11Opponents.length; oppIdx++) {
      const opp = strong11Opponents[oppIdx];
      const oppId = opp.id;
      const oppStrategy = treeStrategyFor(formationToEvol(opp));
      oppVectors[oppId] = { w: 0, d: 0, l: 0 };

      for (const side of [1, 2] as (1 | 2)[]) {
        for (let g = 0; g < 10; g++) {
          const seed = seedBaseL1 + targetIdx * 10000 + oppIdx * 500 + side * 100 + g;
          const teamA = side === 1 ? srcFormation.team : opp.team;
          const teamB = side === 1 ? opp.team : srcFormation.team;
          const stratA = side === 1 ? strategy : oppStrategy;
          const stratB = side === 1 ? oppStrategy : strategy;

          const res = playFullGame(teamA, teamB, {
            seed,
            strategyA: stratA,
            strategyB: stratB,
            identityA: side === 1 ? formationId : oppId,
            identityB: side === 1 ? oppId : formationId,
          });

          const winnerSide = res.winner;
          let outcome = 'L';
          if (winnerSide === side) {
            outcome = 'W';
            l1W++;
            oppVectors[oppId].w++;
            sideVectors[side].w++;
          } else if (winnerSide === 0) {
            outcome = 'D';
            l1D++;
            oppVectors[oppId].d++;
            sideVectors[side].d++;
          } else {
            l1L++;
            oppVectors[oppId].l++;
            sideVectors[side].l++;
          }

          rawGames.push({
            revision: 'v1.0.0-t050-independent-retest',
            formationId,
            level: 'L1',
            opponentId: oppId,
            side,
            gameIndex: g,
            seed,
            outcome,
            winnerSide,
            workerError: null,
          });
        }
      }
    }

    const totalGames = l1W + l1D + l1L;
    const score = (l1W + 0.5 * l1D) / totalGames;
    const pureWinRate = l1W / totalGames;

    let weakestOpp = Object.keys(oppVectors)[0];
    let minOppSc = 1.0;
    for (const [oid, stat] of Object.entries(oppVectors)) {
      const tot = stat.w + stat.d + stat.l;
      const sc = tot > 0 ? (stat.w + 0.5 * stat.d) / tot : 0;
      if (sc <= minOppSc) {
        minOppSc = sc;
        weakestOpp = oid;
      }
    }

    const s1Sc = (sideVectors[1].w + 0.5 * sideVectors[1].d) / 110;
    const s2Sc = (sideVectors[2].w + 0.5 * sideVectors[2].d) / 110;
    const weakestSide = s1Sc <= s2Sc ? 1 : 2;

    l1Vector = {
      recordId: `vec_${formationId}_L1`,
      formationId,
      level: 'L1',
      totalGames,
      w: l1W,
      d: l1D,
      l: l1L,
      score,
      pureWinRate,
      weakestOpponentId: weakestOpp,
      weakestSide,
      verificationState: 'INDEPENDENT_VERIFIED',
      oppVectors,
      sideVectors,
    };
  }

  return {
    targetIdx,
    formationId,
    l2Vector,
    l1Vector,
    rawGames,
  };
}

if (parentPort && workerData) {
  const result = runTargetEvaluation(workerData);
  parentPort.postMessage(result);
}
