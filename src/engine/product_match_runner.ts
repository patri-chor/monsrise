import { playFullGame, type DeploymentStrategy } from './play_full_game';
import { ProductGameSession, type ProductDeploymentTrace, type ProductRoundObservation } from './tree/round_engine/product_round_session';
import type { TeamSlot } from '../game/GameEngine';
import { sha256Hex } from './tree/sha256_pure';

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
  strategyDecisionTraces?: import('./play_full_game').ProductStrategyDecisionTrace[];
  diagnostics?: {
    traces?: ProductDeploymentTrace[];
    observations?: ProductRoundObservation[];
    strategyDecisionTraces?: import('./play_full_game').ProductStrategyDecisionTrace[];
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

  const observableDigest = sha256Hex(JSON.stringify(norm)).slice(0, 16);
  return {
    round,
    roundWinner,
    p1Score,
    p2Score,
    p1Survivors,
    p2Survivors,
    p1TotalHp,
    p2TotalHp,
    observableDigest,
  };
}

export class ProductMatchRunner {
  public static runFullMatch(input: {
    teamA: TeamSlot[];
    teamB: TeamSlot[];
    seed: number;
    nameA: string;
    nameB: string;
    strategyA: DeploymentStrategy;
    strategyB: DeploymentStrategy;
    collectStrategyTrace?: boolean;
  }): ObservableMatchResult {
    const res = playFullGame(
      input.teamA,
      input.teamB,
      input.strategyA,
      input.strategyB,
      input.seed,
      {
        strategyIdentityA: input.nameA,
        strategyIdentityB: input.nameB,
        collectStrategyDecisionTrace: input.collectStrategyTrace,
      }
    );

    const roundOutputs: ObservableRoundOutput[] = (res.roundLogs ?? []).map(rLog => {
      const p1Survivors = (rLog.p1Survivors ?? []).map((s: any) => ({
        id: s.instanceId ?? `p1_${s.monsterId}`,
        dbId: s.monsterId,
        hp: Math.round(s.hp),
        maxHp: Math.round(s.maxHp ?? s.hp),
      }));
      const p2Survivors = (rLog.p2Survivors ?? []).map((s: any) => ({
        id: s.instanceId ?? `p2_${s.monsterId}`,
        dbId: s.monsterId,
        hp: Math.round(s.hp),
        maxHp: Math.round(s.maxHp ?? s.hp),
      }));
      const p1TotalHp = p1Survivors.reduce((sum: number, u: any) => sum + u.hp, 0);
      const p2TotalHp = p2Survivors.reduce((sum: number, u: any) => sum + u.hp, 0);

      const norm = {
        round: rLog.round,
        roundWinner: rLog.winner,
        p1Score: rLog.p1Score,
        p2Score: rLog.p2Score,
        p1Survivors,
        p2Survivors,
        p1TotalHp,
        p2TotalHp,
      };

      return {
        round: rLog.round,
        roundWinner: rLog.winner as 1 | 2 | 0,
        p1Score: rLog.p1Score,
        p2Score: rLog.p2Score,
        p1Survivors,
        p2Survivors,
        p1TotalHp,
        p2TotalHp,
        observableDigest: sha256Hex(JSON.stringify(norm)).slice(0, 16),
      };
    });

    const matchDigestNorm = {
      winner: res.winner,
      p1Score: res.p1Score,
      p2Score: res.p2Score,
      roundDigests: roundOutputs.map(ro => ro.observableDigest),
    };

    return {
      winner: res.winner as 1 | 2 | 0,
      p1Score: res.p1Score,
      p2Score: res.p2Score,
      roundResults: res.roundResults as (1 | 2 | 0)[],
      roundOutputs,
      matchObservableDigest: sha256Hex(JSON.stringify(matchDigestNorm)).slice(0, 16),
      strategyDecisionTraces: res.strategyDecisionTraces,
    };
  }
}
