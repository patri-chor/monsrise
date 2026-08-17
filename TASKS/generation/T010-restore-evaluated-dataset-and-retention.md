STATUS: OPEN

# T010 - Restore Evaluated Pilot Dataset and Re-run Retention

> Domain: `generation` | Decision owner: generation decision agent | Executor branch: `agent/generation`
> Prerequisite: T009 was rejected because its CLI consumed a stale three-candidate dry-run dataset.

## Objective

Restore the single existing T008 evaluated pilot dataset from a durable, auditable local source without running another arena evaluation, then rerun T009 retention against that restored evaluated data. Make focused tests write only temporary fixture/output locations so they cannot overwrite `reports/new-formation-pilot/`.

## Required Scope

1. Locate and validate a durable source for the six-candidate T008 evaluated dataset. It must contain the fixed run metadata from the accepted T008 evidence: seed `42`, workers `2`, coarse games `2`, refined games `6`, seed bases `1000`/`9000`, six coarse evaluations, and three refined evaluations.
2. If no such local durable source exists, write `TASKS/generation/T010.report.md` with `STATUS: PARTIAL`, identify the exact missing artifact, and stop. Do not create a second evaluated run.
3. If recovered, write the exact evaluated dataset only to `reports/new-formation-pilot/candidates.jsonl`, preserving its candidate IDs, evaluation records, and run metadata.
4. Change focused tests so every generated fixture/output path is under a test temporary directory, never `reports/new-formation-pilot/`. Include a regression assertion that the production pilot dataset is byte-identical before and after the test suite.
5. Re-run `candidate_retention.ts` against the restored production dataset. Its output must analyze six candidates; every performance-ranked retained candidate must have `scoreSource` `coarse` or `refined`, never `none`.
6. Update `TASKS/generation/T009.report.md` only if the T009 implementation is now demonstrated against restored evaluated input; otherwise leave the rejected report and document T010 result separately.

## Constraints

- Do not invoke `evaluateBatchParallel`, `arena.ts`, workers, full matrix, cycle optimizer, deployment, or apply code.
- Do not modify `FORMATION_LIBRARY`, bundle artifacts, tree-domain task files, or non-pilot output directories.
- Do not fabricate evaluation scores, candidate rows, or run metadata.
- Do not rerun T008's evaluated pilot. This task restores evidence and fixes test isolation only.

## Acceptance

- [ ] Recovery source and integrity checks are documented.
- [ ] No new arena/worker activity occurs.
- [ ] Focused tests preserve the production pilot dataset byte-for-byte.
- [ ] `npx vite-node tests/candidate_retention.test.ts` passes.
- [ ] Production retention analyzes six evaluated candidates and records valid score sources.
- [ ] All output remains under `reports/new-formation-pilot/` or test temporary paths.

## Delivery

Write `TASKS/generation/T010.report.md` with recovery source, integrity proof, changed files, commands/results, retained/rejected counts, and explicit confirmation that no battle evaluation was run. Commit and push only from `agent/generation`; do not modify this task specification.
