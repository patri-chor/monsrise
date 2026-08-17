STATUS: OPEN
DOMAIN: tree

# T013 - Tree Task-Bus Preservation Repair

> Domain: `tree` | Executor branch: `agent/tree`
> This is a repository-delivery repair only. Do not rerun T011/T012 optimization or alter optimizer behavior.

## Failure Evidence

Both T011 (`4cd56df`) and T012 (`48828b1`) implementation commits removed previously committed tree task records, including accepted closed files and task specifications. The decision owner restored them once after T011, but T012 deleted them again.

This destroys task-bus audit history even when the code result is correct.

## Objective

Restore the missing tree task-bus records and prevent future task implementation commits from deleting unrelated `TASKS/tree/` files.

## Required Work

1. Restore from known prior tree commits, preserving original content:
   - `TASKS/tree/T009.closed.md`
   - `TASKS/tree/T010.closed.md`
   - `TASKS/tree/T011-cross-seed-branch-deck-opening-optimization.md`
   - `TASKS/tree/T011.closed.md`
   - `TASKS/tree/T012-eight-candidate-control-baseline.md`
2. Preserve `TASKS/tree/T012.report.md`; do not overwrite or delete it.
3. Add a lightweight test or repository check that compares the pre-task tracked `TASKS/tree/` file set with the post-task set and fails if an implementation task deletes any unrelated task/report/closed record.
4. The check may permit deletion only when the current task specification explicitly requests its own deletion, which no current tree task does.
5. Run the preservation check against the T011/T012 history scenario or an equivalent fixture proving that unrelated deletion is caught.

## Prohibited

- No optimizer source changes.
- No generation-domain changes.
- No active library, bundle, report evaluation rerun, apply/deploy, or watcher changes.
- Do not modify task contents except restoring the exact missing records and writing T013 report.

## Acceptance

- [ ] All five missing tree task-bus records are restored with original content.
- [ ] T012 report remains present.
- [ ] Preservation check fails on an unrelated task-file deletion fixture and passes on unchanged set.
- [ ] No optimizer or generation source changes.
- [ ] `TASKS/tree/T013.report.md` records restored paths and test output.

## Delivery

Write `TASKS/tree/T013.report.md`, commit and push only `agent/tree`. Do not modify this specification.
