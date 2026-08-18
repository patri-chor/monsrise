STATUS: OPEN
DOMAIN: tree

# T017 - T016 Reinforcement and Auditable Results Rework

> Domain: `tree` | Executor branch: `agent/tree`
> Rework scope: T016 delivery. Do not change the accepted T009-T015 optimizer behavior or introduce new search algorithms.

## Why T016 Is Not Yet Accepted

T016 executed real simulation through `PersistentSimPool`, but its delivery is not auditable or specification-complete:

1. Required fourth independent reinforcement pass was described but not implemented.
2. Complete output was written only under ignored `reports/`; no committed archive contains the actual tier counts, full candidate results, attempts, held-out evaluations, generalization records, rejection ledger, or final grids. A report assertion is not enough for review.

## Confirmed Rule Correction

Total deck cost is **not** a legality or screening ceiling. A typical single-four-cost deck may total 18, while legal multi-four-cost decks are expected to total more. Do not reject, normalize, regenerate, or tier-down any candidate because of total cost alone.

The current deck-size rule is exactly **8 monsters** for new generated candidates. Existing Tier 1 baselines remain frozen historical records. `gift_jungle` currently has 7 monsters; do not alter it in this task. It must be reported as a legacy baseline requiring a separate explicit decision before it can become an 8-monster training source.

## Objective

First repair tree/deck coherence so structurally unplayable candidates never enter simulation. Only after the coherence gate is proven may this task produce reinforced, reproducible, reviewable T016 results. Do not add new optimization dimensions or apply any candidate.

## A. Mandatory Tree/Deck Coherence Gate (Highest Priority)

### Failure Pattern

Some prayer/halfrush descendants of complex source trees recorded `0W/0D/14L`. When deck mutation or R1 changes leave a deep branch placement referencing a monster absent from the mutated team, the game engine cannot deploy the tree plan and the match is directly lost. This is a structural invalidity, not a weak matchup or a valid training result.

### Required Work

1. Before coarse screening, every generated candidate must run a full recursive tree/deck closure check over **every node and every branch path**:
   - each placement `monsterId` is present in candidate `team`;
   - no duplicate deployment on any root-to-leaf path;
   - round monotonicity, coordinate legality, and existing tree legality hold;
   - every executable branch can deploy its planned units under the candidate team.
2. Reuse `validateEvol(root, new Set(teamIds))` or extract a shared public validator from it. Do not create a weaker shallow-only duplicate checker.
3. Reject before any simulation all candidates failing the gate. Record candidate ID, source, deep node ID/round, missing monster ID, and exact validator error in `screening_ledger.jsonl` and `rejection_ledger.jsonl`.
4. Never classify a structural-invalid candidate from an all-loss signature such as `0W/0D/14L`; remove prior invalid results from all attempt, holdout, generalization, Tier 2/Tier 3, and reinforcement calculations.
5. For each rejected invalid mutation, either:
   - deterministically rebuild/rebind its tree to the mutated deck while preserving all legal paths; or
   - replace it with a deterministic, unique, full-tree-coherent mutation for the same source/bucket.
   Do not silently drop a source/bucket without a recorded reason.
6. Add tests using a complex branching prayer/halfrush fixture that intentionally removes a monster referenced only by a deep branch. The test must prove rejection before `PersistentSimPool` receives the candidate. Add a valid complex-tree counterpart that passes.
7. Produce a structural-screening summary with counts for valid, missing-team-monster, duplicate-path-deployment, coordinate/round invalid, and engine-runtime failure. Any engine-runtime structural failure must block tiering.

## B. Eight-Monster Candidate Rule

1. New generated/mutated candidates must contain exactly 8 monsters and satisfy all existing architecture, tactical, badge, and tree legality checks.
2. Do not apply any total-cost rejection rule.
3. Tier 1 source snapshot remains all 11 current bundle formations exactly as-is. Do not mutate, reject, normalize, or train `gift_jungle` as a generated candidate in this task.
4. Add test coverage proving:
   - a legal multi-four-cost mutation above 18 total cost is retained;
   - a 7-monster generated candidate is rejected;
   - the 7-monster `gift_jungle` baseline remains present only as a frozen legacy Tier 1 record.

