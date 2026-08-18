STATUS: OPEN
DOMAIN: tree

# T025 - Enforce T024 Runtime Implementation Before Formal Training

> Domain: `tree` | Executor branch: `agent/tree`
> T024 report is not accepted: current `origin/agent/tree` source still contains the old collision-prone observation key and a synthetic budget fallback.

## Verified Failures

1. Current `src/engine/tree/experience_training_pipeline.ts` still uses:

```ts
const obsKey = `${c.candidateId}_SCHEDULE_1_SCREEN`;
```

It does not use the reported 12-dimensional observation identity. Smoke and Formal records can still collide under `--resume`.

2. Current `src/engine/tree/four_cost_fidelity_gate.ts` still contains:

```ts
rawTraceEvent: primaryEvent ?? null
budgetBefore: primaryEvent ? budgetBefore : node.round * 4
costCharged: primaryEvent ? costCharged : 4
budgetAfter: primaryEvent ? budgetAfter : node.round * 4 - 4
```

A missing runtime trace can therefore receive synthetic budget values and possibly pass. T024 requires missing trace to be `FAIL/MISSING_TRACE`, never a fallback PASS.

The T024 report and tests claim these defects are fixed, but the delivery `HEAD` source disproves that claim.

## Objective

Implement and test the actual T024 behavior in source. No formal screen or promotion training may run until this task passes.

## A. Implement Complete Observation Identity

1. Add and use a deterministic `buildObservationKey()` containing at minimum:

```text
schemaVersion
protocolVersion
runKind
phase
candidateId
candidate/tree fingerprint
source fixture fingerprint
panel ID
side coverage
seed schedule ID
gamesPerCell
code/implementation fingerprint
```

2. Store the exact `observationKey` in every observation record.
3. `--resume` may skip only an exact matching key where:
   - `isEvaluationComplete === true`;
   - `workerErrorCount === 0`;
   - `total === expectedTotal`;
   - run kind, phase, seed, panel, protocol, candidate fingerprint and games/cell all match.
4. Smoke (`total=14`) and formal (`total=140`) must coexist for the same candidate and never collide.
5. Add source-level/runtime tests that create a smoke record, then run formal with `--resume`, and assert a new formal observation is executed and written.

## B. Remove Synthetic Fidelity Fallback

1. In `four_cost_fidelity_gate.ts`, if a required runtime event is absent, create a record:

```text
status: FAIL
failureCode: MISSING_TRACE
```

with no synthetic budget/accepted values.
2. Remove all `node.round * 4` budget evidence from PASS paths. A static estimate may appear only as non-evidence diagnostic metadata, never as `budgetBefore`, `budgetAfter`, `costCharged`, `actualAccepted`, or PASS proof.
3. Verify the required trace event matches source, route, branch/node, side, seed, monster, round, placement fingerprint and accepted/cost/budget fields. Any mismatch is FAIL.
4. Add a test that deliberately drops a runtime trace and proves Phase A fails with `MISSING_TRACE`.
5. Generate summaries exclusively from raw trace records and assert summary numbers equal raw event values.

## C. Formal Screen Hard Gate

1. Before appending a `FORMAL_SCREEN` observation assert exactly:

```text
runKind === FORMAL_SCREEN
phase === screen
 gamesPerCell === 10
 total === 140
 workerErrorCount === 0
 isEvaluationComplete === true
```

2. A smoke record may never generate `PROMOTED`, `DEFERRED` strength, or frontier state.
3. Promotion must refuse until at least one complete formal observation exists for the candidate and protocol.
4. Do not run the requested overnight multi-candidate formal training in this task; first prove the runner with a bounded test/dry run and only then publish the next execution task.

## D. Preserve Existing Data and Task Specs

1. Keep T022/T023/T024 observations as historical audit data; mark them according to their actual protocol. Do not silently rewrite them as formal evidence.
2. Preserve all T020-T025 task specifications and reports. Add a paired-spec Git-tracking test.
3. No active bundle, apply/deploy, generation-domain, or `scripts/watch-gemini.ps1` changes.

## Acceptance

- [ ] `origin/agent/tree` source contains and uses complete observation key; old candidate/schedule-only key is absent from resume logic.
- [ ] Smoke-to-formal resume regression passes with a new 140-game formal record.
- [ ] Missing raw four-cost trace fails as `MISSING_TRACE`; no synthetic `round * 4` PASS evidence remains.
- [ ] Formal screen hard gate rejects any non-140/incomplete/error result.
- [ ] Promotion/frontier cannot consume smoke-only data.
- [ ] No formal overnight training started before this task acceptance.
- [ ] T013 and task-spec preservation tests pass.

## Delivery

Write `TASKS/tree/T025.report.md` with source-line evidence for both repairs, smoke/formal resume test output, missing-trace failure output, task preservation proof, and explicit no-formal-run/no-apply confirmation. Commit/push only `agent/tree`. Do not modify this specification.
