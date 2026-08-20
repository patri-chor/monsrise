STATUS: OPEN
DOMAIN: tree
SUPERSEDES: T105-generation2-auditable-active-pilot-execution

# T106 - Generation 2: Real Active Payload Chain and Non-Template All2Rush Search

## T105 Disposition

T105 improved worker result attribution and passed its test, but its evidence remains insufficient for an active all2rush pilot.

Verified residual failures:

```text
- test and manifest still directly request t0:all2rush/t0 opponents; they do
  not discover/pin current active-library selected records or prove an active
  record pins those R0 payloads;
- manifest contains expected/resolved fp only, not active-library source,
  prepared product fp, task fp, result fp, policy chain, or product revision;
- worker product execution accepts omitted opponentFormation and then falls
  back to FORMATION_LIBRARY; result fp is echoed task metadata and is not
  verified against the actual materialized opponent payload;
- T105 does not compare every worker identity/policy/result field across runs,
  and stores only one selected w0 run rather than 10 per-run records plus a
  comparison record;
- local trials are still the old 14 fixed templates, all L -> L, without a
  persisted search seed, legal-space accounting, action variables, checkpoint,
  worker execution or task/result identity fields;
- the claimed real similar warm-start is not implemented: test mutates a
  context directly and asserts non-selection, but never passes/records a
  warm-start candidate to actual bounded generation;
- required quarantine and branch-runtime artifacts were not emitted for this
  observed no-improvement run.
```

T106 is the single next integer task. It combines the remaining proof repairs with a fresh, evidence-valid pilot attempt. Do not execute T105 separately.

## Scope

```text
all2rush lineage only
no R0 mutation
no global main/tier/L1/deployment change
no root fallback, arena.ts, playSpecVsSpec
```

## 1. Discover and Pin Real Active Records

Implement a narrow active-pilot resolver that reads the current active strength library / active manifest, selects all2rush and candidate opponents by their current active formation records, and writes a pilot manifest with source paths/revisions.

The manifest must include, for each party:

```text
active formation ID and root lineage ID
active library record ID/path/revision
active record expected fingerprint
resolver fingerprint
prepared product payload fingerprint computed from the concrete EvolFormation
calculator policy fingerprint
```

Using an R0 `t0:*` snapshot is allowed only when its active record explicitly points to it. Record that alias/reference; never infer it from formation name.

## 2. Fail-Closed Actual Worker Payload Verification

For formal product pilot tasks:

```text
- require explicit target and opponent EvolFormation payloads;
- forbid FORMATION_LIBRARY lookup/fallback;
- recompute target/opponent payload and policy fingerprints inside worker from
  the received concrete payload;
- reject task before playFullGame if recomputed values differ from expected
  task fields;
- result returns recomputed identity fields, never merely task echoes.
```

At aggregation/pilot driver, reject any disagreement in:

```text
active expected == resolver == prepared == worker recomputed result
```

Include product execution semantics and source snapshot alias/revision. Emit append-only quarantine rows for every rejection.

## 3. Complete Determinism Evidence

Use a pinned active task and explicit payloads. Persist one immutable row for each of:

```text
10 same-worker runs (worker ID + all raw comparison digests/identity fields)
worker A run
worker B run, with different confirmed worker ID
new-pool run
```

Produce a comparison record that checks all fields:

```text
worker task/result recomputed target/opponent payload+policy fprints
winner/WDL, roundResults, trace digest, observation digest,
branch decision digest and planned/actual coordinates digest
```

Do not hard-code `worker_tid_1`/`worker_tid_2`; assert distinct observed IDs. Do not claim one-game discovery stability unless this table passes.

## 4. Actual Seeded Checkpoint-Derived Search

Replace fixed candidate templates with a deterministic seeded sampler.

For each eligible target-side loss case:

```text
- derive legal variable catalog from the actual checkpoint and target-side
  legal context;
- persist search seed, catalog entries/size, and draw order;
- randomly sample 1..3 compatible variables without replacement;
- generate up to 48 unique behavior fingerprints, or record exact exhaustion;
- validate every action against product legal deployment/budget rules before
  worker continuation;
- execute candidates by formal product worker task with exact payload chain.
```

Candidate catalog must be able to vary actual eligible action/placement, deployment order, future R+1/R+2 actions where applicable, whitelist policy values, and serializable AST deltas. It must not be a fixed list built around the first placement.

Every trial record carries:

```text
pilot manifest ID/revision
loss case ID, targetSide, seed/forkRound/checkpoint fingerprint
search seed/draw index/catalog size
concrete variables and action delta
candidate behavior/policy fp
baseline and candidate raw W/D/L/outcome/trace digest
active/resolver/prepared/task/result identity chain
worker ID/task ID/product revision
```

No improvement is a valid terminal pilot outcome when supported by these rows.

## 5. Actual Similar-Case Warm Start

Obtain a distinct real product loss/draw case whose target-side visible observation is similar but not equal, with all inputs from visible legal facts.

Implement a warm-start function with auditable inputs/output:

```text
exact-case branch remains non-executable for similar observation;
its legal action delta is injected as one marked candidate into bounded search;
normal product_tree_strategy selection does not use that delta directly.
```

Persist a record with exact and similar observation fingerprints, proof that runtime branch IDs differ, warm-start candidate ID/delta, and resulting search behavior. If no real similar observation exists, write `NO_SIMILAR_CASE_AVAILABLE` with inventory evidence instead of fabricating a context.

## 6. Branch and Artifact Honesty

Create a branch runtime artifact on every run:

```text
NO_LOCAL_IMPROVEMENT_FOUND
or
EXACT_CASE_BRANCH_CREATED with target-side continuation/replay proof
```

Create quarantine artifact even when empty, with a header/schema row. Merge/prune artifact records inputs and decisions; no empty/default merge allowed.

## Acceptance

- [ ] Active record source explicitly resolves every t0 alias, if used.
- [ ] Formal worker task cannot fall back to FORMATION_LIBRARY and recomputes payload identity from concrete received payload.
- [ ] Active/resolver/prepared/worker identities are compared and persisted end-to-end.
- [ ] Per-run 10 + two distinct workers + recreated pool evidence compares full raw digests and identities.
- [ ] Search is seeded, checkpoint-derived, legal, non-template, and trial-complete.
- [ ] Exact/similar behavior uses real product cases; warm start is a recorded search input, never runtime execution.
- [ ] No-improvement is reported honestly or every created exact branch reproduces target-side result.
- [ ] No global/tier/L1/deployment change.

## Delivery

Write `TASKS/tree/T106.report.md` with active record and alias evidence; worker payload recomputation design; full determinism table; catalog/search seed/trial distribution; result classification; exact/similar/warm-start evidence or explicit unavailability; evidence paths/row counts; quarantines; tests; no-apply confirmation; changed files. Commit/push only `agent/tree`.
