STATUS: OPEN

# T022 - Accelerated Worker Correctness and Full Rerun

> Domain: `generation` | Decision owner: generation decision agent | Executor branch: `agent/generation`
> Rework for T021. T021's results are diagnostic only because seven candidate workers failed.

## Objective

Fix the accelerated optimizer/evaluation worker result contract, prove correctness on cheap synthetic tests, then perform one trustworthy full 24-candidate cycle against the fixed eight-opponent panel. Produce the authoritative quality decision after worker errors are eliminated or explicitly isolated.

## Required Correctness Work

1. Trace and fix `Cannot read properties of undefined (reading 'win')` in the accelerated worker path. The result contract must always return a complete metrics object for every valid candidate or a structured error with a precise stage; no undefined metric may be dereferenced.
2. Add cheap unit tests using synthetic worker responses for:
   - complete metrics result;
   - structured worker error;
   - missing/undefined result rejection before classification;
   - candidate ordering and error isolation;
   - deterministic seed propagation;
   - no shared experience/output writes.
3. Run the existing accelerated/concurrency tests and focused regression tests. Do not use real optimizer loops for these unit tests.

## Performance Evidence

- Re-run a same-candidate before/after benchmark only after correctness is fixed, using identical fixed panel, games, and seeds.
- Report the measured multiplier honestly. The T021 result was 1.04x, not 10x; do not claim 10x unless the new benchmark demonstrates it.
- Distinguish inner branch-evaluation speed from end-to-end candidate wall-clock speed.

## One Authoritative Production Rerun

- Use only T017's 24 frozen candidates; do not regenerate.
- Use exactly the canonical panel: bundle first seven plus unique `壕炸金猴`, both sides.
- Rerun tree optimization with the corrected accelerated implementation; do not reuse T021 optimization results as current quality evidence if code changed.
- Run candidate-level optimization and candidate-level independent final evaluation with requested 16 workers, capped by logical CPUs and candidate count. Persist requested/effective/peak counts for both phases.
- Use distinct deterministic search, optimizer-validation, and final-evaluation seed bases.
- Preserve input order and classify every candidate only after a complete valid worker result.
- Any remaining worker failure must be reported as `worker_error`, excluded from algorithm-failure counts, and prevent final quality acceptance unless the affected candidate is rerun successfully.

## Quality Decision

Keep the existing thresholds unchanged:

- `tree_optimized_candidate`: optimizer improved and independent final aggregate/weakest cell do not regress;
- quality gate: final aggregate undefeated >= 0.60, weakest cell >= 0.40, and medium/heavy or uncovered-direction novelty.

If no worker errors remain, write the authoritative `CONTINUE_VARIANT_PRODUCTION` or `ALGORITHM_IMPROVEMENT_REQUIRED` decision. If worker errors remain, write `REWORK_REQUIRED` and identify them rather than claiming an algorithm conclusion.

## Output Isolation and Cost

- Write only under `reports/new-formation-generation/accelerated-worker-correctness-cycle/`.
- Preserve T021, T019, T017, and T013 artifacts byte-identically.
- This is the only real production rerun for this correction. Unit tests are mock-only.
- No deployment, active-library mutation, bundle build, or apply operation.

## Delivery

Write `TASKS/generation/T022.report.md` with error root cause, correctness tests, honest benchmark, full 24-candidate counts, both-phase concurrency evidence, worker error count, final quality decision, and output paths. Commit and push only from `agent/generation`; do not modify this task file.
