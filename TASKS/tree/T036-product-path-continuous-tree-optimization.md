STATUS: SUPERSEDED_BY_PHASED_T036_T038
DOMAIN: tree

# T036 - Continuous Product-Path Tree Optimization and Mixed-Style Pool

> Superseded before execution by the phased implementation chain: `T036-product-path-foundation-and-gift-repair.md`, T037, then T038. Retained as historical planning only; do not execute.

> Domain: `tree` | Executor branch: `agent/tree`
> User-authorized execution task. Use only the verified product-path evaluator: `playFullGame + declarative tree strategy`, scheduled through `PersistentSimPool` workers. Never use the deprecated arena runner for formal evidence.
> No active bundle apply, deploy, or automatic Tier 1/Tier 2 replacement.

## Verified Starting Evidence

T035 is the first complete auditable product-path screen:

```text
Protocol: PRODUCT_PATH_FORMAL_SCREEN_T035_V1
10 baselines + 60 retained candidate IDs
70 entities × 140 raw cells = 9,800 cells
7 held-out opponents × 2 actual sides × 10 games
0 worker errors
64/64 individual four-cost product traces PASS
both sides have nonempty teams and accepted deployment evidence
```

The data is available under:

```text
tests/fixtures/tree/experience_library/product_path_t035/
```

Historic T014-T027 and T032 aggregates remain retained but must not drive selection:

```text
SANDBOX_ENGINE_UNVERIFIED_PRE_T032
```

## Important T035 Interpretation

1. Do not treat raw cross-source score as improvement. Compare candidates to their own source baseline using matched protocol/schedules.
2. Ten canonical duplicate/no-op groups exist. Existing duplicate IDs remain historical inventory but must not receive separate search budget or mixed-pool exposure.
3. Some sources already score 100% against the current held-out panel (`springsword`, `nutsavior`, `golden_boom` baselines). A 100% descendant of such source is **not an improvement** and cannot be promoted on this panel. It requires an expanded/independent generalization panel.
4. T035 one-schedule 140-game screen is discovery evidence, not Tier 2 admission.
5. Current tiers remain:

```text
Tier 1: frozen current 11 formations, including legacy 7-monster gift_jungle
Tier 2: none
Tier 3: none admitted; product-path frontier candidates are EXPLORATORY signals
```

## Objective

Build a resumable continuous optimizer that explores previously untested legal tree placement/order/branch variants on verified product path, maintains source diversity, and evaluates a mixed-style pool without rewarding duplicate/no-op variants or merely saturated held-out scores.

## A. Search Inventory and Mutation Discipline

1. Build `product_path_t036/coverage_registry.jsonl` from T035 fingerprints and raw traces. For each source/unique candidate record:

```text
canonical team/tree fingerprint
covered node/round/condition/placement coordinate
covered deployment order
covered branch decision
coverage count and source schedule
```

2. Generate only legal, canonical-novel variants. Mutation operators must be explicit and traceable:

```text
untested legal coordinate changes for ordinary controllable monsters
within-round placement-order changes
branch condition/path alternatives
cross-branch placement alternatives
legal reserve/substitute changes when present
```

3. Do not move calculator-controlled positions; use existing authoritative irrelevance rules.
4. Validate `validateTreeDeckCoherence` and all deep tree legality before simulation.
5. Exact eight-monster rule for new candidates. Preserve `gift_jungle` as the frozen seven-monster legacy baseline: no eighth monster and no descendants.
6. Exclude canonical duplicates/no-ops before any screen. Store rejected duplicates with `duplicateOf` and mutation reason for audit.

## B. Balanced Continuous Search Budget

Each resumable cycle must allocate candidate slots by policy, not raw score alone:

```text
50% source-local frontier deepening (untested positions/orders/branches)
30% source-balanced novel variants (at least one opportunity per executable source while unexplored mutations remain)
20% exploration reserve for underrepresented routes/branches/sources
```

