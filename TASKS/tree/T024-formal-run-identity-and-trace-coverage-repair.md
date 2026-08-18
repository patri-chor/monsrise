STATUS: OPEN
DOMAIN: tree

# T024 - Formal Run Identity and Four-Cost Trace Coverage Repair

> Domain: `tree` | Executor branch: `agent/tree`
> T023's real engine trace contract is retained. T023 is not yet authorization to start formal screening because its resume identity can skip formal work after smoke.

## Verified Blocking Defects

### A. Smoke/Formal Resume Collision

T023 builds resume deduplication identity as:

```ts
`${candidateId}_SCHEDULE_1_SCREEN`
```

This omits `runKind`, `gamesPerCell`, protocol version, seed schedule, panel, code/fixture fingerprint, and source tree fingerprint. A `SMOKE` observation (1 game/cell, 14 total) therefore collides with a `FORMAL_SCREEN` observation (10 games/cell, 140 total). Running formal `--resume` after smoke skips the candidate and leaves no valid formal evidence.

### B. Fidelity Coverage and Report Mismatch

Real raw trace events now exist, but the report's budget summaries do not match all raw evidence (for example a raw 泉水剑 event records `4 -> 0`, while the report table states `8 -> 4`). A single matching trace cannot establish all relevant branch-path and both-side coverage.

## Objective

Make the runner safe to launch as a formal resumable screen: formal work must never be skipped due to smoke, observations must be append-only with a complete protocol identity, and four-cost fidelity must prove the claimed branch/side/route coverage from raw traces.

## A. Complete Observation Identity and Resume Semantics

1. Replace candidate/schedule-only dedup key with a stable `observationKey` containing at minimum:

```text
schemaVersion
protocolVersion
runKind
phase
candidateId
canonical candidate/tree fingerprint
source fixture fingerprint
panel identity
side coverage
seed schedule identity
gamesPerCell
code commit (or explicit implementation fingerprint)
```

2. `SMOKE` and `FORMAL_SCREEN` must always have distinct observation keys and may coexist for the same candidate.
3. `--resume` may skip only a prior record with exactly the same complete observation key and `isEvaluationComplete=true`, `workerErrorCount=0`, and exact expected completed game count.
4. An incomplete/error/mismatched-count record must be rerun or recorded as superseded, never treated as done.
5. Add a test sequence:
   - write smoke record for a candidate;
   - invoke formal screen with `--resume`;
   - prove formal evaluation runs and writes 140 completed games, rather than skipping;
   - interrupt after one candidate, resume, and prove remaining candidates run once with no duplicate formal observation.

## B. Formal Screen Hard Gate

1. Formal screen code must assert before writing an observation:

```text
runKind === FORMAL_SCREEN
gamesPerCell === 10
expected total === 7 families × 2 sides × 10 = 140
metric.total === 140
workerErrorCount === 0
isEvaluationComplete === true
```

2. If any assertion fails, append a `FORMAL_SCREEN_INCOMPLETE` diagnostic record and do not create a promotion/frontier decision.
3. `--phase=fidelity` must execute only fidelity; `--phase=screen` must require a recorded valid fidelity gate for the identical source/fixture/code protocol and then screen; `--phase=promotion` must refuse if no qualifying formal screen exists. Test each phase boundary.
4. Do not begin the 3 × 25 games/cell promotion program in this task; it remains pending until formal screens exist and are reviewed.

## C. Trace-Backed Four-Cost Coverage

1. Define the expected coverage unit as:

```text
source fingerprint × conversion route (direct Evol, Evol->bundle->Evol) × branch/path ID × side × four-cost placement fingerprint
```

2. Generate trace evidence for every reachable relevant branch/path and both sides, using deterministic seeds. Raw trace records must carry branch/node ID, conversion route, side, seed, and placement fingerprint.
3. Gate PASS only when every expected coverage unit has a matching raw event where a valid planned four-cost placement is accepted with the actual charged cost and observed budget delta. A coverage gap is `FAIL/MISSING_TRACE`, not PASS.
4. Report summaries must be generated from the raw ledger, never hand-maintained values. Add test that rejects any summary whose budget values differ from raw trace evidence.
5. Preserve historical T023 trace records but mark them `PARTIAL_COVERAGE_T023` until coverage is completed. Do not claim four-cost fully validated until this task passes.

## D. Append-Only Integrity

1. Do not use `writeFileSync()` to replace `evaluation_observations`, `promotion_decisions`, baseline evidence, fidelity ledger, registry, or migration ledger. Use append-only records or versioned immutable snapshots with manifest references.
2. Existing 60 smoke rows remain `INVALID_SMOKE_ONLY`; registry remains `UNVALIDATED_T022_INVENTORY` until each candidate gets a clean formal screen.
3. Current `NO_COMPLETE_FORMAL_FRONTIER` remains until formal observations exist.

## Acceptance

- [ ] Smoke record never blocks matching candidate's formal 140-game screen on `--resume`.
- [ ] Resume test proves no duplicate exact formal record and no skipped incomplete/mismatched record.
- [ ] Formal screen records exactly 140 completed games with error-free complete metrics, or is explicitly incomplete and unranked.
- [ ] Phase boundaries are enforced.
- [ ] Four-cost raw trace ledger covers every source/route/reachable-branch/side placement unit, and summaries are mechanically derived and consistent.
- [ ] T023 records are retained but clearly marked partial where coverage was incomplete.
- [ ] Task specifications T020-T024 are Git-tracked; T013 preservation passes.
- [ ] No promotion evaluation, active bundle change, apply/deploy, or generation-domain change.

## Delivery

Write `TASKS/tree/T024.report.md` with observation-key schema, smoke-to-formal resume test evidence, formal games counts, trace coverage matrix, remaining missing units (if any), append-only migration evidence, test results, and no-apply confirmation. Commit/push only `agent/tree`. Do not modify this specification.
