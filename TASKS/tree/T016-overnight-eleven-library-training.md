STATUS: OPEN
DOMAIN: tree

# T016 - Overnight Eleven-Formation Diversity Training and Three-Tier Library

> Domain: `tree` | Executor branch: `agent/tree`
> Prerequisites: T014 and T015 accepted. This is an offline training-and-curation run. It must never apply, deploy, or modify the active bundle library.

## Objective

Use the current bundle's 11 formations as frozen source seeds to build an auditable, diverse three-tier candidate library overnight:

```text
freeze 11 sources
-> constrained diversity mutation
-> legal/coarse screening
-> three independent optimization attempts per candidate
-> early seven-family holdout validation
-> current strong-panel generalization measurement
-> strength + diversity tiering
```

The purpose is not only to find one strongest formation. It is to preserve useful, legal, behaviorally diverse candidates while identifying a smaller stable high-strength frontier.

## A. Freeze Sources and Reproducibility

1. Snapshot all 11 current `FORMATION_LIBRARY` formations to a committed fixture under `tests/fixtures/tree/` before generating candidates. Snapshot must include IDs, Chinese names, teams, badges, full trees, and a source fingerprint.
2. Do not use the active `FORMATION_LIBRARY` at training runtime after fixture loading.
3. Record source snapshot hash, candidate-generation seed, optimizer seeds, code commit, and every evaluation panel/variant assignment in a run manifest.
4. Output only under:

```text
reports/new-formation-generation/overnight-eleven-library-training/
```

## B. Bounded Diversity Mutation

1. Generate candidates from every one of the 11 frozen source formations.
2. Produce a deterministic balanced candidate set with at least 3 legal non-duplicate mutations per source (minimum 33 mutated candidates), plus an immutable baseline record for each source.
3. Use existing architecture/core/module/legality rules and mutation-vector accounting. Candidate mutations may vary deck, permitted badges, tree/order, and legal controllable placement, but must preserve:
   - team size 6..8;
   - total cost <=18;
   - architecture mandatory/forbidden rules;
   - tactical-required invariant;
   - badge limits and legal badges;
   - tree/path legality and unique deployment.
4. Balance retained mutations per source across available novelty buckets (`light`, `medium`, `heavy`) where legal candidates exist. If a bucket is unavailable, report the legal rejection evidence rather than synthesizing invalid data.
5. Deduplicate by canonical deck key plus tree fingerprint. Never mutate or overwrite a frozen source.
6. Initial coarse screen must reject invalid candidates but must not use an over-strict “only strongest survives” policy. Preserve a documented diversity exploration floor per source/bucket.

## C. Only Proven Optimizer Components

Enable only components with positive evidence from T009-T014:

1. Existing in-deck branch-local replacement and standard branch-node placement search.
2. Calculated-unit-ratio-driven routing from T014:
   - special/aiming units defined solely by `isPositionIrrelevant()` receive zero position candidates;
   - ratio >=0.50: order/timing search R1-R5;
   - ratio <0.50: ordinary position search for controllable units in R1/R2 plus order/timing search R1-R5.
3. Legal within-round ordering (including non-adjacent permutations) and adjacent-round timing shifts subject to budget/path legality.

Explicitly disabled:

- external deck / ontology replacement search;
- low-score target-pool selection;
- opening-specific P4 operators;
- badge mutation during optimization;
- branch feature/condition mutation during optimization;
- active bundle modification or candidate apply.

## D. Three Independent Optimization Attempts

1. Every candidate that passes legal/coarse screening must receive exactly 3 independent optimization attempts with non-overlapping deterministic search and holdout seed schedules.
2. Each attempt trains against all seven representative early bundle families, using training variants; adoption inside an attempt requires held-out same-family variant validation:

```text
held-out aggregate trainingScore improvement >= 0.05
and held-out losses do not increase
```

3. All seven family IDs must remain present in search and held-out validation. Do not divide them into A/B opponent groups.
4. Preserve attempt-level outputs even when a candidate fails. Never select a candidate based only on its best random attempt.
5. Candidate robust strength summary must include:
   - attempts with held-out improvement / 3;
   - median held-out trainingScore;
   - minimum held-out trainingScore;
   - median held-out delta vs unoptimized candidate;
   - median loss delta;
   - selected tree provenance (which attempt, or baseline if none passed);
   - worker error count.
6. A candidate is "robustly improved" only if at least 2/3 attempts pass held-out validation. A one-off pass remains an exploratory record only.

## E. Current Strong-Panel Generalization and Upper-Bound Reinforcement

