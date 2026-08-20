STATUS: OPEN
DOMAIN: tree

# T051 - Dynamic Strength Ladder, Active L2, and 0.70 Draw-Value Regrade

> Domain: `tree` | Executor branch: `agent/tree`
> The system is intended to become stronger continuously. Formation tiers are therefore dynamic strength labels, not permanent historical labels. Replace the stale frozen-T0 L2 strength gate with a current active-strength pool, preserve original 11 only as immutable historical roots, and regrade all active formations using `score = WinRate + 0.70 * DrawRate` (equivalently `(W + 0.70D) / N`). Complete T050R provenance repair before treating any historical perfect result as independent evidence.

## A. Accepted Strategic Decisions

```text
Original 11 formations:
  preserve forever as R0 historical root snapshots
  never mutate or overwrite
  continue to anchor root lineage, replay, audit, and fallback provenance
  no longer define a permanently frozen T0 strength tier

T0 / T1 / T2 / T3:
  dynamic current-strength labels
  assigned by current benchmark performance
  may change as current active opponent pool becomes stronger
  are not historical identity labels

L2:
  becomes Active-L2, built from current active T0 main formations
  it intentionally evolves with the training ecosystem
  historical scores from frozen-T0 benchmark are not directly comparable

Score:
  primary strength score = (W + 0.70 * D) / N
  retain WinRate, DrawRate, LossRate, and old 0.50-draw score for audit only
```

A high-draw / low-loss strategy is valid. Do not introduce a draw penalty, forced decisive-rate gate, or “DRAW_HEAVY” demotion solely because a formation draws often. Direct wins remain intrinsically better than draws under 0.70 weighting.

## B. T050R Is a Hard Evidence Prerequisite

T051 must not promote/regrade from T050's invalid self-opponent / incomplete-provenance retest data. Before a record can be used as independent evidence:

```text
T050R self-opponent repair is complete
exact formation + calculator policy fingerprints are recorded
product-path provenance is recorded
no exact self-opponent exists
raw W/D/L reconciles
```

Until then preserve `UNVERIFIED_AGGREGATE_ONLY`. Historical 0.50-score / frozen-L2 records remain audit-only and cannot silently drive current dynamic label changes.

## C. New Identity and Library Model

Create a new versioned training library/revision with explicit separation:

```text
R0_HISTORICAL_ROOT:
  immutable original 11 snapshot identity
  root lineage source
  no dynamic strength label required

ACTIVE_FORMATION:
  exact formation/team/tree/calculator policy snapshot
  current dynamic tier: T0 | T1 | T2 | T3
  rootR0SourceId
  active role(s):
    CURRENT_ROOT_MAIN
    ACTIVE_TRAINING_PARENT
    ACTIVE_COMPETITOR
    HISTORICAL_MAIN
    ARCHIVED_EXPERIMENTAL
```

Each R0 lineage must initially have one `CURRENT_ROOT_MAIN` active formation. It may be the original snapshot at migration, or a verified descendant only where there is existing explicit evidence. Never infer a replacement merely from legacy aggregate scores.

Multiple formations in one root lineage can be T0 or T1 if their current performance merits it. There is no Top-1-per-root restriction.

When a newer active formation becomes a current root main, do not delete the prior main; mark it `HISTORICAL_MAIN` and retain traceability.

## D. Active-L2 Dynamic Benchmark

Define a versioned Active-L2 manifest:

```text
one or more current T0 main formations per R0 lineage
initial target: one active main per each of 11 R0 lineages
exact formation fingerprint
calculator policy fingerprint
manifest revision/hash
selection timestamp and evidence references
```

Active-L2 must change only through an explicit revisioned selection process. Every evaluation stores the exact manifest hash; no result is comparable across manifest revisions without a fresh evaluation.

T0 and T1 active formations both:

```text
generate mutations / calculator-policy variations
undergo current evaluation
receive Active-L2 and L1 mixed-melee scores
can become/relinquish active parents based on current evidence
```

T2/T3 follow the same exploration pipeline but remain subject to permissions. Do not allow a lower tier to bypass required evidence merely because its parent was T0/T1.

## E. New Evaluation Metrics

For all new dynamic evaluations, persist:

```text
W, D, L, N
primaryScore70 = (W + 0.70 * D) / N
winRate = W / N
drawRate = D / N
lossRate = L / N
legacyScore50 = (W + 0.50 * D) / N (audit-only)
benchmark revision/hash
formation and calculator policy fingerprints
raw provenance and verification state
```

Requirements:

```text
primaryScore70 is in [0,1]
W+D+L=N for raw records
no old 0.50 score is reused as a new 0.70 score
no historical aggregate-only result can obtain a current label without new valid evaluation
score calculations are independently tested for high-draw cases
```

Explicit high-draw regression examples:

```text
80% draw, 20% loss, 0% win:
  Score70 = 0.56

80% draw, 20% win, 0% loss:
  Score70 = 0.76

100% draw:
  Score70 = 0.70
```

