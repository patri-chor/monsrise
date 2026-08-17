STATUS: OPEN

# T019 - Sequential Frozen Candidate Tree Optimization and Quality Decision

> Domain: `generation` | Decision owner: generation decision agent | Executor branch: `agent/generation`
> Prerequisites accepted: T016 fixed-panel API, T017 authoritative sequential frozen pool, T018 candidate-level parallel runner.

## Objective

Run the first complete `new deck + optimized tree` decision cycle. Consume every frozen candidate from T017, optimize its tree against the canonical fixed eight-opponent panel, independently validate baseline versus optimized tree, and issue an evidence-based quality decision: continue generation production or open a targeted algorithm-improvement task.

## Canonical Input and Panel

- Input only: `reports/new-formation-generation/sequential-per-seed-cycle/frozen_candidates.jsonl`.
- Require exactly 24 input records unless a documented input-integrity failure stops before dispatch.
- Panel: `FORMATION_LIBRARY.slice(0, 7)` plus unique `壕炸金猴`; exactly eight unique opponents.
- Every optimization call must pass this panel through `OptimizeFormationOptions.opponents`.

## Candidate-Level Execution

1. Dispatch all 24 candidates through the accepted T018 runner.
2. Request 16 candidate workers; effective count is `min(16, logical CPUs, candidate count)`, minimum 1.
3. Each worker processes one candidate end-to-end with isolated state and unique deterministic search/validation seed pair.
4. Do not parallelize inside `optimizeFormation`, do not share experience persistence, and do not mutate frozen input.
5. Retain parent result ordering by frozen candidate index regardless of completion order.

## Independent Final Evaluation

For every candidate, after optimizer completion/no-op:

1. Independently evaluate its baseline tree and returned optimized tree against all eight opponents, both sides.
2. Use a final evaluation seed base distinct from that candidate's search and validation seeds.
3. Record aggregate W/D/L, aggregate undefeated rate, per-opponent/per-side W/D/L, weakest cell, baseline-to-final deltas, tree fingerprints, optimizer validation data, trigger coverage, and no-op/error reason.
4. Use candidate-level evaluation resources without exceeding the same effective 16-process capacity; record actual evaluation and optimizer resource settings.

## Classification

Assign exactly one outcome per input:

- `tree_optimized_candidate`: `optimizeFormation.improved === true`, independent final aggregate undefeated rate does not regress versus baseline, and independent final weakest cell does not regress;
- `deck_only_candidate`: structurally valid candidate but no returned optimized tree meets the above condition;
- `archive`: malformed input, worker/evaluation failure, or independent final aggregate undefeated rate below 0.25.

## Quality Decision

The cycle passes only if at least one `tree_optimized_candidate` also has:

- final aggregate undefeated rate >= 0.60;
- final weakest cell >= 0.40;
- medium/heavy novelty bucket or a previously uncovered source-seed/module direction.

If the gate passes:

- write `quality_decision.json` as `CONTINUE_VARIANT_PRODUCTION`;
- identify qualifying candidates and their source/module/novelty evidence;
- do not generate more variants in this task.

If the gate fails:

- write `quality_decision.json` as `ALGORITHM_IMPROVEMENT_REQUIRED`;
- diagnose each failure into one or more of: deck weakness, no trigger/split, optimizer no-op, validation rejection, independent regression, weakest-cell weakness, panel coverage issue, or worker/evaluation failure;
- propose exactly one next task direction based on the dominant measured failure mode; do not implement algorithm changes in T019.

## Output Isolation

Write only to `reports/new-formation-generation/sequential-tree-optimization/`:

- `panel_manifest.json`
- `optimization_results.jsonl`
- `independent_final_evaluation.jsonl`
- `quality_decision.json`
- `summary.md`
- optional isolated per-candidate diagnostics

Do not overwrite T013, T017, older pilot outputs, shared optimizer reports, `FORMATION_LIBRARY`, active bundle artifacts, or experience files.

## Execution Budget, Tests, and Delivery

This is the first and only production optimization run for the T017 pool. Do **not** repeat T016's expensive real-simulation API feasibility cases: T016 is already accepted evidence that the fixed-panel API works.

- Add/run only cheap focused tests using mock candidate workers or synthetic optimizer results to prove dispatch-once behavior, panel payload propagation, distinct seed phases, ordered aggregation, classification, quality-decision logic, output isolation, and active-library protection.
- Do not use real `optimizeFormation` calls in unit tests, and do not run a second production optimization attempt for test verification.
- Run exactly one T019 production cycle for the 24 authoritative candidates with requested 16 candidate workers. That run is the sole real optimizer workload and must persist CPU/effective/peak-worker evidence.
- The task includes implementation, tests, the one production run, independent final evaluation, complete diagnostics, and the quality decision. Do not split these into follow-up feasibility tasks.
- Write `TASKS/generation/T019.report.md` with all counts, quality decision, qualifying candidates or dominant failure mode, worker evidence, test results, output paths, and explicit confirmation that nothing was deployed or applied.
- Commit and push only from `agent/generation`; do not modify this task file.
