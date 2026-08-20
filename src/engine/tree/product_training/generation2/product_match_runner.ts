import { playFullGame, type DeploymentStrategy } from '../../../play_full_game';
import { ProductGameSession, type ProductDeploymentTrace, type ProductRoundObservation } from '../../round_engine/product_round_session';
import type { TeamSlot } from '../../../../../game/GameEngine';

export interface ObservableSurvivor {
  id: string;
  dbId: number;
  hp: number;
  maxHp: number;
}

export interface ObservableRoundOutput {
  round: number;
  roundWinner: 1 | 2 | 0;
  p1Score: number;
  p2Score: number;
  p1Survivors: ObservableSurvivor[];
  p2Survivors: ObservableSurvivor[];
  p1TotalHp: number;
  p2TotalHp: number;
  observableDigest: string;
}

export interface ObservableMatchResult {
  winner: 1 | 2 | 0;
  p1Score: number;
  p2Score: number;
  roundResults: (1 | 2 | 0)[];
  roundOutputs: ObservableRoundOutput[];
  matchObservableDigest: string;
  diagnostics?: {
    traces?: ProductDeploymentTrace[];
    observations?: ProductRoundObservation[];
  };
}

export function computeObservableRoundSummary(
  round: number,
  roundWinner: 1 | 2 | 0,
  p1Score: number,
  p2Score: number,
  boardMonsters: Array<{ id?: string; dbId: number; team: 1 | 2; hp: number; maxHp: number; isDead: boolean }>
): ObservableRoundOutput {
  const p1Survivors = (boardMonsters ?? [])
    .filter(m => m.team === 1 && !m.isDead && m.hp > 0)
    .map(m => ({ id: m.id ?? `p1_${m.dbId}`, dbId: m.dbId, hp: Math.round(m.hp), maxHp: Math.round(m.maxHp) }))
    .sort((a, b) => a.dbId - b.dbId || a.hp - b.hp);

  const p2Survivors = (boardMonsters ?? [])
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

export class ProductMatchRunner {
  public static runFullMatch(input: {
    teamA: TeamSlot[];
    teamB: TeamSlot[];
    seed: number;
    nameA: string;
    nameB: string;
    strategyA?: DeploymentStrategy;
    strategyB?: DeploymentStrategy;
    collectDiagnostics?: boolean;
  }): ObservableMatchResult {
    const traces: ProductDeploymentTrace[] = [];
    const observations: ProductRoundObservation[] = [];
    const roundOutputs: ObservableRoundOutput[] = [];

    const fullRes = playFullGame(input.teamA, input.teamB, {
      seed: input.seed,
      strategyA: input.strategyA,
      strategyB: input.strategyB,
      strategyIdentityA: input.nameA,
      strategyIdentityB: input.nameB,
      onDeploymentTrace: input.collectDiagnostics ? (t) => traces.push(t) : undefined,
      onRoundObservation: input.collectDiagnostics ? (o) => observations.push(o) : undefined,
      onRoundEnd: (info) => {
        roundOutputs.push(
          computeObservableRoundSummary(
            info.round,
            info.winner,
            info.p1Score,
            info.p2Score,
            info.boardMonsters
          )
        );
      },
    });

    return {
      winner: fullRes.winner,
      p1Score: fullRes.p1Score,
      p2Score: fullRes.p2Score,
      roundResults: fullRes.roundResults,
      roundOutputs,
      matchObservableDigest: JSON.stringify(roundOutputs.map(o => o.observableDigest)),
      diagnostics: input.collectDiagnostics ? { traces, observations } : undefined,
    };
  }

  public static runFromSession(
    session: ProductGameSession,
    opts: {
      strategyA?: DeploymentStrategy;
      strategyB?: DeploymentStrategy;
      collectDiagnostics?: boolean;
    }
  ): ObservableMatchResult {
    const traces: ProductDeploymentTrace[] = [];
    const observations: ProductRoundObservation[] = [];
    const roundOutputs: ObservableRoundOutput[] = [];

    while (session.currentRound <= 5) {
      if (session.p1Score >= 3 || session.p2Score >= 3) break;
      const ctxA = opts.strategyA ? session.buildRoundContext(1) : undefined;
      const ctxB = opts.strategyB ? session.buildRoundContext(2) : undefined;

      const intentsA = opts.strategyA && ctxA ? opts.strategyA(ctxA) : undefined;
      const intentsB = opts.strategyB && ctxB ? opts.strategyB(ctxB) : undefined;

      const rRes = session.playRound(intentsA, intentsB);
      if (opts.collectDiagnostics) {
        traces.push(...rRes.deploymentTraces);
        observations.push(rRes.observations.p1, rRes.observations.p2);
      }

      roundOutputs.push(
        computeObservableRoundSummary(
          rRes.round,
          rRes.roundWinner,
          rRes.p1Score,
          rRes.p2Score,
          rRes.boardMonsters
        )
      );

      if (rRes.isGameOver) break;
    }

    const winner: 1 | 2 | 0 =
      session.p1Score === session.p2Score ? 0 : session.p1Score > session.p2Score ? 1 : 2;

    return {
      winner,
      p1Score: session.p1Score,
      p2Score: session.p2Score,
      roundResults: session.roundResults,
      roundOutputs,
      matchObservableDigest: JSON.stringify(roundOutputs.map(o => o.observableDigest)),
      diagnostics: opts.collectDiagnostics ? { traces, observations } : undefined,
    };
  }
}
