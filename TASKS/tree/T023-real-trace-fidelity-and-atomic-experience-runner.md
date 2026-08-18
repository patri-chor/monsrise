STATUS: OPEN
DOMAIN: tree

# T023 - Real Four-Cost Trace Fidelity and Atomic Experience Runner Repair

> Domain: `tree` | Executor branch: `agent/tree`
> T022 is not accepted as a four-cost or high-sample evidence result. Preserve its 60-candidate registry only as unvalidated candidate inventory. Do not rank, promote, tier, or apply it.

## Verified T022 Delivery Failures

T022 report claims real four-cost deployment/budget traces and a 10-game/cell screen, but committed implementation and artifacts prove otherwise:

1. `four_cost_fidelity_gate.ts` does not capture a battle trace. It derives budget with `node.round * 4`, assigns `isTraceEquivalent: true`, and assigns `workerErrorCount: 0`. It does not observe actual accepted/skipped placements, actual budget, branch selection, or skip/error reasons from the engine.
2. Committed `evaluation_observations.jsonl` records `gamesPerCell: 1` and `total: 14` for every candidate, despite T022 requiring 10 games/cell / 140 games per candidate for initial screening. Smoke output was written as formal experience evidence.
3. Pipeline uses `writeFileSync()` to replace ledgers, has no persisted cursor/checkpoint, and does not load/deduplicate existing observations. It is neither append-only nor resumable.
4. `PROMOTED` labels derived from 14 games are invalid and must be marked `INVALID_SMOKE_ONLY`, not used for source frontier, Tier, or training direction.

## Objective

Replace T022's synthetic fidelity assertion with real engine-trace evidence, and replace its overwrite-only smoke pipeline with an atomic, append-only, deterministic runner. Do not begin promotion/high-sample training until the repaired Phase A trace gate and smoke/resume tests pass.

## A. Real Engine Deployment Trace Contract

1. Extend the exact same `playSpecVsSpec` / fine-grained worker path used by persistent training to optionally emit per-round placement execution events for the candidate side:
   - candidate/source/canonical fingerprint;
   - side, seed, opponent family and variant;
   - selected branch/node ID;
   - planned ordered placements;
   - for every placement: monster ID, planned x/y, attempted order, accepted/skipped/rejected result, actual x/y if accepted;
   - budget before and after the attempt, actual cost charged, and explicit rejection/skip reason;
   - round completion, game completion, and worker error.
2. Trace source must be runtime engine state, not tree arithmetic, static `costOf()` guesses, or hard-coded booleans.
3. Update worker/pool contract to preserve these traces alongside existing worker errors. A missing expected trace event is a fidelity failure, not an implicit pass.
4. Add tests that create a legal four-cost planned placement and verify runtime trace reports its actual budget reduction and accepted placement; add a controlled over-budget or missing-unit placement and verify a concrete rejected/skipped event and gate failure.

## B. Genuine Four-Cost Fidelity Gate

1. Cover every actual four-cost placement in all ten executable 8-monster Tier 1 sources, on all relevant branch paths and both sides, with deterministic seeds.
2. Direct Evol and explicit `Evol -> bundle -> Evol` route must be run through the trace path. Compare canonical branch/placement sequences and actual runtime outcome event-by-event; label normalization is the only permitted documented difference.
3. `four_cost_fidelity_ledger.jsonl` must include raw trace references/events, not only summary fields.
4. PASS requires all planned valid four-cost placements to receive matching accepted runtime events with correct charged cost and budget delta. Any silent skip, wrong branch/order/round/coordinate, unexplained budget rejection, missing trace, conversion mismatch, or worker error is FAIL.
5. On FAIL, stop before screening/mutation evaluation and write a `STATUS: PARTIAL` report. Do not generate a replacement score or strength conclusion.

## C. Atomic Append-Only Experience Runner

1. Implement a deterministic CLI runner with exactly:

```text
--smoke
--resume
--phase=fidelity|screen|promotion|full
--run-id=<stable-id>
```

2. Persist an atomic cursor under the committed experience-library schema (or a separately committed run-state fixture) after every candidate and every schedule. Write temp file then atomic rename; resume must skip only completed matching fingerprint/protocol/seed records.
3. Make observations append-only:
   - never use `writeFileSync()` to replace observation, decision, baseline, fidelity, or registry ledgers;
   - append a new record with run ID, protocol version, code commit, candidate fingerprint, panel, schedule, seed schedule, games/cell, W/D/L, errors, completion state, and artifact provenance;
   - exact duplicate protocol/fingerprint/panel/schedule records may be reused, but changed code/protocol/seeds create a new observation.
4. Smoke artifacts must be physically and semantically isolated:
   - `runKind: SMOKE`;
   - never create `PROMOTED`, Tier, or source-frontier strength decisions;
   - never share a path/record identity with formal screen observations.
5. Formal screen is exactly early-seven held-out × both sides × 10 games/cell = 140 completed games/candidate. Assert this count in code and tests before writing a formal observation.
6. Promotion evaluation may begin only after Phase B formal screen, and must follow the T022 high-sample policy: 3 independent schedules × 25 games/cell, with error-free completion and source-relative analysis.

## D. Repair Existing T022 Experience Inventory

1. Preserve candidate registry entries as `UNVALIDATED_T022_INVENTORY`; do not delete them.
2. Mark all existing 60 observations and 60 promotion decisions as `INVALID_SMOKE_ONLY` with the reason `gamesPerCell=1, total=14; formal screen requires 10/140`. Preserve them for audit; do not overwrite the original observations.
3. Recompute/remove current source-frontier strength assertions so they cannot select a best candidate from invalid smoke data. Replace with explicit `NO_COMPLETE_FORMAL_FRONTIER` until formal data exists.
4. Commit a migration ledger that maps each invalid record to its reason and replacement eligibility.

## Verification and Acceptance

- [ ] Runtime trace test proves actual accepted legal four-cost placement, actual charged cost, and actual budget delta.
- [ ] Negative trace test proves rejected/skipped four-cost placement is visible and fails fidelity gate.
- [ ] Every four-cost placement/branch/side has committed trace-backed fidelity evidence; no synthetic `round * 4` budget value is accepted as evidence.
- [ ] Smoke data is marked and cannot promote/tier/frontier any candidate.
- [ ] A formal screen record proves 140 completed games per candidate, with zero worker errors.
- [ ] Interrupt/resume test proves atomic cursor resumes without duplicate observations or overwriting prior records.
- [ ] Existing 60 T022 candidates and their invalid smoke observations remain auditable through migration records.
- [ ] T013 preservation and Git-tracked T020/T021/T022/T023 task-spec tests pass.
- [ ] No active bundle/apply/deploy/generation-domain changes.

## Delivery

Write `TASKS/tree/T023.report.md` with trace coverage, any four-cost gate failure table, smoke migration counts, cursor/resume evidence, formal completed-game counts, archive paths, test commands, and no-apply confirmation. Commit/push only `agent/tree`. Do not modify this specification.
