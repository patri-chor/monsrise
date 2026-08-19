STATUS: OPEN
DOMAIN: tree

# T038R - Resumable Adaptive Loop Activation and Aggregate-Mode Boundary Repair

> Narrow repair for T038. Preserve its T037 aggregate screen and first-cycle artifacts. Do not rerun T036/T036R/T037, mutate sources, apply/deploy/publish, or execute strict T037R trace work.

## Verified T038 Defects

T038 checker passes but its local output reveals that it is not yet a safe unattended self-evolution loop:

```text
same cycleId has duplicated 11 source decisions (22 lines)
prune trials are duplicated (3 unique trials written twice)
cycle resume does not prevent duplicate append of a completed cycle
no actual strategy_schedule_branch candidate is generated
no actual multi_monster_exploration candidate/escalation occurs
catalog uses promotionCount / isPromotion=true without required experimental boundary label
prune records omit AGGREGATE_HEURISTIC_UNVERIFIED marker
```

The current catalog is a first aggregate-screen ranking only. It may remain as historical `T038_INITIAL_AGGREGATE_RANKING`, not a self-evolution output.

## Scope

Repair only T038 loop behavior, state identity, candidate production, aggregate-evidence labels, and checker coverage.

## A. Idempotent Cycle Identity and Resume

1. Define a stable cycle identity from:

```text
protocol
source fixture fingerprint
T037 manifest hash
candidate-generation policy version
base random seed
cycle ordinal
```

2. Before any append, atomically inspect cursor and reject or resume an already completed cycle identity. A second invocation of `run_cycle.ts` without a new ordinal/input must be a no-op and must not append decision/prune/catalog rows.
3. Every append-only decision and prune record has a stable `recordId`; checkers must reject duplicates by record ID and by `(cycleId, sourceId, record type, branchNodeId where relevant)`.
4. A new cycle must use a new cycle ordinal/seed and record its parent frontier/catalog identity.

## B. Actual Adaptive Candidate Production

1. Implement real candidate generation in the T038 cycle after loading its prior frontier, not merely selection among T037 fixed candidates.
2. Strong/mature sources generate only single-change candidates (spatial, transform, or one strategy schedule/branch change), subject to controllability budget.
3. Weak/early sources generate configured single-change attempts first. Persist `singleOpFailCount` across cycles.
4. Once the configured failure threshold is reached, generate at least one deterministic seeded `multi_monster_exploration` candidate with 2-4 enumerated legal atomic changes. Persist:

```text
parent fingerprint
random seed
all atomic changes
failure count
escalation reason
rollback parent
```

5. Implement actual `strategy_schedule_branch` generation. A generated branch must alter cross-round schedule, deck/badge, or placement behavior relative to fallback, and must respect R1/R2+ observability and side-aware masks. Do not generate same-round list-order-only changes.
6. Validate and dedupe candidates before any product-path worker dispatch. Record legal rejections with reason.
7. Run the existing aggregate product-path screen for each new accepted candidate; each result remains `AGGREGATE_EXPLORATION_ONLY`.

## C. Aggregate-Mode Boundaries

1. Replace catalog field names that imply approval:

```text
promotionCount -> experimentalFrontierCount
isPromotion -> isExperimentalFrontier
```

2. Catalog top-level required fields:

```text
evidenceClass: AGGREGATE_EXPLORATION_ONLY
integrationStatus: EXPERIMENTAL_UNVERIFIED_NOT_FOR_AUTO_INTEGRATION
formalPromotionStatus: NOT_EVALUATED
```

3. Every cycle decision and prune trial includes:

```text
evidenceClass: AGGREGATE_EXPLORATION_ONLY
```

4. Every prune trial includes:

```text
heuristicStatus: AGGREGATE_HEURISTIC_UNVERIFIED
```

5. Report/catalog/checker must not use `Promoted`, `Promotion`, Tier-ready, or equivalent approved language. “Experimental frontier” is the maximum classification.

## D. Aggregate Heuristic Pruning

Retain product path only. For selected branch candidates, compare the candidate and branch-removed candidate using matched aggregate samples. Persist trial identity, seeds, source-relative/weakest-side aggregate measures, and the mandatory heuristic marker. Do not claim trace-backed pruning and do not call arena prune modules.

