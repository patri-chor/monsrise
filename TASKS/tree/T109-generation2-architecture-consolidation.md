STATUS: OPEN
DOMAIN: tree
SUPERSEDES: T108-generation2-all2rush-multicase-branch-optimization

# T109 - Generation 2 Architecture Consolidation

## Objective

Consolidate Generation 2 tree optimization into a small, explicit architecture before further all2rush search. Do not add another parallel optimizer, evidence writer, checkpoint wrapper, or branch runtime path.

This is a structural task. Preserve the observable battle behavior proved by T107 and preserve T108 artifacts as historical evidence. No R0, global main, tier/L1, or deployment change.

## Required Architecture

Create the following product-training modules under one directory:

```text
src/engine/tree/product_training/generation2/
  product_match_runner.ts
  round_checkpoint_service.ts
  loss_case_service.ts
  local_search_service.ts
  branch_library.ts
  evidence_writer.ts
  index.ts
```

Their responsibilities are fixed.

### 1. `product_match_runner.ts`

The only Generation 2 entry point for product battle execution.

```ts
runFullMatch(input): ObservableMatchResult
runFromCheckpoint(input): ObservableMatchResult
```

It owns the product `playFullGame` / `ProductGameSession` adaptation and returns only normalized observable outputs by default:

```text
final W/D/L
final score
roundResults
per-round survivor/HP summary and digest
```

Detailed trace/internal diagnostics are opt-in and are requested only after an observable mismatch.

### 2. `round_checkpoint_service.ts`

Owns checkpoint capture, restore, fingerprint and observable parity helper calls. It may use `ProductGameSession` internally, but no search or branch logic may call that session directly.

```ts
captureBeforeRound(...)
restore(...)
assertObservableParity(...)
```

### 3. `loss_case_service.ts`

Owns all2rush target-side loss/draw inventory, earliest adverse observable round, severity ranking, and exact case identity.

```ts
buildLossQueue(...)
rankLossCases(...)
```

It must not generate candidates, append generic evidence, or modify branches.

### 4. `local_search_service.ts`

Owns a seeded, checkpoint-derived legal candidate catalog and bounded search.

```ts
buildLegalCatalog(...)
sampleCandidates(seed, limit)
evaluateCase(...)
```

It consumes `ProductMatchRunner` and `RoundCheckpointService`, returns structured local trial results, and never writes an Evol branch directly.

### 5. `branch_library.ts`

Owns only branch records and semantics:

```ts
createExactCaseBranch(...)
confirmExactCaseBranch(...)
matchExact(...)
warmStartCandidates(...)
mergeValidatedPrefixes(...)
pruneValidated(...)
```

`product_tree_strategy` remains responsible only for runtime tree-node selection. It may receive a compiled Evol subtree from this library, but must not perform local search, evidence output, loss ranking, or warm-start candidate generation.

Exact match may execute a verified branch. Similar observation may only yield an explicit warm-start candidate list for `local_search_service`; it must not change runtime branch selection.

### 6. `evidence_writer.ts`

The only Generation 2 JSON/JSONL writer. It owns schema versioning, append-only writes, and required identity/common metadata. Services return data; they do not use `appendFileSync` directly.

### 7. `index.ts`

The only orchestration entry point:

```text
resolve/pin snapshot inputs
-> LossCaseService.buildLossQueue
-> for each case: RoundCheckpointService + LocalSearchService
-> BranchLibrary confirmation/reuse/merge
-> EvidenceWriter
```

No cyclic imports. No direct `ProductGameSession`, `appendFileSync`, `FORMATION_LIBRARY`, or ad-hoc `reports/tree-cycle` write from outside the appropriate module.

## Migration Rules

1. Move/refactor existing Generation 2 code from:

```text
src/engine/tree/round_engine/product_round_session.ts
src/engine/tree/round_engine/fidelity_gate.ts
src/engine/tree/round_engine/loss_case_inventory.ts
src/engine/tree/round_engine/branch_first_optimizer.ts
```

into the modules above, preserving public compatibility re-exports temporarily where current tests/callers need them.

2. Keep `playFullGame` as the authoritative game-rule implementation.
3. Keep `ProductGameSession` private behind `RoundCheckpointService` or `ProductMatchRunner` after compatibility migration.
4. Existing `product_training/05_branch_routing.ts` is historical/adaptive routing; do not call it from Generation 2 and do not expand it. Eliminate any Generation 2 path that uses its root fallback, old arena path, or hard-coded masks.
5. `FORMATION_LIBRARY` can be used only for immutable R0 resolution. Active/current inputs flow through SnapshotResolver/pinned manifest.
6. `reports/tree-cycle` artifact names must be managed by `EvidenceWriter`; preserve old artifacts read-only.

## Allowed Files

Primary allowed files:

```text
src/engine/tree/product_training/generation2/**
src/engine/tree/round_engine/**          # compatibility adapter/removal only
src/engine/tree/product_tree_strategy.ts # only narrow compiled-branch adapter if unavoidable
tests/t109_generation2_architecture.test.ts
```

Do not change:

```text
src/engine/play_full_game.ts game rules
src/game/** battle rules
formation tier/global promotion/UI/R0 data
old arena implementation
```

## Tests

Add architecture tests that prove:

```text
- one public Generation 2 orchestrator call uses the declared service order;
- product runner is the only service that invokes product match execution;
- checkpoint service is the only Generation 2 service using ProductGameSession;
- evidence writer is the only Generation 2 direct filesystem writer;
- local search does not compile/runtime-apply branches;
- branch library does not generate candidates or write evidence;
- exact runtime reuse and similar warm-start remain separate;
- no Generation 2 import reaches arena.ts or 05_branch_routing.ts.
```

Add a focused migration regression for one existing all2rush case: observable result is unchanged before/after service routing.

## Acceptance

- [ ] Seven declared modules exist with single responsibilities.
- [ ] One documented, non-cyclic orchestration path is the sole Generation 2 flow.
- [ ] Existing T107 observable result for a regression case is unchanged.
- [ ] No second optimizer/evidence/checkpoint path remains reachable from Generation 2 entry.
- [ ] Existing artifacts retained; new writes flow only through EvidenceWriter.
- [ ] No global/tier/L1/deployment change.

## Delivery

Write `TASKS/tree/T109.report.md` with before/after call-path table; module ownership table; migration map; compatibility exports; prohibited-dependency test results; regression observable comparison; remaining temporary adapters; changed files. Commit/push only `agent/tree`.
