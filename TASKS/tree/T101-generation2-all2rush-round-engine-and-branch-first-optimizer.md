STATUS: OPEN
DOMAIN: tree
SUPERSEDES: T054-all2rush-branch-first-local-search-pilot

# T101 - Generation 2: All2Rush Round Engine and Branch-First Optimizer

## Mandate

This is the Generation 2 optimization foundation. It absorbs all T054 requirements; do not implement T054 as an independent path.

The Generation 1 broad-panel optimizer is retained only for global rating/independent validation. Generation 2 discovery is concentrated on concrete lost cases:

```text
loss case
-> exact product-game state before earliest meaningful loss round R
-> round-local multi-variable search
-> preserve every local answer as a narrow legal conditional branch
-> exact visible-case branch reuse
-> similar-case branch warm start
-> accumulate, merge shared action prefixes, then prune
-> independent global validation only for main-tree promotion
```

Pilot lineage is strictly `all2rush` / 全二冲. Do not alter other root lineages, R0, global tier policy, web deployment, or player history.

## Non-Negotiable Architecture: Real Round Engine

Create a **single-round product battle execution engine**, but do not create a simplified duplicate combat simulator.

It must execute the same authoritative battle rules/state transitions as `playFullGame` and be usable as a resumable continuation:

```ts
createProductGameSession(...): ProductGameSession
session.captureCheckpointBeforeRound(round): ProductRoundCheckpoint
session.playRound(checkpoint, intentsA, intentsB): ProductRoundResult
session.restore(checkpoint): ProductGameSession
```

Required behavior:

```text
- initialize the same teams, badges, replay seed, budgets, hand/deck state,
  board state, game RNG state, cooldown/effect state, and product artifact
  as playFullGame;
- advance exactly one normal product round using existing authoritative game
  rules, strategy/deployment validation, combat, effects, and scoring;
- expose a serializable/checkable checkpoint immediately before each round;
- restore from a checkpoint without leaking state to another candidate;
- preserve fog-of-war/legal observation semantics;
- produce the same round result, accepted/rejected deployment trace, board,
  budget, hand state, and RNG continuation as an uninterrupted playFullGame.
```

Refactor shared `playFullGame` internals into reusable authoritative helpers if needed. Do not call `playFullGame` 50 times from the start of a game and call it a round engine. Do not use arena.ts, playSpecVsSpec, rule-random, or a separate approximation.

## A. Round Engine Fidelity Gate

Before local search, prove exact parity for at least all2rush versus two current exact product opponents, both sides, and multiple fixed seeds.

For every tested game:

```text
uninterrupted playFullGame
== session initialization + sequential single-round execution
```

Compare exactly:

```text
winner
p1/p2 score
roundResults
round-by-round accepted/rejected deployment traces
branch IDs and planned/actual coordinates
round observations
board / hand / budget state after every round
RNG continuation where representable
```

Also prove checkpoint replay:

```text
run through R-1 -> checkpoint
continue original through end
restore independent sessions from checkpoint -> continue through end
all outputs identical
```

Test isolation across at least two workers and after persistent pool destroy/recreate. If parity or determinism fails, stop local one-game adoption and report `ROUND_ENGINE_FIDELITY_BLOCKED` with a concrete diff; do not use the engine for evidence.

## B. Fixed Loss-Case Inventory

Using current exact all2rush snapshot and T053R product payload identities:

1. Find at most 3 current worst opponent snapshots.
2. For each, retain at most 2 loss/draw cases.
3. Locate the earliest meaningful losing round R from real product round results and traces.
4. Capture the exact pre-R `ProductRoundCheckpoint` plus a legal visible-context record.

Every LossCase contains:

```text
case ID
target/opponent IDs
both payload and calculator-policy fingerprints
benchmark/manifest/product revision
side, seed, round R
pre-R checkpoint fingerprint
round observations visible to all2rush through R
round results and trace through R
reason this is the selected loss point
```

R1 condition labels may use only revealed enemy hand IDs/badges. R2+ may additionally use current enemy board. Never use opponent ID, seed, future hand/board, future outcome, or hidden state as a runtime branch condition.

## C. Generation 2 Focused Multi-Variable Search

For each LossCase, restore the same pre-R checkpoint for every candidate.

Keep fixed:

```text
opponent exact payload
side
seed
pre-R checkpoint
pre-R legal observation
```

Sample at most 48 unique behavior fingerprints per case using a recorded search seed. Each candidate modifies 1 to 3 variables and must include an R decision. Select random combinations from a bounded legal variable catalog, not a Cartesian explosion:

```text
R placement x/y for legally available monster(s)
R same-round intent/deployment order
R+1 or R+2 placement/timing
one existing whitelist-constrained calculator context-policy value
one complete serializable branch-subtree action delta
```

