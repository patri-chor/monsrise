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

export interface ObservableRoundSummary {
  round: number;
  roundWinner: 1 | 2 | 0;
  p1Score: number;
  p2Score: number;
  p1Survivors: Array<{ id: string; dbId: number; hp: number; maxHp: number }>;
  p2Survivors: Array<{ id: string; dbId: number; hp: number; maxHp: number }>;
  p1TotalHp: number;
  p2TotalHp: number;
  observableDigest: string;
}

function computeObservableSummary(
  round: number,
  roundWinner: 1 | 2 | 0,
  p1Score: number,
  p2Score: number,
  boardMonsters: Array<{ id?: string; dbId: number; team: 1 | 2; hp: number; maxHp: number; isDead: boolean }>
): ObservableRoundSummary {
  const p1Survivors = boardMonsters
    .filter(m => m.team === 1 && !m.isDead && m.hp > 0)
    .map(m => ({ id: m.id ?? `p1_${m.dbId}`, dbId: m.dbId, hp: Math.round(m.hp), maxHp: Math.round(m.maxHp) }))
    .sort((a, b) => a.dbId - b.dbId || a.hp - b.hp);

  const p2Survivors = boardMonsters
    .filter(m => m.team === 2 && !m.isDead && m.hp > 0)
    .map(m => ({ id: m.id ?? `p2_${m.dbId}`, dbId: m.dbId, hp: Math.round(m.hp), maxHp: Math.round(m.maxHp) }))
    .sort((a, b) => a.dbId - b.dbId || a.hp - b.hp);

  const p1TotalHp = p1Survivors.reduce((acc, s) => acc + s.hp, 0);
  const p2TotalHp = p2Survivors.reduce((acc, s) => acc + s.hp, 0);

  const norm = {
    round,
    roundWinner,
    p1Score,
    p2Score,
    p1Survivors,
    p2Survivors,
    p1TotalHp,
    p2TotalHp,
  };

  return {
    ...norm,
    observableDigest: JSON.stringify(norm),
  };
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

  // 1. Uninterrupted playFullGame with onRoundEnd capture
  const unTraces: any[] = [];
  const unObs: any[] = [];
  const unRoundSummaries: ObservableRoundSummary[] = [];

  const unMatch = playFullGame(teamA, teamB, {
    seed: opts.seed,
    strategyA: opts.strategyA,
    strategyB: opts.strategyB,
    strategyIdentityA: opts.nameA,
    strategyIdentityB: opts.nameB,
    onDeploymentTrace: (t) => unTraces.push(t),
    onRoundObservation: (o) => unObs.push(o),
    onRoundEnd: (info) => {
      unRoundSummaries.push(
        computeObservableSummary(
          info.round,
          info.winner,
          info.p1Score,
          info.p2Score,
          info.boardMonsters
        )
      );
    },
  });

  // 2. Sequential ProductGameSession
  const session = ProductGameSession.create(teamA, teamB, {
    seed: opts.seed,
    strategyIdentityA: opts.nameA,
    strategyIdentityB: opts.nameB,
  });

  const sessionTraces: any[] = [];
  const sessionObs: any[] = [];
  const sessionRoundSummaries: ObservableRoundSummary[] = [];
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
    sessionRoundSummaries.push(
      computeObservableSummary(
        rRes.round,
        rRes.roundWinner,
        rRes.p1Score,
        rRes.p2Score,
        rRes.boardMonsters
      )
    );

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

  // Compare per-round observable output sequence
  for (let i = 0; i < unRoundSummaries.length; i++) {
    const unSum = unRoundSummaries[i];
    const seqSum = sessionRoundSummaries[i];
    if (!seqSum || unSum.observableDigest !== seqSum.observableDigest) {
      diffs.push(`Observable round ${i + 1} mismatch between uninterrupted and sequential session`);
      break;
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

    const restoredRoundSummaries: ObservableRoundSummary[] = [];

    while (restoredSession.currentRound <= 5) {
      if (restoredSession.p1Score >= 3 || restoredSession.p2Score >= 3) break;
      const ctxA = opts.strategyA ? restoredSession.buildRoundContext(1) : undefined;
      const ctxB = opts.strategyB ? restoredSession.buildRoundContext(2) : undefined;

      const intentsA = opts.strategyA && ctxA ? opts.strategyA(ctxA) : undefined;
      const intentsB = opts.strategyB && ctxB ? opts.strategyB(ctxB) : undefined;

      const rRes = restoredSession.playRound(intentsA, intentsB);
      restoredRoundSummaries.push(
        computeObservableSummary(
          rRes.round,
          rRes.roundWinner,
          rRes.p1Score,
          rRes.p2Score,
          rRes.boardMonsters
        )
      );
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
