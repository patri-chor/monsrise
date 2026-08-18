# Active Product-Path Training Map

This is the operational entry point for tree training. Read this file before starting or reviewing any tree optimization work.

## Current Status

```text
Authoritative execution path: playFullGame + declarative Evol tree strategy
Authoritative evidence: PRODUCT_PATH_FORMAL_SCREEN_T035_V1
Parallel scheduler: PersistentSimPool worker pool
Worker configuration recorded by T035: 32 configured / 32 observed
Current active execution task: T036 Product-Path Foundation and Gift Jungle Eight-Monster Repair
Execution chain: T036 foundation -> T037 screen/check chain -> T038 adaptive loop
Tier 1: frozen current 11 formations
Tier 2: none
Automatic apply/deploy: prohibited
```

`gift_jungle` is repaired in place by T036 to exactly eight monsters through one addition only: `116` with badges `[3, 5]`. After its new product-path baseline, it is an executable optimization source. The pre-T036 seven-monster T035 evidence remains historical-only and fingerprint/protocol-separated.

## One Formal Call Path

```text
T036 candidate generator
  -> validateTreeDeckCoherence + canonical novelty check
  -> product_path screen request
  -> PersistentSimPool dispatches bounded worker tasks
  -> fine_grained_worker product_path task
  -> playFullGame
  -> product_tree_strategy produces declarative intents
  -> product-owned placement, budget, relocation, battle, scoring, trace
  -> append-only product_path_t036 evidence
```

Formal evidence must use this path only. `arena.ts -> playSpecVsSpec` is `SANDBOX_ONLY_DEPRECATED` and must fail before worker startup for any formal request.

## Primary Execution Files

| Role | File |
|---|---|
| Real battle lifecycle and deployment strategy contract | `src/engine/play_full_game.ts` |
| Evol tree to declarative product intents | `src/engine/tree/product_tree_strategy.ts` |
| Product-path formal screen runner | `src/engine/tree/product_path_screen.ts` |
| Worker product-path task | `src/engine/tree/fine_grained_worker.ts` |
| Parallel worker scheduler, errors, manifests | `src/engine/tree/persistent_pool.ts` |
| Tree/deck legality and calculator-controlled-position rules | `src/engine/tree/evol_gene.ts`, `src/engine/tree/order_search.ts`, `src/engine/tree/tree_ops.ts` |
| Runtime four-cost trace gate | `src/engine/tree/four_cost_fidelity_gate.ts` |
| Current continuous optimization specification | `TASKS/tree/T036-product-path-continuous-tree-optimization.md` |

## Authoritative Evidence

| Evidence | Location | Meaning |
|---|---|---|
| Product-path baseline/candidate screen | `tests/fixtures/tree/experience_library/product_path_t035/` | Current verified starting data: 10 baselines, 60 retained candidate IDs, 9,800 raw cells, 64 four-cost trace records. |
| Product-path T035 report | `TASKS/tree/T035.report.md` | Summary only; raw JSONL above is authoritative. |
| Historic sandbox records | `tests/fixtures/tree/experience_library/` and `product_path_t032/` | Retain for audit only. Do not use for selection, promotion, or score comparison. |
| T035 duplicate map | `product_path_t035/candidate_registry.jsonl` | Ten canonical duplicate/no-op groups. Those IDs receive no independent optimization or mixed-pool exposure. |

Historical T014-T027 and T032 aggregate results have this status:

```text
SANDBOX_ENGINE_UNVERIFIED_PRE_T032
```

They are not deleted, but they are not optimization inputs.

## T035 Facts To Use

```text
Protocol: PRODUCT_PATH_FORMAL_SCREEN_T035_V1
10 source baselines + 60 existing candidate IDs
70 entities x 140 cells = 9,800 product-path cells
7 held-out opponents x 2 actual sides x 10 games/cell
0 worker errors
all entities have nonempty teams and actual deployments on both sides
four-cost: 64/64 trace-backed PASS
```

T035 is a one-schedule screen. It is sufficient for discovery and source-relative screening, not Tier 2 promotion.

## Optimization Factors And Order

### 1. Hard validity gates

Reject before simulation when any condition fails:

