STATUS: DONE
DOMAIN: tree

# T053 - Repair Candidate Snapshot Lineage Identity and Retest

## Baseline Reproduction

Latest `formation_strength_library.v4.json` / `winrate_report.txt` no longer show every member of a lineage sharing one score, but score similarity remains materially high.

```text
root           evaluated  entries in repeated L2-score groups
springsword    12         6
nutsavior      11         6
all2rush       11         9
classicsavior  10         6
all2prayer     12         7
suqing         10         6
laddersel      10         7
spade_multi    11         8
gift_savior    11         5
golden_boom    10         6
gift_jungle    10         5
```

The root fallback was removed from `run_cycle.ts`, but current identity data is still inconsistent:

```text
40 candidate formation IDs have:
active-library canonicalFingerprint != candidate_lineage.jsonl candidateFingerprint
```

Examples:

```text
cand:nutsavior:spatial_local:c0_110
  library: 8c8571e8f6c36bea14f4dbd1
  lineage: fe14d73e9531479cb0d6fc78

cand:golden_boom:strategy_schedule_branch:c0_side2
  library: c48481531ea72cebe8045f6e
  lineage: 6f4149b78012969de189eb5e
```

The resolver currently reconstructs a tree, computes a new fingerprint, and registers it even when it differs from lineage metadata. Therefore candidate-library identity, declared lineage identity, resolved tree identity, and evaluated payload identity can diverge.

There are also genuine duplicate candidates, for example `formation_transform:c0_flip` / `c1_flip` often share the same exact fingerprint. These must not consume separate active slots or create duplicate score rows.

## Goal

Make the trial/candidate library the sole snapshot authority and enforce one identity across:

```text
candidate ID
-> declared lineage/registry fingerprint
-> reconstructed exact evol/team/policy fingerprint
-> active-library fingerprint
-> evaluated product payload fingerprint
-> raw W/D/L evidence
```

Do not solve score similarity by modifying Score70, changing seeds, adding noise, or inventing a new score. Do not use root fallback.

## A. Strict Lineage Reconstruction

Repair `snapshot_resolver.ts` so registry/lineage loading is per-record strict:

1. Reconstruct all supported operators from their recorded atomic changes exactly.
2. After reconstruction:

```text
computed fingerprint === recorded candidateFingerprint/canonicalFingerprint
```

must hold before registration.
3. On mismatch, append a compact `SNAPSHOT_LINEAGE_IDENTITY_INVALID` record with candidate ID, recorded fp, computed fp, operator family, source ID, and failure reason; do not register that candidate.
4. Never swallow the whole file with `catch {}`. One bad record may be quarantined, but valid records must continue loading and every rejected record must be observable.
5. Do not use generic synthetic reconstruction for `strategy_schedule_branch` when exact branch atomic data is absent. Fail closed and quarantine it.
6. If existing lineage schema lacks the exact data required to replay a candidate, upgrade the lineage schema/producer to persist that data going forward. Existing incomplete candidates remain historical-invalid until exact snapshot data is recoverable.

## B. Candidate De-Duplication

1. Before a candidate enters the active library or receives any evaluation, deduplicate by exact behavior fingerprint, not candidate ID.
2. Preserve duplicate rows/history as `DUPLICATE_BEHAVIOR_FINGERPRINT_HISTORICAL`, with a `duplicateOfFormationId` reference; exclude them from active counts, L1 selection, L2 evaluation, and reporting as separate formations.
3. Do not merge different fingerprints merely because they happen to get the same Score70/W/D/L result.

## C. Batch-Level Payload Identity Gate

Do not add expensive per-game replay validation. Instead, when building a target/opponent batch:

```text
expected active-library fingerprint
== resolved snapshot fingerprint
== computeCandidateFingerprint(prepared evol)
```

must hold once per formation per batch. Include calculator-policy fingerprint as applicable.

On mismatch:

```text
exclude the formation from this batch
set verification state/reason to SNAPSHOT_IDENTITY_INVALID
write a concise audit record
never copy a root score or use root payload
```

The product worker task/result should carry the target/opponent payload fingerprints so raw rows/evidence can prove what was evaluated. Keep this metadata lightweight; do not calculate/replay it per game.

## D. Quarantine and Retest

1. Mark all existing score/evidence rows for candidate IDs where identity cannot be reconciled as:

```text
SNAPSHOT_IDENTITY_INVALID_PRE_T053
```

They must not affect dynamic tiers, L1 pool weights, challenge catalog selection, branch routing, or candidate parent selection.
2. Re-evaluate only identity-valid, non-duplicate active formations via:

```text
PersistentSimPool
-> fine_grained_worker(product_path)
-> playFullGame
-> product_tree_strategy
```

3. The report must distinguish:

```text
active evaluated
identity-invalid quarantined
behavior-duplicate historical
not evaluated
```

Do not claim individual score equality is invalid by itself: with L2 sample size 11 opponents x P1/P2 x 5 games, equal W/D/L remains possible for different valid variants.

## Acceptance

- [ ] Zero evaluated active candidates have a mismatch among library, lineage, resolved snapshot, and prepared payload fingerprints.
- [ ] All old mismatches are visible and quarantined, not silently repaired or root-substituted.
- [ ] Exact duplicate fingerprints are represented once in active evaluation/L1 selection.
- [ ] Different fingerprints with coincident score remain allowed and are reported as independent evaluated payloads.
- [ ] Product raw/evidence rows identify target/opponent payload fingerprints.
- [ ] Focused resolver/lineage tests include: mismatch quarantine, no generic branch reconstruction, duplicate exclusion, and batch identity gate.
- [ ] No R0 mutation, no active game deployment, no old arena evidence.

## Delivery

Write `TASKS/tree/T053.report.md` with baseline mismatch/duplicate counts; schema changes; exact operator replay coverage and unsupported-operator quarantine count; active/retest counts; before/after score-group summary; raw evidence identity fields; test output; no-apply confirmation; and changed files. Commit/push only `agent/tree`.
