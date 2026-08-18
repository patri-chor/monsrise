STATUS: OPEN
DOMAIN: tree

# T033 - Unify Tree Training with the Real `playFullGame` Execution Path

> Domain: `tree` | Executor branch: `agent/tree`
> User decision: the real product battle path is `playFullGame`; tree training must align to it. The web particle/VFX layer is presentation only and must not be replaced or used as a separate simulation target.
> No active formation/bundle apply, deploy, Tier promotion, or automatic bundle replacement.

## Context and Non-Negotiable Evidence

T031 established an honest failure:

```text
Real product entry: playFullGame
Tree runner entry: arena.ts -> playSpecVsSpec
Independent canonical parity: 0/60 identical
Training evidence: SANDBOX_ENGINE_UNVERIFIED
```

The mismatch is structural: `playFullGame` uses the product placement planner while tree runner injects evolved formation/tree decisions through a separate bundle/arena loop. Byte-identical bundles alone do not make these execution semantics equal.

## Objective

Make tree candidate evaluation execute through the real product `playFullGame` battle lifecycle, while retaining a controlled opt-in strategy adapter capable of applying an Evol formation tree. There must be exactly one battle/placement/budget/combat/result path for real evaluation.

## A. Product Entry Strategy Contract

1. Extend `src/engine/play_full_game.ts` with an explicit, typed, opt-in deployment strategy contract. It must include enough real round state to make a legal decision:

```text
side/source identity
round
source team and available hand
own/enemy board snapshot
opponent revealed hand snapshot
current budget
seed / deterministic RNG
```

2. Strategy output must be only a declarative ordered placement intent:

```text
monsterId
plannedX / plannedY
optional decision/branch provenance
```

3. The product entry exclusively validates/deploys each intent using its existing real placement, budget, collision/relocation, battle, scoring, and reset logic. A strategy must never call `placeMonster` directly or calculate synthetic budget/cost.
4. Preserve existing default behavior byte-for-byte at the semantic level: when no strategy is supplied, `playFullGame(teamA, teamB, options)` retains current greedy/snapshot planner behavior and public callers remain compatible.
5. Add product-entry trace callbacks/return fields for all actual placement outcomes and round observations. Trace fields must include round, actual board side, source side, monster ID, attempt order, planned/actual coordinates, acceptance/rejection reason, budget before/cost/after, and strategy branch provenance.

## B. Tree Strategy Adapter

1. Implement a tree-only adapter converting `EvolFormation` to the new product strategy contract. It may calculate tree branch selection and declarative intents, but must not import/call `arena.ts`, `playSpecVsSpec`, `PersistentSimPool`, `fine_grained_worker`, bundle custom-formation APIs, or direct placement APIs.
2. Use the same real coordinate convention as `playFullGame`; no hidden mirror/offset transformation outside the product entry.
3. A native/frozen formation counterpart must execute through the same product entry and its current default strategy, unless a controlled native formation strategy is explicitly required for a matched test. Document which one is used.
4. Record tree branch provenance in real product traces. A missing branch trace is `MISSING_TRACE`, never a synthetic success.

## C. Replace Training Evaluation Path

1. Retain the existing multi-thread/process scheduling architecture: `PersistentSimPool` and its worker pool remain the dispatcher, task queue, error propagator, and resumable checkpoint coordinator. Do not regress formal evaluation to serial execution.
2. Add a product-path evaluator used inside each `fine_grained_worker` / `persistent_pool` worker for tree formal evaluation. Each worker must invoke `playFullGame` for both candidate sides and collect the product entry traces. `PersistentSimPool` is permitted only as the outer scheduler here; it is not the battle execution path.
3. Preserve configurable bounded concurrency, with outer candidate concurrency <=2 and existing inner worker parallelism retained unless trace safety requires a documented lower cap. Record configured and observed worker concurrency in every new run manifest.
4. Existing `arena.ts -> playSpecVsSpec` must not be used for any new formal screen, promotion, four-cost gate, H2H, or experience-library observation after this task. It may remain only as deprecated diagnostic code with an explicit `SANDBOX_ONLY_DEPRECATED` designation.
5. Add a fail-closed protocol gate: any formal evaluation attempting the old arena runner must throw before workers start.
6. Update the real artifact/provenance manifest to record:

