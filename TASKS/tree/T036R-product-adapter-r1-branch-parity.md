STATUS: OPEN
DOMAIN: tree

# T036R - Product Adapter R1 Branch Parity Repair

> Narrow repair for T036. Do not start T037 until this task passes.
> T036 source repair, foundation modules, and static architecture checks are accepted. Its claimed R1 product-strategy evidence is incomplete because tests only exercise the parallel `branch_semantics.ts` helper, not `product_tree_strategy.treeStrategyFor()` used by `playFullGame`.

## Scope

Add direct, deterministic product-adapter R1 tests and checker assertions. No source mutation, no new candidate generation, no simulation batch, no PersistentSimPool screen, no apply/deploy/publish.

## Required Direct Product-Adapter Evidence

Using the repaired in-place `gift_jungle` from `eleven_frozen_sources.json`:

1. Construct a real `DeploymentStrategyContext` for R1 and call:

```text
treeStrategyFor(formationToEvol(gift_jungle))(ctx)
```

Do not use `branch_semantics.selectBranchForSideAndRound()` as the proof target.

2. Empty visible opponent hand/badges must select the actual empty-mask fallback R1 node. Assert:

```text
all emitted intents carry fallback branchId
expected R1 monster IDs are emitted
```

3. Construct a visible hand/badge input that `recognizeArchetype` actually classifies to the condition on Gift Jungle R1 node `n7`. Assert:

```text
all emitted intents carry n7 branchId
n7's expected R1 intents are emitted
result differs from fallback behavior when the trees differ
```

If current `n7` condition cannot be triggered from legal R1 observable input, record the concrete reason and fix only the source condition to a legitimate R1-observable fullrush condition; do not alter its scheduled placements, team, badges, coordinates, or other branches.

4. Execute both cases for both actual sides:

```text
P2: exact tree coordinates
P1: x -> 10-x mirror
```

Assert intent coordinates and `branch.branchId`, not merely non-null selection.

5. Keep the `branch_semantics.ts` helper tests as consistency checks, but product adapter behavior is the acceptance authority.

## Checks

- Update `tests/t036_product_training_foundation.test.ts` with the direct product adapter cases.
- Update `scripts/tree_product_training/check_architecture.ts` to directly call `treeStrategyFor()` and assert fallback/n7 IDs, intent IDs, and P1/P2 coordinates.
- Include the direct adapter test in the documented T036 verification commands.
- Preserve the passing 25 foundation assertions unless their description is corrected to stricter product-adapter semantics.

## Acceptance

- [ ] R1 fallback is proved via `treeStrategyFor()` for both P1 and P2.
- [ ] R1 n7/fullrush condition branch is proved via `treeStrategyFor()` for both P1 and P2.
- [ ] Every asserted intent has correct branch provenance and P1/P2 coordinate mapping.
- [ ] Helper and product adapter agree for the same observable input.
- [ ] No unrelated source/tree mutation beyond a necessary legal, observable R1 condition repair.
- [ ] No screen/simulation/apply/deploy/publish action.

## Delivery

Write `TASKS/tree/T036R.report.md` with exact trigger input, recognition result, expected/actual branch IDs and intents for each side, test/check commands, any necessary source-condition diff, and no-simulation confirmation. Commit/push only `agent/tree`.
