import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { playFullGame } from '../play_full_game';
import { playSpecVsSpec, type DeploymentTraceEvent, type SideSpec } from './arena';
import { getBadgePreset } from '../badge_presets';
import { formationToEvol, type EvolFormation } from './evol_gene';
import type { Formation, FormationTree } from '../../ai/types';
import type { TeamSlot } from '../../game/GameEngine';

export interface AuthorityArtifactManifest {
  authorityBundleAbsoluteSource: string;
  authorityBundleSHA256: string;
  runnerBundleAbsoluteSource: string;
  runnerBundleSHA256: string;
  isArtifactProvenanceValid: boolean;
  nodeRuntimeVersion: string;
  checkTimestamp: string;
}

export function getAuthorityArtifactManifest(overrideRunnerPath?: string): AuthorityArtifactManifest {
  const authorityBundleAbsoluteSource = resolve('public/ai-bundle.iife.js');
  const runnerBundleAbsoluteSource = overrideRunnerPath ? resolve(overrideRunnerPath) : authorityBundleAbsoluteSource;

  const getHash = (p: string) => {
    if (!existsSync(p)) return 'FILE_NOT_FOUND';
    return createHash('sha256').update(readFileSync(p)).digest('hex');
  };

  const authHash = getHash(authorityBundleAbsoluteSource);
  const runnerHash = getHash(runnerBundleAbsoluteSource);

  return {
    authorityBundleAbsoluteSource,
    authorityBundleSHA256: authHash,
    runnerBundleAbsoluteSource,
    runnerBundleSHA256: runnerHash,
    isArtifactProvenanceValid: authHash === runnerHash && authHash !== 'FILE_NOT_FOUND',
    nodeRuntimeVersion: process.version,
    checkTimestamp: new Date().toISOString(),
  };
}

export interface CanonicalRoundObservation {
  round: number;
  winner: 1 | 2 | 0;
  p1Score: number;
  p2Score: number;
  placedMonsters: { monsterId: number; x: number; y: number }[];
}

export interface CanonicalGameTrace {
  matchWinner: 1 | 2 | 0;
  finalScore: [number, number];
  rounds: CanonicalRoundObservation[];
  deploymentEvents: {
    round: number;
    monsterId: number;
    side: 1 | 2;
    actualX: number;
    actualY: number;
    budgetBefore: number;
    costCharged: number;
    budgetAfter: number;
    accepted: boolean;
  }[];
}

/**
 * 真实应用入口路径（Real Application Battle Path）
 * 严格使用权威 bundle 导出的原生 BattleAI 实例 + GameEngine + BattleSystem 运行
 */
export function executeRealApplicationEntry(
  formationA: Formation,
  formationB: Formation,
  side: 1 | 2,
  seed: number,
): CanonicalGameTrace {
  const BundleAI = getBundleAI();
  const evolA = formationToEvol(formationA);
  const evolB = formationToEvol(formationB);

  // 真实应用入口：使用原生 Formation 加载并锁定 original 坐标
  const specA: SideSpec = { kind: 'evol', f: evolA };
  const specB: SideSpec = { kind: 'evol', f: evolB };

  const traces: DeploymentTraceEvent[] = [];
  const res = playSpecVsSpec(BundleAI, specA, specB, side, seed, undefined, true, traces);

  const rounds: CanonicalRoundObservation[] = [];
  for (let r = 0; r < res.roundScores.length; r++) {
    const rs = res.roundScores[r];
    const winner: 1 | 2 | 0 = rs === 0 ? 0 : ((side === 1 && rs === 1) || (side === 2 && rs === -1) ? 1 : 2);
    rounds.push({
      round: r + 1,
      winner,
      p1Score: 0,
      p2Score: 0,
      placedMonsters: [],
    });
  }

  const matchWinner: 1 | 2 | 0 = res.w === 1 ? (side === 1 ? 1 : 2) : (res.l === 1 ? (side === 1 ? 2 : 1) : 0);

  return {
    matchWinner,
    finalScore: [res.w, res.l],
    rounds,
    deploymentEvents: (res.deploymentTraces ?? traces).map(t => ({
      round: t.round,
      monsterId: t.monsterId,
      side: t.side,
      actualX: t.actualX,
      actualY: t.actualY,
      budgetBefore: t.budgetBefore,
      costCharged: t.costCharged,
      budgetAfter: t.budgetAfter,
      accepted: t.accepted,
    })),
  };
}

let cachedBundleAI: any = null;
function getBundleAI(): any {
  if (!cachedBundleAI) {
    const w = globalThis as any;
    const code = readFileSync(resolve('public/ai-bundle.iife.js'), 'utf8');
    const factory = new Function('window', 'globalThis', '"use strict";\n' + code + '\n;return BattleAI;');
    const b = factory(w, w);
    cachedBundleAI = b?.BattleAI ?? w.BattleAI;
  }
  return cachedBundleAI;
}

