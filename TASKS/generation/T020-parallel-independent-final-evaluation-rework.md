STATUS: OPEN

# T020 - Parallel Independent Final Evaluation Rework

> Domain: `generation` | Decision owner: generation decision agent | Executor branch: `agent/generation`
> Rework for T019. Do not repeat candidate tree optimization.

## Objective

Complete the missing T019 resource contract by evaluating all 24 already-optimized candidates' baseline and final trees through a bounded candidate-level pool of at most 16 workers, then regenerate the authoritative independent evaluation and quality decision.

## Reuse Existing Work

- Reuse `reports/new-formation-generation/sequential-tree-optimization/optimization_results.jsonl` exactly as produced by T019.
- Do not call `optimizeFormation` again.
- Do not regenerate variants, rerun T017, or change the frozen candidate input.
- Do not repeat the 862.5-second optimization workload.

## Required Evaluation

For each of the 24 candidates, one isolated worker must:

1. construct the frozen baseline tree and the optimized tree from the existing optimization result;
2. evaluate baseline and final trees against all eight canonical opponents, both sides, with the existing distinct final seed base;
3. return per-cell and aggregate W/D/L, undefeated rate, weakest cell, and deltas;
4. preserve candidate index ordering in the parent output.

Use the candidate-level pool pattern already accepted in T018. Effective count:

```text
max(1, min(16, availableLogicalCpus, candidateCount))
```

Record `requestedEvaluationWorkers`, `effectiveEvaluationWorkers`, `availableLogicalCpus`, `peakActiveEvaluationWorkers`, and total evaluation duration in a rework manifest or quality decision artifact.

## Quality Decision

Apply the existing T019 classification and quality gate exactly; do not loosen thresholds:

- tree optimized candidate requires optimizer improved plus no final aggregate/weakest-cell regression;
- quality gate requires aggregate undefeated >= 0.60, weakest cell >= 0.40, and medium/heavy or uncovered-direction novelty.

The expected prior result was 0 qualifiers and dominant `optimizer_no_op`; preserve that result if the reused data and parallel final evaluation confirm it. If results differ, report the exact evidence.

## Tests and Cost Control

- Unit tests must use synthetic evaluator tasks/mocks to prove peak cap, CPU/candidate clamping, ordering, and worker error isolation.
- Do not run real optimizer calls in tests.
- Run one production final-evaluation rework over the existing 24 optimization results. This is the only real workload in T020.
- No deployment, bundle build, active-library mutation, or historical artifact modification.

## Outputs and Delivery

Update only under `reports/new-formation-generation/sequential-tree-optimization/`, adding an explicit `final-evaluation-manifest.json` and replacing/regenerating only `independent_final_evaluation.jsonl`, `quality_decision.json`, and `summary.md` as needed. Preserve `optimization_results.jsonl` byte-identically.

Write `TASKS/generation/T020.report.md` with reused optimization hash, evaluation concurrency evidence, test results, final quality decision, and proof that no tree optimization was repeated. Commit and push only from `agent/generation`; do not modify this task file.
