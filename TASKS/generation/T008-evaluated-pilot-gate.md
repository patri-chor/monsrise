STATUS: IN_PROGRESS

# T008 - Gated Evaluated New-Formation Pilot

> Domain: `generation` | Decision owner: generation decision agent | Executor branch: `agent/generation`
> Prerequisite: T006 accepted pipeline. This task runs candidate-only evaluation and never changes the active formation library.

## Objective

Add an explicit, machine-checkable resource gate to the new-formation pilot, then execute one bounded reproducible evaluated pilot only if the gate reports that the tree track is idle. The output is a reviewed candidate dataset and evaluation quality summary, not a promotion or deployment decision.

## Required Scope

1. Add a reusable resource-gate helper for generation evaluation.
   - It must determine whether the tree-domain T005 work is active from the canonical task/status source, not from a manually edited boolean.
   - When blocked, `new_formation_pilot.ts` must refuse non-dry-run execution before compiling workers or writing evaluated candidate output, with a clear structured reason.
   - `--dry-run` must remain permitted while blocked.
   - Keep worker count constrained to 1..4.

2. Extend the pilot CLI/options only as needed for reproducible evaluated runs.
   - Support explicit `--seed`, `--coarse-seed-base`, `--refined-seed-base`, `--coarse-games`, `--refined-games`, `--threshold`, `--count`, and `--workers` flags.
   - Persist all effective options and gate verdict in `diagnostics.json` and `summary.md`.
   - Preserve existing default behavior for callers that import `runNewFormationPilot`.

3. Run exactly one evaluated pilot only if the resource gate permits it:
   - Count: 6 candidates maximum.
   - Workers: 2.
   - Coarse games: 2; refined games: 6.
   - Use non-default, documented distinct bases and a fixed generation seed.
   - Write only to `reports/new-formation-pilot/`; candidate output may overwrite prior pilot output in that same isolated directory.
   - If blocked, do not bypass the gate. Deliver a `STATUS: PARTIAL` report containing the exact gate verdict and stop after dry-run/tests.

4. Produce an evaluation-quality summary that separates:
   - generated candidates;
   - coarse-evaluated candidates;
   - refinement-eligible candidates and threshold;
   - refined-evaluated candidates;
   - any worker/evaluation failure;
   - seed bases, games, worker count, and run duration.

## Constraints

- Do not modify `src/ai/formation_library.ts`, `public/ai-bundle.iife.js`, `arena.ts`, `branch_induct.ts`, `tree_ops.ts`, `evol_gene.ts`, `cycle_optimize.ts`, `apply_optimized.ts`, or a separate battle-ai repository.
- Do not write `reports/optimized/`, `reports/variants_*.json`, shared matrix/state reports, or non-pilot candidate outputs.
- Do not alter tree-domain task files or statuses.
- Do not promote, deploy, or apply any candidate.
- Use existing `evaluateBatchParallel` and the T006 shared assembly pipeline; do not introduce a second evaluator or deck generator.

## Acceptance

- [ ] A focused test proves the gate blocks non-dry-run evaluation while T005 is active, without invoking workers/evaluator or writing evaluated JSONL.
- [ ] A focused test proves dry-run remains available while blocked.
- [ ] A focused test proves an idle gate permits evaluation and records its verdict/effective options in diagnostics.
- [ ] CLI parsing supplies all specified reproducibility options to the runner.
- [ ] `npx vite-node tests/new_formation_pilot.test.ts` passes.
- [ ] `npx tsc --noEmit` introduces no errors in edited files; report unrelated pre-existing errors only.
- [ ] If the real gate is open, report results from exactly one bounded evaluated run with the prescribed resource settings. If it is closed, report `PARTIAL`, do not evaluate, and do not claim candidate quality results.
- [ ] Explicitly confirm that no active formation, bundle artifact, deployment, or non-pilot report was changed.

## Delivery

Write `TASKS/generation/T008.report.md`. Include changed files, tests, exact gate source/verdict, effective options, evaluated-run metrics or blocking reason, output paths, and confirmation of all safety constraints. Commit and push only from `agent/generation`; do not modify this task file.
