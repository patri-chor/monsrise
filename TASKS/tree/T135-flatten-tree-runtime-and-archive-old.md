STATUS: OPEN
DOMAIN: tree
SUPERSEDES: T134-wire-worker-thread-cycle-execution

# T135 - Flatten Tree Runtime and Archive Old

## Decision

The current tree implementation is over-fragmented:

```text
src/engine/tree: 146 TypeScript files, maximum depth 4
product_training/generation2/{cycle,pool,optimizer}: multiple overlapping paths
many old runners, probes, diagnostics and tests obscure the actual runtime
```

Target is a small, flat, direct runtime. Do not preserve directory hierarchy merely for historical caution.

```text
formal runtime: about 10-14 TypeScript files directly under src/engine/tree/
old reference: src/engine/tree/old/
unneeded code/tests: delete
```

Git remains recovery history. `old/` is retained only for useful prior cycle logic/reference and must never be a default runtime/import path.

## Goal

Consolidate the current product-path dynamic T0 `S -> conditional D+S -> lineage backprop -> L1/L2 pool` system, including actual worker-thread dispatch, into one flat formal runtime under `src/engine/tree/`.

Complete T134's actual worker-thread execution wiring within this new formal runtime. Do not implement T134 in the old nested generation2 path first.

## 1. Formal Flat Runtime

Create/retain at most 14 direct `src/engine/tree/*.ts` formal runtime modules. Exact names may follow existing local conventions, but the intended responsibilities are:

```text
tree_cycle.ts                 sole public cycle and CLI-facing orchestrator
tree_types.ts                 all formal runtime public types/config/report
tree_snapshot.ts              exact dynamic snapshot/pool-state input/output
tree_product.ts               product match/run/canonical observation adapter
tree_board.ts                 RoundBoardState capture/clone/edit/one-round adapter
tree_search.ts                S candidate generation, trial accounting, frontier
tree_deck.ts                  constrained D catalog and D-specific snapshot rebuild
tree_lineage.ts               S/D+S lineage, backprop, selection comparator
tree_benchmark.ts             L1/L2/adverse-case measurement
tree_worker.ts                worker-thread task entry/shared serializable ops
tree_worker_pool.ts           persistent worker scheduler/resource accounting
tree_evidence.ts              all formal artifacts
tree_dynamic_pool.ts          dynamic T0 pool, selection/replacement
product_tree_strategy.ts      existing runtime strategy authority, retain at root
```

A module may merge only adjacent responsibilities if that reduces total formal files. Do not split them further. `tree_cycle.ts` must be the sole production orchestration entrypoint.

Public scripts:

```text
scripts/run_tree_cycle.ts
```

It replaces all Generation2 cycle/pilot CLIs. Keep at most one explicit one-shot benchmark option inside it, not a separate runner script.

## 2. What Must Survive Exactly

Formal runtime behavior preserved/rebuilt from current validated product path:

```text
- exact dynamic target/opponent snapshots; no resolver-original fallback when input supplied;
- product-path `playFullGame` and actual strategy trace;
- cached current-round board state and legal S edits;
- Score70 = (W + .70*D) / N;
- S frontier discovery default 32 unique valid trials/case;
- preserve behavior-distinct/non-dominated local S lineages;
- D+S only when L2 < .70 and source S has no local signal;
- max 4 constrained D candidates; each rebuilds D-specific product states and
  gets max 8 unique S trials; no-signal D receives no full L2 validation;
- retained lineage-only L1/L2 backprop and no-regression dynamic pool replacement;
- worker_threads actual dispatch of independent S case, D attempt and backprop
  units; deterministic result merge; single/worker parity;
- persistent dynamic T0 pool and automatic 3-formation selection;
- evidence records all declared proposal/invalid/duplicate/unique/frontier/D/
  backprop/worker/resource data.
```

Do not preserve O/opening optimization in the existing-formation cycle. Opening library remains generation-stage material only and may be archived with old code if unused by active generation path.

