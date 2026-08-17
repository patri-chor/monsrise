STATUS: OPEN

# T008 - Candidate Optimizer Experiment Validity

> Domain: `tree` | Decision owner: tree decision agent | Executor branch: `agent/tree`
> Prerequisite: T007 must be completed first. This task is the corrective follow-up for the failed 24-candidate experiment; do not rerun the 24-candidate batch before all acceptance checks pass.

## Decision Context

The prior accelerated experiment processed 24 candidates but produced:

- 1 `IMPROVED`
- 16 `NO_IMPROVEMENT`
- 7 `ERROR` (`Cannot read properties of undefined (reading 'win')`)
- 0 quality-qualified candidates

This is not evidence that 22 candidates had no valid split. Worker errors cannot be classified as no-op. In addition, final evaluation used one game per cell across 8 opponents x 2 sides: each cell score was only 0% or 100%, so a weakest-cell gate of >=40% effectively demanded no losses in all 16 cells. The pipeline also still uses `undefeated` for classification/gating while branch optimization has migrated to half-draw training score.

## Objective

Make candidate tree-optimization experiments correct, interpretable, and aligned with the training metric before running another candidate batch.

## Required Scope

Allowed files:
- `src/engine/tree/persistent_pool.ts`
- `src/engine/tree/candidate_optimization_runner.ts`
- `src/engine/tree/sequential_tree_optimization.ts`
- `src/engine/tree/accelerated_tree_optimization.ts`
- `src/engine/tree/match_metrics.ts`
- focused tests for these modules

Do not change:
- `TASKS/generation/**`, generation source, or generation reports
- active `FORMATION_LIBRARY`, bundle artifacts, shared matrix/state, apply/deploy code
- `scripts/watch-gemini.ps1`
- mutation/generation operators

## Required Changes

### A. Make PersistentSimPool request-safe

1. Concurrent top-level `dispatchTasks()` calls must not share uncorrelated message listeners on the same worker.
2. Add a per-dispatch request/batch identifier and return only matching worker responses, or serialize per-worker dispatch through a queue with equivalent correctness guarantees.
3. Guard `init()` with one shared initialization promise so concurrent callers cannot initialize workers twice.
4. On incomplete/malformed worker output, throw a structured error containing request id, expected/received task counts, and candidate identity when available. Never let an undefined result flow into `.win` access.
5. Add a concurrency regression test running at least two simultaneous optimizer-style batches through one pool. It must preserve result-to-request attribution and produce no undefined metrics.

### B. Separate optimizer outcomes

1. Extend `CandidateOptimizationResult` so it distinguishes at least:
   - `NO_INFORMATIVE_SPLIT`
   - `NO_OBSERVED_TRIGGER_AT_FORK`
   - `BRANCH_SEARCH_NO_TRAINING_GAIN`
   - `VALIDATION_TRAINING_REJECTED`
   - `ERROR`
   - `IMPROVED`
2. Do not label all `NO_IMPROVEMENT` results as `optimizer_no_op (no valid split/ig)`.
3. Preserve a backward-compatible aggregate/no-improvement view only if it cannot hide the detailed reason in artifacts.
4. Propagate the detailed reason through optimization JSONL, independent evaluation JSONL, quality decision JSON, and summary markdown.

### C. Use training score consistently

1. Use `trainingScore = (win + 0.5 * draw) / total` for candidate classification, optimizer deltas, aggregate quality gate, and weakest-cell score.
2. Preserve and output all three metrics for aggregate and cell-level results:
   - `trainingScore`
   - `pureWinRate`
   - `undefeatedRate`
3. Do not use `(win + draw) / total` as the quality/adoption decision metric.
4. Keep loss non-increase as an optimizer validation guard.

### D. Make weakest-cell gate statistically meaningful

1. Reject `gamesPerCellFinal < 3` before final quality classification, with an explicit configuration error; do not silently treat one-game cells as valid weakest evidence.
2. Set accelerated/sequential defaults to at least 5 final games per cell.
3. Define weakest score as the minimum cell `trainingScore` across the panel.
4. Output the weakest cell identity (opponent and side), its W/D/L, and all three metrics.
5. Gate thresholds must be documented in the summary. Do not claim a candidate is weak solely because a one-game cell lost.

### E. Bounded proof run

After implementation, run only a bounded proof experiment of at most 4 frozen candidates, with:
- fixed panel from T007;
- outer candidate concurrency <= 2;
- final games per cell >= 5;
- isolated directory `reports/new-formation-generation/optimizer-validity-proof/`.

The proof run is diagnostic, not a production candidate batch. It must show every candidate reaches a terminal detailed outcome without worker errors.

## Acceptance

- [ ] Two concurrent pool dispatches cannot cross-deliver worker results; regression test passes.
- [ ] No `.win`/`.draw`/`.loss` access occurs on an undefined worker result.
- [ ] Existing 7 worker errors are no longer reproducible in the proof run.
- [ ] No-op results have truthful detailed categories.
- [ ] All candidate/quality decisions use trainingScore; artifacts retain pureWinRate and undefeatedRate for display.
- [ ] `gamesPerCellFinal=1` is rejected; defaults use >=5.
- [ ] Weakest-cell result includes opponent/side and is calculated from trainingScore.
- [ ] Proof run has <=4 candidates, <=2 outer workers, >=5 games per final cell, and no active-library mutation.
- [ ] Focused existing branch induction and worker correctness tests pass, plus new tests.
- [ ] `npx tsc --noEmit` introduces no errors in edited files; document pre-existing errors only.

## Delivery

Write `TASKS/tree/T008.report.md` with changed files, test/proof commands, detailed result-count breakdown, proof-run metrics, and confirmation that no candidate was applied. Commit and push only `agent/tree`. Do not modify this task file.
