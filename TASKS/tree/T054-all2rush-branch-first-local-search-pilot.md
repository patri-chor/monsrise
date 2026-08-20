STATUS: OPEN
DOMAIN: tree

# T054 - All2Rush Branch-First Local Search Pilot

## Objective

Use `all2rush` / 全二冲 as the only pilot lineage for a branch-first optimizer.

The current global-cycle optimizer generates one trivial T0 mutation (move the first R1 placement right one cell) and evaluates it on a broad L2 panel. This is insufficient for converting known weak matchups into targeted solutions.

The new pilot must follow this order:

```text
lost local game
-> identify earliest meaningful loss round
-> fixed-case multi-variable local search
-> preserve each local solution as a highly specific legal branch
-> identical label: execute the proven branch first
-> similar label: use the branch as a warm start for a small local search
-> accumulate branches
-> attempt shared decision-prefix merge
-> validate merge on covered cases
-> prune only duplicate/dominated/illegal branches
```

Do not directly replace the global main tree because one fixed case succeeds.

## Scope

Pilot only:

```text
root lineage: all2rush
current exact active snapshot selected through SnapshotResolver
```

Do not change R0, global Score70 policy, dynamic tier thresholds, opponent-pool policy, player history, UI deployment, or other root lineages.

All simulation must use:

```text
PersistentSimPool
-> fine_grained_worker(product_path)
-> playFullGame
-> product_tree_strategy
```

Do not use `arena.ts`, `playSpecVsSpec`, old hill-climb evidence, hand-authored aggregate outcomes, or root fallback.

T053R payload-identity requirements remain mandatory. If its product task/result identity propagation is not available yet, implement only the pilot primitives and deterministic diagnosis; do not claim product evidence acceptance.

## A. Establish Deterministic Fixed-Case Contract

Before using one-game local search, test and record whether a fixed case is reproducible:

```text
same all2rush exact snapshot
same opponent exact snapshot
same side
same seed
same policy fingerprint
same product artifact version
```

Required checks:

```text
1. direct playFullGame repeated at least 10 times in one process
2. same task repeated in one persistent worker
3. same task across at least two persistent workers
4. same task after pool destroy/recreate
```

Compare exactly:

```text
winner
roundResults
accepted deployment trace / branch IDs / planned and actual coordinates
round observation sequence
```

If any differ, `SINGLE_CASE_UNSTABLE` and do not use a one-game accept rule. Report the smallest stable repeat count actually observed; do not guess.

## B. Loss-Case Diagnosis

For current all2rush active exact snapshot, run a bounded diagnostic panel against its worst current product-path opponents.

For every loss or draw selected for search, store a `LossCase`:

```text
case ID
target/opponent formation IDs
both exact payload fingerprints and calculator-policy fingerprints
side, seed, product/manifest revision
winner, roundResults
earliest meaningful losing round R
pre-R legal observation sequence
candidate branch decisions/deployment trace through R
opponent visible hand/badge/board facts at R
```

Choose at most:

```text
3 opponent snapshots
2 fixed loss cases per opponent
```

The loss round cannot use future opponent information. R1 conditions use only revealed hand/badges; R2+ may also use current board.

## C. Fixed-Case Multi-Variable Local Search

For each LossCase, hold constant:

```text
opponent exact payload
side
seed
all pre-R state
```

Generate at most 48 unique, legal behavior-fingerprint candidates. Each candidate must modify 1 to 3 variables, including at least one decision at R:

```text
placement x/y for a legally deployable monster
same-round deployment order
a legal R+1/R+2 timing or placement change
one allowed CalculatorContextPolicy value from the existing typed whitelist
an exact, serializable branch subtree only when its AST is complete
```

Use random-combination sampling with a fixed recorded search seed, not Cartesian explosion. Reject duplicate behavior fingerprints before simulation.

For stable fixed cases, one product game per candidate is allowed only for discovery. Record actual W/D/L; retain candidates that improve:

