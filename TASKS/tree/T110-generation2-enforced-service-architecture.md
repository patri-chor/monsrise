STATUS: OPEN
DOMAIN: tree
SUPERSEDES: T109-generation2-architecture-consolidation

# T110 - Generation 2: Enforced Service Architecture

## T109 Disposition

T109 created the requested directory and service names, but it does not yet enforce the declared architecture.

Verified gaps:

```text
- generation2/index.ts only re-exports modules; no single orchestration entry exists;
- LossCaseService directly imports and uses ProductGameSession;
- LocalSearchService directly restores/runs ProductGameSession via the checkpoint service result;
- ProductMatchRunner exposes runFromSession, so callers can bypass its intended match boundary;
- EvidenceWriter.writeJsonl overwrites files and does not supply schema/common metadata,
  violating append-only evidence ownership;
- architecture test is an integration smoke test and does not test prohibited imports,
  direct filesystem writes, service boundaries, or the claimed orchestration order;
- BranchLibrary confirmation marks success when a result exists, not when source-case
  observable outcome and exact branch selection are reproduced;
- local search candidate construction remains fixed-template, not the intended seeded
  legal catalog. This search issue is deferred until architectural boundaries are real.
```

T110 is the single next integer task. It enforces the architecture before continuing T108 multi-case optimization.

## Scope

```text
all2rush optimization remains paused during refactor
no R0/global main/tier/L1/deployment modification
no battle-rule change in play_full_game.ts or src/game/**
no arena.ts / 05_branch_routing.ts dependency in Generation 2
```

## Required Dependency Direction

Only this directed graph is permitted:

```text
index (orchestrator)
  -> LossCaseService
  -> RoundCheckpointService
  -> LocalSearchService
  -> BranchLibrary
  -> EvidenceWriter

ProductMatchRunner <- RoundCheckpointService and LocalSearchService
```

Clarification: `ProductMatchRunner` is the only Generation 2 module allowed to directly call `playFullGame` or execute sequential session rounds. `RoundCheckpointService` is the only Generation 2 module allowed to import `ProductGameSession`.

`LossCaseService` receives a small checkpoint/match facade injected from `RoundCheckpointService`; it must not import `ProductGameSession`, `playFullGame`, or `treeStrategyFor` execution machinery.

`LocalSearchService` receives a continuation evaluation facade from `ProductMatchRunner` / `RoundCheckpointService`; it must not import `ProductGameSession`, invoke `playRound`, or write files.

`BranchLibrary` receives confirmed local results and a branch confirmation callback. It must not create pools directly, generate candidates, execute games, or write files.

`EvidenceWriter` is the sole Generation 2 module allowed to import node filesystem write APIs.

## 1. One Real Orchestrator

Replace export-only `generation2/index.ts` with a single named orchestration API, for example:

```ts
runGeneration2All2RushPilot(input): Generation2PilotResult
```

Its fixed flow:

```text
resolve/pin caller-supplied snapshots
-> LossCaseService.buildLossQueue through supplied facade
-> for each case: build legal catalog and evaluate continuation through services
-> BranchLibrary creates/confirms only genuine improvements
-> EvidenceWriter appends artifacts
-> returns summary
```

Exports of individual data types/helpers may remain, but no external caller may compose the internal pilot flow by calling services in arbitrary order.

## 2. Tight Service Interfaces

Introduce small typed interfaces in one `contracts.ts` file, such as:

```ts
ObservableMatchRunner
CheckpointFacade
ContinuationEvaluator
BranchConfirmationEvaluator
Generation2EvidenceSink
```

Services depend only on these contracts, not concrete cross-layer internals. Avoid dependency injection frameworks or generic service locators.

`ProductMatchRunner` returns normalized observable output. `RoundCheckpointService` owns capture/restore but must ask ProductMatchRunner to run all continuations.

Do not expose public `runFromSession` or raw `ProductGameSession` from the public Generation 2 API. Keep any raw session adapter private to the checkpoint service implementation.

## 3. Append-Only Evidence

Replace overwrite-style trial/evidence writes with schema-versioned append-only records. `EvidenceWriter` must:

```text
create parent directory
append one JSONL row at a time
include schemaVersion, timestamp, artifact kind, and shared pilot metadata
support an explicit empty/header record when an artifact has no data
never truncate a prior artifact during normal pilot operation
```

A JSON manifest can be replaceable only when revision/hash is part of its filename. All event/trial/branch/evaluation records are JSONL append-only.

## 4. Branch Confirmation Contract

`BranchLibrary.confirmExactCaseBranch` receives an evaluator and only marks confirmed if it gets:

```text
source case ID and target side
exact selected branch ID
baseline and branched observable final result
per-round observable digest equality to the recorded candidate result
fresh worker/pool boundary indicator
```

A non-error worker response is not confirmation. No branch is created/attached by orchestrator unless its candidate `improved === true`.

## 5. Enforce Boundaries With Tests

Add tests that inspect the actual imports/source or use testable adapters to prove:

```text
- index invokes the fixed service order through one public pilot call;
- only ProductMatchRunner imports/calls playFullGame in generation2;
- only RoundCheckpointService imports ProductGameSession in generation2;
- only EvidenceWriter imports filesystem write APIs in generation2;
- LossCaseService and LocalSearchService have no direct raw session/game execution;
- BranchLibrary has no PersistentSimPool construction or filesystem writes;
- no generation2 import reaches arena.ts or 05_branch_routing.ts;
- append-only writer retains two sequential records;
- a non-improved candidate cannot create/confirm/attach a branch;
- a response with wrong branch ID or observable digest cannot confirm a branch.
```

Add a regression: one known all2rush loss case flows through the single orchestrator and returns the same observable baseline result as the prior path.

## Migration

Preserve compatibility adapters only outside `generation2/`, document each, and ensure they cannot be reached by the new orchestrator. Do not delete historical evidence or old tests.

## Acceptance

- [ ] One public Generation 2 orchestrator owns actual pilot flow.
- [ ] Service dependency graph is enforced by tests.
- [ ] Generation 2 raw game/session/filesystem ownership is singular as specified.
- [ ] Evidence events are append-only with schema/common metadata.
- [ ] Branch confirmation requires improved source-side observable reproduction.
- [ ] One regression loss case has unchanged baseline observable result.
- [ ] No optimization/global application occurs in this task.

## Delivery

Write `TASKS/tree/T110.report.md` with before/after dependency table; public API and contracts; orchestration call path; forbidden-import test results; append-only evidence test result; branch-confirmation negative/positive cases; regression observable output; compatibility adapters; changed files. Commit/push only `agent/tree`.
