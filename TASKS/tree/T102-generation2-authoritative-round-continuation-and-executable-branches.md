STATUS: DONE
DOMAIN: tree
SUPERSEDES: T101R-real-checkpoint-state-and-executable-branch-pilot

# T102 - Generation 2: Authoritative Round Continuation and Executable All2Rush Branches

## Purpose

T102 combines the unfinished T101 fidelity repairs with the next Generation 2 all2rush pilot capability. This is the sole next execution task; do not execute T101R separately.

The goal is an evidence-valid local optimizer:

```text
exact active snapshot loss case
-> authoritative product checkpoint before loss round
-> deterministic continuation search from that checkpoint
-> legal exact-case runtime branch
-> exact-label reuse / similar-label warm-start
-> evidence-backed prefix merge and late pruning
```

## Fixed Scope

```text
pilot lineage: all2rush only
no R0 mutation
no global main replacement
no dynamic tier/L1-weight change
no web or active-game deployment
no arena.ts/playSpecVsSpec/root fallback
```

Use only current exact snapshots through SnapshotResolver and the product path.

## 1. Authoritative Checkpoint Continuation

Replace the T101 reconstructed checkpoint approximation with an authoritative continuation mechanism sharing the actual `playFullGame` state transitions.

Checkpoint must include all future-affecting state:

```text
round/game-over state
scores and remaining budgets
hand/deck/reveal progression
all RNG continuation state
board monster runtime fields
status effects, cooldowns, shields, timers, target/state flags
persistent battle/effect state
strategy/policy identity
```

Do not reset effects, replace runtime state with defaults, or call a reset helper as a restoration substitute. If the current engine cannot serialize a state safely, add an internal authoritative clone/checkpoint facility rather than reconstructing an approximation.

Fingerprint every restored semantic field.

## 2. Strong Product Parity and Determinism

For all2rush against two exact active product opponents, both sides, four seeds:

```text
uninterrupted playFullGame
== sequential round session
== restored session from R1/R2/R3 checkpoint
```

Compare after every round:

```text
results, scores, budgets, hand/reveals, full board runtime state,
all trace fields, legal observations, RNG/checkpoint fingerprint
```

Also run a fixed case:

```text
same persistent worker
separate workers in a pool
pool destroy/recreate
```

using actual product worker tasks and T053R target/opponent payload identity fields. If not stable, mark `SINGLE_CASE_UNSTABLE` and do not use one-game discovery acceptance.

## 3. Exact Snapshot Loss Cases

Build loss cases only from active-library/manifest expected identities resolved through SnapshotResolver:

```text
library expected fp == resolved fp == prepared fp == task/result payload fp
```

Each loss case records exact pre-R checkpoint, legal observation, side, seed, product revision, both payload/policy fingerprints, and round trace. No FORMATION_LIBRARY fallback for active pilot payloads.

## 4. Seeded Legal Multi-Variable Continuation Search

From each exact checkpoint, build a legal variable catalog and sample up to 48 unique behavior fingerprints using a persisted search seed.

Each candidate changes 1..3 variables and includes an R action:

```text
legally available R placements
R deployment order
legal R+1/R+2 actions
whitelisted typed calculator-policy values
complete serializable branch AST delta
```

Record legal-space size, selected variables, behavior/policy fingerprints, and one continuation result per candidate. One-game discovery is allowed only after determinism passes.

## 5. Executable Branch-First Runtime

For each local improvement:

```text
- derive FeatureMask from actual legal observation at actual fork R;
- optionally derive a visible-layout signature only from allowed visible facts;
- compile delta to executable EvolFormation subtree;
- prove product_tree_strategy selects stored branch ID for the source case;
- prove same exact label/layout reuses branch first;
- prove similar-but-not-identical case does not auto-execute narrow branch,
  but receives it as warm-start input to bounded local search.
```

## 6. Safe Merge and Prune

A merged prefix requires same parent snapshot, legal generalized condition, identical executable prefix, and continuation validation on every source loss case.

Never broaden to an empty/default condition absent explicit source-case plus default-regression evidence. Keep failed merge candidates as separate exact branches.

Prune only exact behavior duplicates, proven dominated legal branches, or non-visible/future-state branches. Preserve pruned trial evidence as historical.

## 7. Evidence

Write revisioned append-only T102 artifacts for fidelity, loss cases, trials, branch library, merge/prune audit. Every product record must include T053R dual payload/policy identities, checkpoint fingerprint, worker/product revision, side/seed/round, and W/D/L reconciliation.

## Acceptance

- [ ] Checkpoint is a full authoritative continuation, not reconstructed partial state.
- [ ] Per-round parity and checkpoint replay pass on specified matrix.
- [ ] Worker/cross-worker/recreated-pool determinism is measured.
- [ ] Pilot uses exact active snapshots and full payload identity chain.
- [ ] Search is seeded, random, legal, and accounts for its unique candidate space.
- [ ] At least one stored branch executes in product_tree_strategy for exact source label, or evidence states no local answer.
- [ ] Exact reuse and similar warm-start are distinct and tested.
- [ ] Merge/prune is source-case validated and never silently broadens to default.
- [ ] No global/tier/L1/deployment changes.

## Delivery

Write `TASKS/tree/T102.report.md` with state coverage, parity/determinism matrices, exact snapshot identities, loss/trial counts, branch execution proof, merge/prune results, evidence paths/counts, T053R status, tests, no-apply confirmation, and changed files. Commit/push only `agent/tree`.
