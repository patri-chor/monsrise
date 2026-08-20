STATUS: OPEN
DOMAIN: tree
SUPERSEDES: T102-generation2-authoritative-round-continuation-and-executable-branches

# T103 - Generation 2: Verified Round State and Real All2Rush Branch Runtime

## Why T102 Is Not Accepted

T102 test passes but does not prove its claimed contract.

Verified facts in current code:

```text
- ProductRoundCheckpoint/restore still loses state:
  statusEffects are restored as [], state as idle, budget is not restored,
  and resetBoardForNextRound() is used after reconstruction.
- T102 loss inventory and optimizer still resolve payloads from FORMATION_LIBRARY,
  not current exact snapshots through SnapshotResolver.
- local branch mask remains hard-coded as main=fullrush and optional drill.
- merge still assigns emptyMask() without source-case execution validation.
- product_tree_strategy only performs existing FeatureMask matching; it has no
  exact-case layout matching or similar-label warm-start behavior.
- T102 test only checks nonempty returned intents. It does not prove chosen
  branch ID, source-case outcome reproduction, exact-vs-similar distinction,
  cross-worker determinism, or full checkpoint state parity.
```

T103 combines correction and next executable pilot iteration. Do not execute T102 separately.

## Scope

```text
lineage: all2rush only
no R0 mutation
no tier/L1/global-main/publish/deploy change
no root fallback
no arena.ts/playSpecVsSpec
```

All target/opponent payloads use T053R identity chain:

```text
active/manifest expected fingerprint
== SnapshotResolver resolved fingerprint
== prepared payload fingerprint
== task/result evidence fingerprint
```

## 1. Authoritative State or Fail Closed

Replace the partial reconstruction checkpoint with one of the following, chosen from actual engine capabilities:

```text
A. authoritative internal clone/restore of every game/battle state object;
B. a serializable state model proven to include every future-affecting field;
C. if neither is available, fail closed: do not claim continuation reuse and
   use full product-game replay for the pilot until state cloning is possible.
```

It must cover and restore:

```text
round/game-over state
both score and remaining budgets
hand/deck/reveal progression
all replay RNG state
all board monster runtime fields
status effects, cooldowns, shields, timers, target/state flags
any persistent battle/effect state
strategy and calculator policy identity
```

Remove any reset/zero/default substitution from restore. Checkpoint fingerprint must cover all semantic restored state.

## 2. Full Round-State Fidelity and Worker Determinism

For exact active all2rush vs at least two exact active opponents, both sides and four seeds, compare uninterrupted product games to sequential session and restored continuations at R1/R2/R3.

After every round compare normalized complete:

```text
round results, scores, budgets, hand/reveal state, full board runtime state,
all deployment trace fields, legal observations, RNG/checkpoint state.
```

Use a test helper that fails on missing compared fields, not a subset comparison.

Also run one fixed case:

```text
same worker repeated
worker A vs worker B
pool destroy/recreate
```

through real product worker tasks. Compare outcome, traces, and T053R identity fields. If unstable, label `SINGLE_CASE_UNSTABLE` and prohibit one-game local discovery acceptance.

## 3. Exact-Snapshot Loss Case and Search

Rewrite loss inventory/optimizer inputs to accept resolved exact target/opponent snapshots, not `FORMATION_LIBRARY` IDs. Persist source expected/resolved/prepared/policy identities with checkpoint and product revision.

Build a real legal variable catalog from checkpoint state. Use persisted search seed to sample up to 48 unique 1..3-variable candidates:

```text
legal R monster/actions and x/y
R deployment order
legal R+1/R+2 actions
whitelisted typed calculator policy values
complete serializable AST deltas
```

Record legal space and selected variables. If continuation fidelity is blocked, full product replay may be used for discovery but evidence must state this explicitly; never present it as checkpoint speedup.

## 4. Real Exact-Case Branch Runtime

Derive branch condition from actual legal observation at actual fork round:

```text
R1: revealed hand IDs/badges only
R2+: current visible board may be added
```

Do not hardcode `fullrush`, `drill`, or opponent identity. Add canonical visible-layout signature support only when entirely derived from legal observation.

Compile an improved action delta to an EvolFormation child subtree. Test with real product strategy and source case:

```text
a. the selected branch trace contains stored branchId;
b. it reproduces the recorded local result on the source case;
c. an identical legal label/layout selects that exact branch;
d. a similar but non-identical label/layout does not select it.
```

Implement similar-label warm-start as an optimizer input/output only, not an automatic runtime branch selection. Test that it seeds a bounded search candidate set while normal runtime falls back to legal default/specific matching.

## 5. Safe Merge and Prune

Merge only after:

```text
same parent exact snapshot
legal generalized condition derived from source observations
identical executable R..K action prefix
successful continuation/product validation on every source case
```

An empty/default condition is prohibited for this pilot. Failed merge keeps exact branches. Prune only exact behavior duplicates, demonstrated domination, or illegal/future-state conditions, preserving history/evidence.

## 6. Tests and Evidence

Create focused T103 tests covering:

```text
checkpoint full-state/replay parity or explicit fail-closed fallback
cross-worker/recreated-pool determinism
exact snapshot identity chain
legal mask derivation (no hardcoding)
branch chosenBranchId + source result reproduction
exact reuse vs similar non-execution
warm-start input distinct from runtime selection
merge source-case validation / empty-mask prohibition
```

Write revisioned append-only T103 artifacts for fidelity, loss cases, trials, branch runtime evidence, and merge/prune evidence. Every product record carries T053R identity fields, W/D/L, checkpoint/worker/product revision and raw task reconciliation.

## Acceptance

- [ ] No partial/default checkpoint restoration is used as authoritative continuation.
- [ ] Full-state parity and worker determinism pass, or continuation discovery is blocked.
- [ ] Exact active snapshots, not FORMATION_LIBRARY fallbacks, define every pilot case.
- [ ] Branch mask derives from legal observed facts.
- [ ] Runtime trace proves exact branch selection and local-result reproduction.
- [ ] Similar labels cannot auto-run a narrow exact branch; warm start is separate.
- [ ] Merges are source-case validated and cannot create empty/default branch.
- [ ] No global/tier/L1/deployment action.

## Delivery

Write `TASKS/tree/T103.report.md` with prior-gap disposition; checkpoint approach/field coverage; fidelity/determinism tables; exact snapshot identities; legal variable counts/trials; runtime branch trace proof; exact/similar/warm-start proof; merge/prune evidence; artifact paths/counts; T053R status; test outputs; no-apply confirmation; changed files. Commit/push only `agent/tree`.
