STATUS: OPEN

# T021 - Accelerated Full Variant-to-Tree Cycle

> Domain: `generation` | Decision owner: generation decision agent | Executor branch: `agent/generation`
> Supersedes the execution portion of T020 because the tree optimizer and final-evaluation paths were accelerated after T019. This is one complete implementation-validation-production block; do not split it into feasibility subtasks.

## Objective

Validate and use the newly accelerated tree-optimization implementation, reported by the decision owner to be approximately 10x faster, then rerun the complete T017 frozen-candidate cycle with the fixed eight-opponent panel and make the final quality decision.

## Required Work Package

### 1. Performance and correctness validation

- Inspect and test the changed optimizer path, including `branch_induct.ts`, `hill_climb.ts`, `optimize_one.ts`, `sequential_tree_optimization.ts`, persistent/fine-grained workers, CPU monitoring, and match metrics.
- Add or run focused cheap tests for worker lifecycle, candidate ordering, deterministic seed isolation, CPU-cap behavior, no shared mutable experience writes, and metric equivalence.
- Establish a before/after benchmark on the same representative candidate, same fixed panel, same games and seeds. Record wall-clock duration, candidate evaluations, worker peak, and result equivalence. Report the measured speedup; do not claim 10x unless the benchmark supports it.
- Preserve the optimizer's fixed-panel contract: exactly bundle first seven plus unique `壕炸金猴`, both sides, no silent full-library fallback.
- Preserve the existing validation threshold and quality gate. Do not loosen acceptance criteria to make the accelerated run pass.

### 2. One authoritative production rerun

- Input only: T017 authoritative `reports/new-formation-generation/sequential-per-seed-cycle/frozen_candidates.jsonl` with 24 candidates.
- Do not regenerate variants or alter T017 data.
- Do not reuse T019's old optimization results as current quality evidence; the algorithm changed, so rerun tree optimization with the accelerated implementation.
- Run all 24 candidates through candidate-level bounded concurrency. Request 16 workers, cap at `min(16, available logical CPUs, candidate count)`, and record actual peak.
- Each candidate must receive distinct deterministic search, optimizer-validation, and final-evaluation seed bases.
- Run independent final baseline/final evaluation through candidate-level bounded concurrency as well. Do not leave final evaluation as a serial loop.
- Preserve result order by candidate index and isolate worker errors/no-ops.

### 3. Quality decision

Classify every candidate exactly once:

- `tree_optimized_candidate`: optimizer reports improvement and independent final aggregate undefeated rate and weakest cell do not regress;
- `deck_only_candidate`: structurally valid but no accepted optimized tree;
- `archive`: malformed/error or final aggregate undefeated rate below 0.25.

The cycle passes only if at least one candidate satisfies all:

- aggregate final undefeated rate >= 0.60;
- weakest cell >= 0.40;
- medium/heavy novelty or an uncovered source-seed/module direction.

If the gate passes, write `CONTINUE_VARIANT_PRODUCTION` and identify the successful directions. If it fails, write `ALGORITHM_IMPROVEMENT_REQUIRED` and identify the measured dominant failure mode. Do not implement another algorithm change inside T021.

## Cost and Isolation Rules

- This is the only real production rerun under the accelerated algorithm.
- Unit tests must use mocks/synthetic tasks; never call real optimizer loops merely to prove scheduler behavior.
- Do not deploy, apply, modify `FORMATION_LIBRARY`, rebuild bundle artifacts, or overwrite T013/T017 historical outputs.
- Write current outputs under `reports/new-formation-generation/accelerated-sequential-tree-cycle/`.
- Preserve T019 and T020 evidence directories and optimization input byte-identically.

Required outputs:

- `performance_benchmark.json`
- `panel_manifest.json`
- `optimization_results.jsonl`
- `independent_final_evaluation.jsonl`
- `quality_decision.json`
- `summary.md`
- optional worker/per-candidate diagnostics

## Delivery

Write `TASKS/generation/T021.report.md` with changed files, benchmark before/after and measured speedup, focused test results, 24-candidate optimization and final-evaluation counts, requested/effective/peak workers for both phases, fixed panel, seed bases, quality decision, output paths, and safety confirmations. Commit and push only from `agent/generation`; do not modify this task specification.
