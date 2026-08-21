import type { CandidateTrial, BaselineCase, OptimizerCycleConfig } from './types';
import type { EvolFormation } from '../../../evol_gene';
import type { TeamSlot } from '../../../../game/GameEngine';

export interface LocalLineage {
  lineageId: string;
  mode: 'S' | 'D_PLUS_S';
  parentSnapshotFingerprint: string;
  sourceCaseId: string;
  dDelta?: {
    type: 'BADGE_CHANGE' | 'REASSIGN_ORDER' | 'REPLACE_MONSTER';
    monsterId?: number;
    badgeIds?: number[];
  };
  sEdits: any[];
  objective: any;
  editedStateFingerprint: string;
  observableDigest: string;
  generation: number;
}

export interface LineageBackpropResult {
  lineage: LocalLineage;
  candidateSnapshot: {
    team: TeamSlot[];
    evol: EvolFormation;
    fingerprint: string;
  };
  l2Metrics: {
    targetW: number;
    targetD: number;
    targetL: number;
    count: number;
    targetScore70Average: number;
  };
  classification: 'IMPROVES' | 'NEUTRAL' | 'REGRESSES';
}

export class LineageManager {
  public static buildSLineages(
    representatives: CandidateTrial[],
    parentSnapshotFingerprint: string
  ): LocalLineage[] {
    return representatives.map(rep => ({
      lineageId: `LIN_S_${rep.candidateId}`,
      mode: 'S',
      parentSnapshotFingerprint,
      sourceCaseId: rep.caseId,
      sEdits: rep.edits,
      objective: rep.objective,
      editedStateFingerprint: rep.editedStateFingerprint,
      observableDigest: rep.result.observableOutput.observableDigest,
      generation: rep.generation,
    }));
  }

  public static filterTopLineagesForBackprop(
    lineages: LocalLineage[],
    maxLineages = 8
  ): LocalLineage[] {
    const sorted = [...lineages].sort((a, b) => {
      // 优先选择 Pareto 胜负等级更高/存活血量更高的
      if (a.objective.roundWinnerRank !== b.objective.roundWinnerRank) {
        return a.objective.roundWinnerRank - b.objective.roundWinnerRank;
      }
      if (a.objective.targetSurvivingHp !== b.objective.targetSurvivingHp) {
        return b.objective.targetSurvivingHp - a.objective.targetSurvivingHp;
      }
      return a.sEdits.length - b.sEdits.length;
    });

    return sorted.slice(0, maxLineages);
  }
}