This is intentional. Record pure W/D/L so a human can distinguish an undefeated draw system from an attacking winner.

## F. Dynamic Regrade Procedure

Do not reuse the old 80/85/80 thresholds verbatim without calibration because both the opponent pool and score function changed.

1. Build Active-L2 v1 from traceable current active mains.
2. Run a product-path calibration panel across the active library using current manifest and `Score70`.
3. Produce, do not silently choose, a threshold proposal showing tier distributions and transition impact for at least:

```text
Option A: quantile/distribution bands
Option B: fixed Score70 gates calibrated from current active pool
Option C: relative-to-Active-L2 median / percentile gates
```

4. The executor must write the calibration report and select only a clearly justified provisional policy if the task needs to run. The policy must be revisioned and easily replaceable. It must not invent a claim that old 80/85/80 thresholds retain their meaning.
5. Apply regrade only after valid product-path evidence under Active-L2 v1; unmatched/incomplete members remain `T3_PENDING_REGRADE` or equivalent, not fabricated T1/T0.

For the first migration, emit a reviewable proposed mapping:

```text
old tier / old score50
new Active-L2 Score70 / W/D/L
new proposed dynamic tier
reason / evidence state
```

Do not overwrite historical labels/evidence.

## G. L1 Mixed Melee and Web

L1 becomes a living pool of R0 roots, current T0/T1 active formations, and traceable eligible descendants. It must retain root-lineage sampling but incorporate dynamic active snapshots and exact policy fingerprints.

```text
T0 and T1 receive L1 scores and may be optimization parents.
R0 historical snapshots may be L1 opponents, but R0 itself is not a learner/tier.
T2/T3 retain existing L1 permission gates.
```

Weights must use only evidence state permitted by T050R/T051. Aggregate-only records get neutral/floor weighting and no verified-strength presentation.

T046 web challenge export/history must carry:

```text
active library revision
Active-L2 manifest hash
Score70 plus W/D/L metrics
verification state
formation and calculator policy fingerprints
```

Do not show a current dynamic score as a historical score. Player history remains local-only and never influences tiers/weights.

## H. Full Audit Ledger Migration

Create a V4/current dynamic ledger or a clearly linked equivalent. It must preserve old V2/V3 history and add:

```text
root identity (R0)
active snapshot identity
active role
active library revision
Active-L2 manifest revision/hash
primaryScore70
legacyScore50
W/D/L metric family
old vs new tier mapping
verification state
supersession links
```

Generated review report must show every active formation, including current T0/T1 parents, with:

```text
R0 lineage
active role
current dynamic tier
Active-L2 Score70 and W/D/L
L1 Score70 and W/D/L
calculator policy fingerprint
verification state
benchmark manifest revision
regrade / retest obligation
```

## I. Product Path and Safety

All new calibration, Active-L2, L1, and regrade evaluation must execute:

```text
PersistentSimPool
-> fine_grained_worker(product_path)
-> playFullGame
-> product_tree_strategy
```

Maintain CPU target around 80% and one-game task granularity. No sandbox arena, rule-random, separation score, generic BattleAI fallback, self-play, or player history evidence.

No active game apply/deploy/publish, no automatic replacement of the playable original formation library, and no T0/R0 mutation.

## J. Required Checks

```text
R0 original 11 exact fingerprints remain immutable and fully recoverable
current T0/T1 labels are dynamic active-strength labels, not frozen identities
Active-L2 manifest contains exact current snapshot/policy fingerprints and revision hash
all Active-L2 results bind exact manifest revision
new Score70 arithmetic and high-draw examples pass
old Score50 never silently becomes Score70
T050R provenance/self-opponent requirements gate independent evidence
multiple T0/T1 members per R0 lineage are supported
T0 and T1 both can be active training parents and receive L1 score
no historical aggregate-only record creates current promotion/regrade by itself
web export/history carries exact dynamic revision/metrics without player-data leakage
ledger V4/current report gives complete, auditable old-to-new mapping
no apply/deploy/publish/frozen-library mutation
```

## Acceptance

- [ ] The system has an explicit immutable R0 historical root layer and a separate dynamic T0-T3 strength ladder.
- [ ] L2 is an actively versioned strength pool, not a permanently frozen historical pool.
- [ ] `W + 0.70D` is the current primary dynamic score, with W/D/L and old 0.50 score retained for audit.
- [ ] High-draw undefeated strategies receive their intended score and remain valid competitors.
- [ ] T0 and T1 are continuously optimized and receive mixed-melee scores as active formations.
- [ ] All regrades are provenance-gated, manifest-pinned, reviewable, and do not fabricate confidence from old aggregate data.

## Delivery

Write `TASKS/tree/T051.report.md` with R0 migration proof; Active-L2 manifest; Score70 calibration/options and selected provisional policy; complete regrade mapping/counts; high-draw regression examples; T0/T1 parent/L1 evidence; T050R dependency proof; V4 ledger/report paths; web metadata proof; test/build/check outputs; no-apply confirmation; and every changed file. Commit/push only `agent/tree`.
