STATUS: OPEN
DOMAIN: tree

# T039 - Corrected Controllability, Full-Panel Adaptive Screen, and CPU-Saturating Evolution

> Domain: `tree` | Executor branch: `agent/tree`
> Build on completed T038 aggregate exploration cycles. This is the active next task. It must retain `PersistentSimPool` and product-only execution. No Tier change, automatic game integration, active formation apply, deploy, or publish.

## Starting Point and Evidence Class

T038's latest catalog is valid only as:

```text
AGGREGATE_EXPLORATION_ONLY
EXPERIMENTAL_UNVERIFIED_NOT_FOR_AUTO_INTEGRATION
formalPromotionStatus=NOT_EVALUATED
```

Retain all T037/T038 files untouched. New records must keep the same aggregate-exploration boundary. Do not revive the retracted per-game trace task in this work.

## A. Fix the Controllability Semantic Error

Existing T038 policy incorrectly treated `calculatedUnitRatio` as `controllableRatio`. They are opposites.

```text
calculatedCount: calculator-controlled monsters; their positions are not tree-adjustable
controllableCount: tree-adjustable monsters; their positions are eligible for spatial optimization
correctControllableRatio = controllableCount / teamSize
```

Use the corrected value in all policy, catalog, decision, telemetry, and checker output.

Required expected examples from the source fixture:

```text
gift_jungle: 7 controllable / 8 = 0.875 -> high spatial budget
all2rush: 2 controllable / 8 = 0.250 -> low spatial budget
laddersel: 1 controllable / 8 = 0.125 -> low spatial budget
springsword: 6 controllable / 8 = 0.750 -> high spatial budget
```

Never mutate calculator-controlled positions through `spatial_local` or an unrestricted transform. Whole-pattern transforms must explicitly list/exclude calculator-controlled exceptions according to authoritative rules.

## B. Correct Source Classification and Search Patience

Replace `WEAK` labels with neutral, evidence-scoped terms:

```text
PANEL_UNDERPERFORMER: low score on this aggregate 7-opponent panel
PANEL_MID
PANEL_SATURATED: high panel score, not inherently globally strong
```

`all2rush` must be labeled `PANEL_UNDERPERFORMER` / high matchup variance, never generally “weak.” Historic 11x11 arena data may be recorded only as a non-authoritative matchup hypothesis:

```text
SANDBOX_ENGINE_UNVERIFIED_PRE_T032
```

Do not retire or screen out a source based on a first candidate or first failed cycle. Each source receives an optimization episode before any de-prioritization:

```text
at least 3 distinct single-change attempts across eligible operator families
spatial_local when controllable placements exist
formation_transform when legal
strategy_schedule_branch when legal
```

Track per-source/per-operator attempts and non-regression/improvement results across cycles. Only after the full episode yields no source-relative non-regression and the source remains `PANEL_UNDERPERFORMER` may the scheduler:

```text
increase deterministic multi_monster_exploration budget
reduce repeatedly ineffective operator-family priority
```

It may never permanently discard the source. A new branch/coverage/matchup opportunity restores its exploration eligibility.

## C. Full-Panel Tiered Sampling

Early screening must retain the full coverage panel; never reduce it to one opponent or one side:

```text
7 opponents x 2 actual sides = 14 cells per candidate
```

Reduce only games per cell, with deterministic staged extensions:

```text
Stage A: 1 game/cell = 14 games/candidate
Stage B: extend to 3 games/cell = 42 games/candidate
Stage C: extend to 6 games/cell = 84 games/candidate
```

Stage A runs only after candidate validation and after the source has entered its optimization episode. It is not source retirement.

Promotion rules, computed from all 14 cells:

```text
A -> B: candidate source-relative score >= baseline - 0.05
B -> C: candidate source-relative score >= baseline
```

For each stage append aggregate records with:

