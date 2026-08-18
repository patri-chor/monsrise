STATUS: OPEN
DOMAIN: tree

# T032 - Unify Tree Training with Real `playFullGame` and Recompute Product-Path Results

> Domain: `tree` | Executor branch: `agent/tree`
> User decision: `playFullGame` is the real product battle path. Tree training must execute through it. Web particle/VFX is presentation only, not a separate target.
> No active formation/bundle apply, deploy, Tier promotion, or automatic bundle replacement.

## Completed Evidence Baseline

T031 tracked delivery is now present on `agent/tree` at `ba73b92` and proves:

```text
Real product entry: playFullGame
Old tree runner: arena.ts -> playSpecVsSpec
Independent canonical parity: 0/60 identical
Historical training evidence: SANDBOX_ENGINE_UNVERIFIED
```

T031's honest failure must be retained. The old tree simulator has different placement/planning semantics and its W/D/L must not be treated as real product strength.

## Objective

Unify candidate evaluation with the real `playFullGame` battle lifecycle while retaining an opt-in, declarative Evol-tree strategy. The product path must exclusively own placement validation, budget, collisions/relocation, combat, round reset, and result calculation. Then retain historic sandbox data and append newly recomputed product-path observations.

## A. Product Entry Strategy Contract

1. Extend `src/engine/play_full_game.ts` with a typed opt-in deployment strategy. It receives:

```text
source side / identity
round
source team and available hand
own/enemy board snapshot
opponent revealed hand snapshot
current budget
seed / deterministic RNG
```

2. Strategy output is ordered declarative intent only:

```text
monsterId
plannedX / plannedY
optional branch/decision provenance
```

3. Only `playFullGame` validates/deploys intent with real placement/budget/collision/relocation/battle/scoring/reset logic. Strategy code must not call `placeMonster`, calculate cost, or mutate game state.
4. With no supplied strategy, preserve current default product behavior and public caller compatibility.
5. Add product trace fields/callbacks covering: round, board side, source side, monster ID, attempt order, planned/actual coordinates, acceptance/rejection reason, budget before/charged/after, round observation, and branch provenance.

## B. Tree Strategy Adapter

1. Implement a tree-only Evol strategy adapter to produce the product strategy's declarative intents and branch provenance.
2. It must not import/call `arena.ts`, `playSpecVsSpec`, bundle custom-formation APIs, or direct placement APIs.
3. It uses product coordinate convention directly; no hidden mirror/offset outside product entry.
4. Frozen/native opponents use the same product entry and default product strategy unless a documented matched native strategy is needed.
5. Missing expected branch trace is `MISSING_TRACE`, never synthetic PASS.

## C. Preserve Parallel Evaluation While Replacing Battle Path

1. Retain `PersistentSimPool` and existing worker/process pool as outer dispatcher, queue, error propagator, and atomic/resumable checkpoint coordinator. Do not regress evaluation to serial execution.
2. Inside every `fine_grained_worker` task, call `playFullGame + product tree strategy` for both candidate sides and collect product traces. `PersistentSimPool` is allowed only as scheduler, never as an alternate battle path.
3. Preserve bounded/configurable worker parallelism. Outer candidate concurrency remains <=2; record configured and observed worker concurrency in each manifest.
4. New formal screen, promotion, four-cost gate, H2H, and experience observation requests must fail closed before workers start if they select `arena.ts -> playSpecVsSpec`. Mark that path `SANDBOX_ONLY_DEPRECATED`.

## D. Provenance, Tests, and Gates

1. Every product-path run must record:

```text
executionSemanticsVersion
productEntryModule
strategyAdapterVersion
authority bundle absolute path + SHA256
runner commit
configured/observed worker concurrency
```

2. Test default `playFullGame` compatibility under fixed seeds with no custom strategy.
3. Test strategy path on both actual sides: legal/illegal intents, collision/relocation, four-cost placement, rejection, branch provenance, and budget correctness through real product traces.
4. Static/runtime proof: product-path tree evaluator calls `playFullGame` and does not execute `arena.ts` / `playSpecVsSpec` / bundle injection.
5. Negative controls must show:

```text
old arena formal runner blocked
strategy direct placement/cost override rejected
missing/incorrect authority artifact blocked
trace/branch mismatch detected
side 1/2 reaches distinct product execution side
```

6. Re-run T031 comparator. It must show the product-path evaluator shares the product battle path; for equivalent strategy configuration it must be identical. Intentional decision differences must remain explicit and fully traceable, never ignored.

## E. Preserve Then Recompute Results

1. Preserve T014-T027 observations, registries, matrices, frontiers, and reports. Annotate their protocol status:

```text
SANDBOX_ENGINE_UNVERIFIED_PRE_T032
```

2. Never overwrite old W/D/L. Append all new observations with a protocol identity containing `executionSemanticsVersion` and product-path manifest hash.
3. After A-D pass, rerun in exact order with product path:

```text
four-cost product-path fidelity gate
10 executable 8-monster source baselines
60 generated candidates × 140 games
(7 early families × 2 actual sides × 10 games/cell)
```

4. Keep `gift_jungle` as frozen Tier 1 7-monster legacy baseline. Do not add an eighth monster or generate descendants.
5. New results are `PRODUCT_PATH_FORMAL_SCREEN` signals only, not Tier 2. Source-relative three-schedule promotion remains a later task.
6. Atomic checkpoint after each candidate/schedule. Worker errors never become losses.

## Integration Boundary

`play_full_game.ts` is shared product-core code. Implement/test only on `agent/tree`; do not modify active public bundle or main directly. A later integration decision is required before exposing any strategy extension to an active web/game workflow.

## Acceptance

- [ ] Tree formal evaluator calls product `playFullGame`, not `arena.ts` / `playSpecVsSpec`.
- [ ] Default product behavior remains compatible without strategy.
- [ ] Tree strategy is declarative; product path owns deployment/budget/combat semantics.
- [ ] Full product traces contain branch, placement, attempt order, acceptance/reason, budget, side, observations, and outcomes.
- [ ] Multi-thread/process pool remains active and concurrency is recorded.
- [ ] Old arena formal request fails closed.
- [ ] Product-path four-cost trace gate passes with actual product events.
- [ ] Product-path 60-candidate 140-game screen is append-only and distinct from sandbox observations.
- [ ] Historic data retained/reclassified; no automatic Tier/apply/deploy change.

## Delivery

Write `TASKS/tree/T032.report.md` with strategy API, changed call path, static provenance, compatibility/negative test output, product-path manifest, worker concurrency, fidelity results, atomic cursor, observation counts/keys, `PRODUCT_PATH_FORMAL_SCREEN` frontier table, historic reclassification, and no-apply confirmation. Commit/push only `agent/tree`. Do not modify this specification.
