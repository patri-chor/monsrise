STATUS: BLOCKED_BY_T036
DOMAIN: tree

# T037 - Product-Path Screen and Check Chain

> Phase 2. Start only after T036 passes. This replaces the earlier unexecuted broad T037 specification.

## Goal

Add one clear product-path screen runner and independent read-only check chain for source baselines and small, deterministic candidate batches. No unattended mutation loop yet.

## Required Execution Files

Add only:

```text
src/engine/tree/product_training/04_screen.ts
src/engine/tree/product_training/run_screen.ts
scripts/tree_product_training/check_candidates.ts
scripts/tree_product_training/check_screen.ts
```

`run_screen.ts` is the only Phase-2 command. It must use:

```text
PersistentSimPool -> fine_grained_worker(product_path) -> playFullGame -> product_tree_strategy
```

No arena/sandbox imports or fallback paths.

## Screen Contract

For each baseline or valid unique candidate:

```text
7 held-out families x 2 actual sides x 10 games = 140 cells
```

Persist append-only evidence under:

```text
tests/fixtures/tree/experience_library/product_path_t037/
```

Required records:

```text
manifest.json
sources.jsonl
candidate_registry.jsonl
rejected_candidates.jsonl
screen_cells.jsonl
screen_observations.jsonl
traces.jsonl
cursor.json
README.md
```

Each cell includes manifest/protocol identity, entity/fingerprint/parent, operator family, source side, opponent, exact seed, game index, W/D/L, completion/error, nonempty team proof, both deployment counts, branch trace link, and trace hash.

## Candidate Batch

Evaluate only a small deterministic Phase-2 batch:

```text
one gift_jungle_v2 baseline
one spatial_local candidate per eligible source
one formation_transform candidate per eligible transformable source
one strategy_schedule_branch candidate per eligible source
```

No multi-monster random exploration yet. Exclude duplicate/no-op candidates before workers start. Same-round list ordering is never a candidate.

## Checks

`check_candidates.ts` verifies exact-eight, legality, canonical uniqueness, operator metadata, source repair provenance, and invalid/rejected records.

`check_screen.ts` independently recomputes W/D/L, source-relative score, 140-cell coverage, 7x2x10 schedule, trace existence, both-side deployments, error count, and worker concurrency. It must separately show R1 branch cells and selected branch IDs for side-aware branches.

## Acceptance

- [ ] Gift Jungle v2 baseline has complete product-path evidence.
- [ ] Each included operator family has at least one valid product-path candidate or recorded legal rejection.
- [ ] Every accepted record has 140 complete cells and zero worker errors.
- [ ] Check scripts pass without simulation.
- [ ] No autonomous loop, mixed pool, promotion, apply, deploy, or publishing.

## Delivery

Write `TASKS/tree/T037.report.md` with one run command, two check commands, file map, entity/operator count, Gift Jungle v2 baseline, source-relative screen table, branch trace samples, cursor, worker concurrency, and no-apply confirmation. Commit/push only `agent/tree`.
