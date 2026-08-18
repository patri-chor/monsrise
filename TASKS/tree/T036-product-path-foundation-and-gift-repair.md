STATUS: OPEN
DOMAIN: tree

# T036 - Product-Path Foundation and Gift Jungle Eight-Monster Repair

> Phase 1 of the self-evolution program. This replaces the earlier unexecuted broad T036 specification. It intentionally does not run an autonomous optimization cycle, a mixed pool, high-sample promotion, apply, deploy, publish, or wholesale archive import.

## Goal

Create the small, testable foundation for a single product-path training pipeline and repair the current `gift_jungle` source to eight monsters with one strictly limited addition.

## A. New Focused Module Layout

Create `src/engine/tree/product_training/` with only the following Phase-1 ownership files:

```text
01_sources.ts      load frozen sources after Gift Jungle repair; source fingerprints
02_candidates.ts   types and deterministic candidate metadata only; no long-running search
03_validate.ts     deep legality, exact-eight rule, canonical fingerprint, duplicate/no-op rejection
branch_semantics.ts side-aware branch selection and R1 observability helpers
index.ts           explicit public exports only
```

Do not create an optimizer runner yet. Do not import these legacy paths:

```text
arena.ts
playSpecVsSpec
evaluateArena
hill_climb.ts
sequential_tree_optimization.ts
branch_induct.ts
```

Keep old files intact for historical/sandbox diagnostics.

## B. Gift Jungle Minimal Repair

1. Modify the current source `gift_jungle` directly. Add exactly one team slot:

```json
{ "monsterId": 116, "badgeIds": [3, 5] }
```

2. Do not create, import, or retain a `gift_jungle_v2` source.
3. Do not wholesale import `D:\develope\对战ai\_archive\阵型库\礼物丛林1.json`. Its other badge/tree changes are out of scope.
4. Add monster `116` only at each existing reachable leaf's empty round-5 deployment list. Use one legal, ordinary, non-calculator-controlled position per leaf; preserve every pre-existing team slot, badge, action, placement, coordinate, branch, and order.
5. Mark the repaired source executable (`isLegacyBaseline: false`) and assign a new current fingerprint. Persist repair provenance in source metadata:

```text
sourceId=gift_jungle
repairKind=add_eighth_monster_only
addedSlot={monsterId:116,badgeIds:[3,5]}
archiveReference=D:\develope\对战ai\_archive\阵型库\礼物丛林1.json
historicalEvidence=PRODUCT_PATH_FORMAL_SCREEN_T035_V1 / seven-monster / retained-separate
```

6. Do not overwrite any T035 record. The old seven-monster Gift Jungle evidence remains historical-only in its existing product-path archive; the repaired source gets a new fingerprint and new baseline.

## C. Branch and Side Semantics

1. `side` is an optional FeatureMask branch condition, not a globally separate strategy tree.
2. Conditions may combine `side` with opponent features observable by the relevant round:

```text
R1: enemy revealed hand IDs and revealed badges only
R2+: R1 observations plus enemy board IDs visible at the current round
```

3. A side-only branch is legal. A side-plus-opponent-feature branch is legal. A condition requiring unavailable future state is illegal.
4. R1 is fully supported: root children at `round=1` may contain condition branches. Product selection begins at R1 and selects a matching branch before emitting R1 intents.
5. Coordinate semantics are immutable:

```text
P2: tree x coordinate is used directly
P1: product_tree_strategy mirrors x to 10-x
```

## D. Candidate Variables, Not Search Yet

Define typed operator families and metadata only:

```text
spatial_local
formation_transform
strategy_schedule_branch
multi_monster_exploration
```

- `spatial_local`: one ordinary controllable placement coordinate only.
- `formation_transform`: a distinct whole-pattern transform candidate, such as legal horizontal/vertical translation or mirror of an allowed computed-unit formation pattern. Never silently mix it into local spatial mutation. It must declare transform kind, affected nodes, legal coordinate mapping, and no-op result.
- `strategy_schedule_branch`: cross-round timing, legal monster/badge changes, R1/R2+ branch conditions, and branch-specific schedules together. Same-round list order is not an operator.
- `multi_monster_exploration`: seeded multi-change exploration metadata only; actual generation belongs to T038.

## E. Tests and Read-Only Checks

Add:

```text
tests/t036_product_training_foundation.test.ts
scripts/tree_product_training/check_sources.ts
scripts/tree_product_training/check_architecture.ts
```

Required assertions:

- current `gift_jungle` is exactly eight monsters and differs from the pre-repair source only by `116 [3,5]` plus legal leaf deployment additions;
- no `gift_jungle_v2` source exists;
- every reachable leaf deploys `116` exactly once on a legal product-side path;
- historic seven-monster T035 evidence remains present and protocol/fingerprint-separated;
- R1 matching branch and R1 fallback branch select correctly, including P1/P2 coordinate behavior;
- side-only and side-plus-visible-opponent-feature branch conditions are accepted;
- future-state R1 condition is rejected;
- new module files do not import deprecated sandbox paths;
- canonical fingerprint distinguishes meaningful transform/schedule/branch changes and rejects no-ops.

## Acceptance

- [ ] Focused Phase-1 module map exists and passes architecture checker.
- [ ] Current Gift Jungle is repaired in place to an executable exact-eight source; historic seven-monster evidence remains separately retained.
- [ ] R1 branch behavior is tested on real product strategy semantics for both sides.
- [ ] No product simulation beyond focused tests; no apply/deploy/publish/Tier change.

## Delivery

Write `TASKS/tree/T036.report.md` with changed file map, test/check commands, exact in-place Gift Jungle diff/provenance, historical-seven-monster separation, R1 branch evidence, source fingerprints, and no-simulation/no-apply confirmation. Commit/push only `agent/tree`.
