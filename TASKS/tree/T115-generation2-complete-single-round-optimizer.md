STATUS: OPEN
DOMAIN: tree
SUPERSEDES: T114-generation2-unique-round-board-search

# T115 - Generation 2 Complete Single-Round Optimizer

## Delivery Style

Implement the complete usable all2rush single-round optimization loop in one cohesive change. Do not split this task into more architecture or micro-validation work. Reuse T113's `RoundBoardState`, factory and `SingleRoundEngine`; fix them only if a real end-to-end test exposes a defect.

After implementation, run broad focused verification and report failures honestly. The next decision task will review results and fix only demonstrated problems.

## Product Goal

For a concrete real all2rush match, select an adverse round and optimize that **one current battle round** using cached board state:

```text
one baseline product match
-> capture/cache RoundBoardState for each round
-> select adverse target-side rounds
-> clone one cached state repeatedly
-> randomly edit target-side pre-battle layout/current-round actions
-> settle only that round through authoritative battle rules
-> keep unique local tactical improvements
-> compare 16 versus 32 candidate budget
-> optionally assess whether best local tactics can become legal earlier strategy branches
```

No candidate re-walks the formation tree. No candidate replays a complete match. No global strategy/tier/deployment change.

## Existing Foundation

Use existing files:

```text
src/engine/tree/product_training/generation2/
  index.ts
  product_match_runner.ts
  round_board_state.ts
  round_board_state_factory.ts
  single_round_engine.ts
  local_search_service.ts
  branch_library.ts
  evidence_writer.ts
```

You may add small files in this same directory if they materially simplify the implementation. Do not create another optimizer outside it.

## Required End-to-End API

Expose one public function from `generation2/index.ts`:

```ts
runAll2RushSingleRoundOptimization(input): SingleRoundOptimizationReport
```

Input supports:

```text
target snapshot or formation ID
opponent snapshot/formation IDs
seed list
maximum adverse round cases
searchSeed
budgets: [16, 32]
```

Return structured data, not only filesystem artifacts:

```text
selected baseline cases
captured base RoundBoardStates
proposal/invalid/duplicate/unique counts
per-budget trial outputs
behavior-distinct local solution sets
best representative per case
optional continuation/forward-branch assessments
summary
```

## Baseline Case Selection

Use real product baseline matches to capture every reachable `RoundBoardState` once.

Choose at most:

```text
3 opponents
x 2 target-side adverse rounds per opponent
= 6 cases
```

An adverse round is ranked by:

```text
round loss before round draw
larger target score deficit after that round
earlier round
```

For each case retain baseline observable output:

```text
case ID, target/opponent fingerprints, side, seed, round
base RoundBoardState fingerprint
round winner, score delta/after score
survivors keyed by instance ID with HP/max HP
survivor count/total HP
observable digest
```

## Candidate Generator

Implement a deterministic seeded proposal stream from one cached base board state. Each proposal contains 1..3 compatible target-side edits selected from:

```text
1. reposition a previously deployed target unit
2. reposition a target current-round pending action
3. reorder target current-round pending actions
4. combine any compatible actions above
```

The generator must use actual available deployed units/pending actions from the board state. It must not iterate a fixed hand-written offset list around a single unit.

For every proposal:

```text
clone base state
apply edits
validate target zone, bounds, collision, action identity, no duplicate unit,
current-round budget and action order
canonicalize edited state
calculate edited stateFingerprint
```

Rules:

```text
invalid proposal -> record INVALID, no execution/no budget use
duplicate stateFingerprint -> record DUPLICATE, no execution/no budget use
unique valid state -> execute exactly one SingleRoundEngine battle/count it
```

Use deterministic PRNG seeded by `searchSeed` plus case key. Do not use `Math.random`.

## Budget Experiment

For each case, run one proposal stream and report both prefixes:

```text
Budget 16 = first 16 unique valid edited board states
Budget 32 = first 32 unique valid edited board states
```

If legal state space exhausts, stop and record the actual exhaustion reason/count.

