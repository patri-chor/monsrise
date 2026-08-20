import type { RoundBoardState } from '../round_board_state';
import type { RoundBoardEdit } from '../round_board_state_factory';
import { RoundBoardStateFactory } from '../round_board_state_factory';
import { PRODUCT_ZONES } from '../../../../play_full_game';

export interface EvaluatedCandidate {
  candidateId: string;
  caseId: string;
  generation: number;
  editedStateFingerprint: string;
  edits: RoundBoardEdit[];
  state: RoundBoardState;
}

export class CandidateSpace {
  public static sampleCompatibleEdits(
    baseState: RoundBoardState,
    rng: () => number
  ): RoundBoardEdit[] {
    const targetSide = baseState.targetSide;
    const zone = PRODUCT_ZONES[targetSide];
    const baseUnits = baseState.deployedUnits.filter(u => u.side === targetSide);
    const basePending = baseState.pendingActions.filter(a => a.side === targetSide);

    const totalAvail = baseUnits.length + basePending.length;
    if (totalAvail === 0) return [];

    const maxDesired = totalAvail >= 3 ? 3 : totalAvail >= 2 ? 2 : 1;
    const desiredCount = 1 + Math.floor(rng() * maxDesired);

    const edits: RoundBoardEdit[] = [];
    const usedDeployedIds = new Set<string>();
    const usedActionOrders = new Set<number>();

    for (let i = 0; i < desiredCount; i++) {
      const r = rng();
      if (baseUnits.length > 0 && r < 0.5) {
        const avail = baseUnits.filter(u => !usedDeployedIds.has(u.instanceId));
        if (avail.length > 0) {
          const u = avail[Math.floor(rng() * avail.length)];
          usedDeployedIds.add(u.instanceId);
          edits.push({
            type: 'REPOSITION_DEPLOYED_UNIT',
            instanceId: u.instanceId,
            newX: zone.min + Math.floor(rng() * (zone.max - zone.min + 1)),
            newY: Math.floor(rng() * 5),
          });
        }
      } else if (basePending.length > 0) {
        const avail = basePending.filter(a => !usedActionOrders.has(a.order));
        if (avail.length > 0) {
          const a = avail[Math.floor(rng() * avail.length)];
          usedActionOrders.add(a.order);
          edits.push({
            type: 'CHANGE_PENDING_PLACEMENT',
            actionOrder: a.order,
            newX: zone.min + Math.floor(rng() * (zone.max - zone.min + 1)),
            newY: Math.floor(rng() * 5),
          });
        }
      }
    }

    return edits;
  }

  public static mutateEdits(
    edits: RoundBoardEdit[],
    baseState: RoundBoardState,
    rng: () => number
  ): RoundBoardEdit[] {
    const targetSide = baseState.targetSide;
    const zone = PRODUCT_ZONES[targetSide];
    const cloned = edits.map(e => ({ ...e }));

    if (cloned.length > 0) {
      const idx = Math.floor(rng() * cloned.length);
      cloned[idx].newX = zone.min + Math.floor(rng() * (zone.max - zone.min + 1));
      cloned[idx].newY = Math.floor(rng() * 5);
    }

    return cloned;
  }
}
