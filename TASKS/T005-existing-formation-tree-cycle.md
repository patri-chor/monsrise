STATUS: IN_PROGRESS

# T005 — Existing Formation Tree Decision Cycle

> Owner: DeepSeek decision/execution track. This is a fresh post-T004 cycle for existing formations.

## Objective

Validate the new observation-driven tree optimizer on real existing formations, then produce isolated optimization candidates only when actual trigger coverage and independent validation both pass. Do not change the active formation library in this task.

## Why this is separate

T001 completed an earlier cycle. T003/T004 subsequently changed observation timing, exact fork matching, validation seeds, and experience-key behavior. The old optimization reports therefore cannot be treated as proof that the new optimizer works end to end.

## Scope

1. Run a bounded smoke evaluation first, sequentially, on 2 representative existing formations:
   - one with an existing conditional branch (`礼物救星` or `铲土多核`);
   - one without a newly-added key branch.
2. Inspect each result for:
   - non-empty R1-R5 observation samples where rounds are played;
   - `forkRound` and `triggerCoverage`;
   - non-empty independent validation result;
   - branch adoption only when the 5% validation gate passes.
3. If smoke passes, run a sequential candidate-only optimization sweep for eligible existing formations using a new isolated output directory under `reports/tree-cycle/`.
4. Candidate outputs must include base tree fingerprint, search/validation seeds, trigger coverage, before/after validation scores, and no-write verdict.

## Hard constraints

- Do not run `apply_optimized.ts`.
- Do not modify `src/ai/formation_library.ts` or the separate battle-ai library.
- Do not overwrite `reports/optimized/`, `reports/branch_induct_result.json`, or shared matrix files; use `reports/tree-cycle/`.
- Do not run concurrent high-worker arena evaluation while T006/new-formation generation is evaluating candidates.
- Use at most 4 arena workers / processes for this track unless the other track is idle.
- Do not treat a no-split/no-trigger result as a failure; report it as a valid no-op.

## Smoke acceptance

- [ ] Both representative runs complete without exception.
- [ ] Observations exist for played rounds even where no conditional branch was selected.
- [ ] `triggerCoverage.totalObserved > 0` whenever a branch is proposed.
- [ ] Any `improved=true` result meets independent validation: undefeated delta >= 0.05 and losses do not increase.
- [ ] No active library or shared optimized artifact changes.

## Batch admission gate

Only after smoke acceptance, schedule eligible existing formations sequentially. Candidate artifacts are reviewed by the decision owner before any later apply task is created.

## Delivery

Write `TASKS/T005.report.md` with commands, run list, output paths, trigger coverage summaries, candidate/no-op counts, and explicit confirmation that nothing was applied.