```text
cycleId / candidate fingerprint / parent fingerprint / source / operator family
stage ID / gamesPerCell / totalGames / deterministic seed set
7x2 coverage / WDL / source-relative score / weakest-side score
stage decision and exact criterion
```

A failed stage is an exploration result, never a loss conversion or source-level rejection. T037's existing 10 games/cell records remain a fixed historical starting reference and may not be mixed arithmetically with the new stage totals.

## D. CPU-Saturating Fine-Grained Scheduling

Current utilization is structurally limited because one entity submits only 14 tasks and each task serially runs 10 games. Replace this for new T039 screening:

```text
one actual game = one product-path pool task
outer candidate concurrency <= 2
both candidates' full 7 x 2 x stage-game task sets dispatch together
aggregate only after pool results return
```

Retain:

```text
PersistentSimPool -> fine_grained_worker(product_path) -> playFullGame -> product_tree_strategy
```

Do not use arena or old round-robin workers.

The CPU controller target is 80%, with honest measured acceptance:

```text
when runnable work persists >=10 seconds:
observed average CPU >=75%
observed p95 CPU <=90%
```

Record per screen/cycle:

```text
configured and observed workers
peak and average in-flight game tasks
CPU average / p50 / p95
low-queue interval count
host-level limitation when target is not reached
```

Do not claim success merely because `CpuLoadMonitor` is configured with 0.80. If workload is too small to sustain the window, report it; do not fabricate saturation.

## E. Aggregate Heuristic Pruning

Keep pruning product-path-only and explicitly non-formal:

```text
evidenceClass=AGGREGATE_EXPLORATION_ONLY
heuristicStatus=AGGREGATE_HEURISTIC_UNVERIFIED
```

Use Stage B (3 games/cell) for matched before/after branch-removal comparisons. Preserve full 7x2 coverage, seeds, W/D/L, source-relative and weakest-side deltas, sample stage, and scheduling telemetry. Do not call legacy arena pruning.

## F. Unified Files and Checks

Extend the existing single-entry product training system only:

```text
src/engine/tree/product_training/04_screen.ts
src/engine/tree/product_training/05_select.ts
src/engine/tree/product_training/06_prune.ts
src/engine/tree/product_training/run_cycle.ts
scripts/tree_product_training/check_cycle.ts
```

Do not add competing optimizer commands. `run_cycle.ts` remains the sole unattended entry.

Add focused tests/checks for:

```text
correct controllable ratio and budget direction for Gift Jungle / All2Rush / Laddersel / SpringSword
no calculator-controlled spatial mutation
all Stage A/B/C records have exact 7x2 coverage and correct total games
stage promotions recompute from source-relative score
three-attempt episode requirement before operator de-prioritization or multi-monster escalation
all2rush neutral panel-underperformer classification
one-game task granularity and two-candidate queueing
CPU/in-flight telemetry presence and no fabricated target claim
same cycle rerun remains idempotent
aggregate-only labels remain present; no promotion/integration field or action
```

## Acceptance

- [ ] Correct controllability semantics drive actual policy and catalog values.
- [ ] Gift Jungle receives high spatial opportunity; All2Rush and Laddersel receive low spatial opportunity.
- [ ] Every new early screen covers all 7 opponents and both sides.
- [ ] Candidate sources get a three-attempt optimization episode before any operator-family de-prioritization/escalation.
- [ ] New screen tasks are one-game granular and sustain a measured CPU target honestly.
- [ ] Stage A/B/C records and transitions are deterministic, resumable, and separately auditable.
- [ ] Pruning retains aggregate heuristic labeling.
- [ ] No source retirement, Tier/apply/deploy/publish, or automatic game integration.

## Delivery

Write `TASKS/tree/T039.report.md` with implementation/check commands; corrected controllability table; classification and episode ledger; Stage A/B/C counts/results; full-panel proof; CPU/in-flight telemetry; multi-monster eligibility decisions; aggregate heuristic pruning records; catalog schema/labels; cursor/resume proof; and no-apply confirmation. Commit/push only `agent/tree`.