For every unique trial compare to baseline target-side observable output and classify:

```text
ROUND_WIN_IMPROVEMENT    target loses/draws baseline and wins candidate round
ROUND_DRAW_IMPROVEMENT   target loses baseline and draws candidate round
HP_SURVIVOR_IMPROVEMENT  same round result, target survivors/count/HP improves
                          and opponent total HP does not improve
NO_IMPROVEMENT
```

Store each behavior-distinct result as:

```text
edited state fingerprint + observable digest
```

At summary level provide, for 16 and 32 separately:

```text
proposals / invalid / duplicate / unique executed
improvement count by class
best result
runtime total and average per unique trial
new distinct improvements from unique trials 17..32
```

## Local Solution Selection

For every case retain all behavior-distinct improvements. Do not make T110's “first improvement wins” mistake.

Remove only exact same state/result duplicates. Mark domination only when another solution is at least as good on:

```text
round-result class
score delta
own survivor count/total HP
opponent total HP
```

and strictly better on at least one.

Choose a representative using:

```text
result class
-> score delta
-> own survivor count/HP
-> lower opponent HP
-> fewer edits
-> stable fingerprint
```

Other non-dominated solutions remain local tactical alternatives/warm-start data.

## Optional Forward Strategy Assessment

Do not auto-deploy any local solution.

For one best solution per case only, assess whether its edits can be expressed as a legal forward tree action at the original decision round using only visible facts. Record:

```text
FORWARD_EXPRESSIBLE
LOCAL_ONLY_NEEDS_EARLIER_CONTEXT
LOCAL_ONLY_NOT_VISIBLE
NOT_ASSESSED
```

If `FORWARD_EXPRESSIBLE`, optionally run one complete product match to classify:

```text
CONTINUATION_IMPROVES
CONTINUATION_NEUTRAL
CONTINUATION_REGRESSES
```

Do not mutate the active tree in this task.

## Verification

Write focused tests, not isolated trivial stubs:

```text
1. For all selected baseline cases:
   normal product R observable output == no-edit cached RoundBoardState result.
2. Every executed candidate has a unique edited state fingerprint.
3. Candidate trials use same base fingerprint for their case and only execute one R battle.
4. Existing deployed-unit reposition occurs in at least one real case when available;
   verify it does not create duplicate deployment.
5. 16 run is exactly the unique-trial prefix of 32 run for same case/search seed.
6. Invalid/duplicate proposals do not consume budget.
7. Every selected representative is non-dominated among retained solutions.
8. No active tree/R0/tier/L1/deployment artifact is modified.
```

Do not block implementation on cross-worker, full-match, or internal-state audits. Those are separate verification/diagnostic concerns unless a concrete failure appears.

## Evidence

Use EvidenceWriter for:

```text
all2rush_g2_t115_manifest.json
all2rush_g2_t115_baseline_cases.jsonl
all2rush_g2_t115_proposals.jsonl
all2rush_g2_t115_unique_trials.jsonl
all2rush_g2_t115_budget_comparison.jsonl
all2rush_g2_t115_local_solutions.jsonl
all2rush_g2_t115_forward_assessment.jsonl
all2rush_g2_t115_summary.json
```

Each trial must record all fields required above. Empty artifacts use an explicit schema/header row, not omission.

## Acceptance

- [ ] One public call completes baseline selection, cached state search, 16/32 comparison and local-solution selection.
- [ ] Candidate search is seeded, uses real board units/actions, and counts only unique valid edited board states.
- [ ] Candidates execute only one current battle round from cloned cached state.
- [ ] All selected cases pass no-edit observable equivalence.
- [ ] Behavior-distinct improvements and 16-vs-32 marginal evidence are reported.
- [ ] No automatic runtime/global application happens.

## Delivery

Write `TASKS/tree/T115.report.md` with API/call path; case matrix; proposal/unique accounting; 16-vs-32 table; detailed local solution table with actual edits; forward assessment/optional continuation; test outcomes; evidence counts; no-apply confirmation; changed files. Commit/push only `agent/tree`.
