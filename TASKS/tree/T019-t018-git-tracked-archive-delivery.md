STATUS: OPEN
DOMAIN: tree

# T019 - T018 Git-Tracked Archive Delivery Repair

> Domain: `tree` | Executor branch: `agent/tree`
> Delivery repair only. Do not rerun simulations or alter any T017 measured result, tier, candidate, seed, fixture, or optimizer behavior.

## Verified Failure

T018 report claims the three readable files were generated, but `origin/agent/tree` at delivery commit `e6ca4db` does not track them:

```text
tests/fixtures/tree/t016_training_archive/tier_library.md
tests/fixtures/tree/t016_training_archive/summary.md
tests/fixtures/tree/t016_training_archive/final_r5_grids.md
```

Remote verification with `git ls-tree -r --name-only origin/agent/tree -- tests/fixtures/tree/t016_training_archive/` shows only the original 10 files. `git show origin/agent/tree:<path>` fails for all three Markdown paths.

T018 also deleted its own task specification. This must be restored unchanged.

Runtime `existsSync()` is insufficient: acceptance requires the readable artifacts to be Git-tracked in the delivery commit itself.

## Objective

Commit the already deterministic readable archive files and restore T018 task specification, without rerunning training or changing data.

## Required Work

1. Rebuild the three readable files from already committed T017 archive JSON/JSONL using the existing deterministic builder only:
   - `tests/fixtures/tree/t016_training_archive/tier_library.md`
   - `tests/fixtures/tree/t016_training_archive/summary.md`
   - `tests/fixtures/tree/t016_training_archive/final_r5_grids.md`
2. Restore `TASKS/tree/T018-t017-readable-archive-completion.md` byte-for-byte from its published specification; preserve `T018.report.md`.
3. Add all four files to the delivery commit. Do not rely on ignored runtime `reports/` files.
4. Update/add a focused test that proves artifacts are Git-tracked at `HEAD`, not merely present on disk. The test must invoke Git or inspect `git ls-files` / `git ls-tree HEAD` for all three archive paths and the T018 specification.
5. Verify exact archive facts from committed data:

```text
Tier 1 = 11
Tier 2 = 0
Tier 3 = 5
Rejected = 25
```

6. Verify grids include 11 Tier 1 entries, explicitly state zero Tier 2 entries, mark calculator-controlled units `[计算定位]`, and mark `gift_jungle` as legacy 7-monster baseline.

## Prohibited

- No `PersistentSimPool` / simulation execution.
- No modification of T017 archive JSON/JSONL, tiers, candidate data, scores, seeds, reinforcement, runner, fixtures, or active bundle.
- No generation-domain changes or apply/deploy.
- No deletion of any unrelated `TASKS/tree/` record.

## Acceptance

- [ ] Three readable archive files are present and Git-tracked at delivery `HEAD`.
- [ ] T018 task specification is restored and Git-tracked at delivery `HEAD`.
- [ ] Git-tracking test fails when any required file is untracked/missing and passes at `HEAD`.
- [ ] Counts/IDs/grids agree with unmodified committed T017 archive data.
- [ ] No simulation reran and no measured data changed.
- [ ] T013 preservation check passes.

## Delivery

Write `TASKS/tree/T019.report.md` with exact committed file paths, `git ls-tree HEAD` evidence, test outputs, and explicit no-rerun/no-apply confirmation. Commit/push only `agent/tree`. Do not modify this specification.
