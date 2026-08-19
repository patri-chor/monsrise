STATUS: OPEN
DOMAIN: tree

# T046R - Web L1 Challenge Variant Snapshot Fidelity

> T046 is not accepted as a playable L1 challenge integration. Training policy/T0 roles/checker schema passed, but the exported web catalog is behaviorally incorrect for generated descendants. Repair only web snapshot fidelity, adapter loading, and end-to-end verification. Do not alter Tier thresholds, training evidence, weights, player-history isolation, or active game formations.

## Verified Blocking Defect

In `export_web_challenge.ts`, generated descendants do not export their own snapshot. Current behavior is effectively:

```text
for ROOT member:
  export root source team/evol

for GENERATED_DESCENDANT / other non-root member:
  export the same root source team/evol again
```

The UI can therefore label an opponent as a variant while actually playing the root T0 formation. This violates the L1 challenge contract.

## A. Canonical Variant Snapshot Recovery

For every exported catalog member, resolve the formation payload from that exact member's canonical fingerprint/lineage record, not merely from `rootSourceId`.

Required sources/precedence, all with strict fingerprint validation:

```text
ROOT:
  frozen T0 source fixture snapshot

GENERATED_DESCENDANT:
  canonical candidate/lineage registry snapshot with exact candidate fingerprint
  including exact team, badges, evol tree, branch conditions, placements and provenance

EARLY_HELDOUT:
  exact held-out fixture snapshot

HISTORICAL / SPECIALIST (if eligible in a later revision):
  exact permitted provenance snapshot
```

A member is exportable only when:

```text
payload canonical fingerprint equals catalog member fingerprint
team is valid for web battle
EvolFormation/tree passes tree strategy validation
root lineage/provenance matches catalog record
```

No payload may silently fall back to its root source. On missing/mismatched payload, exclude the member from this web revision with an explicit `WEB_SNAPSHOT_UNRESOLVED` record. Do not label it playable.

## B. Browser Adapter Fidelity

The browser challenge adapter must instantiate and execute the selected payload's actual:

```text
team slots and badges
EvolFormation decision tree
cross-round schedule and branch behavior
P1/P2 coordinate mapping rules
```

It may not invoke generic `BattleAI.buildTeam` or rebuild the opponent from root source data after selection.

Before battle, independently verify in browser/runtime:

```text
selected member ID
selected catalog fingerprint
loaded payload fingerprint
prepared opponent team fingerprint
```

All four must agree. Any mismatch aborts before board preparation and returns to Team Editor with a clear message, preserving player team/history.

## C. Player History Fidelity Fields

Extend local player history record to include:

```text
selectedMemberId
selectedCatalogFingerprint
loadedPayloadFingerprint
preparedOpponentTeamFingerprint
snapshotVerification: PASS | FAILED
```

Only completed PASS matches count in player W/D/L statistics. Failed preparation is a local diagnostic record, never a training artifact.

## D. Required Browser-Level Verification

Add focused tests and actual browser/runtime checks that prove:

```text
at least one GENERATED_DESCENDANT has a team/tree fingerprint different from its root and exports its own exact payload
selecting that descendant causes prepared web opponent team/tree fingerprint to equal descendant, not root
ROOT, GENERATED_DESCENDANT and EARLY_HELDOUT each resolve correct source kind
mismatch/missing snapshot fails closed with no generic/root fallback
VS AI preserves manual player team and uses exact selected opponent payload
player history remains localStorage-only and records snapshot verification
web catalog hash/schema remains valid after per-member snapshot resolution
```

Build affected client artifacts with `npx vite build`. Do not start a replacement server. Verify the existing web GUI after refresh; report exact verification method/limitations.

## Acceptance

- [ ] No generated descendant can be displayed as a variant while executing a root T0 payload.
- [ ] Every playable L1 member has exact snapshot-to-fingerprint fidelity from export through battle preparation.
- [ ] Missing evidence fails closed rather than silently degrading gameplay.
- [ ] Player history confirms what snapshot was actually played and remains isolated from training.
- [ ] No change to training policy, tiers, weights, active formation library, deployment, or publishing.

## Delivery

Write `TASKS/tree/T046R.report.md` with root-vs-variant gap audit; exportable/excluded counts by origin; payload fingerprint validation examples; browser preparation evidence for a generated descendant; failure-path evidence; build/GUI verification; history storage proof; and no-apply confirmation. Commit/push only `agent/tree`.
