STATUS: OPEN

# T012 - First-Four Cycle Output Isolation Repair

> Domain: `generation` | Decision owner: generation decision agent | Executor branch: `agent/generation`
> This is a narrow repair to rejected T011. Do not regenerate candidates, rerun arena evaluation, or invoke tree optimization.

## Objective

Ensure the first-four-cycle runner and its focused tests write only to their explicit isolated output directories. In particular, importing or testing first-four generation must never create, update, or invoke the retention CLI against `reports/new-formation-pilot/`.

## Required Scope

1. Identify the import-time or test-time path that caused `tests/first_four_generation.test.ts` to print and write `reports/new-formation-pilot/retention.json` and `retention.md`.
2. Eliminate the side effect. Importing helper modules must not execute a CLI or write output.
3. Make the first-four runner pass explicit input/output paths to all retention helpers. Its production outputs remain exclusively under `reports/new-formation-generation/first-four-cycle/`.
4. Make focused tests use a unique temporary directory beneath `tests/.tmp/first-four-generation/` and clean it up after success/failure.
5. Add byte-identical regression checks for all existing production artifacts before/after the test suite:
   - `reports/new-formation-pilot/candidates.jsonl`
   - `reports/new-formation-pilot/retention.json` when present
   - `reports/new-formation-pilot/retention.md` when present
   - `reports/new-formation-generation/first-four-cycle/` artifacts
6. Preserve the accepted T011 first-four manifest, generated candidates, retention results, and summary. Do not alter their candidate results or scores.

## Constraints

- Do not invoke `evaluateBatchParallel`, any arena command, worker, optimizer, full matrix, deployment, or apply operation.
- Do not modify tree-domain files, `branch_induct.ts`, `FORMATION_LIBRARY`, or bundle artifacts.
- Do not write outside `tests/.tmp/` during tests and `reports/new-formation-generation/first-four-cycle/` during an explicitly requested production runner invocation.

## Acceptance

- [ ] `npx vite-node tests/first_four_generation.test.ts` passes.
- [ ] Test output contains no write path under `reports/new-formation-pilot/`.
- [ ] All protected production artifacts are byte-identical before and after the focused test.
- [ ] A test-run production invocation using an explicit temporary output directory writes only there.
- [ ] Existing T011 production artifacts are unchanged.
- [ ] No arena, worker, tree optimizer, active-library, deployment, or bundle action occurs.

## Delivery

Write `TASKS/generation/T012.report.md` with root-cause explanation, changed files, tests/results, hash or byte-identity evidence, and explicit confirmation that T011 artifacts and active formations were unchanged. Commit and push only from `agent/generation`; do not modify this task specification.