All candidates require exact snapshot/payload fingerprint identity and legal product intent validation. Deduplicate before simulation.

When round-engine fidelity holds, one continuation game per unique candidate is permitted for discovery. This is where the cost falls from a broad panel:

```text
11 opponents x 2 sides x 5 games = 110 games/candidate
```

to one fixed continuation per candidate. The intended 50x budget is **50 distinct candidate combinations**, not replaying the same seed/candidate 50 times.

A discovery improvement is:

```text
L -> D
D -> W
L -> W
or a strictly improved round trajectory with unchanged final loss, retained only as a warm-start candidate
```

## D. Branch-First Library

Every local discovery answer is first stored, not globally applied.

Introduce branch states:

```text
EXACT_CASE_BRANCH
GENERALIZING_BRANCH
MERGED_PREFIX_BRANCH
PRUNED_HISTORICAL
```

`EXACT_CASE_BRANCH` must contain:

```text
parent exact snapshot fingerprint
solution behavior fingerprint
fork round
most-specific legal FeatureMask
optional canonical visible-layout signature
exact executable action subtree / policy delta
source LossCase IDs
fixed-case result and checkpoint evidence references
coverage / validation counters
```

Rules:

```text
- main/default tree remains behavior-equivalent;
- an exact matching visible label/layout selects the exact-case branch first;
- a similar but non-identical label treats the branch only as a warm-start
  candidate for a bounded new local search;
- it must not silently execute the narrow branch as a proven generalized rule.
```

Runtime matching order is specificity-first, then validated coverage, then local Score70/WDL. It must remain compatible with the existing `product_tree_strategy` legal visibility model.

## E. Branch Generalization, Prefix Merge, and Late Pruning

After two or more branches exist:

1. Compare their visible conditions and action sequences.
2. Attempt a merge only when a legal generalized condition exists **and** the branches share an identical executable decision prefix.
3. Create a `MERGED_PREFIX_BRANCH` for the common R..K prefix; retain narrower later sibling decisions where they differ.
4. Validate a merged branch on every source LossCase before accepting it.

Prune only after evidence:

```text
same condition + same behavior fingerprint
exact behavior duplicate represented elsewhere
strictly dominated on every verified covered case by a legal broader branch
requires non-visible/future state
```

Pruned records stay append-only as `PRUNED_HISTORICAL`; do not delete trial snapshots/evidence.

## F. Confirmation Boundaries

One stable fixed-case continuation is sufficient only for local discovery.

For an `EXACT_CASE_BRANCH` to be executable pilot evidence:

```text
repeat source case after a fresh worker/pool boundary
verify the feature/layout condition is legal and present at fork R
```

For `GENERALIZING_BRANCH` or `MERGED_PREFIX_BRANCH`:

```text
validate every originating case
plus at least one distinct matching or near-matching legal visible case when available
```

No fixed-case discovery or branch result alone may:

```text
replace global main tree
change T0/T1/T2/T3
change L1 weight
publish/deploy to game
```

Global main promotion remains an independent paired Active-L2 validation concern.

## G. Evidence

T053R-style dual payload identity propagation is mandatory for all product records. Create revisioned append-only artifacts:

```text
all2rush_g2_round_engine_fidelity.jsonl
all2rush_g2_loss_case_inventory.jsonl
all2rush_g2_local_search_trials.jsonl
all2rush_g2_branch_library.jsonl
all2rush_g2_branch_merge_prune_audit.jsonl
```

Each local trial must identify checkpoint, target/opponent payload/policy identities, variable set, behavior fingerprint, seed/side/R, W/D/L outcome, trace reference, and worker/product revision.

## Acceptance

- [ ] Single-round session/checkpoint engine is proven equivalent to uninterrupted product games for the defined test cases.
- [ ] Checkpoint restore is isolated and deterministic across worker/pool boundaries.
- [ ] At least one real all2rush loss/draw is represented by an exact pre-R product checkpoint.
- [ ] Fixed-case search evaluates multiple unique 1-3-variable combinations using continuations, not full game restarts.
- [ ] Local answers are stored as legal exact-case branches before any generalization/pruning.
- [ ] Exact labels reuse a branch; similar labels use it only as warm start.
- [ ] Merge requires shared executable prefix and validation; pruning is evidence-based and historical.
- [ ] No global/tier/L1/deployment change occurs from local pilot results.
- [ ] No old arena evidence or root fallback enters the pipeline.

## Delivery

Write `TASKS/tree/T101.report.md` with round-engine design/call path; parity and checkpoint-replay table; deterministic cross-worker results; all2rush snapshot identities; loss inventory; candidate variable distribution/count; discovery results; branch labels/visibility proof; reuse/warm-start/merge/prune results; evidence paths/counts; T053R dependency status; focused tests; no-apply confirmation; and changed files. Commit/push only `agent/tree`.
