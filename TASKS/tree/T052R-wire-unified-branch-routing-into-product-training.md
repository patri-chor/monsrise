STATUS: OPEN
DOMAIN: tree

# T052R - Wire Unified Branch Routing Into Product Training

> T052 is partially accepted as a pure routing library and unit-test proof. It is rejected as an operational training feature: `routeLocalCandidate`, `convertLocalSolutionToBranch`, `optimizeBranchSubtreeLocally`, and `evaluateForwardBranchNode` have no caller outside `t052_branch_routing.ts`/tests. The produced audit JSONLs contain repeated `test_cand_audit` / `parent_fp_123` fixture records, not real product-path training evidence.

## Verified Gap

```text
T052 routing functions:
  defined and unit tested
  no production caller

T052 audit records:
  test candidate IDs/fingerprints
  repeated test timestamp records
  no real product game / manifest / seed / WDL provenance
```

Do not present T052 routing as live optimization until this task is complete.

## A. Real Product Training Integration

Wire the unified routing stage into the current active product training cycle/candidate scheduler:

```text
local mutation candidate (spatial/order/tree/badge/calculator policy)
-> same manifest/seed product-path parent-vs-candidate panel
-> raw W/D/L + per-game visible label observation
-> routeLocalCandidate
-> GLOBAL_IMPROVEMENT queue OR LOCAL_ONLY_BRANCH conversion queue
-> branch-local optimization queue
-> forward-node evaluation queue
-> fresh product-path validation
-> append-only production audit artifacts
```

Use only:

```text
PersistentSimPool -> fine_grained_worker(product_path) -> playFullGame -> product_tree_strategy
```

Do not invoke old `hill_climb.ts`, `branch_induct.ts`, `arena.ts`, `playSpecVsSpec`, generic BattleAI, rule-random, separation, or test fixtures as evidence.

## B. Product-Path Observation Capture

Extend product worker/task response as needed so each evaluated game supports legal attribution:

```text
formation and calculator-policy fingerprints
parent/candidate identity
Active-L2/L1 manifest hash and revision
side, seed, game outcome/WDL
round-by-round visible hand IDs/badges and revealed board IDs
recognized labels at each possible fork round
selected branch ID/main fallback
product-path provenance / worker/deployment errors
```

Never capture/use hidden future opponent information. R1 remains hand/badge only; R2+ adds only current revealed board.

## C. Production Routing and Branch Validation

A LOCAL_ONLY_BRANCH route must have:

```text
real candidate/parent product-path records
same benchmark/manifest and matched seed panel
actual global Score70 delta
actual target-label subset Score70/WDL delta
minimum configured label/side coverage
observable FeatureMask at chosen fork
unique parent/candidate/policy fingerprints
```

On conversion:

```text
copy exact local changed subtree/policy behavior into conditional branch
preserve main branch exactly
run branch-local optimization with real targeted product games
run forward-node evaluation with actual earlier-round visibility and product-path replay
accept only after fresh validation; otherwise retain recorded rejection/late fork
```

The route must not automatically modify R0, active playable formations, or dynamic T tiers. It produces experimental candidates/evidence only.

## D. Audit Data Hygiene

1. Preserve existing T052 audit JSONLs as `TEST_FIXTURE_CONTAMINATED_HISTORICAL`; do not treat them as evidence.
2. Create V2/current production audit paths or explicit revisioned records. Do not append production rows beside test fixtures without a strict `recordKind`/schema boundary.
3. Every production routing/conversion/forward record must include:

```text
recordKind: PRODUCT_PATH_EVIDENCE
record ID
candidate/parent/policy fingerprints
formation IDs
manifest hash/revision
seed schedule revision
raw outcome/vector references
observable label inputs and fork round
route/conversion/forward result
W/D/L / Score70 values
worker/deployment status
createdAt
```

4. Current checker must fail if test fixture IDs/fingerprints, missing provenance, duplicate record IDs, or missing raw references appear in production evidence.

## E. End-to-End Verification

Add a deterministic product-path integration test or bounded test run proving:

```text
real local candidate globally regresses/holds
but improves a legally observable fullrush/mine or equivalent subset
-> current scheduler produces LOCAL_ONLY_BRANCH
-> writes production evidence with raw source records
-> converts branch without mutating main tree
-> attempts forward round with real visibility/replay result
```

If no naturally occurring candidate can meet this within a bounded deterministic fixture, create a dedicated product-path test fixture with real teams/trees and run `playFullGame`; do not use a fabricated aggregate result.

Run current dynamic training checker once T051R establishes it, focused T052R test, product-path tests, and `npx vite build` only if UI/export changed.

## Acceptance

- [ ] Unified routing is invoked from the actual active product training scheduler, not only tests.
- [ ] Real per-game product observations drive label attribution and Score70/WDL routing.
- [ ] All current audit records are production-provenance complete and test data is clearly historical/segregated.
- [ ] Branch conversion, branch-local optimization, and forward validation each have end-to-end product-path evidence.
- [ ] No old arena/testing data can cause a current branch candidate acceptance.

## Delivery

Write `TASKS/tree/T052R.report.md` with scheduler call path; worker observation schema; one real end-to-end routing example; audit V2 schema/counts and test-fixture segregation; branch-local/forward evidence; check/test output; dynamic-model dependency status; no-apply confirmation; and every changed file. Commit/push only `agent/tree`.
