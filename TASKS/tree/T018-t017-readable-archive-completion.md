STATUS: OPEN
DOMAIN: tree

# T018 - T017 Readable Archive Completion

> Domain: `tree` | Executor branch: `agent/tree`
> This is a delivery-completeness repair only. Do not rerun training, alter candidates, scores, tiers, seeds, screening, reinforcement, or optimizer behavior.

## Verified T017 State

T017 correctly applies `validateTreeDeckCoherence(evol)` before a candidate enters simulation. The committed archive contains the machine-readable training results: 30 coherent 8-monster candidates, 90 attempt records, one failed non-replacing reinforcement attempt, Tier 1=11, Tier 2=0, Tier 3=5, and rejected records.

However, the committed archive currently contains only 10 files. T017 required the following readable artifacts but they were written only to ignored runtime reports, not committed:

1. `tier_library.md`
2. `summary.md`
3. Chinese final R5 grid document for every Tier 1 and Tier 2 candidate, with calculator-controlled units marked as computed rather than fixed coordinates.

## Objective

Complete the committed T017 archive without rerunning any simulation or changing any measured data.

## Required Work

1. Generate and commit under `tests/fixtures/tree/t016_training_archive/`:
   - `tier_library.md`
   - `summary.md`
   - `final_r5_grids.md`
2. All content must be deterministically derived only from already committed T017 archive data and the committed frozen source/candidate fixtures.
3. `tier_library.md` must state exact counts and complete IDs:

```text
Tier 1: 11
Tier 2: 0
Tier 3: 5
Rejected: 25
```

4. `summary.md` must state:
   - 11 frozen sources, including `gift_jungle` as 7-monster legacy Tier 1 baseline;
   - 30 coherent 8-monster generated candidates;
   - 90 independent attempts;
   - 1 reinforcement attempt and its non-replacement outcome;
   - zero worker errors;
   - no-apply status.
5. `final_r5_grids.md` must show all 11 Tier 1 baselines. Tier 2 section must explicitly state that it has zero candidates. For each rendered formation:
   - Chinese monster names;
   - R5 cumulative mainline grid or a precise branch/mainline label;
   - calculator-controlled units marked `[计算定位]`, never presented as fixed final positions;
   - `gift_jungle` marked legacy 7-monster baseline.
6. Add a focused deterministic test that checks the three new files are present, non-empty, internally consistent with committed JSON archive counts/IDs, and marks calculator-controlled units correctly.
7. Run the new focused test plus T017/T015/T013 focused tests. Do not run training or PersistentSimPool simulation.

## Prohibited

- No runner or optimizer logic change.
- No fixture/candidate/tier/score/seed/reinforcement change.
- No active bundle, generation-domain, apply/deploy, watcher, or unrelated task change.
- Do not delete any `TASKS/tree/` record.

## Acceptance

- [ ] Archive has all 13 required machine-readable and readable artifacts.
- [ ] Counts and IDs in Markdown match committed JSON/JSONL data exactly.
- [ ] All 11 Tier 1 and zero Tier 2 grid status are accurately rendered in Chinese.
- [ ] No simulation reran and no measured data changed.
- [ ] New archive test and T017/T015/T013 tests pass.
- [ ] Task-bus preservation check passes.

## Delivery

Write `TASKS/tree/T018.report.md` with added archive paths, count consistency evidence, test output, and explicit no-rerun/no-apply confirmation. Commit/push only `agent/tree`. Do not modify this specification.
