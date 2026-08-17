STATUS: OPEN

# T015 - Frozen Candidate Fixed-Panel Tree Optimization

> Domain: `generation` | Decision owner: generation decision agent | Executor branch: `agent/generation`
> Prerequisites: T013 and T014 accepted. This task consumes the existing frozen 24-candidate pool. It does not regenerate variants.

## Objective

Optimize decision trees for the frozen T013 candidates while keeping each new deck fixed, using the same fixed eight-opponent panel for optimization, independent validation, and final comparison. Determine whether each output is a sufficiently strong and novel `new deck + optimized tree` candidate.

## Hard Prerequisite

Before any candidate optimization, verify that the public tree optimizer supports a backwards-compatible options parameter that accepts a caller-supplied opponent panel, for example:

```ts
optimizeFormation(BundleAI, source, gamesPerOpp, {
  opponents: Formation[],
  searchSeedBase,
  validationSeedBase,
})
```

The supplied panel must be used for trace collection, branch induction, matched-opponent filtering, branch search, and independent validation. If this interface is not present and tested on the current branch, write `TASKS/generation/T015.report.md` with `STATUS: PARTIAL`, identify the missing tree-domain prerequisite, and stop without running optimizer, arena, or generation work. Do not change tree optimizer source files in this task.

## Input and Fixed Panel

- Input only: `reports/new-formation-generation/per-seed-expansion/frozen_candidates.jsonl`.
- Resolve and persist the fixed panel as `FORMATION_LIBRARY.slice(0, 7)` plus the unique `壕炸金猴`; require exactly eight unique opponents.
- Use the candidate's own team and baseline tree. Preserve the frozen JSONL unchanged.

## Execution

1. For each frozen candidate, build an isolated source formation using the frozen team and baseline tree.
2. Invoke the fixed-panel tree optimizer with deterministic, distinct search and validation seed bases derived from candidate index.
3. Use at most 16 workers/processes only where the invoked evaluation implementation supports it; never exceed host CPU availability. Record actual resource settings.
4. Independently evaluate baseline tree and optimized tree against all eight opponents, both sides, using a final seed base distinct from optimizer search and validation bases.
5. Record per-opponent and aggregate W/D/L, undefeated rate, weakest cell, before/after delta, tree fingerprints, trigger coverage, no-op reason, and optimization validation result.
6. Categorize each candidate exactly once:
   - `tree_optimized_candidate`: existing optimizer validation passes and independent fixed-panel final comparison does not regress aggregate undefeated rate or weakest cell;
   - `deck_only_candidate`: deck is valid but no optimized tree passes validation;
   - `archive`: structural invalidity, evaluation failure, or final aggregate score below 0.25.

## Quality Gate

The cycle passes if at least one `tree_optimized_candidate` has:

- independent final aggregate undefeated rate at least `0.60`;
- weakest cell at least `0.40`;
- novelty bucket `medium` or `heavy`, or a previously uncovered source-seed/module direction.

If no candidate passes, do not regenerate or tune in this task. Write a diagnosis that identifies whether failure is due to deck quality, absent branch triggers, optimizer no-ops, validation rejection, weakest-cell regression, or insufficient coverage. That diagnosis will drive the next algorithm-improvement task.

## Output Isolation

Write only under `reports/new-formation-generation/frozen-tree-optimization/`:

- `panel_manifest.json`
- `optimization_results.jsonl`
- `summary.md`
- `quality_decision.json`
- optional per-candidate diagnostics JSON

## Constraints

- Do not alter `FORMATION_LIBRARY`, active bundle artifacts, deployment/apply code, frozen candidate input, T013 results, or any report outside this task output directory.
- Do not modify tree optimizer source or tree-domain task files.
- Do not perform new card-deck generation in this task.

## Delivery

Write `TASKS/generation/T015.report.md` with prerequisite evidence, processed/no-op/pass/archive counts, fixed-panel names, deterministic seeds, final quality-gate result, output paths, tests, resource settings, and confirmation of no active-library change. Commit and push only from `agent/generation`; do not modify this task file.
