STATUS: OPEN
DOMAIN: tree

# T044 - Formation Strength Tiers and Learning-Level Gates

> Domain: `tree` | Executor branch: `agent/tree`
> Replacement for rejected T043. Implement the user's two-axis model exactly: `T` classifies formation strength/library membership; `L` classifies learning/test environment. Build on T042 lineage-complete melee catalog. No active-game apply, bundle mutation, deploy, publish, or mutation of frozen T0.

## A. Non-Negotiable Two-Axis Vocabulary

### Formation tiers (T): formation strength and library identity

```text
T0
  Original frozen 11 formations. Immutable root sources and stable strong benchmark.
  T0 remains permanently distinct from every promoted formation.
  It is never overwritten by T1 promotion and continues to anchor root-lineage archetypes.

T3
  Newly generated/early structural candidates. T3 has not yet proven itself against Early Bundle.

T2
  A T3 formation that has passed L3 Early Bundle strength gate.
  T2 formations may train/evaluate in L2 against frozen T0.

T1
  A T2 formation that has passed L2 frozen-T0 strength gate.
  T1 formations are the strongest promoted training-library formations, distinct from T0.
  T1 formations are eligible for L1 mixed-melee training.
```

### Learning/test levels (L): opponent environment

```text
L3 = Early Bundle 8 (the seven frozen Early Bundle opponents plus historical Gift Jungle fixture)
L2 = frozen original T0 11 only; never silently replace it with promoted T1 formations
L1 = lineage-probabilistic mixed melee pool, using the T042 root-T0 archetype sampler
```

Never use T names as a synonym for L stages, and never use L names as a formation-library tier.

## B. Automatic Strength-Tier Gates

Use the complete aggregate vector for the appropriate frozen learning-level revision. All thresholds are versioned configuration, not hardcoded logic.

```text
T3 -> T2
  L3 total win-rate score >= 55%

T2 -> T1
  L2 total win-rate score >= 60%

T1 -> T2 (demotion)
  L2 total win-rate score < 55%
```

This is an intentional 5 percentage-point hysteresis band. Values in `[55%, 60%)` mean:

```text
T2 remains T2
T1 remains T1
```

Gate scores must be calculated from the specified L-level's complete current revision vector only, with all opponents and actual P1/P2 coverage. Do not mix scores across L3/L2/L1 revisions and do not substitute candidate-vs-parent, self-play, rule-random, arena, or old separation/adScore.

A formation may retry after new valid optimization evidence. A failed candidate remains at its current T tier; it is not discarded. A current T1 that fails its L2 threshold must automatically demote to T2 and receive an L2 diagnostic obligation.

## C. Coupled Permission and Execution Rules

```text
T3:
  May generate/optimize and test only in L3.
  Cannot dispatch L2 or L1 work.

T2:
  Continues L3 diagnostics as needed.
  May generate/optimize and test in L2 against frozen T0.
  Cannot dispatch L1 melee.

T1:
  Retains L2 regression monitoring.
  May continue L2 optimization and may dispatch L1 melee.
  L1 results are a generalization diagnostic, not a separate T tier.
```

A T1 member receives persistent L1 status markers:

```text
L1_NOT_YET_EVALUATED
L1_ELIGIBLE
L1_STABLE
L1_DIAGNOSE_REQUIRED
```

`L1_ELIGIBLE` requires T1 plus three genuinely distinct L2-targeted optimization attempts, as enforced by T041R/T042. `L1_STABLE` and `L1_DIAGNOSE_REQUIRED` come from L1 melee evaluation. An L1 failure returns the formation to L2 diagnostic optimization while it remains T1 unless its subsequent L2 score triggers the explicit <55% demotion rule.

## D. T0 Integrity and Lineage

- T0's 11 snapshots remain frozen, separate, and are the sole L2 strong benchmark.
- Promoted T1 formations never replace a T0 source, even if their score is greater.
- Every T1/T2/T3 formation retains `rootT0SourceId` and lineage proof. This continues to define its L1 archetype as established by T042.
- T0 source changes create a new frozen L2 revision and require re-evaluation; no silent tier carryover.

## E. Durable Library and Policy Artifacts

Create versioned artifacts, for example:

```text
formation_tier_policy.json
formation_strength_library.json
formation_tier_transitions.jsonl
learning_level_evaluations.jsonl
```

Every formation record exposes:

```text
formation/candidate ID and canonical fingerprint
rootT0SourceId and lineage proof
currentTier: T0 | T1 | T2 | T3
L1 status marker
current L3/L2/L1 revision references
complete vector references and computed gate score
prior tier transitions with predicate values/reasons
next allowed learning level and diagnostic obligation
AGGREGATE_EXPLORATION_ONLY / no-apply status
```

Library counts must separately report:

```text
T0 count
T1 count
T2 count
T3 count
T1 L1_ELIGIBLE count
T1 L1_STABLE count
T1 L1_DIAGNOSE_REQUIRED count
```

Each non-T0 formation has exactly one current T tier. Historical transitions are retained append-only.

## F. Required Checks

Extend the sole `run_cycle.ts` entry and checker/tests to prove:

```text
T and L axes are distinct in all schema, logs, reports, and code-facing names
T0 has exactly the frozen original 11 and is never altered by promotion
a T3 passing complete L3 at >=55% automatically enters T2
a T2 passing complete L2 at >=60% automatically enters T1
a T1 below L2 55% automatically returns to T2
55%-<60% hysteresis preserves current T tier
T3 cannot dispatch L2/L1; T2 cannot dispatch L1; T1 may dispatch L1 only after three distinct L2 attempts
L2 uses frozen T0 only, not promoted T1 members
L1 uses T042 lineage-probabilistic root-T0 sampler
L1 failure produces L2 diagnostics, and only L2 <55% demotes T1
T1 promotion never applies/replaces a T0 or active-game formation
all decisions recompute from full L-level P1/P2 vectors and frozen revision identity
```

## Acceptance

- [ ] T0/T1/T2/T3 now truthfully report formation strength/library status, not test progression.
- [ ] L1/L2/L3 truthfully report test/training environments, not formation strength.
- [ ] Automatic promotions/demotions follow 55% / 60% / 55% thresholds with hysteresis.
- [ ] Only T1 can enter L1 melee; T2 learns against T0 in L2; T3 learns in L3.
- [ ] Frozen T0 remains immutable and separate from promoted T1.
- [ ] No active-game integration or formal apply/deploy/publish occurs.

## Delivery

Write `TASKS/tree/T044.report.md` with tier policy; initial T0/T1/T2/T3 counts; L1 status counts; promotion/demotion audit examples; L-level vector calculations; T0 integrity proof; permission-denial checks; L2 diagnostic return proof; checker results; and aggregate-only/no-apply confirmation. Commit/push only `agent/tree`.
