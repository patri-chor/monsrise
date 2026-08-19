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

## E. Required Check Additions

Extend `check_cycle.ts` and focused tests to verify:

```text
reinvoking same cycle is idempotent (no added records)
new cycle identity is distinct and parent-linked
no duplicate decision/prune records
actual strategy_schedule_branch candidate produced or a valid explicit rejection
weak source reaches deterministic multi-monster escalation after configured persistent failure threshold
all generated candidates legal/unique and screened via product path
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
