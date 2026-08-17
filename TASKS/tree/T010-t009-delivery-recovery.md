STATUS: OPEN
DOMAIN: tree

# T010 - T009 Delivery Recovery

> Domain: `tree` | Executor branch: `agent/tree`
> This is a delivery-recovery task, not a request to reimplement T009 from scratch.

## Failure Evidence

A local `TASKS/tree/T009.report.md` arrived with `STATUS: DONE`, but after `git fetch origin --prune`, `origin/agent/tree` does not contain:

- `TASKS/tree/T009.report.md`
- `tests/fixtures/tree/four_frozen_candidates.jsonl`
- T009 implementation commit

The remote tree branch remains at `1e457cd`, so the decision owner cannot review, test, or accept the claimed delivery.

## Objective

Recover the actual T009 implementation onto `agent/tree` and prove delivery from a clean tree checkout.

## Required Steps

1. Before changing code, verify the current branch is exactly `agent/tree` and inspect `git status`.
2. Locate the existing local T009 implementation and report. Do not recreate it blindly.
3. Commit all T009 source changes, committed fixture, test changes, and `TASKS/tree/T009.report.md` to `agent/tree`.
4. Push `agent/tree` to origin.
5. In a clean checkout/worktree of the pushed `agent/tree` commit, run:
   ```bash
   npx tsx tests/t008_optimizer_experiment_validity.test.ts
   ```
6. The clean-checkout run must pass and create all five proof artifacts during execution.
7. Update `TASKS/tree/T010.report.md` with the delivered commit SHA, clean-checkout command/result, and exact artifact list.

## Constraints

- Do not modify generation-domain tasks/files.
- Do not change active `FORMATION_LIBRARY`, bundle artifacts, watcher, matrix/state, apply/deploy, or mutation/generation operators.
- Do not add a second alternate implementation if the existing T009 work can be recovered.
- If the local implementation is unavailable, write `STATUS: PARTIAL` with exact missing paths and stop.

## Acceptance

- [ ] `origin/agent/tree` contains T009 report, implementation, fixture, and test.
- [ ] T009 clean-checkout test passes from the pushed commit.
- [ ] T010 report records the exact commit SHA and artifacts.
- [ ] No prohibited cross-domain or active-library changes.

## Delivery

Write `TASKS/tree/T010.report.md`, commit and push only on `agent/tree`. Do not modify this specification.
