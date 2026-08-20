import { ProductGameSession, type ProductRoundCheckpoint, type DeploymentIntent, type ProductRoundResult } from '../../round_engine/product_round_session';
import { ProductMatchRunner, computeObservableRoundSummary, type ObservableRoundOutput } from './product_match_runner';
import type { TeamSlot } from '../../../../../game/GameEngine';
import { sha256Hex } from '../../sha256_pure';

import { gameEngine } from '../../../../game/GameEngine';

export interface CounterfactualRoundInput {
  round: number;
  seed: number;
  p1Score: number;
  p2Score: number;
  p1Budget: number;
  p2Budget: number;
  teamA: TeamSlot[];
  teamB: TeamSlot[];
  strategyIdentityA: string;
  strategyIdentityB: string;
  preRoundCheckpoint: ProductRoundCheckpoint;
  intentsA?: DeploymentIntent[];
  intentsB?: DeploymentIntent[];
  targetSideExistingBoardOverrides?: Array<{
    monsterId: number;
    overrideX: number;
    overrideY: number;
  }>;
  collectDiagnostics?: boolean;
}

export interface CounterfactualRoundResult {
  round: number;
  roundWinner: 1 | 2 | 0;
  p1ScoreDelta: number;
  p2ScoreDelta: number;
  p1Score: number;
  p2Score: number;
  observableOutput: ObservableRoundOutput;
  inputFingerprint: string;
  rawResult: ProductRoundResult;
}

export class CounterfactualBattleEngine {
  public static computeInputFingerprint(input: CounterfactualRoundInput): string {
    const norm = {
      round: input.round,
      seed: input.seed,
      p1Score: input.p1Score,
      p2Score: input.p2Score,
      p1Budget: input.p1Budget,
      p2Budget: input.p2Budget,
      teamA: input.teamA.map(s => ({ m: s.monsterId, b: [...(s.badgeIds ?? [])].sort() })),
      teamB: input.teamB.map(s => ({ m: s.monsterId, b: [...(s.badgeIds ?? [])].sort() })),
      intentsA: (input.intentsA ?? []).map(i => ({ m: i.monsterId, x: i.plannedX, y: i.plannedY })),
      intentsB: (input.intentsB ?? []).map(i => ({ m: i.monsterId, x: i.plannedX, y: i.plannedY })),
      overrides: (input.targetSideExistingBoardOverrides ?? []).map(o => ({ m: o.monsterId, x: o.overrideX, y: o.overrideY })).sort((a, b) => a.m - b.m),
    };
    return sha256Hex(JSON.stringify(norm)).slice(0, 16);
  }

  public static runCounterfactualRound(input: CounterfactualRoundInput): CounterfactualRoundResult {
    // 1. 从确切的 preRoundCheckpoint 恢复会话
    const session = ProductGameSession.restore(input.preRoundCheckpoint, {
      strategyIdentityA: input.strategyIdentityA,
      strategyIdentityB: input.strategyIdentityB,
    });

    // 2. 如果存在已有棋盘单位的反事实位置重设 (Existing Board Overrides)，在开战与部署前更新其初始坐标
    if (input.targetSideExistingBoardOverrides && input.targetSideExistingBoardOverrides.length > 0) {
      const overrideMap = new Map<number, { x: number; y: number }>();
      for (const ov of input.targetSideExistingBoardOverrides) {
        overrideMap.set(ov.monsterId, { x: ov.overrideX, y: ov.overrideY });
      }

      // 通过 gameEngine.boardMonsters 更新初始与当前坐标
      for (const m of gameEngine.boardMonsters) {
        if (overrideMap.has(m.dbId)) {
          const coords = overrideMap.get(m.dbId)!;
          m.gridX = coords.x;
          m.gridY = coords.y;
          m.initialGridX = coords.x;
          m.initialGridY = coords.y;
        }
      }
    }

    // 3. 执行确切的单回合模拟
    const rawRes = session.playRound(input.intentsA, input.intentsB);

    // 4. 计算标准可观测输出
    const obsOutput = computeObservableRoundSummary(
      rawRes.round,
      rawRes.roundWinner,
      rawRes.p1Score,
      rawRes.p2Score,
      rawRes.boardMonsters
    );

    const inputFp = this.computeInputFingerprint(input);

    return {
      round: rawRes.round,
      roundWinner: rawRes.roundWinner,
      p1ScoreDelta: rawRes.p1ScoreDelta,
      p2ScoreDelta: rawRes.p2ScoreDelta,
      p1Score: rawRes.p1Score,
      p2Score: rawRes.p2Score,
      observableOutput: obsOutput,
      inputFingerprint: inputFp,
      rawResult: rawRes,
    };
  }
}