```text
not exactly 8 monsters for a new candidate
gift_jungle modified beyond the one allowed in-place addition of 116 [3,5]
invalid/deep-incoherent Evol tree
calculator-controlled position moved outside an approved formation transform
duplicate canonical fingerprint
missing authority artifact/protocol identity
old arena formal execution request
```

### 2. Canonical novelty and coverage

Prioritize mutations that cover untested real product-path behavior:

```text
spatial_local: legal ordinary-monster coordinates only
formation_transform: separately declared legal translation/mirror/pattern flip
strategy_schedule_branch: cross-round timing + deck/badge + R1/R2+ branch together
multi_monster_exploration: only after repeated single-operator failures
```

Same-round placement-array order is not an optimization operator: all valid round actions load before battle. `side` is an optional branch condition and mandatory two-side evaluation dimension, never a one-sided score-selection shortcut.

Record parent fingerprint, mutation operator, affected node/round/path, transform mapping where relevant, and prior coverage. A cosmetic ID change is not a new candidate.

### 3. Adaptive source allocation

T038's unattended cycle adapts the search budget:

```text
mature / strong source: mostly one-change spatial, transform, or strategy candidates
early / weak / unexplored source: start single-change; escalate to seeded 2-4-change exploration only after recorded failures
calculator-controlled-heavy source: reduce spatial budget by controllable placement ratio; use strategy/transform budget instead
```

Saturated sources cannot dominate simply from a 100% held-out score. Every source retains a novelty floor.

### 4. Product-path screen

For each unique legal candidate:

```text
7 held-out families x 2 actual sides x 10 games = 140 games
```

Persist each cell's seed, side, opponent, W/D/L, team validation, trace hash, placements, branch information, budget information, completion state, and manifest identity.

The screen decision is source-relative:

```text
candidate delta = candidate score - matched own-source baseline score
```

Raw cross-source score is not an improvement metric.

After a conditional frontier is selected, product-path post-pruning tests each nonempty branch against a matched branch-removed candidate. Prune only when removal causes no material source-relative or weakest-side regression. Legacy `prune.ts` and `prune_branch.ts` remain sandbox-only because they use arena.

### 5. Independent high-sample verification

Candidates with positive source-relative delta, or materially new behavior from a saturated source, advance to:

```text
7 families x 2 sides x 25 games x 3 independent schedules = 1,050 games
```

Compare to their own source baseline under the same schedules. Require complete evidence, zero errors, positive lower uncertainty bound, no material schedule regression, and no material independent-panel regression.

### 6. Mixed-style pool

The pool is a generalization/ecology measurement, not a promotion shortcut.

Include one representative per canonical fingerprint:

```text
all frozen Tier 1 formations
unique product-path frontier signals
future independently verified candidates
```

Use smoothed selection weights:

```text
55% confidence-adjusted source-relative strength
25% uncertainty/exploration bonus
20% source/style diversity bonus
```

Enforce source exposure floors and ceilings. Record match probability components, source/candidate fingerprints, sides, seeds, W/D/L, and trace hashes.

### 7. Recommendation only

`PROMOTION_SUPPORTED` can be suggested only after the three-schedule source-relative evidence and independent panel pass. It never modifies Tier 1, applies a formation, deploys a bundle, or changes the active game without a separate integration decision.

## What Not To Use For Formal Decisions

| Area | Status |
|---|---|
| `src/engine/tree/arena.ts` / `playSpecVsSpec` | Sandbox diagnostic compatibility only; prohibited for formal runs. |
| Old T014-T027 score tables and T026 H2H matrix | Historical sandbox evidence only. |
| T032 aggregate-only results | Retained, but superseded by instrumented T035 evidence. |
| `round_robin_optimization/pruning_summary.json` | No-effect historical output; do not use as optimization evidence. |
| Candidate IDs alone | Not identity. Use canonical tree/deck fingerprint. |

## Resumption Rules

1. Read the relevant `product_path_t036/cursor.json` and manifest before resuming.
2. Resume only if protocol, authority artifact hash, execution semantics, strategy adapter version, fingerprint, schedule, side, seed, and code commit match.
3. Write append-only cells and traces; replace only the cursor atomically.
4. Worker exceptions are errors, never losses.
5. Keep outer candidate concurrency at or below two; record configured and observed worker-pool concurrency.
