import { sha256Hex } from '../../sha256_pure';

export interface RoundBoardUnit {
  instanceId: string; // stable: side + original deployment round/order (e.g. "p2_r1_o1")
  side: 1 | 2;
  monsterId: number;
  badgeIds: number[];
  deployedRound: number;
  deploymentOrder: number;
  originalX: number;
  originalY: number;
}

export interface RoundDeploymentAction {
  side: 1 | 2;
  round: number;
  order: number;
  monsterId: number;
  badgeIds: number[];
  x: number;
  y: number;
  accepted: boolean;
  rejectionReason: string | null;
}

export interface RoundBoardState {
  schemaVersion: 'GENERATION2_ROUND_BOARD_STATE_V1';
  targetRound: number;
  seed: number;
  rngStateBeforeRound: number;
  p1ScoreBeforeRound: number;
  p2ScoreBeforeRound: number;
  p1BudgetBeforeRound: number;
  p2BudgetBeforeRound: number;
  teamA: Array<{ monsterId: number; badgeIds: number[] }>;
  teamB: Array<{ monsterId: number; badgeIds: number[] }>;
  deployedUnits: RoundBoardUnit[];       // accepted R1..R-1 entries
  pendingActions: RoundDeploymentAction[]; // current-R actions
  targetSide: 1 | 2;
  targetFormationFingerprint: string;
  opponentFormationFingerprint: string;
  targetPolicyFingerprint: string;
  opponentPolicyFingerprint: string;
  selectedBranchIdsThroughRound: string[];
  stateFingerprint: string;
}

export function computeRoundBoardStateFingerprint(
  state: Omit<RoundBoardState, 'stateFingerprint'>
): string {
  const norm = {
    schemaVersion: state.schemaVersion,
    targetRound: state.targetRound,
    seed: state.seed,
    p1ScoreBeforeRound: state.p1ScoreBeforeRound,
    p2ScoreBeforeRound: state.p2ScoreBeforeRound,
    p1BudgetBeforeRound: state.p1BudgetBeforeRound,
    p2BudgetBeforeRound: state.p2BudgetBeforeRound,
    deployedUnits: state.deployedUnits
      .map(u => ({ id: u.instanceId, m: u.monsterId, b: [...u.badgeIds].sort(), x: u.originalX, y: u.originalY }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    pendingActions: state.pendingActions
      .map(a => ({ side: a.side, o: a.order, m: a.monsterId, x: a.x, y: a.y, acc: a.accepted }))
      .sort((a, b) => a.side - b.side || a.o - b.o),
    targetSide: state.targetSide,
    targetFp: state.targetFormationFingerprint,
    oppFp: state.opponentFormationFingerprint,
    targetPol: state.targetPolicyFingerprint,
    oppPol: state.opponentPolicyFingerprint,
    branches: [...state.selectedBranchIdsThroughRound].sort(),
  };
  return sha256Hex(JSON.stringify(norm)).slice(0, 16);
}
