# Generation Variant-to-Tree Cycle Plan

STATUS: ACTIVE
OWNER: generation decision agent
UPDATED: 2026-08-17

## Operating Rule

This plan replaces long-running goal control for the generation cycle. Git-bus reports must wake the decision session directly for review, acceptance, rework, or the next task. Do not create a long goal that can absorb or delay those report messages.

## Target Outcome

Produce and validate genuinely new `deck + optimized tree` variants using the canonical fixed eight-opponent panel:

1. `FORMATION_LIBRARY.slice(0, 7)` in bundle order;
2. the unique formation named `壕炸金猴`;
3. both sides evaluated for every candidate/opponent pairing.

A later adoption/deployment task is required before any candidate enters `FORMATION_LIBRARY` or bundle artifacts.

## Canonical Workflow

### Phase A - Sequential Candidate Production

Task: `TASKS/generation/T017-sequential-per-seed-variant-cycle.md`

For each of bundle-order first four source seeds, complete the entire transaction before beginning the next source:

1. bounded mutation attempts (maximum 20);
2. within-source and prior-finalized-source deduplication;
3. fixed-eight-panel coarse evaluation, both sides;
4. independent retention up to six candidates, with exploration floor `adScore >= 0.25` and no zero-score retention;
5. durable source freeze manifest and candidate snapshot.

Expected maximum: 24 candidates. T013's batch-generated pool remains historical evidence only and is not an optimization input.

Acceptance evidence:

- source transaction timestamps prove `seed N freeze` completes before `seed N+1 generate` begins;
- no global pre-evaluation batch or global retention capacity competition;
- each source has isolated outputs and source provenance;
- production requests 16 workers and records CPU-clamped effective workers.

### Phase B - Fixed-Panel Optimizer Consumer API

Task: `TASKS/generation/T016-fixed-panel-optimizer-consumer-api.md`

Add the backwards-compatible caller option `optimizeFormation(..., { opponents })`. This is generation-owned evaluation scoping, not a tree-algorithm improvement.

Acceptance evidence:

- omitted panel preserves current all-library behavior;
- supplied panel constrains trace collection, induction/search, matched-opponent filtering, validation, and diagnostics;
- empty panel fails before simulation;
- canonical eight-panel identity is auditable;
- no changes to optimizer split/search/validation algorithm or active formation data.

### Phase C - Candidate-Level Parallel Tree Optimization and Independent Validation

Task: `TASKS/generation/T018-candidate-level-tree-optimization-parallelism.md`, then `TASKS/generation/T019-sequential-frozen-candidate-tree-optimization.md` after T016, T017, and T018 are accepted. T019 is one complete implementation-and-production block, not a feasibility follow-up.

Input: root frozen output from T017 only.

Concurrency model: each frozen candidate is an independent optimizer process. The parent schedules at most `min(16, logical CPUs, candidate count)` candidate processes at once. Individual `optimizeFormation` calls remain deterministic and single-process; its branch search, cache, and decision logic are not parallelized or changed.

For every frozen candidate:

1. retain its generated deck and baseline tree;
2. optimize its tree against the canonical fixed eight-panel using deterministic distinct search and validation seed bases;
3. independently compare baseline and optimized tree with a final distinct seed base against the same panel, both sides;
4. record per-cell and aggregate W/D/L, weakest cell, undefeated rate, fingerprint, trigger coverage, validation outcome, and no-op reason.

Resource policy: use 16 requested workers when implementation supports parallelism; cap at available logical CPUs and persist actual settings.

### Phase D - Quality Decision

A candidate qualifies as a `tree_optimized_candidate` only when it passes optimizer validation and independent final comparison does not regress aggregate undefeated rate or weakest cell.

The production gate passes if at least one qualified candidate has all of:

- aggregate undefeated rate >= 0.60;
- weakest cell >= 0.40;
- medium/heavy novelty or a previously uncovered source-seed/module direction.

Decision branches:

- Gate passes: publish the next generation-domain production task to expand more seeds/variants using the successful direction evidence.
- Gate fails: publish a narrow algorithm-improvement task with evidence identifying deck weakness, trigger absence, optimizer no-op, validation rejection, weakest-cell regression, or coverage deficit. Algorithm changes belong to tree domain only when they change optimizer decision logic; generation owns its consumer/evaluation workflow.

## Current State

- [x] T013 completed batch-based per-seed retention; historical baseline only.
- [x] T014 accepted; production evaluation requests 16 workers and CPU-clamps.
- [x] T015 audited the old pool and correctly stopped because fixed-panel API was missing.
- [ ] T016 fixed-panel consumer API: OPEN.
- [ ] T017 sequential per-seed candidate production: OPEN.
- [ ] T018 candidate-level parallel tree optimization runner: OPEN.
- [x] T019 completed an initial cycle; rejected for serial independent final evaluation, with its quality evidence retained as historical baseline.
- [ ] T020 parallel-final-evaluation rework: superseded by accelerated rerun T021.
- [ ] T021 accelerated full variant-to-tree cycle: OPEN; includes benchmark, 24-candidate rerun, parallel final evaluation, and final quality decision.
- [ ] Phase D quality decision: included in T021 and pending its report.

## Report Handling

On every matching generation Git-bus report:

1. read the report and current branch state;
2. verify tests, behavior, scope, and output isolation;
3. write an acceptance/closure record or a same-domain rework task;
4. update this plan's Current State and Next Action;
5. publish the next task if its prerequisites are satisfied.

## Next Action

Wait for and review T016 and T017 reports. Their execution order is independent: T017 establishes the authoritative sequential pool, while T016 supplies its required fixed-panel optimizer consumer boundary. Publish the Phase C optimization task only after both are accepted.