## E. CPU Saturation and Tiered Aggregate Sampling

### 1. Fix task granularity before raising worker counts

Current T037 task construction is too coarse:

```text
one entity = 7 opponents x 2 sides = 14 tasks
one task loops 10 games serially
with 32 workers, at most 14 workers can run
```

Replace this for T038 candidate screening with fine-grained one-game product tasks. Aggregate W/D/L only after the pool returns. Do not persist per-game traces or claim strict evidence; this remains aggregate exploration.

### 2. Keep a sustained runnable queue

- Preserve `PersistentSimPool`; do not cap it below available workers for formal product tasks.
- Keep outer candidate concurrency <=2, but dispatch the two candidates' per-game task sets together so the queue has at least `2 x 7 x 2 x samples` runnable games.
- Initial dispatch window must be at least `min(configuredWorkers, runnableTasks)`; do not wait for one completed aggregate cell before scheduling the next side/opponent/candidate.
- `CpuLoadMonitor` remains a 80% target controller, but scheduler telemetry must record configured workers, peak in-flight tasks, average in-flight tasks, sampled average CPU, sampled p50/p95 CPU, and number of low-queue intervals.
- Acceptance target: while runnable work is available for at least 10 seconds, observed average CPU must reach >=75% with p95 <=90%, or report a measured host-level blocker (for example VM quota, memory pressure, or host contention). Do not claim a literal guaranteed 80% on a host that cannot provide it.

### 3. Tiered sample budget for rapid exploration

Use a deterministic staged sample plan per candidate, per `opponent x side` cell:

```text
Stage A exploration: 1 game/cell = 14 games/candidate
Stage B contender: extend to 3 games/cell = 42 games/candidate
Stage C aggregate frontier: extend to 6 games/cell = 84 games/candidate
```

No default 10-game/cell screen for new T038 candidates. The old T037 10-game aggregate data remains a fixed starting reference.

Promotion to the next sample stage is source-relative and deterministic:

```text
A -> B: candidate aggregate score is >= source baseline score - 0.05
B -> C: candidate aggregate score is >= source baseline score
```

Record stage, games-per-cell, stage decision, source-relative criterion, parent score, and exact stage seed identity. A candidate failing a stage is retained as a rejected/exploration result, not silently discarded or converted to a loss.

### 4. Match pruning to the same fast evidence tier

Product-path aggregate pruning uses Stage B (3 games/cell) for before/after matched candidates. It remains `AGGREGATE_HEURISTIC_UNVERIFIED` and must record sample stage and task telemetry.

## F. Required Check Additions

Extend `check_cycle.ts` and focused tests to verify:

```text
reinvoking same cycle is idempotent (no added records)
new cycle identity is distinct and parent-linked
no duplicate decision/prune records
actual strategy_schedule_branch candidate produced or a valid explicit rejection
weak source reaches deterministic multi-monster escalation after configured persistent failure threshold
all generated candidates legal/unique and screened via product path
per-game task granularity and two-candidate queueing are used
stage A/B/C sample counts and promotion criteria recompute correctly
scheduler telemetry is present and CPU target is measured honestly
all catalog/decision/prune records bear aggregate experimental labels
no legacy promotion field/term remains in machine-readable catalog
```

## Acceptance

- [ ] A same-input rerun produces no duplicate records.
- [ ] At least two linked cycles demonstrate persistent state; later cycle produces strategy schedule/branch work and, when threshold condition is met, seeded multi-monster exploration.
- [ ] Candidate generation, validation, screen, selection, prune, cursor, and export work through the one `run_cycle.ts` entry.
- [ ] All output is explicitly aggregate exploration only and cannot auto-integrate.
- [ ] No source mutation, Tier change, apply/deploy/publish, or strict trace rerun.

## Delivery

Write `TASKS/tree/T038R.report.md` with cycle identities, no-op rerun proof, parent links, new candidate/operator counts, strategy/multi-monster evidence or rejections, duplicate audit, aggregate labels, prune heuristic records, catalog schema diff, source frontiers, and no-apply confirmation. Commit/push only `agent/tree`.
