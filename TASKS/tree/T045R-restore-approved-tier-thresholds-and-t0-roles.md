STATUS: REJECTED
DOMAIN: tree

# T045R - Restore Approved Tier Thresholds and T0 Roles

> REJECTED: The user authorized the current T045 pyramid thresholds (`T3 -> T2: L3 >= 80%`, `T2 -> T1: L2 >= 85%`). This task incorrectly attempted to restore 55%/60%/55%. Do not implement it. The only valid remaining correction is to remove the unapproved Top-1-per-root cap while retaining the authorized pyramid thresholds and the completed T0 learner-role repair.

> T045/T044 updated report is rejected as a decision implementation. It changed the approved formation-tier policy without user authorization and retained the known T0/L1 role conflation. Repair only these regressions; preserve all aggregate sample records and lineage artifacts.

## Verified Unauthorized Regression

The approved T/L model established for T044 is:

```text
T3 -> T2: L3 total score >= 55%
T2 -> T1: L2 total score >= 60%
T1 -> T2: L2 total score < 55%
L2 [55%, 60%): hysteresis, preserve current T tier
```

The current T045 artifacts instead use:

```text
T3 -> T2: 80%
T2 -> T1: 85% + root Top-1 restriction
```

Neither the 80/85 thresholds nor the Top-1-per-root cap was approved. Remove them. T1 may contain more than one qualified formation in a root lineage; T0 remains the separate immutable root/benchmark set.

## Verified T0 Role Regression

Current library/report still represent all T0 roots as:

```text
L1_STABLE
L1 learner allowed levels [L3, L2, L1]
L1 score
```

That is prohibited. T0 is an immutable benchmark/opponent catalog anchor, never an L1 trainee or learner.

## Required Policy

### T axis: formation strength/library membership

```text
T0: exactly original frozen 11, immutable anchor
T3: new candidate until L3 >=55%
T2: L3-qualified, may train L2
T1: L2 >=60% qualified, may train L1 after three distinct L2 attempts
```

### L axis: learning environment

```text
L3: Early Bundle 8
L2: frozen T0 11 only
L1: root-T0-lineage probabilistic melee pool
```

### T0 roles

```text
learningPermissions: []
benchmarkRoles: [L2_FROZEN_T0_ANCHOR]
opponentCatalogRoles: [L1_ROOT_LINEAGE_MEMBER]
l1LearnerStatus: NOT_APPLICABLE
l1Score: null
l2AttemptsCount: null
```

T0 can be selected as an L1 opponent. It cannot be dispatched as an L1 learner or receive L1 learner status.

## Required Implementation and Migration

1. Create a new policy/library revision that explicitly supersedes the unauthorized T045 policy; do not rewrite prior artifact history.
2. Reclassify current non-T0 candidates deterministically using the approved 55/60/55 policy and their complete frozen-revision L3/L2 vectors.
3. Do not retain old Top-1 cap states as current T1 decisions; record that they were superseded by policy revision.
4. Retain L1 sample evidence only for formations that are T1 under the restored policy. Candidates no longer T1 become L1_NOT_PERMITTED until requalified.
5. Recompute counts, transition logs, and reports with exact approved threshold/predicate values.

## Required Checks

```text
policy values exactly equal 0.55 / 0.60 / 0.55
no 0.80, 0.85, Top-1 cap, pyramid quota, or equivalent gate appears in current policy/code path
T1 membership may include multiple qualifying descendants of the same root
all T0 records have no L1 learner status/score/learning permission
T0 remains an L2 anchor and L1 opponent catalog member
T3/T2/T1 learning permissions follow approved two-axis rules
all current tiers recompute from frozen complete L3/L2 vectors and policy revision
T1 L1 eligibility still requires three genuinely distinct L2 attempts
no self-play/rule-random/separation/arena/apply/deploy/publish
```

## Acceptance

- [ ] Current active tier library uses only the approved 55%/60%/55% hysteresis policy.
- [ ] T0 is never represented as L1 learner/stable/diagnose, while retaining benchmark/opponent roles.
- [ ] No unapproved Top-1-per-root restriction remains.
- [ ] Historical T045 records remain provenance-separated from corrected current policy results.

## Delivery

Write `TASKS/tree/T045R.report.md` with policy diff; migration/reclassification counts; T0 role audit; multi-T1-per-root proof when qualified; permission checks; checker output; and no-apply confirmation. Commit/push only `agent/tree`.
