STATUS: OPEN
DOMAIN: tree

# T015 - T014 Report Identity and Calculated-Unit Correction

> Domain: `tree` | Executor branch: `agent/tree`
> This is a narrow delivery correction for T014. Do not change the order-search algorithm, fixtures, experiment configuration, seeds, or metrics.

## Failure Evidence

T014's clean acceptance test proves the ratio calculation is correct, but `TASKS/tree/T014.report.md` misidentifies calculator-controlled monster IDs in its Chinese table. For example, `cand_s1_1_2a` has one calculated unit because its team includes `116` (钻头), while the report labels it as `106` (冲锋). The candidate's ratio happens to remain 1/8, but human interpretation of its route and grid becomes unreliable.

## Objective

Correct all T014 human-facing monster identity, calculated-unit listing, and optimized-final-grid labels from one authoritative source, without recomputing or changing any experimental result.

## Required Work

1. Use `computeCalculatedUnitRatio(team)` and the shared monster source (`DB_MONSTERS` or a single exported shared name helper) to generate all displayed calculated-unit IDs and Chinese names. Do not maintain a separate hand-written report map.
2. Audit all eight rows in T014 report and every T014 Chinese final-grid section against the committed `eight_frozen_candidates.jsonl` fixture and the actual accepted optimized tree result.
3. Correct `TASKS/tree/T014.report.md` in place, preserving all measured scores, seeds, decisions, and no-apply conclusions. Add a short correction note with the original delivery commit `524ad11` and correction commit SHA.
4. Add a focused regression test asserting at minimum:
   - `cand_s1_1_2a` reports `116` / 钻头 as its calculated unit, not `106` / 冲锋;
   - every displayed calculated ID belongs to the candidate's team;
   - displayed calculated count equals `computeCalculatedUnitRatio(team).calculatedCount` for all 8 candidates;
   - report/grid display name is derived from the same authoritative identity source.
5. Do not rerun the costly optimization proof. Run only deterministic report/identity checks plus T014 and T013 focused regressions.

## Prohibited

- No order-search behavior or scoring change.
- No fixture changes.
- No generation-domain changes.
- No active library, bundle, matrix/state, apply/deploy, or watcher change.
- Do not delete or modify unrelated `TASKS/tree/` files.

## Acceptance

- [ ] All eight T014 report identity rows match fixture team membership and shared calculated-unit definition.
- [ ] T014 Chinese grid labels use the same authoritative name source.
- [ ] Scores/outcomes/protocol match the accepted T014 test output; no experiment rerun occurred.
- [ ] New focused test and T014/T013 tests pass.
- [ ] Task-bus preservation check passes with no unrelated deletion.

## Delivery

Write `TASKS/tree/T015.report.md` listing every corrected candidate row, correction test output, and explicit statement that no optimization proof was rerun. Commit/push only `agent/tree`. Do not modify this specification.
