STATUS: SUPERSEDED_BY_PHASED_T036_T038
DOMAIN: tree

# T037 - Unified Rapid Self-Evolving Product-Path Architecture

> Superseded before execution by the smaller phased implementation chain: T036 foundation, T037 screen/check chain, then T038 adaptive loop. Retained as historical planning only; do not execute.

> Domain: `tree` | Executor branch: `agent/tree`
> This is the active implementation task. It supersedes T036 as the execution plan, but does not delete T036 or historical evidence.
> Goal: deliver a clear, resumable, product-path-only self-evolution system that can run unattended cycles and later be connected to the game. Prioritize a working useful loop over premature ablation research.

## Non-Negotiable Runtime Path

```text
one orchestrator
-> one source/inventory loader
-> one candidate generator
-> one legality/dedupe gate
-> one product-path evaluator
-> one selection/promote-candidate registry
-> one runtime export adapter

PersistentSimPool
-> fine_grained_worker product_path task
-> playFullGame
-> product_tree_strategy
-> product-owned validation / placement / combat / score / trace
```

Formal training must never call `arena.ts`, `playSpecVsSpec`, `evaluateArena`, or legacy hill-climb/sequential optimizer paths. Keep them as sandbox diagnostics only; do not delete them in this task.

## A. Repair Gift Jungle as a New Executable Source

1. Preserve the existing 7-monster `gift_jungle` source unchanged as historic legacy evidence.
2. Add a separate executable source ID `gift_jungle_v2` based on the existing `gift_jungle` team/tree with exactly one addition:

```text
monsterId: 116
badgeIds: [3, 5]
```

3. Do not import the archive wholesale. In particular, preserve existing team badges, existing placements, and existing branch structure. The repair is **only** the eighth team slot.
4. Add this monster to the existing empty leaf deployment plan on every reachable root-to-leaf path, at a legal non-calculator-controlled coordinate. Preserve all pre-existing placements and do not change their order/coordinates.
5. Create and persist a named source fingerprint plus repair provenance:

```text
baseSourceId: gift_jungle
repairKind: add_eighth_monster_only
addedSlot: { monsterId: 116, badgeIds: [3, 5] }
archiveReference: D:\develope\对战ai\_archive\阵型库\礼物丛林1.json
```

6. Run a product-path baseline for `gift_jungle_v2`; it is eligible for optimization after the baseline completes. `gift_jungle` itself remains non-executable/no-descendant historical evidence.

## B. Clear Files and Stages

Create a focused directory under `src/engine/tree/product_training/` with exactly these ownership roles:

```text
01_sources.ts             frozen sources + gift_jungle_v2 repair + source fingerprints
02_candidates.ts          candidate generation for the two permitted operator families
03_validate.ts            deck/tree legality, canonical fingerprint, duplicate/no-op rejection
04_screen.ts              140-game product-path screen, raw cell/trace persistence and resume
05_select.ts              source-relative selection and next-cycle state
06_runtime_export.ts      read-only adapter that exports the selected candidate catalog for later game integration
run_cycle.ts              the only unattended-cycle command and orchestration entry point
```

Create matching read-only verification files under `scripts/tree_product_training/`:

```text
check_sources.ts
check_candidates.ts
check_screen.ts
check_cycle.ts
```

Do not create more executable optimization entry points. The old files remain but must be labeled `SANDBOX_ONLY_DEPRECATED` in the active guide and must not be imported by the new directory.

## C. Only Two Candidate Operator Families

### 1. Spatial operator family

Mutate only legal, ordinary controllable placement coordinates. It does not modify deck, branch conditions, cross-round timing, or same-round list ordering.

Selection priority:

```text
product-path weak opponent-side cells
uncovered coordinates in trace coverage
small local legal moves before broad moves
```

### 2. Strategy operator family

Mutate these together as one candidate, because they are semantically coupled:

```text
cross-round monster timing / deployment schedule
legal deck monster replacement and badge adjustment
branch creation / removal / condition refinement
R1 opening branches and R2+ branches
```

