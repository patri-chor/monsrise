STATUS: OPEN
DOMAIN: tree
SUPERSEDES: T133-worker-thread-product-cycle-pool

# T134 - Wire Worker-Thread Cycle Execution

## Rework Fact

T133 is not accepted as parallel-cycle delivery.

Verified current state:

```text
product_worker.ts and ProductWorkerPool exist
but optimizer_cycle.ts has no ProductWorkerPool / parallelBackend / workerCount use
therefore actual cycle work remains serial
T133 parity test runs two cycles but proves only five summary numbers, not that
worker threads executed S, D+S, or backprop work
```

D-specific state reconstruction exists and must be preserved. This task wires the already-created worker pool into real cycle execution; do not add another pool architecture.

## Goal

Make `parallelBackend: 'worker_threads'` execute actual independent cycle work through `ProductWorkerPool`, with exact deterministic merge and evidence proving what ran in workers.

## 1. Wire Actual Work

In `OptimizerCycleOrchestrator`, choose backend once per run:

```text
single:
  call shared operation functions in main isolate
worker_threads:
  submit actual independent units to ProductWorkerPool
```

Required worker units:

```text
- one source-case S frontier discovery search;
- one legal D attempt with D-specific state capture plus <=8 S trials;
- one retained-lineage paired/full product validation group.
```

Do not submit one artificial no-op task merely to claim worker use. Do not leave `CycleSearch`, `LineageManager.executeDPlusSSearch`, or backprop actual work serial when backend is worker_threads.

Extract shared serializable operation functions as needed. Worker and single paths must invoke exactly the same underlying operation semantics.

## 2. Deterministic Merge and Fail-Closed Behavior

Every dispatched item records:

```text
workId
stage: S | D_PLUS_S | BACKPROP
source case / D / lineage ID
input snapshot/state fingerprints
seed
backend worker ID or SINGLE
result status
```

Parent sorts results by:

```text
workId -> caseId -> dId -> lineageId
```

before frontier/archive/selection operations.

Worker error or timeout:

```text
persist failed work record
fail cycle/pilot as incomplete
never silently rerun in main thread, retry with new seed, or omit it
```

Ensure timeouts terminate/recreate the affected worker so it cannot later emit a stale result into another task.

## 3. Strong Parity Test

Use one fixed bounded product-path cycle with exact same snapshots/config/seeds:

```text
single
worker_threads(workerCount=2)
```

Compare canonicalized logical artifact contents, excluding only resource fields:

```text
S proposal/invalid/duplicate/unique records
D trigger/catalog/D-specific-state/ds-trial records
local frontier lineages and order
backprop validation W/D/L/N/Score70
lineage selection and pool decision
```

Assert worker run evidence has:

```text
completed worker work units > 0
stage counts S > 0
and D_PLUS_S/BACKPROP > 0 whenever same single run triggers/retains them
```

The test must fail if `parallelBackend` is accepted but ignored.

## 4. Performance Benchmark and Three-T0 Pilot

Run same bounded workload:

```text
single
worker_threads(2)
worker_threads(min(logical CPUs - 1, 6))
```

Record table:

```text
backend
worker count
completed/failed/timed-out work by stage
wall ms
parent CPU user/system ms
sum worker CPU user/system ms
max worker RSS
unique S/sec
D+S attempts/sec
backprop validations/sec
speedup versus single
canonical parity result
```

Then run real three-T0 pilot with selected worker count. Report exact configuration and completed stage; no silent fallback.

## Acceptance

- [ ] worker_threads executes actual S/D+S/backprop cycle work.
- [ ] single and worker canonical artifacts are identical for fixed inputs.
- [ ] evidence proves worker task-stage counts.
- [ ] timeout/error work is fail-closed and cannot leak stale results.
- [ ] benchmark includes single/2/default and a real three-T0 worker pilot.
- [ ] D-specific state capture remains part of D+S work.
- [ ] no active/global mutation.

## Delivery

Write `TASKS/tree/T134.report.md` with T133 wiring defect/fix; actual worker stage counts; canonical parity table; single/2/default resource-speed table; real three-T0 pilot result/resource table; worker failures/timeouts; D-specific-state confirmation; artifact paths; no-apply confirmation; changed files. Commit/push only `agent/tree`.
