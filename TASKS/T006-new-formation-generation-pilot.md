STATUS: OPEN

# T006 — New Formation Generation Pilot

> Owner: Antigravity/new-window execution track. This supersedes the paused T002 pilot scope; do not reopen T002.

## Objective

Build and validate a bounded, reproducible pipeline for generating and evaluating new formation candidates. The task produces an isolated candidate dataset and quality report; it does not modify the active formation library or deploy any candidate.

## Context

Existing assets:
- `variant_generate.ts`: mutation from an existing seed.
- `generate_variants.ts`: composition/assembly pipeline.
- `arena_parallel.ts` and `arena_worker.ts`: parallel candidate evaluation.
- `flow_library.ts`, `monster_taxonomy.ts`, `deck_ontology.ts`: composition and badge constraints.

T003/T004 completed tree-decision evaluation hardening. This task remains independent from tree-branch application: generated candidates must retain their tree and evaluation metadata but must not be applied to `FORMATION_LIBRARY`.

## Required scope

1. Implement a pilot runner, e.g. `src/engine/tree/new_formation_pilot.ts`.
2. Generate candidates from at least 3 distinct archetype/module paths, using existing generation helpers rather than rewriting their operators.
3. Enforce a hard generation-attempt cap. A duplicate- or combo-only-depleted search must terminate with a structured partial result, never loop indefinitely.
4. Write all results only under `reports/new-formation-pilot/`:
   - `candidates.jsonl`
   - `summary.md`
   - optional diagnostics JSON
5. Every JSONL candidate must contain at least:
   - deterministic candidate id and generation seed
   - source/archetype/module path
   - full team with badges
   - tree
   - structural validation verdict/reason
   - coarse and refined evaluation fields when evaluated
   - evaluator seed base, games, worker count
6. Use two-stage evaluation:
   - coarse pass: low-cost fixed seeds;
   - refinement: independent seed base and higher games for candidates that pass a documented threshold.
7. Deduplicate by canonical team+badge representation and canonical tree fingerprint, not only display name.
8. Provide a `--dry-run` mode that builds and validates candidates without arena evaluation.

## Resource and shared-output constraints

- Do not modify `src/ai/formation_library.ts`, `public/ai-bundle.iife.js`, or the separate battle-ai repository.
- Do not run `apply_optimized.ts`, `cycle_optimize.ts`, full matrix, or deployment.
- Do not write `reports/optimized/`, `reports/variants_*.json`, or shared matrix/state reports.
- Use at most 4 workers while T005 is active. If T005 is evaluating, run only dry-run/structural generation; wait before arena evaluation.
- Do not modify tree decision files: `arena.ts`, `branch_induct.ts`, `tree_ops.ts`, `evol_gene.ts`, `cycle_optimize.ts`.

## Acceptance

- [ ] `--dry-run` terminates and writes a valid isolated summary.
- [ ] Requested candidate count greater than the reachable unique space terminates at an explicit attempt cap with a partial-result reason.
- [ ] At least 3 source/archetype paths appear in the pilot output.
- [ ] No duplicate canonical team+badges+tree fingerprint records occur.
- [ ] Coarse/refined evaluations use distinct fixed seed bases.
- [ ] Output contains no active-library mutation.
- [ ] Existing `variant_generate.ts` still runs for one small seed case.
- [ ] `npx tsc --noEmit` introduces no errors in edited files; report pre-existing errors only.

## Delivery

Write `TASKS/T006.report.md` with changed files, commands/results, resource settings, generated/accepted/rejected counts, output paths, and any capacity/quality limitations. Commit and push implementation plus report. Do not modify this task file.
