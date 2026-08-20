STATUS: DONE
DOMAIN: tree
SUPERSEDES: T103-generation2-verified-round-state-and-branch-runtime

# T104 - Generation 2: Active-Snapshot Worker Determinism and All2Rush Pilot Run

## T103 Disposition

T103 improved session field restoration and exact snapshot resolver usage, but it is not accepted as the full Generation 2 contract.

Verified residual gaps:

```text
1. T103 fidelity matrix tests only all2rush on Side 1:
   2 opponents x 4 seeds = 8 games, not both-side matrix.
2. No actual PersistentSimPool same-worker / cross-worker / destroy-recreate
   determinism test exists.
3. Test resolves t0:all2rush/t0 opponents, not the current active-library or
   pinned Active-L2 snapshot selected for the pilot.
4. No test proves similar-but-nonidentical observation fails exact-case runtime
   selection while supplying a separate warm-start candidate to local search.
5. Loss-case inventory catches SnapshotResolver errors and silently returns null,
   which can conceal identity loss instead of creating an auditable quarantine.
6. Product worker task-level dual payload/policy identity evidence required by
   T053R has not been proven through the Generation 2 artifacts.
```

T104 is the single next integer task and combines remaining verification with the first evidence-valid all2rush pilot execution.

## Scope

```text
pilot lineage: all2rush only
no R0 mutation
no global main/tier/L1 change
no deployment/publish
no root fallback, no FORMATION_LIBRARY active payload fallback
no arena.ts/playSpecVsSpec
```

## 1. Pin Current Active Pilot Snapshots

Define a pilot manifest containing:

```text
current active all2rush formation ID + expected active-library fingerprint
selected exact opponents (at least 2) + expected fingerprints
policy fingerprints
active-L2/benchmark manifest revision and hash
product/worker revision
```

Resolve all through SnapshotResolver. Require:

```text
pilot manifest expected fp
== active-library fp
== resolver fp
== prepared evol fp
== worker task/result payload fp
```

Do not use `t0:*` unless the active library explicitly pins that R0 snapshot. Any unresolved opponent/candidate creates an append-only quarantine record and fails that pilot case; no silent `null`/skip.

## 2. Complete Round Fidelity and Worker Determinism Matrix

For all2rush vs two pinned exact opponents, run both sides and seeds `[1, 42, 100, 2024]`:

```text
16 cases
uninterrupted product game == sequential session == restored R1/R2/R3 continuation
```

Compare complete normalized round state, all trace fields, observations, budgets, checkpoint fingerprints, outcome and score after every round.

For at least one loss case, use real product worker tasks to test:

```text
A. same dedicated worker repeated 10 times
B. worker A versus worker B with same task
C. destroy pool/create new pool then rerun
```

Every run must carry and compare T053R dual target/opponent payload/policy identity fields. If any mismatch/difference occurs, write `SINGLE_CASE_UNSTABLE` evidence and block one-game discovery acceptance.

## 3. Exact Branch Selection and Similar Warm-Start Separation

Build at least one branch from a real pinned loss case if a local improvement exists.

Prove with product-path traces:

```text
exact source legal observation -> selected branch trace ID == stored branch ID
-> branch continuation reproduces stored local W/D/L result

identical independently reconstructed legal observation -> same exact branch selected

similar but nonidentical observation -> narrow exact branch is NOT selected
-> normal runtime falls back to legal standard matching
-> optimizer receives exact branch action delta only as a warm-start candidate,
   explicitly identified as warm-start and not runtime-applied.
```

Branch conditions/layout signatures are derived from visible facts only. Add a negative test that an opponent ID, seed, hidden/future hand/board, or outcome cannot appear in a runtime condition/signature.

## 4. Execute the First Evidence-Valid Focused Pilot

Only if worker determinism passes:

```text
- inventory at most 3 pinned worst opponents x 2 loss/draw cases;
- for each case sample up to 48 seeded, legal, unique 1..3-variable candidates;
- use authoritative continuation when full parity passes;
- otherwise fail closed and do not claim local one-game discovery.
```

Persist candidate-space size, selected variables, exact action/policy changes, behavior fingerprints, checkpoint, source identities, W/D/L, worker result identity, and branch outcome.

No pilot result promotes the global main or changes tier/L1.

## 5. Evidence

Write T104 revisioned append-only artifacts:

```text
all2rush_g2_t104_pilot_manifest.json
all2rush_g2_t104_round_fidelity.jsonl
all2rush_g2_t104_worker_determinism.jsonl
all2rush_g2_t104_loss_cases.jsonl
all2rush_g2_t104_local_trials.jsonl
all2rush_g2_t104_branch_runtime.jsonl
all2rush_g2_t104_merge_prune.jsonl
all2rush_g2_t104_quarantine.jsonl
```

Each product record includes target/opponent formation IDs, expected/resolved/prepared/task/result payload and policy fingerprints, task/worker identity, side/seed/round, W/D/L and reconciliation.

## Acceptance

- [ ] Both-side 16-case exact active-snapshot round fidelity matrix passes.
- [ ] Same-worker, cross-worker, and recreated-pool determinism is actually tested with worker product tasks.
- [ ] No silent unresolved snapshot skip; every failure is audited/quarantined.
- [ ] Exact branch source-case selection/result and independent exact-label reuse are traced.
- [ ] Similar label cannot auto-run narrow branch; warm start is demonstrably separate.
- [ ] Pilot trial evidence is task-level identity-complete and only executes after stability gate.
- [ ] No global/tier/L1/deployment change.

## Delivery

Write `TASKS/tree/T104.report.md` with exact pilot manifest; full 16-case parity table; worker determinism matrix; quarantine counts; loss/candidate/trial counts; exact/similar/warm-start trace table; branch/merge status; evidence row counts/sample identities; focused tests/commands; no-apply confirmation; changed files. Commit/push only `agent/tree`.
