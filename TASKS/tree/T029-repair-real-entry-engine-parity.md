STATUS: OPEN
DOMAIN: tree

# T029 - Repair T028: Independent Real-Entry Engine Parity

> Domain: `tree` | Executor branch: `agent/tree`
> T028's artifact SHA-256 equality is retained as a useful observation. Its behavioral parity PASS is invalid and must not be used to reclassify T014-T027 sandbox results as real-game evidence.

## Verified Failure in T028 Harness

`src/engine/tree/real_game_engine_parity_gate.ts` currently claims real-path versus tree-path behavior but actually executes the same tree pool twice:

```ts
const res1 = await pool.evalCandidateWithDeploymentTraces(evol, [opp], 1, seed);
const res2 = await pool.evalCandidateWithDeploymentTraces(evol, [opp], 1, seed);
```

Both calls share `PersistentSimPool`, `evol`, opponent list, game count, and seed. This proves only repeatability of one runner, not parity with an independent real application entry path.

Additionally, the loop variable `side` is recorded but never passed into either call, so the claimed dual-side coverage is false.

Current `fine_grained_worker.ts` still loads `resolve('public/ai-bundle.iife.js')` relative to the tree executor checkout. A matching local SHA-256 at one point in time does not satisfy the T028 requirement that the runner consume an authoritative immutable artifact rather than a drift-prone checkout copy.

## Required Repair

### A. Retract Invalid Claim

1. Change T028 report/result classification to:

```text
BYTE_PARITY_PASS_BEHAVIOR_PARITY_INVALID
SANDBOX_ENGINE_UNVERIFIED
```

2. Record the exact tautology and unpropagated `side` defect. Do not retain phrases such as “100% behavioral parity proven”, “real-game valid”, or “60 dual-side cases passed”.
3. Preserve T026 values, but retain the `SANDBOX_ENGINE_UNVERIFIED` classification. Do not run T027 promotion or continuous optimization based on them.

### B. Artifact Provenance Gate

1. Define a runner configuration that receives an explicit absolute authority artifact path, defaulting only to an immutable named real-game build artifact.
2. Before every simulation, record source path, SHA-256, bundle build command/source commit, runner commit, and Node version.
3. Fail closed if the supplied artifact differs from the authority manifest. Do not manually copy/sync a bundle into a tree checkout to pass.
4. Add a focused test that changes/overrides the runner artifact path and verifies mismatch blocks before worker/pool startup.

### C. Truly Independent Behavior Parity

1. Identify the real application battle entry path used by the product. Do not call `PersistentSimPool`, `fine_grained_worker`, `arena.ts`, `playSpecVsSpec`, or an adapter that delegates to any of them for the real side.
2. Build a deterministic, independently dispatched real-entry adapter that returns canonical event records for:

```text
selected branch/node
planned and actual deployment coordinates
attempt order
accepted/rejected result and reason
budget before/cost/after
round observation
final W/D/L
```

3. The tree side may use the tree runner. The real side must be demonstrably distinct; tests must assert different entry module identities/call provenance.
4. Run matrix covering all ten executable source formations, at least three held-out opponents, both actual sides, and fixed seeds. Pass `side` to the actual real and tree execution routes, and assert it affects the executed spec rather than merely report metadata.
5. Compare full canonical event objects, not only trace count / monster ID / final budget. List all intentionally excluded presentation-only fields.
6. Add negative tests:
   - a forced coordinate/budget/branch difference must fail parity;
   - a fake adapter delegating to `PersistentSimPool` must be rejected;
   - changing side must invoke the opposite-side path.

## Acceptance

- [ ] T028 behavioral PASS is retracted and historical scores remain sandbox-unverified.
- [ ] Artifact provenance is explicit, immutable, and fail-closed before simulation.
- [ ] Real comparison side has separate entry provenance and cannot call tree runner code.
- [ ] Test matrix uses actual side 1 and side 2 execution, not unused metadata.
- [ ] Full deployment/branch/budget/outcome trace is compared and negative controls fail.
- [ ] Only a successful independent parity result may unblock T027, continuous optimization, Tier promotion, or any strength claim about the actual game.
- [ ] No apply/deploy/bundle replacement.

## Delivery

Write `TASKS/tree/T029.report.md` with the T028 retraction, concrete real entry module path, authority artifact manifest, executed command output, case matrix, provenance assertions, negative-test output, final PASS/FAIL, and explicit gating status. Commit/push only `agent/tree`. Do not modify this specification.
