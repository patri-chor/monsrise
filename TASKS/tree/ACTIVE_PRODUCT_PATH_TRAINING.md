# Active Product-Path Training Map

This is the operational entry point for tree training. Read this file before starting or reviewing any tree optimization work.

## Current Status

```text
Authoritative execution path: playFullGame + declarative Evol tree strategy
Authoritative evidence: PRODUCT_PATH_FORMAL_SCREEN_T035_V1
Parallel scheduler: PersistentSimPool worker pool
Worker configuration recorded by T035: 32 configured / 32 observed
Current active execution task: T036
Tier 1: frozen current 11 formations
Tier 2: none
Automatic apply/deploy: prohibited
```

`gift_jungle` remains a frozen seven-monster Tier 1 legacy baseline. Do not add an eighth monster and do not generate descendants.

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
legacy gift_jungle descendant
invalid/deep-incoherent Evol tree
calculator-controlled position moved
duplicate canonical fingerprint
missing authority artifact/protocol identity
old arena formal execution request
```

### 2. Canonical novelty and coverage

Prioritize mutations that cover untested real product-path behavior:

```text
legal ordinary-monster coordinates
within-round placement order
branch conditions and branch paths
cross-branch placements
legal reserve/substitute changes
```

Record parent fingerprint, mutation operator, affected node/round/path, and prior coverage. A cosmetic ID change is not a new candidate.

### 3. Source-balanced search allocation

Per resumable T036 cycle:

```text
50% current source-local frontier deepening
30% source-balanced novel variants
20% underrepresented branch/route/source exploration reserve
```

A saturated source is not allowed to consume the budget just because it scores 100% on the current held-out panel.

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
