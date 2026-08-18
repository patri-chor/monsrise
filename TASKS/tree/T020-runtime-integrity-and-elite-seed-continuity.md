STATUS: OPEN
DOMAIN: tree

# T020 - Runtime Evaluation Integrity and Elite-Seed Continuity

> Domain: `tree` | Executor branch: `agent/tree`
> Prerequisite: complete T019's Git-tracked readable archive repair first. This task supersedes T017's source-strength interpretation; do not use T017's all-zero rows to rank source formations.

## Verified Problem

T017's tree/deck coherence gate correctly rejects static deep-branch references to missing team monsters, but many candidates still have exact `0W/0D/70L` records across all attempts and panels, including all three new variants for 泉水剑、坚果救星、经典救星、肃清 and others.

This is not credible ordinary performance data. In `src/engine/tree/fine_grained_worker.ts`, an exception is converted into:

```ts
{ w: 0, d: 0, l: task.games, error: message }
```

but `PersistentSimPool.evalCandidateBatchOnMatchedParallel()` aggregates only W/D/L and discards `error`. T017 therefore recorded false losses and falsely reported zero worker errors. Static coherence alone is insufficient because runtime bundle injection, branch resolution, deployment budget, and engine exceptions remain unverified.

T017 also replaced T014's known fixed candidate pool with a new three-mutation pool. This discarded continuity with previously validated candidates, including `cand_s2_1_8e` (坚果救星), which T014 recorded as early held-out `53.6% -> 62.9%` and current strong-panel `+12.5 pp`. The new T017 candidates `cand_s2_1_f175`, `cand_s2_2_49de`, and `cand_s2_3_568c` are different candidates, not retests of `cand_s2_1_8e`.

## Objective

Make simulation errors observable and disqualifying, diagnose/reclassify all T017 all-zero records, and restore a persistent elite-seed pool so verified candidates are compared and retained across training rounds. Do not begin a new broad mutation campaign until this is complete.

## A. Error-Preserving Evaluation Contract

1. Change the persistent evaluation contract so every worker result `error` is propagated to the caller. Never silently convert an exception to an ordinary loss.
2. `MatchMetrics` or a companion diagnostic result must include at minimum:
   - `workerErrorCount`;
   - task-level errors with candidate ID/fingerprint, opponent family/variant, side, seed, game count, and message;
   - completed W/D/L excluding errored games;
   - `isEvaluationComplete`.
3. A candidate with any runtime error is `RUNTIME_INVALID`, not rejected for weak performance. It must never enter attempt aggregation, generalization, reinforcement, Tier 2, Tier 3, or source ranking.
4. Preserve raw runtime errors in a committed diagnostic archive; do not only print them to console or ignored runtime reports.
5. Add a regression test that injects a worker/task failure and proves it is visible to the runner and cannot produce a normal `0W/0D/NL` metric.

## B. Full Runtime Preflight Before Training

1. After static `validateTreeDeckCoherence`, run a deterministic engine-level preflight through the same worker/bundle path used by training:
   - all seven early families;
   - both sides;
   - one deterministic game per cell is sufficient for structural executability only.
2. Any preflight error rejects the candidate before 3-attempt optimization, with the exact error in screening/rejection ledger.
3. Distinguish valid all-loss performance from runtime invalidity. A valid candidate may lose every completed game, but only if its preflight and completed evaluation have zero errors.
4. Diagnose all T017 candidates whose archive contains exact all-zero `0/70` evaluation. Produce a source/candidate error table. Do not claim those candidates are weak unless the clean rerun completes without error.
5. Recompute only affected T017 candidate records after runtime repair. Mark the prior archive as superseded for ranking, while retaining it for audit.

## C. Persistent Elite-Seed Pool

1. Create a committed fixture/ledger of previously evidenced candidates, retaining source identity, original candidate ID, deck/tree fingerprint, provenance task, early-seven held-out results, strong-panel result, and exact seed schedule.
2. Include at least the T014 proven improvements:
   - `cand_s1_1_2a` (泉水剑);
   - `cand_s1_2_2b` (泉水剑);
   - `cand_s2_1_8e` (坚果救星).
3. Every future source-family training pool must contain:
   - the immutable Tier 1 source baseline where it is executable;
   - its persistent elite seeds, unchanged;
   - its new diversity mutations.
   New random mutations must not replace or erase elite seeds.
4. Retest elite seeds with the repaired runtime contract and the current early-seven / strong-panel protocol. Keep their historical T014 measurements separate from new measurements; report comparable deltas rather than assuming equality across schedules.
5. New candidates should be judged against both their source baseline and the best eligible elite seed of the same source. Do not optimize only all2/fullrush sources simply because broken candidates from other sources recorded zero.

## D. Coverage and Reporting

1. Report results by source, separating:
   - static-invalid;
   - runtime-invalid with error signatures;
   - complete-valid evaluated;
   - elite-seed retest;
   - new mutation.
2. No Tier declaration may be made while any included candidate has unclassified runtime errors.
3. Preserve current rules: new candidates exactly 8 monsters; no total-cost ceiling; `gift_jungle` remains unmodified legacy 7-monster Tier 1 and does not generate 8-monster descendants without a separate decision.
4. No active library/bundle change, apply, deploy, generation-domain modification, or broad new candidate generation in this task.

## Acceptance

- [ ] Worker errors cannot be represented as ordinary losses anywhere in the persistent evaluation API.
- [ ] Engine-level preflight runs before optimization and commits detailed errors.
- [ ] Every T017 all-zero record is classified by a clean error-preserving rerun.
- [ ] T014 elite candidates, including `cand_s2_1_8e`, exist in a committed persistent elite-seed ledger and are retested.
- [ ] No source ranking or tier decision depends on runtime-invalid rows.
- [ ] Regression tests cover worker-error propagation, preflight rejection, elite-seed preservation, and T013 task preservation.
- [ ] No active bundle/apply/deploy change.

## Delivery

Write `TASKS/tree/T020.report.md` with exact root-cause error table, affected/repaired candidate IDs, T014 elite retest results, source coverage, changed API behavior, test commands, superseded archive reference, and no-apply confirmation. Commit/push only `agent/tree`. Do not modify this specification.