## C. Real Reinforcement Pass

1. Implement the T016 fourth independent reinforcement pass for exactly one best robust candidate per source, if a source has any robust candidate. Do not run it for non-robust candidates merely to search for a fourth lucky result.
2. Use a fourth non-overlapping search/held-out seed schedule and all seven early bundle families.
3. Reinforcement can replace the selected tree only when it passes held-out validation and does not reduce the candidate's original 3-attempt median held-out trainingScore.
4. Persist reinforcement input candidate ID, source ID, seeds, baseline/final W-D-L and trainingScore, pass/reject reason, and whether it replaced the selected result.
5. Add a focused test proving failed reinforcement cannot replace a three-attempt selected tree.

## D. Committed Auditable Archive

1. Preserve ignored runtime reports if useful, but additionally write a committed archive under:

```text
tests/fixtures/tree/t016_training_archive/
```

2. Archive must contain non-empty, deterministic review data equivalent to every T016 required artifact:
   - `source_snapshot.json`
   - `generation_manifest.json`
   - `all_candidates.jsonl`
   - `screening_ledger.jsonl`
   - `optimization_attempts.jsonl`
   - `early_holdout_evaluations.jsonl`
   - `current_panel_generalization.jsonl`
   - `reinforcement_attempts.jsonl`
   - `tier_library.json`
   - `tier_library.md`
   - `rejection_ledger.jsonl`
   - `summary.md`
   - Chinese final R5 grid data/document for every Tier 1/Tier 2 candidate, marking calculator-controlled units as computed.
3. Archive metadata must state code commit, fixture fingerprints, candidate-generation seed, all attempt seeds, panel/variant assignments, exact 8-monster generated-candidate rule, legacy baseline exception, and no-apply status.
4. The archive must expose actual Tier 1/Tier 2/Tier 3/rejected counts and complete IDs, not only examples.
5. Do not commit bulky unstructured trace dumps, node_modules, ignored runtime `reports/`, active library, bundle artifacts, or shared matrix/state.

## E. Execution and Verification

1. Re-run the corrected deterministic T016 pipeline only as needed to create the compliant archive; do not fabricate artifacts.
2. Use 3 independent attempts for every valid 8-monster candidate, 5 final games per opponent/side cell, outer concurrency <=2, and zero worker errors for tiered candidates.
3. Existing search scope remains unchanged:
   - allowed: T014 calculated-unit-ratio routing, legal order/timing search, ordinary controllable R1/R2 position search;
   - disabled: external deck replacement, low-score pool, P4 opening operators, badge mutation during optimization, branch feature/condition mutation, and apply.
4. Run T013 preservation check and retain all unrelated `TASKS/tree/` records.

## Acceptance

- [ ] Full recursive tree/deck coherence gate rejects deep-branch references to missing team monsters before simulation.
- [ ] Prior `0W/0D/14L` structural-invalid results are excluded from attempts, holdout, generalization, reinforcement, and tier calculations.
- [ ] Tier 1 archive contains exactly the original 11 baselines, with `gift_jungle` explicitly marked as frozen legacy 7-monster baseline.
- [ ] Every Tier 2/Tier 3 generated candidate has exactly 8 monsters; legal multi-four-cost candidates above 18 total cost are retained.
- [ ] Every valid coherent 8-monster candidate has 3 independent complete attempt records and seven-family held-out records.
- [ ] Reinforcement exists only for source-best robust candidates and is independently recorded.
- [ ] Archive contains all required data and full tier/rejection IDs/counts.
- [ ] No worker errors among tiered candidates, and no active library/bundle/apply/deploy changes.
- [ ] T014/T015/T016 focused tests plus new T017 tests pass.
- [ ] T013 preservation check passes; no unrelated task file deletion.

## Delivery

Write `TASKS/tree/T017.report.md` with before/after valid-candidate counts, all cost-rejected/replaced IDs, full tier counts, reinforcement outcomes, archive paths, exact test results, and explicit no-apply confirmation. Commit/push only `agent/tree`. Do not modify this specification.