- Saturated sources (baseline score 100% on the held-out panel) may receive discovery budget but may not crowd out other sources via score-weighted selection.
- Record selection rationale, novelty measure, parent fingerprint, source, and operator.
- Keep outer candidate concurrency <=2 and retain worker-pool parallelism. Record configured/observed worker counts.

## C. Product-Path Screening and Source-Relative Gate

1. Every new unique candidate initially receives a complete product-path screen:

```text
7 held-out families × 2 actual sides × 10 games = 140 games
```

with per-cell seed, both-side trace links, team validation, branch/placement/budget events, protocol manifest, and atomic cursor.

2. A candidate may be `PRODUCT_PATH_FRONTIER_SIGNAL` only if:

```text
complete 140 cells
0 worker errors
all required trace evidence
unique canonical fingerprint
source-relative delta >= 0 on matched T035 baseline panel
```

3. Any candidate with a positive source-relative delta, or any candidate from a saturated source that differs materially in behavior, proceeds to an independent three-schedule verification. Use new non-overlapping schedules:

```text
7 families × 2 sides × 25 games × 3 schedules = 1,050 games/candidate
```

Run matched same-source baseline in the same schedules if an equivalent product-path baseline evidence is absent.

4. `PROMOTION_SUPPORTED` is only possible with:

```text
unique fingerprint
0 errors / complete evidence
positive lower uncertainty bound of source-relative delta
no schedule materially below source baseline
independent strong/current panel has no material regression
```

Even `PROMOTION_SUPPORTED` is a recommendation only; it does not alter Tier 1 or apply any formation.

## D. Mixed-Style Pool

Build a separate product-path mixed-style pool with one representative per canonical fingerprint, containing:

```text
all frozen Tier 1 baselines
all unique PRODUCT_PATH_FRONTIER_SIGNAL candidates
any future verified promotion candidates
```

1. Every match draws one candidate/opponent using smoothed weights:

```text
0.55 × confidence-adjusted source-relative strength
+ 0.25 × uncertainty/exploration bonus
+ 0.20 × source/style diversity bonus
```

2. Enforce source exposure floors and ceilings. No source or duplicate fingerprint may dominate the pool solely due to a saturated 100% held-out score.
3. Record exact sampling probability components, selected IDs/fingerprints, sides, seeds, W/D/L, deployment trace hashes, and coverage counts.
4. Pool score is ecology/generalization evidence only; it never replaces matched same-source promotion evidence.

## E. Artifacts and Resumption

Append all evidence under:

```text
tests/fixtures/tree/experience_library/product_path_t036/
```

Required artifacts:

```text
manifest.json
coverage_registry.jsonl
candidate_registry.jsonl
screen_cells.jsonl
screen_observations.jsonl
three_schedule_cells.jsonl
mixed_pool_matches.jsonl
mixed_pool_rankings.json
source_frontiers.json
promotion_recommendations.jsonl
cursor.json
README.md
```

All writes append-only or atomic cursor replacement. Observation identities include execution semantics, manifest hash, canonical fingerprint, schedule, side, seed, opponent, and code commit. Never overwrite T035 or historical data.

## Acceptance

- [ ] All new formal tasks use verified product path and pooled parallel workers; deprecated arena formal path fails closed.
- [ ] New candidates are legal, exact-eight, coherent, canonical-novel, and source-diverse; legacy gift_jungle unchanged.
- [ ] Per-cell product-path evidence supports every new screen score.
- [ ] Source-relative rather than raw cross-source scores drive frontier/promotion decisions.
- [ ] Three-schedule verification and mixed-style pool are separately auditable.
- [ ] Duplicate/no-op candidates do not consume independent search/pool budget.
- [ ] No Tier/apply/deploy change.

## Delivery

Write `TASKS/tree/T036.report.md` with code/test commands, manifest, worker concurrency, selection/novelty ledger, coverage changes, screen/three-schedule tables, mixed-pool exposure and matchup results, source-relative deltas, duplicate exclusions, recommendations (not applications), cursor, and explicit no-apply confirmation. Commit/push only `agent/tree`. Do not modify this specification.
