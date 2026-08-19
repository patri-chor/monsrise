STATUS: OPEN
DOMAIN: tree

# T044R - T0 Anchor Role and L1 Status Repair

> Narrow repair for accepted T044 gate mechanics. Product-path audit confirms `T0_L1_RECORDS=0`; no T0 melee training was dispatched. However, `formation_strength_library.json` incorrectly assigns every T0 member `L1_STABLE`, an L1 score, and `allowedLearningLevels: [L3,L2,L1]`. This violates the two-axis model and must be repaired before long-running scheduling relies on the library.

## Required Semantics

```text
T0:
  immutable frozen root source
  L2 benchmark anchor
  L1 opponent-catalog member when selected by root-lineage sampler
  never an L1 learner / trainee
  never L1_ELIGIBLE, L1_STABLE, or L1_DIAGNOSE_REQUIRED
  never gets L1 training score or L1 diagnostic obligation
  does not have learner allowedLearningLevels
```

T0 may appear in an L1 sampling manifest as an *opponent member*. That catalog role must not be represented as an L1 learning status in the formation strength library.

Only promoted `T1` formations may have the L1 learner status markers:

```text
L1_NOT_YET_EVALUATED
L1_ELIGIBLE
L1_STABLE
L1_DIAGNOSE_REQUIRED
```

T2 and T3 have no L1 learner status beyond an explicit non-eligible value such as `L1_NOT_PERMITTED`.

## Required Changes

1. Split library representation into explicit roles:

```text
learningPermissions
benchmarkRoles
opponentCatalogRoles
l1LearnerStatus (T1 only)
```

2. Correct all T0 records:

```text
learningPermissions: []
benchmarkRoles: [L2_FROZEN_T0_ANCHOR]
opponentCatalogRoles: [L1_ROOT_LINEAGE_MEMBER]
l1LearnerStatus: NOT_APPLICABLE
l1Score: null
l2AttemptsCount: null
```

3. Ensure runtime dispatch checks learner permissions, not opponent-catalog membership. T0 remains eligible as an L2/L1 opponent but cannot be scheduled as a candidate under evaluation in L1.
4. Recompute counts with disjoint meaning:

```text
T1L1EligibleCount / StableCount / DiagnoseRequiredCount count only T1 learners
T0L1OpponentMemberCount is separately reported
T0L1LearnerCount must be zero
```

5. Preserve T044 historical output separately or create a T044R policy/library revision. Do not rewrite it as though it had correct semantics.

## Required Checks

```text
T0_L1_LEARNER_RECORDS = 0
T0 library entries have no L1 learner status, score, or allowed learner level
all T0 entries retain L2 benchmark and L1 opponent-catalog role
only T1 may be L1 eligible/stable/diagnose-required
T2/T3 cannot dispatch L1
T0 cannot dispatch L1 as trainee, even though it can be selected as an L1 opponent
counts separate T0 opponent membership from T1 learner statuses
no frozen T0 mutation, apply, deploy, publish, self-play, rule-random, or arena path
```

## Acceptance

- [ ] Library roles no longer conflate benchmark/opponent membership with learning eligibility.
- [ ] T0 remains preserved and usable as benchmark/opponent, but never claims L1 learner completion.
- [ ] Long-running scheduler has unambiguous permissions and counts.

## Delivery

Write `TASKS/tree/T044R.report.md` with before/after role table; T0 learner/opponent counts; policy revision; permission/dispatch audit; checker output; and aggregate-only/no-apply confirmation. Commit/push only `agent/tree`.
