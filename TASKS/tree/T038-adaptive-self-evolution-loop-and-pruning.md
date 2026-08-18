STATUS: BLOCKED_BY_T037
DOMAIN: tree

# T038 - Adaptive Self-Evolution Loop, Transform Search, and Product-Path Pruning

> Phase 3. Start only after T037 passes. This is the first unattended self-evolution loop, deliberately built after foundation and screen evidence are stable.

## Goal

Implement one resumable `run_cycle.ts` that evolves candidates using product-path evidence, adapts search breadth to source maturity and controllability, performs product-path post-pruning, and exports a read-only candidate catalog for future game integration.

## Sole New Execution Entry

```text
src/engine/tree/product_training/05_select.ts
src/engine/tree/product_training/06_prune.ts
src/engine/tree/product_training/06_runtime_export.ts
src/engine/tree/product_training/run_cycle.ts
scripts/tree_product_training/check_cycle.ts
```

`run_cycle.ts` is the only unattended optimizer command. It may call the Phase-2 validated candidate generator and screen runner only. It must retain `PersistentSimPool`, outer candidate concurrency <=2, append-only evidence, and atomic cursor state.

## Adaptive Operator Policy

### Mature / strong sources

A source is mature when its matched product-path baseline/frontier has high confidence and no material weak side. It receives mostly single-change candidates:

```text
spatial_local
one formation_transform
one strategy_schedule_branch delta
```

Do not spend broad random mutation budget on a stable strong source unless coverage proves its remaining legal space is exhausted or a weak opponent-side cell appears.

### Early / weak / unexplored sources

Start with single-change candidates. If a configurable consecutive single-operator attempt threshold yields no non-regressing unique result, escalate that source to deterministic seeded `multi_monster_exploration`:

```text
2-4 coordinated legal changes
may combine cross-round schedule + deck/badge + R1/R2+ branch
never includes meaningless same-round list reordering
```

Record escalation reason, failed single-operator count, random seed, parent fingerprint, every atomic change, and rollback parent.

### Controllability-aware spatial budget

Spatial search allocation is based on runtime/tree controllability, not raw formation count:

```text
spatial budget = base spatial budget x controllable placement ratio
```

Sources with many calculator-controlled units receive reduced spatial candidates and increased strategy/transform budget. If no ordinary controllable placements exist, spatial budget is zero and the reason is recorded.

### Formation transforms

Whole-pattern transforms are their own candidate family. Test them separately from local movement:

```text
legal translation
legal mirror
Empire/formation-pattern flip where authoritative transform rules permit
```

Each transform must apply consistently to its declared nodes, preserve legal side coordinates after P1/P2 mapping, identify calculator-controlled exceptions, and be rejected as a no-op if canonical behavior does not change.

## Side-Aware Branches and R1

- `side` is an optional branch-mask parameter and may combine with visible opponent features.
- R1 conditions use only R1-observable enemy hand/revealed-badge data.
- R2+ may additionally use currently visible enemy board IDs.
- Every branch candidate must change schedule/deck/placement behavior relative to fallback; no behavior-equivalent branches.
- All screening remains both-side 7x2x10. Side is never optimized by selecting only its favorable result.

## Product-Path Post-Pruning

After a source frontier candidate is selected, run product-path-only greedy post-pruning:

```text
for each nonempty branch:
  compare candidate vs branch-removed candidate on matched product-path sample
  prune only when removal has no material source-relative or weakest-side regression
```

Persist each prune trial, seeds, raw cells/trace links, before/after fingerprints, branch condition, decision, and confidence. Do not call legacy `prune.ts` or `prune_branch.ts` because they use arena.

## Cycle Steps

```text
1. Load T037 verified sources/frontiers/coverage/cursor.
2. Decide per-source maturity, controllability, weak-side needs, and operator budget.
3. Generate and validate canonical-novel batch.
4. Screen through the Phase-2 product path.
5. Rank by matched source-relative score, then weakest-side score, then coverage gain.
6. Product-path post-prune selected conditional candidates.
7. Keep one unique frontier per source and append a cycle decision record.
8. Export read-only runtime_candidate_catalog.json.
```

Outputs append below `product_path_t037/` or a versioned `product_path_t038/` namespace, never overwrite T035 evidence.

## Acceptance

- [ ] At least one completed resumable cycle executes through product path only.
- [ ] Mature and early-source policies are visibly different and auditable.
- [ ] Multi-monster exploration occurs only after recorded single-operator failure threshold.
- [ ] Calculated-unit-heavy sources have reduced/zero spatial allocation with reasons.
- [ ] Transform candidates are separately labeled and validated.
- [ ] R1 side-aware branch candidates and product-path post-pruning have trace-backed evidence.
- [ ] Runtime catalog is read-only; no Tier/apply/deploy/publish change.

## Delivery

Write `TASKS/tree/T038.report.md` with cycle command/check command, policy counts, escalation ledger, controllability/spatial allocation table, transform outcomes, R1 branch evidence, prune decisions, source frontiers, cursor, runtime catalog location, concurrency, and no-apply confirmation. Commit/push only `agent/tree`.
