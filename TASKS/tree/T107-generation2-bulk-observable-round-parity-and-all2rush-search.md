STATUS: OPEN
DOMAIN: tree
SUPERSEDES: T106-generation2-real-active-payload-and-non-template-search

# T107 - Generation 2: Bulk Observable Round Parity and All2Rush Search

## Validation Policy Change

T106 over-specified internal checkpoint/worker identity diagnostics as routine evidence. T107 replaces that with a behavior-first standard.

The question is whether a resumed/single-round product path behaves identically to uninterrupted real product games. Prove this through a broad matrix of actual battles and observable round outputs, not by trying to inspect every transient internal variable.

Internal fields such as RNG internals, VFX, target pointers, cooldown implementation detail, raw deployment trace, or serialized hidden state are diagnostic-only. Collect them only when an observable comparison fails.

## Scope

```text
all2rush remains the only optimization/pilot lineage
no R0 mutation
no global main/tier/L1/deployment change
no arena.ts/playSpecVsSpec/root fallback for formal evidence
```

A formation used in a formal test must still be the exact declared snapshot; this is a minimal input correctness rule, not a per-variable state-audit requirement.

## 1. Broad Actual-Battle Observable Parity Matrix

Build a large product-path test matrix using the available exact formation snapshots, including all2rush and a diverse set of opponents. Use at least:

```text
8 distinct formations total where available
all ordered target/opponent matchups among selected formations, excluding self
both sides for each matchup
at least 8 deterministic seeds per side
```

If available corpus is smaller, run every available exact formation and report the actual matrix size. Do not choose only easy or known deterministic opponents.

For every case compare:

```text
A. uninterrupted playFullGame
B. sequential ProductGameSession playing one normal product round at a time
C. continuation restored from checkpoints at every reachable round
```

After every completed round, compare normalized observable output:

```text
round winner/result
cumulative p1/p2 score
per-side surviving monster set keyed by stable monster instance identity
per surviving monster current HP and max HP
per-side total HP and survivor count
```

For a stable machine-independent comparison use exact integer values where engine HP is integral. If HP is floating point, normalize to an explicitly documented fixed precision before comparing. Include no hidden/internal fields in the ordinary parity record.

A mismatch row contains the first divergence round and then may attach an opt-in diagnostic dump:

```text
accepted/rejected deployment trace
branch ID/planned/actual coordinates
visible observation
internal state snapshot only as needed to explain the mismatch
```

## 2. Cross-Worker Result Stability

Use a representative subset covering at least:

```text
all2rush vs 3 distinct opponents
both sides
4 seeds
```

Run each case:

```text
10 times on one worker
once on a confirmed different worker
once after destroy/recreate pool
```

The normal pass comparison is only the same observable per-round sequence from section 1. Worker IDs are recorded merely to establish placement, not treated as correctness output. On mismatch, collect diagnostic trace.

## 3. Exact Inputs, Kept Simple

For each formation input, store only:

```text
formation ID
selected snapshot fingerprint
calculator-policy fingerprint
```

At task construction, recompute the fingerprint from the concrete submitted formation and reject a mismatch. The worker result echoes the recomputed target/opponent fingerprint. This establishes that tests are running the declared formations without demanding an elaborate active-library/worker provenance chain in every trial.

Use active selection when available; when no active alias exists, a pinned R0 snapshot is permitted and stated plainly in the evidence.

## 4. All2Rush Focused Search After Parity Gate

Only after observable parity and worker stability pass, run all2rush local exploration on actual loss/draw cases.

For each selected case:

```text
- find earliest round whose observable result turns the match toward loss;
- checkpoint immediately before that round;
- generate up to 48 unique 1..3-variable legal candidates;
- use a persisted search seed and checkpoint-derived legal placement/order/
  R+1/R+2/policy/AST variable catalog;
- replay a continuation for each candidate;
- compare target-side final W/D/L, final score, round results, and per-round
  surviving unit HP output against baseline.
```

Do not require internal state trace on every candidate. Each trial records:

```text
loss case ID, target side, seed/fork round, snapshot/policy fprints,
search seed, candidate behavior fingerprint, concrete selected variables,
final W/D/L, final score, round results, per-round HP-output digest,
improved flag.
```

A valid outcome is either:

```text
NO_LOCAL_IMPROVEMENT_FOUND
or
EXACT_CASE_BRANCH_CREATED
```

## 5. Branch Semantics

For an improved local candidate only:

```text
- convert it to a branch with conditions from legal visible observations;
- prove source case exact label selects it and reproduces the improved
  observable result sequence;
- a real similar visible case does not auto-select it;
- it may be provided as a warm-start candidate for local search only.
```

If there is no improvement, do not force branch/warm-start demonstration. Record no branch created.

Merge/prune is deferred unless at least two genuine improved branches exist. No empty/default-condition merge.

## 6. Evidence

Write concise, append-only T107 evidence:

```text
all2rush_g2_t107_formation_manifest.json
all2rush_g2_t107_round_parity.jsonl
all2rush_g2_t107_worker_stability.jsonl
all2rush_g2_t107_loss_cases.jsonl
all2rush_g2_t107_local_trials.jsonl
all2rush_g2_t107_branch_results.jsonl
all2rush_g2_t107_mismatch_diagnostics.jsonl
```

`round_parity` records matrix input IDs/fingerprints, mode A/B/C, outcome and per-round observable HP digest. `mismatch_diagnostics` exists even when empty, with schema/header. Detailed internals go there only after an observable failure.

## Acceptance

- [ ] Broad actual-battle matrix reaches stated formation/side/seed coverage or reports unavoidable corpus limitation.
- [ ] Uninterrupted, sequential, and every reachable checkpoint continuation have identical observable round outputs for all passing cases.
- [ ] Same-worker, different-worker, and recreated-pool product results have identical observable sequences across representative subset.
- [ ] Formation input fingerprint is recomputed from each concrete payload before execution.
- [ ] Candidate search is seeded, legal, non-template, and records observable outputs.
- [ ] No-improvement is accepted as a complete pilot conclusion; any created branch reproduces an improved observable source result.
- [ ] Detailed internal-variable collection appears only for mismatch diagnostics.
- [ ] No global/tier/L1/deployment action.

## Delivery

Write `TASKS/tree/T107.report.md` with formation corpus and matrix dimensions; exact case/pass/fail counts; observable comparison schema and HP normalization; worker stability counts; mismatch diagnostics count; all2rush loss/candidate distribution; result classification; branch outcome if any; evidence paths/row counts; focused tests; no-apply confirmation; changed files. Commit/push only `agent/tree`.
