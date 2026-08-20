// ============================================================
// src/engine/tree/round_engine/fidelity_gate.ts
// T101: Round Engine Fidelity Gate & Determinism Validator
// ============================================================

import { playFullGame, type DeploymentStrategy } from '../../play_full_game';
import { ProductGameSession } from './product_round_session';
import type { TeamSlot } from '../../../game/GameEngine';
import { appendFileSync, existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface FidelityComparisonResult {
  match: boolean;
  gameSummary: {
    seed: number;
    teamAName: string;
    teamBName: string;
    uninterruptedWinner: 1 | 2 | 0;
    sessionWinner: 1 | 2 | 0;
    uninterruptedP1Score: number;
    sessionP1Score: number;
    uninterruptedP2Score: number;
    sessionP2Score: number;
    uninterruptedRounds: (1 | 2 | 0)[];
    sessionRounds: (1 | 2 | 0)[];
  };
  checkpointReplayMatch?: boolean;
  diffs: string[];
}

export function runFidelityComparison(
  teamA: TeamSlot[],
  teamB: TeamSlot[],
  opts: {
    seed: number;
    nameA: string;
    nameB: string;
    strategyA?: DeploymentStrategy;
    strategyB?: DeploymentStrategy;
    testCheckpointReplayAtRound?: number;
  }
): FidelityComparisonResult {
  const diffs: string[] = [];

  // 1. Uninterrupted playFullGame
  const unTraces: any[] = [];
  const unObs: any[] = [];
  const unMatch = playFullGame(teamA, teamB, {
    seed: opts.seed,
    strategyA: opts.strategyA,
    strategyB: opts.strategyB,
    strategyIdentityA: opts.nameA,
    strategyIdentityB: opts.nameB,
    onDeploymentTrace: (t) => unTraces.push(t),
    onRoundObservation: (o) => unObs.push(o),
  });

  // 2. Sequential ProductGameSession
  const session = ProductGameSession.create(teamA, teamB, {
    seed: opts.seed,
    strategyIdentityA: opts.nameA,
    strategyIdentityB: opts.nameB,
  });

  const sessionTraces: any[] = [];
  const sessionObs: any[] = [];
  const checkpoints: any[] = [];

  while (!session.roundResults.length || session.currentRound <= 5) {
    if (session.p1Score >= 3 || session.p2Score >= 3 || session.currentRound > 5) break;
    const r = session.currentRound;
    const cp = session.captureCheckpointBeforeRound(r);
    checkpoints.push(cp);

    const ctxA = opts.strategyA ? session.buildRoundContext(1) : undefined;
    const ctxB = opts.strategyB ? session.buildRoundContext(2) : undefined;

    const intentsA = opts.strategyA && ctxA ? opts.strategyA(ctxA) : undefined;
    const intentsB = opts.strategyB && ctxB ? opts.strategyB(ctxB) : undefined;

    const rRes = session.playRound(intentsA, intentsB);
    sessionTraces.push(...rRes.deploymentTraces);
    sessionObs.push(rRes.observations.p1, rRes.observations.p2);

    if (rRes.isGameOver) break;
  }

  const sessionWinner: 1 | 2 | 0 =
    session.p1Score === session.p2Score ? 0 : session.p1Score > session.p2Score ? 1 : 2;

  if (unMatch.winner !== sessionWinner) {
    diffs.push(`Winner mismatch: uninterrupted=${unMatch.winner}, session=${sessionWinner}`);
  }
  if (unMatch.p1Score !== session.p1Score) {
    diffs.push(`P1 score mismatch: uninterrupted=${unMatch.p1Score}, session=${session.p1Score}`);
  }
  if (unMatch.p2Score !== session.p2Score) {
    diffs.push(`P2 score mismatch: uninterrupted=${unMatch.p2Score}, session=${session.p2Score}`);
  }
  if (JSON.stringify(unMatch.roundResults) !== JSON.stringify(session.roundResults)) {
    diffs.push(`Round results mismatch: uninterrupted=${JSON.stringify(unMatch.roundResults)}, session=${JSON.stringify(session.roundResults)}`);
  }
  if (unTraces.length !== sessionTraces.length) {
    diffs.push(`Deployment trace count mismatch: uninterrupted=${unTraces.length}, session=${sessionTraces.length}`);
  } else {
    for (let i = 0; i < unTraces.length; i++) {
      const u = unTraces[i];
      const s = sessionTraces[i];
      if (u.monsterId !== s.monsterId || u.actualX !== s.actualX || u.actualY !== s.actualY || u.accepted !== s.accepted) {
        diffs.push(`Trace index ${i} mismatch: ${JSON.stringify(u)} vs ${JSON.stringify(s)}`);
        break;
      }
    }
  }

  // 3. Test Checkpoint Replay if requested
  let checkpointReplayMatch = true;
  if (opts.testCheckpointReplayAtRound && checkpoints.length >= opts.testCheckpointReplayAtRound) {
    const cpToRestore = checkpoints[opts.testCheckpointReplayAtRound - 1];
    const restoredSession = ProductGameSession.restore(cpToRestore, {
      strategyIdentityA: opts.nameA,
      strategyIdentityB: opts.nameB,
    });

    while (restoredSession.currentRound <= 5) {
      if (restoredSession.p1Score >= 3 || restoredSession.p2Score >= 3) break;
      const ctxA = opts.strategyA ? restoredSession.buildRoundContext(1) : undefined;
      const ctxB = opts.strategyB ? restoredSession.buildRoundContext(2) : undefined;

      const intentsA = opts.strategyA && ctxA ? opts.strategyA(ctxA) : undefined;
      const intentsB = opts.strategyB && ctxB ? opts.strategyB(ctxB) : undefined;

      const rRes = restoredSession.playRound(intentsA, intentsB);
      if (rRes.isGameOver) break;
    }

    const restWinner: 1 | 2 | 0 =
      restoredSession.p1Score === restoredSession.p2Score ? 0 : restoredSession.p1Score > restoredSession.p2Score ? 1 : 2;

    if (restWinner !== sessionWinner || restoredSession.p1Score !== session.p1Score || restoredSession.p2Score !== session.p2Score) {
      checkpointReplayMatch = false;
      diffs.push(`Checkpoint replay from R${opts.testCheckpointReplayAtRound} failed to match sequential session outcome!`);
    }
  }

  return {
    match: diffs.length === 0,
    gameSummary: {
      seed: opts.seed,
      teamAName: opts.nameA,
      teamBName: opts.nameB,
      uninterruptedWinner: unMatch.winner,
      sessionWinner,
      uninterruptedP1Score: unMatch.p1Score,
      sessionP1Score: session.p1Score,
      uninterruptedP2Score: unMatch.p2Score,
      sessionP2Score: session.p2Score,
      uninterruptedRounds: unMatch.roundResults,
      sessionRounds: session.roundResults,
    },
    checkpointReplayMatch,
    diffs,
  };
}

export const EVIDENCE_FIDELITY_PATH = resolve('reports/tree-cycle/all2rush_g2_round_engine_fidelity.jsonl');

export function appendFidelityEvidence(record: any): void {
  const line = JSON.stringify({
    recordKind: 'ALL2RUSH_G2_ROUND_ENGINE_FIDELITY_V1',
    timestamp: new Date().toISOString(),
    ...record,
  }) + '\n';
  appendFileSync(EVIDENCE_FIDELITY_PATH, line, 'utf8');
}
