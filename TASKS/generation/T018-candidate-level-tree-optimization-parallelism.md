STATUS: OPEN

# T018 - Candidate-Level Parallel Tree Optimization Runner

> Domain: `generation` | Decision owner: generation decision agent | Executor branch: `agent/generation`
> Prerequisites: T016 fixed-panel consumer API accepted; T017 sequential candidate pool accepted. This task adds outer candidate scheduling only. It must not change tree-optimizer decision logic.

## Objective

Create a generation-owned runner that optimizes independent frozen candidates in parallel. Each worker/process owns one complete candidate optimization at a time, preserving that candidate's deterministic `optimizeFormation` execution. Run up to 16 candidate processes concurrently, clamped to host logical CPU availability and to the number of remaining candidates.

This is **not** inner optimizer parallelism. Do not parallelize branch search, change cache behavior, share mutable experience state between candidates, or add a `workerCount` option to `optimizeFormation`.

## Input and Dispatch Unit

- Input only: the root `frozen_candidates.jsonl` produced by accepted T017.
- Each dispatch unit is one candidate's complete optimization lifecycle:
  1. construct isolated source formation from the frozen deck and baseline tree;
  2. call `optimizeFormation` with the canonical fixed eight-opponent panel and candidate-derived deterministic search/validation seed bases;
  3. return serialized result/no-op/error payload to the parent.
- The parent must not mutate frozen input records.

## Worker Policy

```text
requestedCandidateWorkers = 16
effectiveCandidateWorkers = max(1, min(16, availableLogicalCpus, candidateCount))
```

- Spawn at most `effectiveCandidateWorkers` simultaneously.
- Schedule remaining candidates as a bounded queue; do not spawn one process per candidate without a cap.
- Reuse the repository's established `worker_threads`/bundled-worker pattern where practical.
- Each worker must receive only serializable candidate data, panel data, and derived seeds.
- Do not share `ExperienceBank` state between workers. Isolate worker-local experience output or disable persistence for this generation run; no worker may write shared optimizer experience files concurrently.
- Record requested/effective counts, host CPU count, candidates dispatched, peak simultaneous workers, per-candidate worker start/end timestamps, and deterministic seeds.

## Fixed Panel and Determinism

- Resolve the panel exactly as `FORMATION_LIBRARY.slice(0, 7)` plus unique `壕炸金猴`; require eight unique opponents.
- Pass this panel through T016's `opponents` API on every candidate call.
- Derive distinct deterministic search and validation seed bases from candidate index. No two candidates may share a search/validation seed pair.
- Preserve candidate output order in the parent result file regardless of worker completion order.

## Tests

Add focused tests proving:

- given 24 candidates and 16 CPUs, peak active candidate workers is 16 and all 24 eventually complete;
- given fewer CPUs or fewer candidates, effective count clamps correctly;
- no more than the cap are active at any time and result ordering remains input order;
- each dispatched candidate receives the exact canonical eight-opponent panel and distinct deterministic seeds;
- a worker no-op/error is captured for that candidate without corrupting other candidates or the frozen input;
- worker-local state cannot overwrite shared optimizer experience/output files;
- no optimizer decision logic or active formation data changes.

Tests should use a mock candidate worker rather than expensive full optimization. Do not run deployment, apply, bundle build, or active-library writes.

## Output Isolation

Runner production outputs must be capable of writing only beneath `reports/new-formation-generation/sequential-tree-optimization/`. Do not overwrite T013/T017 outputs, shared optimizer reports, or `reports/optimized/`.

## Delivery

Write `TASKS/generation/T018.report.md` with implementation files, test results, CPU/capacity evidence, scheduling evidence, isolation design, and confirmation that tree optimization algorithm behavior was not changed. Commit and push only from `agent/generation`; do not modify this task file.
