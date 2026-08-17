STATUS: OPEN

# T007 - Correct New-Formation Pilot Evaluation and Assembly

> Owner: Antigravity execution track. This task corrects rejected T006 implementation `ba1c39b`; retain its useful bounded-runner/output behavior and do not restart the pilot design.

## Objective

Make the new-formation pilot mechanically reproducible and semantically aligned with the existing formation assembly pipeline, so coarse and refinement metadata truthfully describe distinct arena simulations. The task remains candidate-only: it must never change the active formation library or deploy a candidate.

## Required Changes

1. **Real seed-base control in the shared evaluator.**
   - Extend `evaluateBatchParallel` in `src/engine/tree/arena_parallel.ts` with an optional fixed `seedBase` parameter (or a backwards-compatible options object).
   - All generated task seeds must be deterministic functions of that passed base, candidate index, opponent, side, and game index. Preserve current call behavior when the argument is omitted.
   - Pass `coarseSeedBase` for T006 coarse evaluation and `refinedSeedBase` for refinement. They must be distinct by validation, not only by documented defaults.
   - Persist the seed base actually passed to the evaluator in each evaluation record.

2. **Extract and reuse assembly logic.**
   - Refactor only as far as needed to expose a deterministic, non-evaluating generation/assembly helper from `src/engine/tree/generate_variants.ts` (or a narrow shared helper colocated with it).
   - The T006 runner must call that helper instead of maintaining copied versions of skeleton definition, output/survival candidate pools, badge selection, and basic deck-validity rules.
   - The helper must support a seeded selection path needed by T006 and return the complete team plus source metadata. Do not rewrite `COMBO_MODULES`, ontology, taxonomy, or existing variant operators.

3. **Archetype-correct reference trees.**
   - Select the reference tree by source archetype before `mapRefTreeToDeck`: `prayer`, `halfrush`, and `fullrush` must each use a documented corresponding existing formation template.
   - Store the chosen `referenceFormation` in each candidate record.
   - Do not fallback silently to an unrelated tree. If a named template is unavailable, fail with a clear actionable error before writing evaluated records.

4. **Preserve T006 safety constraints.**
   - Keep output restricted to `reports/new-formation-pilot/`.
   - Keep `--dry-run`, canonical team+badges and tree-fingerprint deduplication, and hard attempt-cap partial termination.
   - Keep worker count at most four. With T005 still `IN_PROGRESS`, do not run arena evaluation for delivery; run dry-run and unit tests only.
   - Do not modify `src/ai/formation_library.ts`, `public/ai-bundle.iife.js`, `arena.ts`, `branch_induct.ts`, `tree_ops.ts`, `evol_gene.ts`, `cycle_optimize.ts`, `apply_optimized.ts`, or reports outside the isolated pilot directory.

## Tests and Acceptance

- [ ] A focused automated test proves two calls to `evaluateBatchParallel` with different bases produce disjoint deterministic task-seed schedules. Test the task construction/seed derivation directly; do not use expensive arena runs.
- [ ] A pilot-runner test confirms the coarse and refined evaluator invocations receive distinct bases, and candidate JSONL records retain the exact bases used.
- [ ] A test confirms one generated candidate per each of `prayer`, `halfrush`, and `fullrush` records its archetype-appropriate reference formation; a missing template must throw rather than silently fallback.
- [ ] A test confirms the pilot uses the extracted assembly helper, with no second copy of the core skeleton/pool/badge/validation rules in `new_formation_pilot.ts`.
- [ ] `npx vite-node tests/new_formation_pilot.test.ts` passes.
- [ ] `npx vite-node --script src/engine/tree/new_formation_pilot.ts --dry-run --count 6 --workers 2` terminates, produces isolated output, covers at least three paths, and does not mutate `FORMATION_LIBRARY`.
- [ ] `npx tsc --noEmit` introduces no errors in files edited for this task; report other pre-existing errors without fixing unrelated files.
- [ ] Do not perform an arena-evaluated pilot run while T005 is active. State this explicitly in the report.

## Delivery

Write `TASKS/T007.report.md` with changed files, test commands/results, the exact reference-tree mapping, seed derivation contract, resource settings, and explicit confirmation that no active library or non-pilot report was modified. Commit and push implementation plus report. Do not modify this task file.
