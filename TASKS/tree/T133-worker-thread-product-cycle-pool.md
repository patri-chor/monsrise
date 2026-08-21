STATUS: OPEN
DOMAIN: tree
SUPERSEDES: T132-executable-s-ds-frontier-and-backprop

# T133 - Worker-Thread Product Cycle Pool

## Decision

Use Node `worker_threads` for parallel product-cycle work.

```text
single process / Promise.all: CPU battle remains serial; unsafe to concurrently
run mutable game globals in one isolate
child_process: safe isolation but each worker pays a full Node/V8 process RSS
worker_threads: one Node process, independent V8 isolates/module state, lower
startup and process overhead; correct default for product cycle parallelism
```

The repository already has `PersistentSimPool`/`arena_parallel` worker-thread patterns. Do not use their deprecated arena evaluation path. Reuse/adapt only the worker lifecycle, serializable-task, stable-result-order, timeout, and CPU-accounting patterns for formal product-path cycle work.

## Goal

Add one worker-thread pool for independent S/D+S/backprop product work in the consolidated Generation 2 optimizer. Prove product-path result determinism and measure speed/memory before making worker-thread parallelism default.

No child-process implementation. No same-isolate battle concurrency. No legacy arena runtime import. No new optimizer runner.

## 1. One Pool Boundary

Add exactly these optional cycle modules:

```text
cycle/product_worker_pool.ts
cycle/product_worker.ts
```

Responsibilities:

```text
product_worker.ts:
  receive serializable product task
  initialize its own engine/module isolate once
  execute product-path S search, D+S attempt, or L1/L2/backprop group
  return serializable result, CPU time, wall time, RSS delta, stable work ID

product_worker_pool.ts:
  own persistent Worker instances for one optimizer/pilot run
  bounded queue / timeout / crash containment
  deterministic work dispatch and result ordering
  aggregate resource metrics
  terminate workers after run
```

Do not duplicate cycle objective/search semantics in a worker. Extract serializable work functions from `search.ts`, `lineage.ts`, and/or `optimizer_cycle.ts` as needed so single-thread and worker-thread paths call the same product-path operations.

## 2. Configuration

Add to `OptimizerCycleConfig`/pilot config:

```ts
parallelBackend: 'single' | 'worker_threads'; // default worker_threads after parity
workerCount?: number;                         // default min(logicalCpus - 1, 6), >=1
workerTimeoutMs?: number;
```

Worker assignment units:

```text
one source-case S discovery search
one D attempt (its <=8 S trials remain serial within that worker)
one retained-lineage full L1/L2/backprop validation group
```

This preserves shared mutable state inside an isolate and avoids splitting one D attempt across workers.

## 3. Determinism

For identical:

```text
snapshot fingerprints
pool_before revision
config
seed stream
work IDs
```

`single` and `worker_threads` must yield identical, canonicalized:

```text
proposal/invalid/duplicate/unique counts
candidate/state/output fingerprints
S/D+S frontier membership/order
D trigger/no-signal behavior
backprop W/D/L/N/Score70
selected lineage / pool decision
artifact logical records
```

Parent process sorts every received result by stable `workId`, then case/D/lineage ID before merging. Wall/CPU/RSS fields may differ and are excluded from parity equality.

Worker error/timeout:

```text
record failed stable work item
no silent retry / reseeding
fail pilot/cycle explicitly when required formal work has no result
```

## 4. Resource Accounting

Per run/stage record:

```text
backend
workerCount
logical CPUs
wall time
parent CPU time
sum worker CPU user/system time
peak / per-worker RSS where available
queued / completed / failed / timed-out work units
S/D+S/backprop work distribution
```

No artificial CPU spin. Avoid process-wide `process.memoryUsage()` as a fake total; worker reports own RSS and pool reports max/sum sampled RSS with method documented.

## 5. Verification and Benchmark

1. Focused worker lifecycle/serialization test.
2. Product-path parity test:

```text
same bounded cycle once single, once worker_threads(2)
canonical evidence equality excluding resource timings
```

3. Bounded performance benchmark:

```text
same practical case matrix
single vs worker_threads 2 vs worker_threads min(CPUs-1, 6)
report wall time, CPU, RSS, throughput, speedup
```

4. One real three-T0 L1/L2 pilot with worker threads. If system load/memory cannot support default worker count, use measured lower count and report the concrete resource limit; do not silently fallback to single.

Tests should finish within 120 seconds. The real benchmark/pilot may run longer but must report progress/resource metrics and exact completed stage.

## Acceptance

- [ ] Product cycle parallelism uses worker_threads, not child processes or same-isolate concurrency.
- [ ] Single/worker canonical results are equal for same work/seed inputs.
- [ ] S, D+S, and backprop units use one shared operation path.
- [ ] Worker count is bounded/configurable; workers terminate cleanly.
- [ ] Resource and speed benchmark demonstrates measured tradeoff.
- [ ] Real three-T0 pilot runs with the chosen worker count.
- [ ] No legacy arena dependency or active/global mutation.

## Delivery

Write `TASKS/tree/T133.report.md` with backend decision; worker architecture; parity table; single/2/default-worker benchmark table (wall/CPU/RSS/throughput/speedup); real three-T0 pilot resource/result summary; worker failures/timeouts; artifact paths; no-apply confirmation; changed files. Commit/push only `agent/tree`.
