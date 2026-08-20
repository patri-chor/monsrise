STATUS: OPEN
DOMAIN: tree

# T101R - Real Checkpoint State and Executable Branch Pilot

## T101 Verification Result: Rework Required

T101 focused tests pass:

```text
t101_round_engine_fidelity: 1/1
t101_loss_case_and_branch_optimizer: 1/1
```

They do not establish the actual T101 acceptance contract. The current implementation has material gaps, so its round-engine/local-branch results must be treated as `ROUND_ENGINE_UNVERIFIED_PRE_T101R`, not optimization evidence.

## Verified Failures

### A. Checkpoint state is incomplete and restore is not a faithful continuation

`product_round_session.ts` checkpoint/restore currently:

```text
- does not restore p1/p2 remaining budget in syncToGameEngine;
- serializes statusEffects as [] on restore;
- resets state to idle and calls resetBoardForNextRound after reconstruction;
- captures several monster values from static data / zero values instead of
  asserting the complete runtime state transition contract;
- checkpoint fingerprint omits budget and most combat/state fields.
```

A final winner/score match over 16 cases is not sufficient evidence of exact pre-R continuation.

### B. Required worker/pool determinism was not tested

T101 report claims cross-worker/pool behavior, but `t101_round_engine_fidelity.test.ts` invokes only direct in-process `ProductGameSession` / `playFullGame`. It has no `PersistentSimPool`, no two-worker comparison, and no destroy/recreate-pool test.

### C. Pilot does not use exact active snapshots

`loss_case_inventory.ts` and `branch_first_optimizer.ts` resolve `all2rush` and opponents from `FORMATION_LIBRARY`, not through `SnapshotResolver` with current active-library/pinned payload fingerprints. This violates the current identity chain and can evaluate an R0/root payload instead of the current dynamic snapshot.

### D. Candidate search is not the required random multi-variable search

Current generation deterministically changes the first placement and emits only a fixed small pattern (reported 8 + 3 + 3), despite a max of 48. It does not:

```text
- sample combinations from a bounded variable catalog with a recorded seed;
- vary which legally deployable monster/action is selected;
- include deployment-order variables;
- use exact complete branch AST delta only;
- prove each variable count/action is legal in the actual LossCase checkpoint.
```

### E. Branch-first runtime behavior was not implemented

The current branch record is audit-only:

```text
- condition is hard-coded (`main: fullrush`, optionally `drill`), not inferred
  from the recorded legal observation;
- no optional visible-layout signature;
- exact label reuse is not wired into product_tree_strategy;
- similar labels do not warm-start a bounded search;
- stored action delta is not proven to compile into / execute as a legal tree branch.
```

### F. Merge is unsafe and unvalidated

`mergeAndPruneBranches()` creates a merge with `emptyMask()` solely because first-round placements stringify equally. It neither proves a legal generalized condition nor executes the merged branch on all source LossCases. This can make a narrow counter run universally.

## Scope

Repair only Generation 2 all2rush pilot. Do not alter R0, tier policy, Score70, global promotion, L1 weights, web deployment, or other roots. Do not use arena.ts or root fallback.

T053R exact target/opponent product payload identity requirements are mandatory.

## A. Faithful Authoritative Checkpoints

Refactor/checkpoint the actual authoritative product state, not an approximation.

A checkpoint must capture and restore every state that can affect any future product round, including at minimum:

```text
round and game-over state
both scores and both remaining budgets
team/hand/deck/reveal progression
replay RNG state and all game RNG sources used by continuation
all board-monster runtime fields
status effects, cooldown/skill state, shield, timers, targeting/state flags
battle-system state that survives a round, if any
product strategy identity and necessary policy state
```

If an existing authoritative state cannot safely be serialized/restored, expose an internal authoritative clone/checkpoint mechanism rather than guessing fields or resetting them. Do not call `resetBoardForNextRound()` as a substitute for restore unless the uninterrupted product path performs that exact transition at the same point.

Checkpoint fingerprint must cover every restored semantic field, not just positions/team/round score.

## B. Strong Fidelity Tests

Compare uninterrupted `playFullGame` and sequential session round-by-round, both sides, against at least two exact all2rush opponents and four seeds.

After every round compare exact normalized:

```text
round results
p1/p2 score and remaining budget
hands/revealed state
board including every runtime monster/effect/cooldown field
all deployment trace fields, not a subset
all legal observations
RNG continuation/checkpoint fingerprint
```

