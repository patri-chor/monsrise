import { CyclePilot } from './product_training/generation2/cycle/pilot';
import { LineageManager } from './product_training/generation2/cycle/lineage';

export class TreeLineage {
  public static buildSLineages(representatives: any[], parentSnapshotFingerprint: string) {
    return LineageManager.buildSLineages(representatives, parentSnapshotFingerprint);
  }

  public static compileForwardCandidate(rep: any, adverseCase: any, oppSnap: any) {
    return CyclePilot.compileForwardCandidate(rep, adverseCase, oppSnap);
  }

  public static validateCandidateAgainstCurrentPilot(
    cand: any,
    baseCase: any,
    targetSnap: any,
    oppSnap: any,
    currentTargetEvol: any,
    config: any,
    iter: number
  ) {
    return CyclePilot.validateCandidateAgainstCurrentPilot(
      cand,
      baseCase,
      targetSnap,
      oppSnap,
      currentTargetEvol,
      config,
      iter
    );
  }
}
