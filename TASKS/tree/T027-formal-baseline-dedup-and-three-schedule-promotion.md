STATUS: OPEN
DOMAIN: tree

# T027 - Formal Baselines, Candidate Deduplication, and Three-Schedule Promotion

> Domain: `tree` | Executor branch: `agent/tree`
> Uses T026 formal 140-game screen as a screening signal only. No active bundle change, apply, deploy, or automatic Tier 2 admission.

## Verified T026 Evidence

T026 contains genuine formal screen observations:

```text
60 candidates × 140 games = 8,400 games
runKind=FORMAL_SCREEN
gamesPerCell=10
total=140
workerErrorCount=0
isEvaluationComplete=true
```

This establishes that four-cost sources can run and have nonzero formal results. Notable formal scores include:

```text
肃清 cand_s5_2_light_suqi: 85.7%
壕炸金猴 cand_s9_5_heavy_gold: 69.3%
礼物救星 cand_s8_3_medium_gift: 65.7%
经典救星 cand_s3_1_light_clas: 60.4%
铲土多核 cand_s7_4_medium_spad: 57.5%
坚果救星 cand_s1_5_heavy_nuts: 53.2%
```

These are not yet adoption evidence because source baselines in the experience library have only 14-game diagnostic observations, and each candidate has only one formal seed schedule.

## Verified Data-Quality Issues

1. Candidate IDs are not a uniqueness proof. For example, `cand_s6_5_heavy_ladd` and `cand_s6_6_heavy_ladd` have different IDs but the same formal candidate fingerprint `candidate_c4d69a8f`.
2. `candidate_registry.jsonl` does not persist the full canonical tree/deck fingerprint necessary to audit duplicates.
3. `pruning_summary.json` shows `prunedBranchCount: 0` and `prePruningScore/postPruningScore: 0` for reported candidates. Do not claim pruning improved performance, and do not use its output as a promotion input.

## Objective

Convert T026's one-schedule screen into reliable per-source comparative evidence: establish high-sample baselines, eliminate duplicate/no-op variants, and promote only unique candidates through three independent high-sample schedules.

## A. Canonical Candidate Registry and Deduplication

1. Define a canonical candidate fingerprint containing exact ordered team IDs/badges and full Evol tree topology, node IDs/rounds/conditions, ordered placements, and coordinates.
2. Backfill registry with the fingerprint, parent/source fingerprint, mutation vector, and `duplicateOf` when applicable.
3. Group the 60 T026 inventory entries by canonical fingerprint.
4. For each duplicate group:
   - retain one deterministic canonical representative;
   - mark all others `DUPLICATE_NOOP` with representative ID and reason;
   - preserve their T026 observations for audit but do not count them as independent diversity candidates or promote them separately.
5. Add test coverage proving two IDs with the same team/tree collapse into one group, while a coordinate, badge, placement order, or branch-condition change does not.

## B. High-Sample Per-Source Baselines

1. For all ten executable 8-monster Tier 1 sources, run exactly the same three independent held-out schedules intended for promotion:

```text
7 early families × 2 sides × 25 games/cell × 3 schedules
= 1,050 games per source baseline
```

2. Use fixed non-overlapping deterministic seed schedules, committed protocol identity, and error-preserving metrics.
3. Append observations to the experience library; never overwrite 14-game diagnostic baseline data.
4. Report W/D/L, trainingScore, interval estimate, median/minimum schedule score, and worker error state for every baseline.

## C. Three-Schedule Candidate Promotion

1. Candidate eligibility:
   - unique canonical fingerprint;
   - complete T026 140-game formal screen with 0 errors;
   - no unresolved four-cost trace issue;
   - select at least the best unique candidate per source plus any additional source-diverse candidates whose 140-game score meets a documented screen threshold.
2. For each eligible candidate, run three independent schedules matching the baseline protocol:

```text
7 families × 2 sides × 25 games/cell × 3 schedules
= 1,050 games/candidate
```

3. Compare each candidate only against the baseline of its own source using matched schedule IDs. Report per-schedule delta, median delta, minimum delta, W/D/L delta, uncertainty interval, and error count.
4. Independent current strong-panel evaluation must use a separate matching three-schedule protocol. It is generalization-only, never a search objective.
5. `PROMOTION_SUPPORTED` requires all:
   - 0 errors and complete observations;
   - lower uncertainty bound of source-relative held-out median delta > 0;
   - no schedule worse than source baseline by more than a documented tolerance;
   - no material strong-panel regression;
   - not `DUPLICATE_NOOP`.
6. Anything else is `EXPLORATORY`, `INCONCLUSIVE`, or `REJECTED`; do not call it Tier 2.

## D. Pruning Claim Correction

1. Mark existing T026 pruning output as `NO_EFFECT_OBSERVED` because all reported pruned branch counts and score deltas are zero.
2. Do not run or report pruning as optimization in this task. A future pruning experiment requires nonzero actual removals and matched before/after evaluation.

## E. Operational Requirements

1. Reuse T025/T026 full observation keys with current content fingerprints; complete matching records may resume, but incomplete/mismatched records must not be reused.
2. Cursor/checkpoint must be written atomically after every candidate/schedule.
3. Outer candidate concurrency <=2. Record worker concurrency, elapsed time, seeds, code commit, and library observation keys.
4. Append all new evidence under `tests/fixtures/tree/experience_library/` using new protocol/run IDs. Do not overwrite T026 data.
5. Preserve all task files and do not modify active library, bundle artifacts, generation domain, or watcher.

## Acceptance

- [ ] Registry exposes canonical fingerprints and duplicate groups; no duplicate/no-op candidate is promoted as separate diversity evidence.
- [ ] All ten executable source baselines have complete three-schedule 1,050-game evidence.
- [ ] Every promoted candidate has complete matched three-schedule 1,050-game source-relative evidence and independent current-panel generalization.
- [ ] Promotion decisions use source-relative deltas and uncertainty, not raw cross-source score or single schedule.
- [ ] Existing pruning result is correctly marked no-effect and not used as optimization evidence.
- [ ] Experience library remains append-only, resumable, and auditable.
- [ ] No apply/deploy or automatic Tier 2 admission.

## Delivery

Write `TASKS/tree/T027.report.md` with duplicate mapping, baseline table, candidate three-schedule tables, source-relative deltas/intervals, current-panel results, supported/inconclusive decisions, pruning correction, commands/cursor, and explicit no-apply confirmation. Commit/push only `agent/tree`. Do not modify this specification.
