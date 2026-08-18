STATUS: OPEN
DOMAIN: tree

# T017 - T016 Cost Compliance, Reinforcement, and Auditable Results Rework

> Domain: `tree` | Executor branch: `agent/tree`
> Rework scope: T016 delivery. Do not change the accepted T009-T015 optimizer behavior or introduce new search algorithms.

## Why T016 Is Not Yet Accepted

T016 executed real simulation through `PersistentSimPool`, but its delivery is not auditable or specification-complete:

1. `src/engine/tree/eleven_library_training.ts` screens new candidates with `totalCost <= 24`, while T016 requires every new mutation to cost `<=18`.
2. Required fourth independent reinforcement pass was described but not implemented.
3. Complete output was written only under ignored `reports/`; no committed archive contains the actual tier counts, full candidate results, attempts, held-out evaluations, generalization records, rejection ledger, or final grids. A report assertion is not enough for review.

Tier 1 remains the frozen current 11-formation bundle baseline. A historical Tier 1 source may exceed 18 cost, but this does not relax the `<=18` limit for any new mutation/descendant.

## Objective

Make the existing T016 training output reproducible, cost-compliant, reinforced, and reviewable without adding new optimization dimensions or applying any candidate.

## A. Strict New-Candidate Cost Rule

1. Change T016 screening so every generated/mutated candidate must have total cost `<=18`, team size 6..8, and all existing legality checks.
2. Tier 1 source snapshot remains all 11 current bundle formations exactly as-is, including historical baseline sources above 18 cost. Do not mutate, reject, normalize, or train a >18-cost baseline as a generated candidate.
3. Regenerate/re-screen only affected candidate records deterministically. Preserve candidate IDs where still legal; give replacement candidates deterministic IDs and record the replacement reason where old candidate exceeded cost.
4. Add test coverage proving:
   - a 19+ cost mutation is rejected;
   - an existing 22-cost Tier 1 baseline remains present only in Tier 1;
   - no Tier 2/Tier 3 candidate exceeds 18 cost.

## B. Real Reinforcement Pass

1. Implement the T016 fourth independent reinforcement pass for exactly one best robust candidate per source, if a source has any robust candidate. Do not run it for non-robust candidates merely to search for a fourth lucky result.
2. Use a fourth non-overlapping search/held-out seed schedule and all seven early bundle families.
3. Reinforcement can replace the selected tree only when it passes held-out validation and does not reduce the candidate's original 3-attempt median held-out trainingScore.
4. Persist reinforcement input candidate ID, source ID, seeds, baseline/final W-D-L and trainingScore, pass/reject reason, and whether it replaced the selected result.
5. Add a focused test proving failed reinforcement cannot replace a three-attempt selected tree.

## C. Committed Auditable Archive

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
3. Archive metadata must state code commit, fixture fingerprints, candidate-generation seed, all attempt seeds, panel/variant assignments, strict cost rule, and no-apply status.
4. The archive must expose actual Tier 1/Tier 2/Tier 3/rejected counts and complete IDs, not only examples.
5. Do not commit bulky unstructured trace dumps, node_modules, ignored runtime `reports/`, active library, bundle artifacts, or shared matrix/state.

## D. Execution and Verification

1. Re-run the corrected deterministic T016 pipeline only as needed to create the compliant archive; do not fabricate artifacts.
2. Use 3 independent attempts for every valid candidate, 5 final games per opponent/side cell, outer concurrency <=2, and zero worker errors for tiered candidates.
3. Existing search scope remains unchanged:
   - allowed: T014 calculated-unit-ratio routing, legal order/timing search, ordinary controllable R1/R2 position search;
   - disabled: external deck replacement, low-score pool, P4 opening operators, badge mutation during optimization, branch feature/condition mutation, and apply.
4. Run T013 preservation check and retain all unrelated `TASKS/tree/` records.

## Acceptance

- [ ] Tier 1 archive contains exactly the original 11 baselines.
- [ ] All Tier 2/Tier 3/archive generated candidates cost <=18, with no exception inherited from Tier 1.
- [ ] Every valid candidate has 3 independent complete attempt records and seven-family held-out records.
- [ ] Reinforcement exists only for source-best robust candidates and is independently recorded.
- [ ] Archive contains all required data and full tier/rejection IDs/counts.
- [ ] No worker errors among tiered candidates, and no active library/bundle/apply/deploy changes.
- [ ] T014/T015/T016 focused tests plus new T017 tests pass.
- [ ] T013 preservation check passes; no unrelated task file deletion.

## Delivery

Write `TASKS/tree/T017.report.md` with before/after valid-candidate counts, all cost-rejected/replaced IDs, full tier counts, reinforcement outcomes, archive paths, exact test results, and explicit no-apply confirmation. Commit/push only `agent/tree`. Do not modify this specification.
