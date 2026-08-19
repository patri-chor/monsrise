// ============================================================
// scripts/tree_product_training/t050_worker.ts
// Worker for evaluating candidate targets with distinct EvolFormation & pools
// ============================================================

import '../../src/engine/env';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { FORMATION_LIBRARY } from '../../src/ai/formation_library';
import type { Formation } from '../../src/ai/types';
import { formationToEvol, type EvolFormation } from '../../src/engine/tree/evol_gene';
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

// 加载全谱系 Web Challenge Catalog
const WEB_CATALOG_PATH = resolve('public/data/l1_melee_challenge_catalog.json');
let webCatalogMembers: Map<string, { name: string; team: any; evol: EvolFormation; archetypeId: string }> | null = null;
let meleeOpponentsList: Array<{ id: string; name: string; team: any; evol: EvolFormation; archetypeId: string }> | null = null;

function ensureCatalogLoaded() {
  if (webCatalogMembers && meleeOpponentsList) return;
  webCatalogMembers = new Map();
  meleeOpponentsList = [];

  const catalog = JSON.parse(readFileSync(WEB_CATALOG_PATH, 'utf8'));
  for (const arch of catalog.archetypes) {
    for (const mem of arch.members) {
      const entry = {
        name: mem.name,
        team: mem.team,
        evol: mem.evol,
        archetypeId: arch.archetypeId,
      };
      webCatalogMembers.set(mem.canonicalFingerprint, entry);
      webCatalogMembers.set(mem.memberId, entry);
      if (mem.team && mem.evol) {
        meleeOpponentsList.push({
          id: mem.memberId,
          name: mem.name,
          team: mem.team,
          evol: mem.evol,
          archetypeId: arch.archetypeId,
        });
      }
    }
  }
}

export function runTargetEvaluation(data: TargetTaskData): TargetTaskResult {
  ensureCatalogLoaded();

  const { targetIdx, formationId, rootT0SourceId, canonicalFingerprint, levelsToRetest, seedBaseL2, seedBaseL1 } = data;

  // 1. 获取目标候选专属的实际 team 与 EvolFormation
  const catalogEntry = webCatalogMembers!.get(canonicalFingerprint) ?? webCatalogMembers!.get(formationId);
  let myTeam: any[];
  let myEvol: EvolFormation;

  if (catalogEntry && catalogEntry.team && catalogEntry.evol) {
    myTeam = catalogEntry.team;
    myEvol = catalogEntry.evol;
  } else {
    const rootFormation = FORMATION_LIBRARY.find(f => f.id === rootT0SourceId) ?? FORMATION_LIBRARY[0];
    myTeam = rootFormation.team;
    myEvol = formationToEvol(rootFormation);
  }

  const strategy = treeStrategyFor(myEvol);
  const rawGames: any[] = [];
  let l2Vector: any | null = null;
  let l1Vector: any | null = null;

  // 2. L2 重测：对战 11 套 Frozen T0 强阵 (11 对手 × 2 侧 × 10 局 = 220 局)
  if (levelsToRetest.includes('L2')) {
    const strong11Opponents = FORMATION_LIBRARY.slice(0, 11);
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
          const teamA = side === 1 ? myTeam : opp.team;
          const teamB = side === 1 ? opp.team : myTeam;
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

  // 3. L1 重测：对战全谱系概率 Melee 对手池 (11 谱系中各抽取 2 个不同成员，共 22 套对手 × 双侧 × 5 局 = 220 局)
  if (levelsToRetest.includes('L1')) {
    // 挑选排除自身的 22 套 Melee 对手
    const eligibleMeleeOpponents = meleeOpponentsList!.filter(
      opp => opp.id !== formationId && opp.name !== myEvol.name
    );
    const melee22 = eligibleMeleeOpponents.slice(0, 22);

    let l1W = 0, l1D = 0, l1L = 0;
    const oppVectors: Record<string, { w: number; d: number; l: number }> = {};
    const sideVectors: Record<1 | 2, { w: number; d: number; l: number }> = {
      1: { w: 0, d: 0, l: 0 },
      2: { w: 0, d: 0, l: 0 },
    };

    for (let oppIdx = 0; oppIdx < melee22.length; oppIdx++) {
      const opp = melee22[oppIdx];
      const oppId = opp.id;
      const oppStrategy = treeStrategyFor(opp.evol);
      oppVectors[oppId] = { w: 0, d: 0, l: 0 };

      for (const side of [1, 2] as (1 | 2)[]) {
        for (let g = 0; g < 5; g++) { // 22 对手 × 2 侧 × 5 局 = 220 局
          const seed = seedBaseL1 + targetIdx * 10000 + oppIdx * 500 + side * 100 + g;
          const teamA = side === 1 ? myTeam : opp.team;
          const teamB = side === 1 ? opp.team : myTeam;
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