## 3. Old Archive and Deletion

Move only useful old/reference implementation files to:

```text
src/engine/tree/old/
```

with a single `src/engine/tree/old/README.md` mapping old path -> reason -> Git commit/reference. Old files may retain their old imports internally but must not be imported by formal runtime, public scripts, or formal tests.

Delete rather than archive:

```text
- one-off `_probe_*`, `*_diag`, `*_check`, inspection scripts;
- duplicate generation2 runners/configs/events/runtime/persistence;
- deprecated arena/sandbox formal paths;
- obsolete product_training stage files not used by formal runtime;
- tests that only validate deleted/archived behavior;
- duplicate CLI scripts.
```

Do not move unrelated active UI/game engine/product `playFullGame` modules outside `tree/`.

No `generation2/`, `cycle/`, `pool/`, `optimizer/`, or `round_engine/` directory remains on the formal runtime import path. Remove empty directories.

## 4. Import and Artifact Migration

Rewrite all active imports/scripts/tests to direct flat paths. No re-export shim directory and no compatibility aliases: broken imports must be updated or the obsolete caller removed.

Artifact root becomes:

```text
reports/tree-cycle/<run-id>/
```

with one predictable layout:

```text
config.json
pool_before.json
pool_after.json
selection.json
summary.json
formation-<id>/
  baseline.json
  s_trials.jsonl
  d_catalog.jsonl
  ds_trials.jsonl
  lineages.jsonl
  backprop.jsonl
  decision.json
  resources.json
```

No duplicate generation2/dynamic-t0 artifact trees.

## 5. Tests

Delete the accumulated T125-T134 narrow task tests. Replace with exactly three direct tests:

```text
tests/tree_cycle_product.test.ts
  exact snapshots; S/D+S trigger and D-specific board reconstruction;
  Score70/lineage/no-regression decision; artifact schema

tests/tree_cycle_worker.test.ts
  actual worker S/D+S/backprop task counts; single vs worker canonical parity;
  timeout/failure fail-closed behavior

tests/tree_cycle_pilot.test.ts
  auto-select 3 dynamic entries; one bounded real product L1/L2 pilot;
  replacement/no-apply and resource metrics
```

No assertion depends on named formation, exact coordinate, positive improvement, or hard-coded result. Tests must complete within 120 seconds individually.

## 6. Migration Verification

Before deletion, produce a temporary import/caller inventory. After migration verify:

```text
- direct tree formal runtime files <=14;
- only `tree_cycle.ts` is a formal orchestration entrypoint;
- zero active imports from `tree/old/`;
- zero active imports from removed generation2 paths;
- `scripts/run_tree_cycle.ts --smoke` runs product path;
- three replacement tests pass;
- single vs worker threads canonical parity passes;
- actual worker task counts prove S/D+S/backprop dispatch;
- one bounded three-T0 pilot completes or reports a concrete product-stage
  timeout/failure without data fabrication;
- git diff explicitly lists moved vs deleted files;
- active production/R0/tier/L1/deployment data are unchanged.
```

## Acceptance

- [ ] Formal tree optimizer is 10-14 direct root modules.
- [ ] Old logic is isolated in `tree/old/`; unneeded files are deleted.
- [ ] No nested generation2 runtime directory remains active.
- [ ] One CLI and one artifact layout exist.
- [ ] S/D+S/lineage/dynamic pool/worker functionality survives product-path migration.
- [ ] Worker execution is actual, deterministic, and measured.
- [ ] Exactly three direct formal tests replace task-test accumulation.
- [ ] No active/global mutation.

## Delivery

Write `TASKS/tree/T135.report.md` with before/after file-count and depth table; formal root file list/responsibilities; old archived path table; deleted file list/count; import-inventory result; artifact migration; three test outputs; smoke/parity/three-T0 pilot data; worker resource data; no-apply confirmation; changed files. Commit/push only `agent/tree`.
