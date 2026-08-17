STATUS: OPEN
DOMAIN: tree

# T012 - Eight-Candidate Control Baseline (Ablation Control)

> Domain: `tree` | Executor branch: `agent/tree`
> T011 completed a combined low-score-pool + external-deck + opening-operator run. This task establishes the matched control before attributing any combined result to a specific intervention.

## Objective

Run the exact same eight frozen candidates and fixed panel as T011 with the pre-T011 optimizer behavior only. This is the control arm for subsequent ablations.

## Fixed Protocol

- Candidate fixture: `tests/fixtures/tree/eight_frozen_candidates.jsonl`
- Candidate distribution: exactly two each from s1, s2, s3, s4
- Fixed eight-opponent panel, same candidate ordering and per-candidate search/validation seed schedule as T011
- Outer candidate concurrency: <=2
- Final games per opponent/side cell: >=5
- Training metric: `(win + 0.5 * draw) / total`
- Output only: `reports/new-formation-generation/eight-candidate-control-baseline/`

## Control Configuration

Enable only the pre-T011 branch optimizer:

1. Use a single deterministic weakest cell only. Do not form or weight a low-score target pool.
2. Search only in-deck replacements and existing non-opening branch placement behavior.
3. Disable all external-deck candidates, including ontology pool lookup.
4. Disable all early opening operators: R1/R2 compact placement, opening order changes, early deployment moves, or opening-specific branch placement changes.
5. Preserve the T009 request safety, training-score validation gate, and minimum final-cell sample rule.

## Required Outputs

For every candidate, record:

- source seed and candidate ID;
- baseline/final aggregate trainingScore, pureWinRate, undefeatedRate;
- weakest-cell identity and metrics;
- single targeted weakest cell and its fork-round observation status;
- terminal outcome;
- in-deck/external/opening candidate counts, proving external and opening counts are zero;
- search/validation seeds and runtime.

Generate a comparison table against T011 using only identical candidate IDs and evaluation seeds. Explicitly state that this control cannot establish the individual effects of the three T011 interventions, but it establishes their combined delta.

## Prohibited

- No low-score pool.
- No external deck candidate, team membership change, or badge change.
- No opening-specific operator.
- No change to generation-domain files, active library, bundle, shared matrix/state, apply/deploy, or watcher.
- Do not modify T011 source behavior; add explicit configuration/options instead of reverting it globally.

## Acceptance

- [ ] Exactly 8 candidates, 2 from each of s1/s2/s3/s4.
- [ ] Control run matches T011 panel, candidate identity/order, seeds, final games/cell, and concurrency budget.
- [ ] External and opening candidate counts are zero in every result.
- [ ] No low-score pool is constructed or weighted.
- [ ] Per-candidate and aggregate comparison against T011 is emitted.
- [ ] Zero worker errors; no active candidate is applied.
- [ ] T011 and T009 focused tests remain passing.
- [ ] `npx tsc --noEmit` adds no errors in edited files; pre-existing errors are documented.

## Delivery

Write `TASKS/tree/T012.report.md` with the control manifest, per-seed outcome counts, T011 comparison table, zero-external/zero-opening evidence, test commands, and no-apply confirmation. Commit and push only `agent/tree`. Do not modify this specification.
