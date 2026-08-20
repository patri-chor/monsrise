STATUS: OPEN
DOMAIN: tree
SUPERSEDES: T121-generation2-bulk-instance-optimizer-validation

# T122 - Generation 2 Full-Scale Bulk Optimizer Run

## Reason

T121 implemented the right simple bulk-run direction but executed only a reduced smoke matrix:

```text
actual:   2 search seeds / 6 baseline seeds / 6 holdout seeds /
          16 candidates / 2 generations / population 8
required: 3 search seeds / 12 baseline seeds / 24 holdout seeds /
          32 candidates / 3 generations / population 16
```

The reduced result is not sufficient to accept a pilot branch or draw overall performance conclusions:

```text
36 paired validations
aggregate target score: 1.50 -> 1.00 (delta -0.50)
golden_boom delta: -1.50
all2prayer delta: -0.50
gift_jungle delta: +0.50
```

The automatic rejection of regressing candidates is correct. Do not alter rules to produce a desired positive outcome.

## Goal

Run the existing simple `BulkOptimizerRunner` at the full T121 scale, with any necessary bounded, practical fixes to ensure configuration is faithfully honored and paired validation accurately reflects the shared objective.

This is not an event-sourcing/persistence redesign and not a new search architecture. Do not create task-specific branch rules or manually select a winning opponent/coordinate.

## Required Configuration

Execute exactly at least:

```text
target: all2rush
opponents: current configured active/pinned pool, minimum:
  golden_boom, all2prayer, gift_jungle
sides: [1, 2]
baseline seeds: 12 deterministic unique seeds
holdout seeds: 24 deterministic unique seeds, disjoint from baseline seeds
search seeds: 3 deterministic unique seeds
max adverse cases/opponent: 2
unique candidates/case: 32
max generations: 3
population size: 16
```

Use a generated seed utility/config, not a manually duplicated special-case trial list. Persist the exact arrays in each run config and aggregate manifest.

## Required Practical Corrections Before the Run

Inspect and correct only where required to make the full-scale evidence valid:

```text
1. Bulk candidate allocation must actually reflect population 16, 3 generations
   and total cap 32; report generation-level requested/evaluated counts.
2. Baseline case/parity accounting must report actual product match-round inputs,
   not a formula-only count.
3. Paired validation classification must use the shared match-level objective,
   including Score70-compatible value, final W/D/L, round trajectory and HP
   tie-breaks, not target raw final score alone.
4. Every paired record must include score inputs W/D/N or sufficient values to
   recompute Score70, target-perspective final W/D/L, per-round winner array,
   per-round survivor/HP digest, branchSelected, objective vector/comparison.
5. An active pilot is determined independently per candidate from its own paired
   holdout aggregate. Any regression under the shared comparator rejects that
   candidate. Never average a favorable candidate with unrelated rejected ones.
6. If a branch does not select in a holdout pair, classify it NOT_SELECTED and
   exclude it from that candidate's effect claim while recording the case.
```

Do not change product battle rules, R0, global main/tier/L1/deployment.

## Full-Scale Outputs

For each of the three independent optimizer runs write normal run artifacts:

```text
config.json
baseline_cases.jsonl
local_trials.jsonl
local_solutions.jsonl
generation_summary.jsonl
paired_validations.jsonl
candidate_holdout_summary.jsonl
summary.json
```

Then write aggregate artifacts:

```text
all2rush_g2_t122_manifest.json
all2rush_g2_t122_bulk_aggregate.json
all2rush_g2_t122_bulk_by_opponent.jsonl
all2rush_g2_t122_bulk_by_side.jsonl
all2rush_g2_t122_bulk_by_candidate.jsonl
all2rush_g2_t122_generation_accounting.jsonl
```

Required aggregate fields, explicit even when zero:

```text
config counts and actual counts
baseline product matches and round parity inputs/mismatches
optimizer runs, mined cases, per-run/generation candidate count
unique candidates and runtime
local improvement distribution
forward-expressible/local-only counts
paired full-match count
selected/not-selected pair count
paired improves/neutrals/regresses
baseline/candidate Score70, delta, W/D/N inputs
per opponent/per side Score70 and W/D/N
per candidate holdout Score70 and status
active/rejected count
```

## Acceptance

- [ ] Full required matrix, not a reduced smoke configuration, has completed.
- [ ] All seed arrays are present and baseline/holdout are disjoint.
- [ ] Candidate budget/generation/population accounting matches actual execution.
- [ ] All paired evidence carries sufficient product observable data and shared-objective comparison.
- [ ] Pilot status is candidate-local and automatic; any regressing candidate is rejected.
- [ ] No global/tier/L1/deployment modifications.

## Delivery

Write `TASKS/tree/T122.report.md` with requested-versus-actual matrix table; runtime; generation accounting; aggregate and per-candidate Score70/W-D-N table; per-opponent/per-side outcomes; selected/not-selected accounting; final active/rejected pilot list; parity count; artifact paths; no-apply confirmation; changed files. Commit/push only `agent/tree`.