```text
L -> D
D -> W
L -> W
```

Do not call a repeated run of the identical seed a new sample.

## D. Branch-First Preservation and Reuse

For every retained local solution:

1. Infer the most specific **legally visible** feature/layout mask at round R.
2. Store it as `EXACT_CASE_BRANCH`, containing:

```text
condition mask
optional canonical visible-layout signature
fork round
exact branch subtree/policy delta
source loss case IDs
solution behavior fingerprint
fixed-case W/D/L result
```

3. Main branch must remain byte-for-byte behavior-equivalent.
4. Exact same visible label/layout hits execute `EXACT_CASE_BRANCH` before the default branch.
5. Similar but non-identical labels do not silently execute the exact branch as accepted policy. Use it as a warm-start seed for a bounded local search and create a sibling/expanded branch only with product evidence.

No conditions may include seed, opponent identity, future hand, future board, final outcome, or hidden state.

## E. Branch Merge and Late Pruning

Do not discard local branches early merely because they have narrow coverage.

After at least two exact-case branches exist, attempt merge only when:

```text
conditions can be legally generalized
and
their decision sequence has an identical executable prefix
```

Create `MERGED_PREFIX_BRANCH`:

```text
shared coarse condition + shared R..K decision prefix
then retain finer sibling branch choices later where necessary
```

Validate merged coverage on every source LossCase before accepting it. Do not merge solely because labels sound similar.

Prune only:

```text
identical condition + behavior fingerprint duplicates
behavior duplicates already represented by another branch
branches dominated on every validated covered case by a legal broader branch
branches dependent on non-visible/future state
```

Pruned branches become `PRUNED_HISTORICAL`, retaining references to trial snapshots and evidence; do not delete them.

## F. Small-Sample and Global Guardrails

One stable fixed-case game proves only a local discovery result. It does not change global main, tier, or L1 weight.

For an exact branch to be marked executable pilot evidence:

```text
repeat on its source case after fresh worker/pool boundary
and verify exact label is visible at the fork round
```

For a generalized/merged branch:

```text
validate all originating source cases plus at least one distinct matching or near-matching visible case when available
```

Global main adoption remains separate and requires current paired Active-L2 evidence.

## G. Evidence and Audit

Create revisioned append-only pilot artifacts, segregated from aggregate score ledgers:

```text
all2rush_fixed_case_determinism.jsonl
all2rush_loss_case_inventory.jsonl
all2rush_local_search_trials.jsonl
all2rush_branch_library.jsonl
all2rush_branch_merge_prune_audit.jsonl
```

Each product record must include T053R-style target/opponent payload identity fields. Do not write fake or aggregate-only W/D/L as fixed-case evidence.

## Acceptance

- [ ] Determinism is experimentally measured across direct, same-worker, cross-worker, and recreated-pool runs.
- [ ] At least one real all2rush loss/draw case is diagnosed from product traces without future-information leakage.
- [ ] Fixed-case search tries multiple unique 1-3 variable combinations, with exact trial records.
- [ ] At least one found local solution is preserved as a legal exact-case branch, or the report states no solution with exact candidate/trial counts.
- [ ] Exact label reuse and similar-label warm-start are demonstrably distinct.
- [ ] Merge/prune logic retains narrow useful branches until evidence supports merger/pruning.
- [ ] No fixed-case result changes global main/tier/L1 by itself.
- [ ] No root fallback, no R0 mutation, no apply/deploy.

## Delivery

Write `TASKS/tree/T054.report.md` with deterministic experiment table; all2rush snapshot identities; loss-case inventory; candidate variable distribution and unique trial counts; local W/D/L outcomes; branch labels and legality proof; branch reuse/warm-start/merge results; artifact paths/counts; T053R dependency status; focused test output; no-apply confirmation; and changed files. Commit/push only `agent/tree`.
