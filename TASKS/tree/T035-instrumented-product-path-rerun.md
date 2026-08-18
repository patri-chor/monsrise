STATUS: OPEN
DOMAIN: tree

# T035 - Instrumented Product-Path Rerun With Auditable Raw Evidence

> Domain: `tree` | Executor branch: `agent/tree`
> User-authorized scope: retain historical and T032 aggregate results; recompute/update product-path W/D/L only after full raw instrumentation. No new mutation definitions, H2H, promotion, Tier change, apply, deploy, or active bundle change.

## Why This Rerun Is Required

T034 losslessly recovered the four existing T032 output files and verified aggregate arithmetic, but correctly found insufficient raw evidence:

```text
10 baselines missing
64 individual product-path four-cost trace records missing
family × actual-side × seed cell records missing
canonical candidate content fingerprints missing
both-side deployment evidence missing
17 aggregate 140/0/0 rows remain SUSPICIOUS_UNTIL_AUDITED
```

Therefore T032 aggregate W/D/L is retained but not adoption-quality. This task may rerun only the fixed T032 source/candidate inventory to create auditable raw product-path data.

## A. Schema and Instrumentation Before Any Simulation

1. Define `PRODUCT_PATH_FORMAL_SCREEN_T035_V1`, distinct from T032. Include:

```text
executionSemanticsVersion
strategyAdapterVersion
productEntryModule
authority absolute artifact + SHA256
runner commit
manifest hash
configured/observed worker concurrency
seed schedule ID
```

2. Add append-only raw records under:

```text
tests/fixtures/tree/experience_library/product_path_t035/
```

Required files:

```text
manifest.json
candidate_registry.jsonl
source_baselines.jsonl
candidate_cells.jsonl
candidate_observations.jsonl
four_cost_fidelity_ledger.jsonl
cursor.json
frontiers.json
README.md
```

3. Store each candidate canonical fingerprint containing exact ordered team IDs/badges and full Evol topology, node rounds/conditions, ordered placements and coordinates. Group identical fingerprints, preserve all IDs, and mark duplicates/no-ops.
4. Each cell record must contain source/candidate/opponent IDs, candidate fingerprint, actual source side, seed, schedule ID, game index, W/D/L source result, completion/error state, and product-path provenance.
5. For every cell persist source-side and opponent-side product deployment traces or a compact trace hash plus a separately stored lossless trace record. Include nonempty-team validation, placement count, round count, final scores, early termination reason, and branch provenance.
6. No aggregate score/frontier may be written until its expected raw cells are present, complete, error-free, and their W/D/L recomputes exactly.

## B. Product-Path Four-Cost Gate

1. Re-run product path fidelity gate from actual `playFullGame` trace events.
2. Persist every coverage unit with source, candidate/baseline identity, direct/round-trip route, actual side, planned/actual placement, acceptance/rejection reason, budget before/cost/after, seed, and raw trace link/hash.
3. Missing trace is `MISSING_TRACE`, never PASS. A failed/missing unit blocks the screen.
4. Preserve the old T032 `64/64` aggregate as historical unverified output; do not overwrite it.

## C. Fixed Inventory Product-Path Rerun

1. Use exactly the existing fixed 10 executable 8-monster sources and their retained six mutation definitions each. Do not generate new variants.
2. Keep `gift_jungle` frozen as the 7-monster legacy record; no eighth monster and no descendants.
3. Run source baselines and candidates on product path with explicit schedule:

```text
7 held-out families × 2 actual sides × 10 games per cell
= 140 games per baseline/candidate
```

4. Seeds must be deterministic and each raw record must expose the exact seed. Both source and opponent must have validated nonempty legal teams before dispatch; failure is a worker/protocol error, not a loss.
5. Retain multi-thread scheduling:

```text
PersistentSimPool outer scheduler / worker pool remains enabled
outer candidate concurrency <= 2
record configured and observed worker concurrency
```

Each worker executes `playFullGame + declarative tree strategy`; no formal request may reach arena/playSpecVsSpec.
6. Atomic checkpoint after each completed candidate and baseline. Resume identity includes protocol, manifest hash, schedule, fingerprint, and cell identity. Never reuse T032 aggregate records.

## D. Integrity Gates and 100% Investigation

1. Recompute every candidate/baseline W/D/L and score from raw cells:

```text
trainingScore = (W + 0.5D) / total
```

2. Require exact 140 raw completed cells, both actual sides, all seven opponents, 10 games/cell, 0 worker errors, nonempty candidate/opponent teams, and real deployment evidence before `PRODUCT_PATH_SCREEN_SIGNAL_ONLY`.
3. Any 100% candidate must additionally show for every cell:

```text
candidate placements > 0
opponent placements > 0
no early/protocol termination
valid side mapping
trace-linked final score/outcome
```

4. Any violation is `PRODUCT_PATH_DATA_INTEGRITY_FAIL` or `SUSPICIOUS_UNTIL_AUDITED`, blocks frontier/adoption, and is reported exactly.
5. Do not classify any row Tier 2 or use it to bias new optimization. This task only produces valid product-path screen evidence.

## Acceptance

- [ ] Old sandbox and T032 aggregate files remain untouched.
- [ ] Raw baseline, candidate-cell, trace, fingerprint, four-cost, cursor, manifest, and frontier artifacts are append-only and Git-tracked.
- [ ] Fixed inventory has 10 baselines and 60 candidates with auditable 140-game product-path coverage, or failures are recorded without converting errors to losses.
- [ ] Product four-cost units are individually trace-backed.
- [ ] Scores/frontiers recompute exactly from raw cells.
- [ ] Duplicates/no-ops are identified by canonical content fingerprint.
- [ ] 100% results pass both-side deployment/integrity checks or remain suspicious.
- [ ] Multi-thread pool is retained and recorded; no arena formal execution.
- [ ] No promotion, apply, deploy, active bundle change, or new mutation generation.

## Delivery

Write `TASKS/tree/T035.report.md` with manifest, file hashes/counts, worker concurrency, four-cost matrix, baseline table, candidate/duplicate summary, raw-cell recomputation evidence, 100% investigation, complete/incomplete classifications, cursor, and no-apply confirmation. Commit/push only `agent/tree`. Do not modify this specification.
