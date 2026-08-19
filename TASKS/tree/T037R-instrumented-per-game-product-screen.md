STATUS: RETRACTED_BY_USER
DOMAIN: tree

# T037R - Instrumented Per-Game Product-Path Screen Repair

> Retracted before execution by direct user instruction. Retain as a future strict-evidence upgrade specification; do not execute it now.

> Narrow repair for T037. Preserve its completed aggregate screen artifacts as `AGGREGATE_ONLY_UNADOPTED`; do not delete or overwrite them. T038 remains blocked until this task passes.

## Verified Failure

T037 ran the correct high-level product call chain but persisted only one aggregate record per opponent-side cell:

```text
26 entities x 14 aggregate cells = 364 records
10 games are collapsed into MatchMetrics per cell
candidateDeploymentCount = null
opponentDeploymentCount = null
branchTraceLink = null
traceHash = null
traces.jsonl missing
```

It therefore cannot prove per-game seed/outcome/deployment/branch behavior and must not drive adaptive selection, pruning, or runtime export.

## Scope

Repair only T037 screen instrumentation and evidence persistence. Do not mutate sources, candidate definitions, operator selection, pool sizing, Tier state, active formation, bundle, deploy, or publish.

## Required Product-Path Execution

Retain:

```text
PersistentSimPool -> fine_grained_worker(product_path) -> playFullGame -> product_tree_strategy
outer candidate concurrency <= 2
```

Add a product worker task/result mode that returns one record for every actual game, including both deployment traces, rather than only aggregated `MatchMetrics`. Formal aggregate APIs may remain for diagnostics but must not be used as the source of T037R evidence.

## Required Append-Only T037R Namespace

Write a new protocol and namespace; never merge it with T037 aggregates:

```text
Protocol: PRODUCT_PATH_T037R_V1
tests/fixtures/tree/experience_library/product_path_t037r/
```

Required files:

```text
manifest.json
sources.jsonl
candidate_registry.jsonl
rejected_candidates.jsonl
game_records.jsonl
cell_aggregates.jsonl
screen_observations.jsonl
traces.jsonl
cursor.json
README.md
```

### One `game_records.jsonl` Record Per Game

Exactly one record per entity/opponent/source-side/gameIndex, containing:

```text
protocol / manifestHash / execution semantics / code commit
entity ID / source ID / canonical fingerprint / operator family / parent
opponent ID + opponent fingerprint
actual source side
exact deterministic seed
gameIndex
W/D/L from source perspective
round count and final scores
completed/error state (errors never become losses)
source and opponent team sizes
source and opponent accepted deployment counts
early termination reason
source and opponent trace links/hashes
selected branch IDs/provenance observed in source trace
```

### Traces

`traces.jsonl` must retain lossless source-side and opponent-side product deployment trace arrays for every game, keyed by a stable `traceId`. Hashes alone are insufficient.

## Exact Coverage

For every accepted entity:

```text
7 held-out families x 2 actual sides x 10 games = 140 game records
14 cell aggregates, each recomputed only from its 10 matching game records
```

The runner must fail closed before marking an entity complete when any expected game is missing, has a worker error, has empty team evidence, has zero accepted deployments on either side, lacks a trace, or has early/protocol termination.

Use atomic per-entity cursor checkpoints. Resume identity includes protocol, manifest hash, source/candidate fingerprint, opponent fingerprint, source side, game index, seed, and code commit.

## Checks

Replace/extend `check_screen.ts` so it independently verifies:

```text
one 140-row game-record schedule per entity
exact 7x2x10 coverage and deterministic unique seeds
all W/D/L and trainingScore recompute from game records
all 14 cell aggregates recompute from their 10 games
zero errors / nonempty teams / accepted deployments on both sides
lossless trace presence and trace-hash linkage
branch IDs link to source traces where a tree strategy runs
manifest authority, worker configured/observed counts, and no arena formal call
```

Update candidate checker only if needed to require T037R identity separation. Add focused tests for a product worker per-game record and a trace-linked aggregate recomputation.

## Acceptance

- [ ] Existing T037 aggregate files remain unchanged and explicitly classified `AGGREGATE_ONLY_UNADOPTED`.
- [ ] T037R has 26 accepted entities x 140 trace-backed game records = 3,640 records, or explicit failure records without loss conversion.
- [ ] Every accepted entity has valid 7x2x10 cell coverage and 14 correctly recomputed aggregates.
- [ ] Every game has both team/deployment evidence, both traces, exact seed, actual side, and source-perspective W/D/L.
- [ ] Product pool and worker concurrency remain retained; no arena formal execution.
- [ ] No promotion/apply/deploy/publish or autonomous T038 selection.

## Delivery

Write `TASKS/tree/T037R.report.md` with implementation file map, protocol/manifests, raw game/trace counts, aggregate recomputation result, coverage, error/termination/deployment audit, branch trace evidence, worker concurrency, preserved-T037 classification, and no-apply confirmation. Commit/push only `agent/tree`.
