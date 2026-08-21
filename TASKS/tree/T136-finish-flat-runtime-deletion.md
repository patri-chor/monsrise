STATUS: IN_PROGRESS
DOMAIN: tree
SUPERSEDES: T135-flatten-tree-runtime-and-archive-old

# T136 - Finish Flat Runtime Deletion

## Rework Fact

T135 function tests pass but the requested cleanup is incomplete:

```text
before T135: 146 tree TypeScript files
after T135: 158 tree TypeScript files
root direct files: 16, target <=14
active nested directories remain: product_training/, round_engine/
tests remain: tree_cycle_smoke.test.ts plus the required three tests
```

Do not claim consolidation until file count and active-import boundaries meet the request.

## Goal

Finish the destructive consolidation: one flat active tree runtime of 10-14 direct files; all useful old cycle/reference code only in `tree/old/`; unneeded code and tests deleted.

No feature work, no new runtime behavior, no compatibility shims. Preserve the tested T135 product behavior while reducing file/directory count.

## 1. Exact Active File Budget

After completion, direct active `src/engine/tree/*.ts` count is **<=14** and formal cycle responsibilities are at most 12 files:

```text
tree_cycle.ts
tree_types.ts
tree_product.ts          # absorbs snapshot resolver/product adapter where possible
tree_benchmark.ts
tree_search.ts
tree_deck.ts
tree_lineage.ts
tree_dynamic_pool.ts
tree_evidence.ts
tree_worker.ts
tree_worker_pool.ts
product_tree_strategy.ts
```

Merge/delete rather than retain separate active files:

```text
tree_snapshot.ts -> tree_product.ts or tree_types.ts
evol_gene.ts -> tree_types.ts if only active cycle model use remains
calculator_policy.ts -> tree_types.ts / tree_product.ts if active
sha256_pure.ts -> direct local helper in its sole consumer if active
```

If one listed file cannot merge due a non-cycle active caller, move the generic helper above tree into `src/engine/`; do not exceed root budget.

## 2. Nested Path Elimination

No active runtime files remain below `src/engine/tree/`.

```text
src/engine/tree/product_training/** -> move useful reference files to tree/old/
src/engine/tree/round_engine/** -> move useful reference files to tree/old/
```

Then delete those directories. No active import may reference:

```text
/tree/old/
/tree/product_training/
/tree/round_engine/
/generation2/
```

`tree/old/README.md` must list each archived file's original path, reason, and the last commit reference. Do not preserve nested directories inside `old/`; flatten old reference files too, resolving filename collisions with an `old_` prefix.

## 3. Test Deletion

Keep exactly:

```text
tests/tree_cycle_product.test.ts
tests/tree_cycle_worker.test.ts
tests/tree_cycle_pilot.test.ts
```

Delete `tests/tree_cycle_smoke.test.ts`, T125-T134 tests, task-specific stale tests, and tests solely for archived code. Merge any unique smoke assertion into one of the three retained tests.

## 4. Deletion Safety

Before removal generate import inventory. Delete/move only after active callers are migrated.

Required final commands/checks:

```text
- tree active direct *.ts <=14
- tree active nested *.ts = 0
- tree/old nested *.ts = 0
- formal tests exactly 3 tree_cycle_*.test.ts
- zero active import matches prohibited paths
- CLI smoke passes
- three retained tests pass
- single/worker parity remains passing
- git diff table: active merged/moved/archived/deleted counts
```

Do not alter `src/game/BattleSystem.ts` user/worktree changes. No active product/R0/tier/L1/deployment mutation.

## Acceptance

- [ ] Active tree runtime direct files <=14; formal cycle <=12.
- [ ] No active nested tree runtime directory remains.
- [ ] `old/` is flat reference only; no active imports into it.
- [ ] Exactly three formal tree cycle tests remain.
- [ ] Product smoke + retained tests pass.
- [ ] No active/global mutation.

## Delivery

Write `TASKS/tree/T136.report.md` with before/after direct/nested/old/test counts; final active file table; archived/deleted file list/count; prohibited import scan; smoke/test outputs; no-apply confirmation; changed files. Commit/push only `agent/tree`.
