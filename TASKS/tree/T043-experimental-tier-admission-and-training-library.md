STATUS: OPEN
DOMAIN: tree

# T043 - Experimental Tier Admission and Training Library

> Domain: `tree` | Executor branch: `agent/tree`
> T042 is accepted as the current lineage-complete aggregate training catalog. Add durable, automatic **experimental training tier** admission so candidates that meet their stage gate visibly enter T3/T2 rather than remaining an undifferentiated candidate list. This does not replace, apply, deploy, publish, or mutate the frozen current T1 game library.

## Terminology and Tier Model

These are training-library states, not automatic active-game integration:

```text
FROZEN_T1
  The current 11 immutable source formations. They remain the strong benchmark.

CANDIDATE
  Generated/valid candidate not yet admitted to a training tier.

EXPERIMENTAL_T3
  Candidate that passes the Early Bundle gate. T3 and candidates train only against Early Bundle.

EXPERIMENTAL_T2
  Candidate promoted from T3 after its Early Bundle episode gate. T2 and above may train against current frozen T1.

EXPERIMENTAL_T1_EPISODE
  T2 candidate that passes the current strong-pool gate and is completing focused T1 optimization.

EXPERIMENTAL_MELEE
  Candidate that completes its real Stage-1 episode and is eligible for lineage-probabilistic melee.

EXPERIMENTAL_FRONTIER
  Candidate that passes melee stability according to the frozen revision policy. It is an experimental parent/member only, never an active frozen T1 replacement.
```

No state may imply:

```text
automatic overwrite of FORMATION_LIBRARY
active game apply
formal Tier 1 replacement
bundle artifact update
deploy or publish
```

## A. Automatic Admission Rules

Admission is automatic, deterministic, revision-scoped, and append-only. Do not require a human to manually reclassify a candidate after it has met a gate.

```text
CANDIDATE -> EXPERIMENTAL_T3
  when it completes the full frozen Early Bundle 8 x P1/P2 evaluation
  and passes the versioned Early Bundle gate.

EXPERIMENTAL_T3 -> EXPERIMENTAL_T2
  only after completing its required Early Bundle optimization episode
  and passing the versioned promotion gate based on the complete Early Bundle vector.

EXPERIMENTAL_T2 -> EXPERIMENTAL_T1_EPISODE
  when it completes the complete current frozen T1 pool evaluation
  and passes the strong-pool entry gate.

EXPERIMENTAL_T1_EPISODE -> EXPERIMENTAL_MELEE
  only after three genuinely distinct Stage-1 targeted attempts,
  each with real full 11 x P1/P2 strong-pool evidence.

EXPERIMENTAL_MELEE -> EXPERIMENTAL_FRONTIER
  only after T042 lineage-probabilistic melee policy is satisfied.
```

A candidate that fails a gate remains in its current experimental tier and records its diagnostic/coverage obligation. It is not discarded or demoted simply because one direction failed.

## B. Versioned, Explainable Gate Configuration

Create a versioned `experimental_tier_policy.json` with all thresholds, comparison rules, sample-stage requirements, weakest-matchup/side safeguards, and benchmark revision IDs. No hidden hardcoded gates.

The policy must define:

```text
Early Bundle CANDIDATE -> T3 gate
Early Bundle T3 -> T2 gate and required episode coverage
Strong-pool T2 -> T1-episode gate
Stage-1 episode distinct-attempt requirement
Melee -> frontier stability gate
conditions that trigger HOLD / DIAGNOSE / REACTIVATE
```

Every admission record references its exact policy revision, benchmark revision, complete aggregate vector, and transition predicate values/text. Checker must recompute the decision.

## C. Training Library and Counts

Create a durable, immutable-by-revision training library view, for example:

```text
experimental_training_library.json
experimental_tier_transitions.jsonl
```

Each member must expose:

```text
candidate ID / canonical fingerprint / root T1 source / lineage proof
current experimental tier
prior tier transitions and reasons
benchmark/policy revision references
Early Bundle / strong pool / melee vector references
known weakest opponent/side and next diagnostic obligation
isEligibleAsMeleeMember / isExperimentalFrontier
integration status and no-apply confirmation
```

The library must report live counts separately:

```text
FROZEN_T1 count
CANDIDATE count
EXPERIMENTAL_T3 count
EXPERIMENTAL_T2 count
EXPERIMENTAL_T1_EPISODE count
EXPERIMENTAL_MELEE count
EXPERIMENTAL_FRONTIER count
```

A candidate may appear as a historical lower-tier transition, but exactly one `currentTier` must exist in the current revision.

## D. T1 Changes and Revisions

When frozen T1 source membership/fingerprint changes, create a new benchmark/policy/library revision. Retain historical tier transitions but mark affected candidates `REVALIDATION_REQUIRED`; do not silently preserve current T2+ status under a changed strong pool.

T1 root lineage still controls melee archetype identity as established by T042.

## E. Required Checks

Extend the sole `run_cycle.ts` entry and checker/tests to prove:

```text
all admission transitions satisfy and expose their exact policy predicates
candidates cannot skip CANDIDATE -> T3 -> T2 -> T1-episode -> Melee ordering
T3/candidate dispatches only Early Bundle; T2 and above may dispatch strong pool
only three genuinely distinct Stage-1 attempts unlock melee
current tier counts reconcile to library membership with exactly one current tier/member
failed direction does not discard/demote a candidate
frontier never changes FROZEN_T1 or active game library
T1 change triggers revision and revalidation rather than silent carryover
no arena, self-play, rule-random, old separation/adScore, apply/deploy/publish path
```

## Acceptance

- [ ] Qualifying candidates automatically enter experimental T3 and later T2; T2 is no longer reported as zero merely because it is not active-game Tier 2.
- [ ] Tier state is deterministic, durable, visible, and backed by full benchmark vectors.
- [ ] T3/candidate vs Early Bundle and T2+ vs frozen T1 training restrictions are enforced.
- [ ] Experimental tiers never mutate frozen T1 or active game state.

## Delivery

Write `TASKS/tree/T043.report.md` with policy revision; admission thresholds; current counts per training tier; transition audit; example T3/T2 members and evidence vectors; holds/diagnostics; T1 revision/revalidation proof; checker result; and explicit no-apply confirmation. Commit/push only `agent/tree`.
