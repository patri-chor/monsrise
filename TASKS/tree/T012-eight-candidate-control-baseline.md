STATUS: OPEN
DOMAIN: tree

# T012 - Eight-Candidate Control Baseline (Ablation Control)

> Domain: `tree` | Executor branch: `agent/tree`
> This is the matched control for T011. T011 combined low-score-pool, external-deck, and opening interventions; this control disables those interventions.

## Objective

Run the same eight frozen candidates, fixed panel, ordering, seeds, concurrency, and final games/cell as T011 using pre-T011 behavior only, so the combined delta is measurable.

## Control Configuration

- Exactly 8 candidates: 2 each from s1, s2, s3, s4.
- Fixed 8-opponent panel; same seed schedule as T011.
- Outer concurrency <=2; final games per cell >=5.
- Training score: `(win + 0.5 * draw) / total`.
- Single deterministic weakest-cell target only; no low-score pool.
- In-deck branch replacement and normal branch-node position search only.
- External deck candidates disabled and must remain zero.
- R1/R2 opening-specific operators disabled and must remain zero.
- No active library mutation, apply, deployment, generation-domain changes, watcher changes, or shared matrix/state changes.
- Output only under `reports/new-formation-generation/eight-candidate-control-baseline/`.

## Required Comparison

Report per candidate and aggregate:

- source seed and candidate ID;
- baseline/final trainingScore, pureWinRate, undefeatedRate;
- weakest cell identity and metrics;
- terminal outcome and fork observation status;
- in-deck/external/opening candidate counts;
- T011 matched comparison using identical candidates, panel, seeds, games, and concurrency.

## Acceptance

- [ ] Exactly 2 candidates from each source seed.
- [ ] Panel, ordering, seeds, concurrency, and games/cell match T011.
- [ ] External candidates and opening-specific candidates are zero.
- [ ] No low-score pool is constructed.
- [ ] Aggregate trainingScore and loss guard control adoption.
- [ ] Zero worker errors, no candidate applied, no active-library mutation.
- [ ] T009/T011 focused tests pass.
- [ ] `npx tsc --noEmit` adds no errors in edited files; pre-existing errors documented.

## Delivery

Write `TASKS/tree/T012.report.md`, commit and push only `agent/tree`, and do not modify this specification.