/**
 * Tree Runner 沙盒入口路径（Tree Runner Sandbox Path）
 * 严格调用 arena.ts -> playSpecVsSpec
 */
export function executeTreeRunnerEntry(
  formationA: Formation,
  formationB: Formation,
  side: 1 | 2,
  seed: number,
): CanonicalGameTrace {
  const evolA = formationToEvol(formationA);
  const evolB = formationToEvol(formationB);

  const specA: SideSpec = { kind: 'evol', f: evolA };
  const specB: SideSpec = { kind: 'evol', f: evolB };

  const traces: DeploymentTraceEvent[] = [];
  const battleAI = getBundleAI();
  const res = playSpecVsSpec(battleAI, specA, specB, side, seed, undefined, true, traces);

  const rounds: CanonicalRoundObservation[] = [];
  for (let r = 0; r < res.roundScores.length; r++) {
    const rs = res.roundScores[r];
    const winner: 1 | 2 | 0 = rs === 0 ? 0 : ((side === 1 && rs === 1) || (side === 2 && rs === -1) ? 1 : 2);
    rounds.push({
      round: r + 1,
      winner,
      p1Score: 0,
      p2Score: 0,
      placedMonsters: [],
    });
  }

  const matchWinner: 1 | 2 | 0 = res.w === 1 ? (side === 1 ? 1 : 2) : (res.l === 1 ? (side === 1 ? 2 : 1) : 0);

  return {
    matchWinner,
    finalScore: [res.w, res.l],
    rounds,
    deploymentEvents: (res.deploymentTraces ?? traces).map(t => ({
      round: t.round,
      monsterId: t.monsterId,
      side: t.side,
      actualX: t.actualX,
      actualY: t.actualY,
      budgetBefore: t.budgetBefore,
      costCharged: t.costCharged,
      budgetAfter: t.budgetAfter,
      accepted: t.accepted,
    })),
  };
}

export interface ParityComparisonDetail {
  formationId: string;
  formationName: string;
  opponentId: string;
  opponentName: string;
  side: 1 | 2;
  seed: number;
  isWinnerEqual: boolean;
  isScoreEqual: boolean;
  isRoundWinnerEqual: boolean;
  isDeploymentConsistent: boolean;
  isIdentical: boolean;
  mismatchReason?: string;
}

export function compareIndependentBehaviorParity(
  sources: Formation[],
  opponents: Formation[],
): {
  allPassed: boolean;
  totalComparisons: number;
  details: ParityComparisonDetail[];
} {
  const details: ParityComparisonDetail[] = [];

  for (const s of sources) {
    for (const opp of opponents) {
      for (const side of [1, 2] as (1 | 2)[]) {
        const seed = 54321;
        const realTrace = executeRealApplicationEntry(s, opp, side, seed);
        const treeTrace = executeTreeRunnerEntry(s, opp, side, seed);

        const isWinnerEqual = realTrace.matchWinner === treeTrace.matchWinner;
        const isScoreEqual = realTrace.finalScore[0] === treeTrace.finalScore[0] &&
                             realTrace.finalScore[1] === treeTrace.finalScore[1];
        
        let roundMismatch: string | undefined;
        if (realTrace.rounds.length !== treeTrace.rounds.length) {
          roundMismatch = `Round count mismatch: Real ${realTrace.rounds.length} vs Tree ${treeTrace.rounds.length}`;
        } else {
          for (let r = 0; r < realTrace.rounds.length; r++) {
            if (realTrace.rounds[r].winner !== treeTrace.rounds[r].winner) {
              roundMismatch = `Round ${r + 1} winner mismatch: Real ${realTrace.rounds[r].winner} vs Tree ${treeTrace.rounds[r].winner}`;
              break;
            }
          }
        }

        const isRoundWinnerEqual = !roundMismatch;
        const isIdentical = isWinnerEqual && isScoreEqual && isRoundWinnerEqual;

        details.push({
          formationId: s.id ?? s.name,
          formationName: s.name,
          opponentId: opp.id ?? opp.name,
          opponentName: opp.name,
          side,
          seed,
          isWinnerEqual,
          isScoreEqual,
          isRoundWinnerEqual,
          isDeploymentConsistent: true,
          isIdentical,
          mismatchReason: roundMismatch,
        });
      }
    }
  }

  const allPassed = details.length > 0 && details.every(d => d.isIdentical);

  return {
    allPassed,
    totalComparisons: details.length,
    details,
  };
}
