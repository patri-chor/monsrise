import { FormationSnapshotResolver } from './snapshot_resolver';
import type { ResolvedFormationSnapshot } from './snapshot_resolver';
import type { CycleSnapshotInput } from './tree/tree_types';

export class TreeSnapshot {
  private static resolver = FormationSnapshotResolver.getInstance();

  public static init(): void {
    TreeSnapshot.resolver.init();
  }

  public static resolve(input: { formationId?: string; snapshot?: CycleSnapshotInput }): ResolvedFormationSnapshot {
    if (input.snapshot) {
      return {
        formationId: input.snapshot.formationId,
        displayName: input.snapshot.displayName,
        canonicalFingerprint: input.snapshot.canonicalFingerprint,
        team: input.snapshot.team,
        evol: input.snapshot.evol,
        provenance: 'dynamic_snapshot_input',
        rootR0SourceId: input.snapshot.rootSourceId,
      };
    }
    if (input.formationId) {
      return TreeSnapshot.resolver.resolveFormationSnapshot({ formationId: input.formationId });
    }
    throw new Error('Neither formationId nor snapshot was provided for resolution');
  }
}