For at least R1/R2/R3 checkpoints:

```text
original session continuation
fresh restored continuation #1
fresh restored continuation #2
```

must be equal through final result and per-round state.

Add actual product worker determinism coverage:

```text
same fixed all2rush case repeated in one worker
same case assigned to two distinct PersistentSimPool workers
pool destroy/recreate then rerun
```

Compare product trace/outcome and all returned T053R payload identity fields. If any differ, mark `SINGLE_CASE_UNSTABLE`; local one-game discovery is blocked.

## C. Exact Snapshot-Based All2Rush Cases

Use SnapshotResolver and active-library/pinned manifest records for all2rush and every opponent. A loss case must carry/verify:

```text
active-library expected fingerprint
resolved snapshot fingerprint
prepared payload fingerprint
policy fingerprint
```

No `FORMATION_LIBRARY` lookup may define the evaluated all2rush/opponent payload, except as immutable R0 source resolution where explicitly pinned as R0.

## D. Actual Fixed-Case Random Variable Search

Build a bounded legal variable catalog from the pre-R checkpoint. Candidate generation must:

```text
- use a persisted search seed;
- randomly sample 1..3 variables without Cartesian enumeration;
- attempt up to 48 unique behavior fingerprints, or report precise legal-space exhaustion;
- choose from legally actionable monsters/placements/orders at R;
- optionally choose R+1/R+2 legal actions;
- use typed whitelist calculator-policy values;
- use only exact serializable branch AST changes;
- validate candidate intents against the checkpoint before continuation.
```

Persist selected variables/action deltas and candidate behavior/policy fingerprints per trial.

## E. Compile Branches Into Runtime and Prove Reuse

For every local answer:

1. Derive FeatureMask from actual LossCase legal observation, at its actual fork round; do not hardcode an archetype/key.
2. If used, derive a canonical visible-layout signature only from legally visible hand/badge/board information.
3. Compile the action delta into an `EvolFormation` child subtree compatible with `product_tree_strategy`.
4. Prove on source case that runtime selects the stored exact branch ID and reproduces its recorded local result.
5. Add branch-selection behavior:

```text
exact same legal label/layout -> exact-case branch selected first
similar but non-identical label/layout -> no automatic exact branch execution;
                                      expose branch as warm-start input only
```

Demonstrate both with product-path tests.

## F. Safe Merge/Prune

A merge requires:

```text
at least two branches
same parent snapshot
legal generalized condition derived from source observations
identical executable action prefix
product continuation validation on every source LossCase
```

Do not use `emptyMask()` unless every source case and a representative default-case regression test justify a universal branch, which is not expected for this pilot.

On merge failure retain the exact branches. Prune only proven behavior duplicates, proven dominated branches, or illegal/future-state branches. Persist source references and reasons.

## G. Evidence

Replace/append revisioned evidence with:

```text
all2rush_g2r_round_engine_fidelity.jsonl
all2rush_g2r_loss_case_inventory.jsonl
all2rush_g2r_local_search_trials.jsonl
all2rush_g2r_branch_library.jsonl
all2rush_g2r_branch_merge_prune_audit.jsonl
```

Every record carries task-level target/opponent payload and policy identity fields per T053R, checkpoint fingerprint, product revision, side/seed/fork round, and raw W/D/L reconciliation.

## Acceptance

- [ ] Checkpoint is an exact authoritative continuation, not a reconstructed approximation.
- [ ] Round-by-round full-state, trace, observation, and checkpoint replay parity pass.
- [ ] Actual worker/cross-worker/recreated-pool determinism is measured and passes, or single-case use is blocked.
- [ ] All cases use exact active snapshot identities.
- [ ] Search is seeded random 1..3-variable selection with actual legal-space accounting.
- [ ] At least one branch is compiled and selected at runtime for its exact source case, or report no local solution.
- [ ] Similar labels do not auto-execute narrow branches; warm-start behavior is distinct and tested.
- [ ] Merges cannot broaden to empty/default condition without evidence; every accepted merge is source-case validated.
- [ ] No main/tier/L1/deployment changes from pilot outcomes.

## Delivery

Write `TASKS/tree/T101R.report.md` with baseline gaps; checkpoint field coverage; exact parity matrix; worker determinism matrix; active snapshot identities; legal search-space/candidate distribution; branch runtime-selection proof; merge/prune validation; artifact counts/sample identities; T053R dependency status; focused test outputs; no-apply confirmation; and changed files. Commit/push only `agent/tree`.
