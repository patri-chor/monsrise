STATUS: OPEN
DOMAIN: tree

# T012 - Cross-Seed Low-Score Pool Ablation (A)

> Domain: `tree` | Executor branch: `agent/tree`
> This is Ablation A. It must run before any external-deck or opening modification experiment. T011 is retained as the eventual combined configuration and is not executable yet.

## Objective

Measure only the effect of replacing single-weakest-cell targeting with an observed low-score cell pool across four source seeds.

Everything else remains at the accepted T009 baseline:

- in-deck branch-local replacement only;
- no external monster/deck pool;
- no R1/R2 opening-specific operators;
- no active-library mutation or apply.

## Candidate and Evaluation Protocol

1. Use exactly 8 deterministic frozen candidates: 2 from each source seed `s1`, `s2`, `s3`, `s4`.
2. Use the fixed 8-opponent panel.
3. Outer candidate concurrency <=2.
4. Final games per opponent/side cell >=5.
5. Use the accepted training score:

```text
trainingScore = (win + 0.5 * draw) / total
```

6. Use the same candidate fixture and fixed seeds for the T009 baseline comparison where possible. Any fixture change must be documented and deterministic.

## Required Change: Low-Score Cell Pool

1. Calculate trainingScore for every opponent/side cell.
2. Select a deterministic target pool:
   - always include the weakest cell;
   - include all cells within an explicit documented band of the weakest score;
   - cap pool size at 3 cells;
   - tie-break by opponent index then side.
3. A cell may produce a branch target only when the relevant fork round has actual runtime observation evidence.
4. Retain the existing independent aggregate validation gate:
   - aggregate trainingScore must improve by at least 0.05;
   - losses must not increase.
5. A gain confined to one cell cannot be adopted if aggregate validation fails.
6. Emit for every candidate:
   - all evaluated cells with W/D/L and three metrics;
   - selected pool cells and selection reason/band;
   - observation/trigger coverage per pool cell;
   - addressed / no-observed-trigger / no-informative-split / validation-rejected outcome per pool cell;
   - aggregate outcome and selected branch, if any.

## Explicitly Prohibited in This Ablation

- External replacement candidates not already in the deck.
- Any mutation of team membership, badges, or deck composition.
- Opening-only operators: moving earlier, R1/R2 order swap, R1/R2 placement search, or opening library mutation.
- Changes to mutation/generation pipelines, `TASKS/generation/**`, active `FORMATION_LIBRARY`, bundle, matrix/state, apply/deploy, or watcher.

## Comparison Requirement

Write a concise T009-vs-T012 comparison using the same metrics:

- per-seed terminal outcome counts;
- aggregate trainingScore delta;
- weakest-cell trainingScore delta;
- number of pool cells observed/addressed;
- worker error count;
- runtime and evaluation budget.

Do not claim a superiority result if seed, panel, candidate identities, or final games/cell differ.

## Acceptance

- [ ] Exactly 2 candidates from each of s1/s2/s3/s4 are present.
- [ ] Target pool is deterministic, contains the weakest cell, has <=3 cells, and reports its rule.
- [ ] No external deck candidate or opening operator is used; tests prove both absences.
- [ ] Branch attempts have fork-round observation evidence.
- [ ] Aggregate trainingScore and loss guard control adoption.
- [ ] Proof output reports per-cell and per-pool diagnostics.
- [ ] T009 request-safety tests still pass.
- [ ] Proof run has zero worker errors, no applied candidate, and no active-library changes.
- [ ] `npx tsc --noEmit` adds no errors in edited files; document pre-existing errors only.

## Delivery

Write `TASKS/tree/T012.report.md` with test commands, candidate distribution, exact pool rule, per-seed outcomes, T009 comparison limits/results, and no-external/no-opening proof. Commit and push only `agent/tree`. Do not modify this task file.
