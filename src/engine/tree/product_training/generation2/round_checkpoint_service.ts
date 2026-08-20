import { ProductGameSession, type ProductRoundCheckpoint } from '../../round_engine/product_round_session';
import type { TeamSlot } from '../../../../../game/GameEngine';
import { ProductMatchRunner, type ObservableMatchResult } from './product_match_runner';
import type { DeploymentStrategy } from '../../../play_full_game';

export class RoundCheckpointService {
  public static captureBeforeRound(session: ProductGameSession, round: number): ProductRoundCheckpoint {
    return session.captureCheckpointBeforeRound(round);
  }

  public static restore(
    checkpoint: ProductRoundCheckpoint,
    opts: {
      strategyIdentityA: string;
      strategyIdentityB: string;
    }
  ): ProductGameSession {
    return ProductGameSession.restore(checkpoint, opts);
  }

  public static createSession(
    teamA: TeamSlot[],
    teamB: TeamSlot[],
    opts: {
      seed: number;
      strategyIdentityA: string;
      strategyIdentityB: string;
    }
  ): ProductGameSession {
    return ProductGameSession.create(teamA, teamB, opts);
  }

  public static assertObservableParity(
    resultA: ObservableMatchResult,
    resultB: ObservableMatchResult
  ): { match: boolean; diffs: string[] } {
    const diffs: string[] = [];
    if (resultA.winner !== resultB.winner) {
      diffs.push(`Winner mismatch: A=${resultA.winner}, B=${resultB.winner}`);
    }
    if (resultA.p1Score !== resultB.p1Score || resultA.p2Score !== resultB.p2Score) {
      diffs.push(`Score mismatch: A=${resultA.p1Score}:${resultA.p2Score}, B=${resultB.p1Score}:${resultB.p2Score}`);
    }
    if (JSON.stringify(resultA.roundResults) !== JSON.stringify(resultB.roundResults)) {
      diffs.push(`Round results mismatch: A=${JSON.stringify(resultA.roundResults)}, B=${JSON.stringify(resultB.roundResults)}`);
    }
    if (resultA.matchObservableDigest !== resultB.matchObservableDigest) {
      diffs.push(`Observable round output digest mismatch`);
    }
    return {
      match: diffs.length === 0,
      diffs,
    };
  }
}
