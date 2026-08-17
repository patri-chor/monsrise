STATUS: OPEN
DOMAIN: tree

# T006 — Training Score Migration and Winrate Display

## Objective

Replace the tree optimizer's training/selection metric from draw-equals-win "undefeated rate" to a half-draw score:

```text
trainingScore = (win + 0.5 * draw) / (win + draw + loss)
```

Keep presentation metrics explicit and separate:

```text
pureWinRate = win / total
undefeatedRate = (win + draw) / total
```

## Why

The old `undefeated` metric equates a draw with a win. It hides regression from pure wins to draws and can adopt candidates that have lower competitive value. Example from T005 `all2rush`: baseline `8W/0D/8L` has trainingScore 50.0%; candidate `6W/3D/7L` has trainingScore 46.875%, although old undefeated rate rises from 50.0% to 56.25%.

## Scope

Allowed:
- `src/engine/tree/branch_induct.ts`
- `src/engine/tree/tree_cycle_runner.ts`
- tree optimization types/helpers directly required by these files
- `tests/branch_induct_evaluation.test.ts`
- `tests/tree_cycle_smoke.test.ts`
- focused new tree-metric tests

Do not change:
- `TASKS/generation/**`, generation source files, or generation reports
- active `FORMATION_LIBRARY`, bundle artifacts, deployment, or apply scripts
- `scripts/watch-gemini.ps1`
- full matrix/cycle application

## Required Implementation

1. Introduce one shared, typed result metric helper in the tree optimization area. It must calculate and expose `win`, `draw`, `loss`, `total`, `trainingScore`, `pureWinRate`, and `undefeatedRate`.
2. Replace all branch optimizer search comparisons, printed candidate scores, and final adoption threshold checks with `trainingScore`.
3. Retain loss non-increase as a second adoption guard unless a test/documented decision shows it is redundant.
4. Rename ambiguous runtime/result fields. Do not leave a field named `undefeated` as the primary score; compatibility aliases are allowed only when explicitly documented and cannot drive search/adoption.
5. Update `OptimizeFormationResult`, `searchValidation`, and T005 candidate JSON/schema to contain all three metrics. The stored `improved` and `verdict` must derive from trainingScore.
6. Update markdown/output presentation:
   - summaries and winrate-facing display must show `纯胜率` and `不败率` separately;
   - training/internal diagnostics must label `训练分` and never call it 胜率 without qualification.
7. Add deterministic tests covering:
   - `8W/0D/8L` trainingScore is 50.0%;
   - `6W/3D/7L` trainingScore is 46.875%, pure win rate is 37.5%, undefeated rate is 56.25%;
   - the latter cannot be adopted over the former despite higher undefeated rate;
   - all existing observation/forkRound/T004 tests remain valid.
8. Update the T005 runner test expectations for the new metric. Do not treat existing generated T005 artifacts as valid under the new policy.

## Acceptance

- [ ] No tree optimizer search or adoption decision is driven by `(win + draw) / total`.
- [ ] Branch candidate comparison and validation use half-draw trainingScore.
- [ ] Reports distinguish trainingScore, pureWinRate, and undefeatedRate.
- [ ] Tests prove draw-heavy regression is rejected.
- [ ] `npx vite-node tests/branch_induct_evaluation.test.ts` passes.
- [ ] `npx vite-node tests/tree_cycle_smoke.test.ts` passes.
- [ ] `npx tsc --noEmit` introduces no errors in edited files; report pre-existing errors only.
- [ ] No active formation data, shared matrix, or bundle artifact changes.

## Delivery

Write `TASKS/tree/T006.report.md` with changed files, tests, the T005 all2rush metric example, and explicit confirmation that no candidate was applied. Commit and push only the tree-domain implementation/report.
