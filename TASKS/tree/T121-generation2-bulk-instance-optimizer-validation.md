STATUS: DONE
DOMAIN: tree
SUPERSEDES: T120-generation2-event-sourced-optimizer-runtime

# T121 - Generation 2 Bulk Instance Optimizer Validation

## Direction

Do not implement event sourcing, event reducers, lifecycle journals, process interruption machinery, or other persistence architecture for this task. T120 is superseded and must not be executed.

The product goal is an optimizer that produces better all2rush decisions. Confidence comes from a large number of independent real product instances, not elaborate intermediate trace architecture.

Keep persistence simple:

```text
config.json
summary.json
candidate/solution records required for inspection
```

Reuse the existing Generation 2 optimizer, cached `RoundBoardState`, `SingleRoundEngine`, full-match runner and current reports. Make only practical fixes necessary for reliable repeated runs and correct result calculation.

## Goal

Run the optimizer automatically over a broad, deterministic product-instance matrix, then evaluate whether its automatically selected tactics/forward branches improve or regress on separate real matches.

The program decides candidate selection through its objective functions. The task does not hard-code which opponent, branch, coordinate, or result should win.

## 1. Simple Optimizer Runtime

Keep a straightforward API:

```ts
runGeneration2Optimizer(config): Promise<OptimizerRunReport>
```

A config controls target, opponent pool, seeds, candidate budget, generations and validation budget. It can write normal JSON/JSONL outputs for a run. Resume/event replay is out of scope.

Correct only these practical runtime requirements:

```text
- fixed seeded config gives deterministic results within a fresh process;
- candidate budget counts unique valid edited RoundBoardState fingerprints;
- `populationSize`, `maxGenerations`, and `uniqueCandidatesPerCase` have an
  observable, documented allocation effect;
- ordinary candidate evaluation uses cached state and exactly one battle round;
- full matches are used only for selected solution/branch evaluation;
- final pilot status agrees with measured validation outcome.
```

No need to retain old failed-run state or reconstruct history. Each run is independent.

## 2. Broad Instance Matrix

Use a config-generated matrix, not a hand-authored list of named expected results:

```text
target: all2rush
opponent pool: all configured active/pinned opponents (at least the existing 3)
sides: 1 and 2
baseline seeds: at least 12 deterministic seeds
validation/holdout seeds: at least 24 different deterministic seeds
maximum 2 adverse cases per opponent per optimizer run
candidate budget: at least 32 unique states/case
generations: at least 3
population: at least 16
```

Run at least three independent optimizer runs with different `searchSeed` values. Each run must mine adverse cases from its own baseline matrix and choose/archive tactics programmatically.

For each selected local solution:

```text
- verify no-edit cached RoundBoardState equals normal product round on all
  requested observable fields;
- evaluate the edited state for exactly current R;
- retain objective vector and selected/non-selected outcome.
```

For every automatically forward-expressible representative, run paired baseline vs candidate full product matches over the holdout matrix:

```text
same target/opponent/side/seed per pair
baseline final W/D/L and Score70-compatible value
candidate final W/D/L and Score70-compatible value
round winners
per-round survivor/HP digest
branch selection true/false
classification by shared program objective
```

For local-only representatives, record why they remain local and include them in local-search aggregate metrics. Do not force a runtime branch.

## 3. Aggregate Evaluation

Produce programmatic aggregate metrics across all independent runs and all holdout pairs:

```text
baseline instance count
single-round parity instance count / mismatch count
optimizer runs / mined adverse cases / unique candidates / candidate runtime
one-round improvement distribution: loss->draw, draw->win, loss->win,
HP/survivor-only, no improvement
forward-expressible representatives / local-only representatives
full-match paired validation count
full-match improves / neutral / regresses
Score70 baseline aggregate / candidate aggregate / delta
per-opponent and per-side aggregates
branch selection true/false counts
active pilot count / rejected count
```

A candidate becomes `PILOT_ACTIVE` only if its own holdout paired aggregate is non-regressing under the shared objective and it selected only on legal matching conditions. Otherwise it is `FORWARD_REJECTED`; this is a direct result calculation, not manually authored policy.

No need to optimize for specific expected opponent outcomes. Report zeroes explicitly where no improvement occurs.

## 4. Broad Test and Run Strategy

Separate implementation from validation:

```text
Phase A: implement/fix the simple runtime and batch runner in one pass.
Phase B: run one broad automated audit plus the actual large instance matrix.
```

The audit must verify with generated matrices:

```text
- deterministic same-config results in independent fresh Node processes;
- unique candidate fingerprint/budget behavior;
- population/generation/cap allocation behavior;
- no-edit current-round observable parity including winners, scores, stable
  survivor IDs, HP/max HP, totals and accepted/rejected actions;
- ordinary candidate loop does not invoke full-match runner;
- final branch status matches aggregate paired validation;
- baseline/holdout seed sets do not overlap;
- no R0/global/tier/L1/deployment mutation.
```

Do not build a special interruption/resume framework or event reducer merely to test these properties.

## Artifacts

Use straightforward run directories:

```text
reports/tree-cycle/generation2-bulk/<run-id>/
  config.json
  baseline_cases.jsonl
  local_trials.jsonl
  local_solutions.jsonl
  paired_validations.jsonl
  summary.json

reports/tree-cycle/all2rush_g2_t121_bulk_aggregate.json
reports/tree-cycle/all2rush_g2_t121_bulk_by_opponent.jsonl
reports/tree-cycle/all2rush_g2_t121_bulk_by_side.jsonl
```

## Acceptance

- [ ] No event-sourcing/resume/lifecycle-journal system is added.
- [ ] Optimizer runs over large generated baseline/holdout instance matrices.
- [ ] Candidate selection, solution archive and pilot/rejection decisions are programmatic.
- [ ] Multiple independent search seeds are evaluated.
- [ ] Full-match paired results quantify actual aggregate impact, including Score70.
- [ ] Broad audit validates parity, isolation, determinism and allocation behavior.
- [ ] No global/tier/L1/deployment modification.

## Delivery

Write `TASKS/tree/T121.report.md` with runtime changes; matrix config and actual sample counts; optimizer-run table; aggregate objective/Score70 table; per-opponent/per-side tables; selected/local-only/pilot/rejected counts; parity/audit outcomes; runtime; artifact paths; no-apply confirmation; changed files. Commit/push only `agent/tree`.
