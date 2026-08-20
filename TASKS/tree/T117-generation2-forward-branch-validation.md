STATUS: DONE
DOMAIN: tree
SUPERSEDES: T116-generation2-diverse-local-search-and-solution-selection

# T117 - Generation 2: Forward Branch Validation

## Starting Point

T116 completed diversified cached single-round search:

```text
6 cases across 3 opponents (2 per opponent)
192 unique single-round trials
1/2/3 edit distribution: 76 / 83 / 33
62 local improvements
7 Pareto non-dominated local solutions
4 cases with round win/draw improvement
```

At least one selected gift_jungle representative has a full-match confirmation:

```text
baseline: draw 1:1
altered: all2rush win 0:2
classification: CONTINUATION_IMPROVES
```

T117 does not broaden random search. It validates and classifies the existing non-dominated solutions for possible legal forward branch use.

## Scope

```text
all2rush only
inputs: T116 non-dominated local solutions and current matching snapshots
no R0/global main/tier/L1/deployment change
no UI/deployment publishing
```

## 1. Solution Classification

For each of the seven T116 non-dominated solutions, create an explicit classification:

```text
FORWARD_CANDIDATE
LOCAL_ONLY_EARLIER_CONTEXT
LOCAL_ONLY_NOT_VISIBLE
DISCARDED_DOMINATED_AFTER_FULL_MATCH
```

A `FORWARD_CANDIDATE` must modify only an action that can be issued by all2rush at a real legal decision round, and its condition must use only facts visible to all2rush then.

```text
- pending current-round action coordinate/order may be forward candidate;
- reposition of earlier deployed unit is forward candidate only when converted
  to that unit's original legal deployment action and its needed condition is
  visible at that earlier round;
- no opponent ID, seed, future board, outcome, or hidden hand may appear in
  the runtime condition.
```

Local-only solutions stay in the solution library as warm-start/tactical evidence; do not force them into runtime branches.

## 2. Compile Forward Candidates

For each forward candidate:

```text
- create an executable all2rush Evol subtree/action delta at its actual
  decision round;
- derive minimal legal FeatureMask / optional visible-layout signature;
- attach it to a pilot-only branched evol snapshot;
- prove source case strategy selects the branch ID;
- run source case full product match and compare baseline versus branch.
```

Only candidates whose source full-match result is at least neutral may proceed to expanded validation.

## 3. Expanded Product Validation

For every source-confirmed forward branch run full real product matches against:

```text
source opponent, source side, seeds [1, 7, 42, 100, 2024]
source opponent, opposite side, same seeds
other two selected opponents, both sides, seeds [1, 42]
```

For each paired baseline/branch case record:

```text
branch ID
opponent snapshot fingerprint
side/seed
baseline final W/D/L, score, roundResults, per-round HP digest
branch final W/D/L, score, roundResults, per-round HP digest
runtime branch selected true/false
classification: IMPROVES / NEUTRAL / REGRESSES / NOT_SELECTED
```

A branch remains pilot-active only when:

```text
- it selects on its intended source condition;
- it has no source regression;
- it does not select on nonmatching cases;
- its source paired Score70-equivalent result is non-regressing.
```

This is not tier/global promotion. It is pilot branch library selection only.

## 4. Conflict and Ordering

If multiple forward branches match one case, use deterministic order:

```text
more specific legal condition/layout
-> stronger source validation result
-> stable branch ID
```

Evaluate overlapping candidates together. If a branch causes regression under overlap, narrow it by legal visible condition or mark it `DISCARDED_DOMINATED_AFTER_FULL_MATCH`.

## 5. Warm-Start Library

For every local-only solution and every rejected forward branch, preserve the concrete edit/action delta as a warm-start record:

```text
source observable case signature
legal decision round if known
state/action delta
reason not runtime active
```

It may seed future local single-round search only. It must not change runtime selection.

## Evidence

Write:

```text
all2rush_g2_t117_solution_classification.jsonl
all2rush_g2_t117_forward_branches.jsonl
all2rush_g2_t117_source_validation.jsonl
all2rush_g2_t117_expanded_validation.jsonl
all2rush_g2_t117_overlap_resolution.jsonl
all2rush_g2_t117_warm_start_library.jsonl
all2rush_g2_t117_summary.json
```

## Acceptance

- [ ] All T116 non-dominated solutions receive an explicit classification.
- [ ] Every forward candidate uses a legal visible decision condition and source runtime trace proves branch selection.
- [ ] Every source-confirmed candidate receives paired full product validation over stated seed/side matrix.
- [ ] No branch remains pilot-active with source regression or nonmatching-case auto-selection.
- [ ] Local-only/rejected items remain as warm-start evidence, not runtime policy.
- [ ] No global/tier/L1/deployment change.

## Delivery

Write `TASKS/tree/T117.report.md` with T116 input solution table; classification rationale; compiled branch table; source/expanded validation matrix; overlap ordering/results; active pilot branch list; warm-start list; evidence counts; tests; no-apply confirmation; changed files. Commit/push only `agent/tree`.