```text
executionSemanticsVersion
productEntryModule
strategyAdapterVersion
authorityBundle absolute path + SHA256
runner commit
```

## D. Test Matrix and Compatibility

1. Default compatibility: fixed seeds and no custom strategy must preserve current `playFullGame` outcomes/traces for representative Tier 1 teams.
2. Strategy path: test both actual source sides, legal and illegal intents, collision/relocation, four-cost placement, rejected placement, branch provenance, and budget correctness through product entry traces.
3. Product-path tree evaluator must be proven to call `playFullGame` and statically prohibited from using `arena.ts`, `playSpecVsSpec`, `PersistentSimPool` old execution path, or bundle custom-formation injection.
4. Negative tests:
   - old arena formal runner request is blocked;
   - strategy direct-placement/cost override is rejected;
   - missing/incorrect authority artifact blocks before evaluation;
   - a trace/branch mismatch is detected;
   - side 1/2 reaches distinct product side execution.
5. Run the T031 canonical comparator again. It must now either:
   - show product-path tree evaluator uses the same product battle path with documented intentional decision differences, or
   - produce exact identity for equivalent strategy configuration.

Do not weaken comparison by ignoring branch, placement, budget, observation, or outcome fields.

## E. Experience Library Reclassification and Rerun

1. Preserve all T014-T027 observations, registries, matrices, frontiers, and reports unchanged, but annotate their protocol status as:

```text
SANDBOX_ENGINE_UNVERIFIED_PRE_T033
```

2. Do not overwrite historical W/D/L. New observations must append with a new protocol identity incorporating `executionSemanticsVersion` and product-path manifest hash.
3. After all A-D tests pass, rerun in order using the unified evaluator:

```text
four-cost product-path fidelity gate
10 executable 8-monster source baselines
60 generated candidates formal screen: 7 families × 2 sides × 10 games/cell = 140 games/candidate
```

4. Preserve `gift_jungle` as frozen 7-monster Tier 1 legacy baseline; do not generate an eighth monster or descendants.
5. Do not call new numbers Tier 2. They are `PRODUCT_PATH_FORMAL_SCREEN` signals until source-relative three-schedule promotion evidence is completed.
6. Atomic checkpoints after each candidate/schedule. Outer concurrency <=2; errors never become losses.

## F. Integration Boundary

`play_full_game.ts` is product-core shared code. Implement and test only on `agent/tree`; do not modify active public bundle or main directly. Any later exposure to the active web/game entry is a separate integration decision after this task's product-path test evidence is reviewed.

## Acceptance

- [ ] Tree formal evaluator calls real `playFullGame`, not `arena.ts` / `playSpecVsSpec`.
- [ ] Default product gameplay is compatible without custom strategy.
- [ ] Tree strategy produces declarative intents; real product path owns all deployment/budget/combat semantics.
- [ ] Full product traces cover branches, positions, attempt order, acceptance/reason, budget, side, observations, and outcomes.
- [ ] Old formal arena evaluator fails closed.
- [ ] Product-path four-cost trace gate passes with actual runtime events.
- [ ] New 60-candidate, 140-game formal screen is append-only and clearly separate from sandbox observations.
- [ ] Historical records are retained and reclassified; no automatic Tier/apply/deploy change.

## Delivery

Write `TASKS/tree/T033.report.md` with API contract, changed call path, static call provenance, compatibility and negative test output, manifest, fidelity results, resumable rerun cursor, observation counts/keys, source frontier table labelled `PRODUCT_PATH_FORMAL_SCREEN`, historical reclassification, and explicit no-apply confirmation. Commit/push only `agent/tree`. Do not modify this specification.