1. Evaluate baseline and selected result for every candidate on the fixed current strong panel using independent fixed seeds. This is a generalization measurement, not a training signal.
2. Flag, but do not delete, any candidate with:

```text
current aggregate trainingScore delta < -0.05
or current weakest-cell trainingScore delta < -0.10
```

3. For each source's highest robust candidate and each provisional Tier 1 candidate, run one additional **reinforcement pass** using the same proven components and a fourth non-overlapping early-ecosystem holdout seed schedule. This is upper-bound exploration, not a fourth cherry-pick.
4. Reinforcement may replace the selected result only if it independently passes held-out validation and does not lower the candidate's robust median held-out trainingScore.

## F. Three-Tier Curation

Tier classification must be deterministic, explainable, and use both strength and diversity.

### Tier 1: Current Bundle Baseline

Tier 1 is exactly the frozen snapshot of all 11 current bundle formations. It is the known, trusted baseline and is never replaced, reordered, modified, or mixed with generated candidates by this overnight run.

For each Tier 1 source, report its early-seven holdout and current-panel measurements alongside its descendants, but do not require it to satisfy a new threshold and do not apply any optimized descendant to it.

### Tier 2: Stable Enhanced Candidates

All required:

- legal and no worker errors;
- robustly improved (>=2/3 held-out passes);
- median early held-out trainingScore >=0.50;
- current strong-panel aggregate trainingScore >=0.35;
- no current-panel generalization warning;
- unique canonical deck/tree fingerprint relative to Tier 1 and other Tier 2 candidates.

Tier 2 is a reviewable enhancement library, not an automatic replacement for Tier 1.

### Tier 3: Exploratory Diversity

All required:

- legal and no worker errors;
- median early held-out trainingScore >=0.30;
- did not violate hard generalization safety floor (current aggregate >=0.25);
- unique mutation vector or behavior/deck/tree fingerprint not already represented by Tier 1 or Tier 2.

Candidates below Tier 3 are rejected but retained in a rejection ledger with reason. Do not silently discard them.

## G. Required Artifacts

Produce committed, reviewable artifacts:

1. `source_snapshot.json`
2. `generation_manifest.json`
3. `all_candidates.jsonl`
4. `screening_ledger.jsonl`
5. `optimization_attempts.jsonl`
6. `early_holdout_evaluations.jsonl`
7. `current_panel_generalization.jsonl`
8. `tier_library.json`
9. `tier_library.md` with Chinese names, source, mutation vector, scores, three-attempt stability, generalization flag, and selected tree provenance
10. `rejection_ledger.jsonl`
11. `summary.md` with per-source coverage, bucket coverage, pass rates, three tier counts, resources/duration, and no-apply confirmation
12. Chinese final R5 grid for every Tier 1 and Tier 2 candidate. Calculator-controlled units must be marked as computed rather than displayed as fixed final positions.

## Resource Limits

- Outer candidate concurrency <=2.
- Final games per opponent/side cell >=5 for all tier decisions.
- Do not use more than 3 initial mutations per source unless the run report explicitly documents spare capacity and source/bucket coverage remains balanced.
- If the run cannot complete in one overnight window, produce `STATUS: PARTIAL` report with completed artifacts, exact resumable cursor, and no unverified tier decision. Do not reduce games/cell or validation attempts silently.

## Acceptance

- [ ] Exactly 11 frozen source formations and at least 33 legal, non-duplicate mutations (3+ per source).
- [ ] All three novelty buckets have coverage where legally possible, otherwise rejection evidence exists.
- [ ] Every screened candidate has 3 independent optimization attempts and complete early seven-family holdout records.
- [ ] Calculator-controlled units have zero position candidates; routing follows calculated-unit ratio.
- [ ] No disabled component was used.
- [ ] Strong-panel measurement is separate from training and reports warnings.
- [ ] Reinforcement pass is restricted to source winners/provisional Tier 1 and is independently validated.
- [ ] Tier 1 contains exactly the frozen 11 current-bundle sources; Tier 2/Tier 3 rules are applied deterministically and rejected candidates remain in ledger.
- [ ] No worker errors among tiered candidates; no active library/bundle/apply/deploy changes.
- [ ] T013 preservation check passes and no unrelated task record is deleted.
- [ ] T014/T015 focused tests pass; new pipeline tests cover tier boundaries, attempt aggregation, and no-position mutation for calculator units.

## Delivery

Write `TASKS/tree/T016.report.md` with source/candidate counts, bucket coverage, attempt statistics, tier counts, top candidates per tier, generalization warnings, resource usage, artifacts, test commands, preservation result, and no-apply confirmation. Commit/push only `agent/tree`. Do not modify this specification.