- Same-round placement array ordering is **not** a formal operator. `playFullGame` builds each side's round plan then performs all placements before battle; do not spend search budget claiming independent tactical value for list order.
- Branch proposals must change an executable schedule/deck decision. Reject a branch whose child produces the same canonical behavior as the fallback route.
- A branch condition is only eligible if its signals are observable through `DeploymentStrategyContext` by the relevant round.
- R1 branches are first-class. At round 1, selection may use the existing observable enemy hand/revealed badges; it may not use future board state.

## D. Side and Opening Semantics

1. `side` is a mandatory robustness evaluation dimension, not a candidate mutation:

```text
P1: tree x coordinate mirrored by product_tree_strategy
P2: tree x coordinate used directly
```

2. Every screen has both actual source sides:

```text
7 held-out families x 2 sides x 10 games = 140 games
```

3. Every R1 branch test must prove, through product traces, that matching observable inputs select the intended R1 branch and nonmatching inputs select its fallback/other valid branch.
4. The opening is not an independent cosmetic stage. It is the R1 subset of the strategy operator family, evaluated with its coupled schedule/branch decision.

## E. Fast Self-Evolution Cycle

The sole command is `run_cycle.ts`. One cycle:

```text
1. Load verified sources and current selected candidates.
2. Include gift_jungle_v2 after its own baseline is complete.
3. Build trace-derived coverage state and source-relative baselines.
4. Allocate a bounded candidate batch:
   50% spatial family
   50% strategy family
   source rotation and novelty floors prevent saturated sources dominating.
5. Validate + canonical-dedupe candidates before workers start.
6. Run 140-game product-path screens through PersistentSimPool; outer candidate concurrency <= 2.
7. Select one best unique candidate per source by source-relative score, then weakest-side score, then novelty/coverage gain.
8. Append raw data and update cursor/state atomically.
9. Export selected candidate catalog only; do not apply it to FORMATION_LIBRARY or active runtime automatically.
```

Initial acceptance speed gate:

```text
0 worker errors
complete 140 cells
both sides / all seven opponents / 10 games each
real traces and nonempty deployments
unique fingerprint
source-relative score >= baseline
no material weakest-side regression
```

This gate produces `CYCLE_FRONTIER_CANDIDATE`, not Tier 2. Detailed ablation, three-schedule confirmation, mixed-pool ranking, and game publishing integration are explicitly later tasks once a stable self-evolving loop works.

## F. Required Tests and Checks

1. Unit/integration test: `gift_jungle_v2` is exactly eight monsters; the original remains exactly seven and unchanged.
2. Unit/integration test: the eighth monster is deployed on every reachable leaf path through product strategy, with actual runtime trace/budget evidence.
3. Product-path test: an R1 condition branch is selected on matching visible opponent input and a fallback/nonmatching route is selected otherwise. Verify both P1 and P2 coordinate handling.
4. Static architecture check: new product_training directory imports no arena, playSpecVsSpec, evaluateArena, hill_climb, or sequential_tree_optimization.
5. Screen checker recomputes every W/D/L and source-relative score from raw cells.
6. Cycle checker validates source rotation, operator-family counts, duplicate rejection, resume identity, and worker concurrency.

## Evidence Output

Append only under:

```text
tests/fixtures/tree/experience_library/product_path_t037/
```

```text
manifest.json
sources.jsonl
candidate_registry.jsonl
rejected_candidates.jsonl
screen_cells.jsonl
screen_observations.jsonl
traces.jsonl
source_frontiers.json
cycle_state.json
runtime_candidate_catalog.json
cursor.json
README.md
```

## No-Apply Boundary

This task may create a read-only runtime candidate catalog for later integration. It must not alter frozen Tier 1, FORMATION_LIBRARY, active bundle, game default selections, deploy, or publish.

## Delivery

Write `TASKS/tree/T037.report.md` with the single run/check commands, new file map, gift_jungle_v2 baseline, R1 branch test result, product-path evidence counts, candidate/operator counts, source-relative frontier table, resume state, concurrency, and no-apply confirmation. Commit/push only `agent/tree`. Do not modify this specification.
