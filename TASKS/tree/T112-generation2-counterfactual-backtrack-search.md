STATUS: OPEN
DOMAIN: tree
SUPERSEDES: T111-generation2-branch-coverage-and-conflict-resolution

# T112 - Generation 2: Counterfactual Backtrack Search for All2Rush

## Correct Local-Search Semantics

T110's 33 improved trial count is not 33 independent improvements. Candidate generation used a fixed coordinate list and did not deduplicate actual behavior fingerprints before evaluation.

T112 replaces that search semantics.

The intended optimization is not to illegally move a monster after it is already on the R-round board. It is the counterfactual question:

```text
"If I had placed this already-deployed monster differently at its own earlier
 deployment round D, would the later adverse round R have been avoided?"
```

For an adverse round R and an already deployed target monster:

```text
find original deployment round D <= R
capture/use exact pre-D checkpoint
change only D..R-local strategy actions
replay continuously from D through the end
```

This is a local backtracking window, not global start-of-game search. A successful branch must fork at D, where the action is legal, rather than at R after the placement has already happened.

## Scope

```text
all2rush only
use Generation2PilotOrchestrator and existing generation2 modules
no R0/global main/tier/L1/deployment changes
no arena.ts/playSpecVsSpec
```

Do not discard T110 evidence. Reclassify its 33 count as raw improved trials and use only behavior-distinct results as input to this task.

## 1. Unique Actual Candidate Contract

A candidate counts against budget only after compiling it to a concrete executable evolution/action delta and obtaining a new behavior fingerprint.

```text
sample parameter proposal
-> compile actual D..R strategy delta
-> calculate behavior fingerprint
-> if fingerprint already seen for this case/window: discard without execution
-> otherwise validate legal replay action and execute
```

Persist both proposal fingerprint and compiled behavior fingerprint. Rejected duplicates are recorded separately but do not consume 16/32 trial budget.

An improved candidate is unique by behavior fingerprint, not by coordinate label or random draw index.

## 2. Backtrack-Window Discovery

For every selected target-side loss case:

1. Identify relevant already-deployed target monsters at adverse round R from observable board/HP output and deployment history.
2. For each candidate monster, identify original deployment round D and exact pre-D checkpoint.
3. Build a bounded D..R action catalog, with legality enforced against each respective round:

```text
- change original placement x/y of monster deployed at D;
- change same-round deployment order where more than one action exists;
- move an already planned future deployment from D+1..R into an earlier legal
  round, removing its old scheduled action;
- defer an existing D action to a later legal round where appropriate;
- adjust coordinated placements/order of up to three actions across D..R;
- choose allowed calculator-policy values when relevant.
```

Never place a monster twice. Never move a monster already on the D checkpoint board. Never add actions not legal under actual budget/team rules.

For D = R this reduces to ordinary current-round local search. For D < R it is the required counterfactual “place it differently last round” search.

## 3. Two Budget Experiments

For each chosen `(loss case, D-window)` run both independently with fixed recorded seeds:

```text
Budget A: 16 unique behavior-fingerprint candidates
Budget B: 32 unique behavior-fingerprint candidates
```

Use the same candidate catalog and deterministic random stream; Budget A is the first 16 unique candidates of the Budget B stream. This makes marginal comparison meaningful.

For each budget report:

```text
legal proposal count
compiled duplicate count
unique executed count
behavior-distinct improvements
best result by W/D/L, score, adverse-round delay, and HP trajectory
incremental unique improvements discovered by candidates 17..32
runtime cost / continuation count
```

Stop only upon legal-space exhaustion or budget limit. Do not report a fixed template count as a budget.

## 4. Branch Recording and Forward Placement

For each behavior-distinct improved candidate:

```text
- retain it initially in a local solution set for its (case, D-window);
- select a representative only after comparing all distinct results;
- create an EXACT_CASE_BRANCH at actual fork round D;
- condition derives solely from D-round legal visible observations;
- action subtree captures the D..R change;
- confirm source case replay from pre-D checkpoint across a fresh worker/pool boundary.
```

A later label at R cannot be used to decide an action at D. If D-round visible facts cannot distinguish the target situation, the solution remains local evidence/warm-start only and is not an executable early branch.

## 5. Per-Case Selection and Non-Domination

Do not use T110's “first improved candidate wins” behavior.

For each case/window group:

```text
- retain all behavior-distinct improvements;
- remove only an exact behavior duplicate;
- mark a candidate dominated only when another candidate is at least as good on
  all recorded observable metrics and strictly better on at least one;
- choose an executable branch representative based on best observable result,
  then simpler/earlier legal delta, then stable behavior fingerprint.
```

Non-selected distinct improvements are retained as warm-start/historical candidates with their evidence.

## Evidence

Write append-only T112 evidence:

```text
all2rush_g2_t112_backtrack_windows.jsonl
all2rush_g2_t112_candidate_proposals.jsonl
all2rush_g2_t112_unique_trials.jsonl
all2rush_g2_t112_budget_comparison.jsonl
all2rush_g2_t112_local_solution_sets.jsonl
all2rush_g2_t112_forward_branches.jsonl
all2rush_g2_t112_summary.json
```

Each unique trial includes loss case, R, D, selected target action/monster, pre-D checkpoint fingerprint, budget/run seed/draw index, exact D..R delta, compiled behavior fingerprint, W/D/L, score, roundResults, per-round HP digest, and classification.

## Acceptance

- [ ] Duplicate behavior fingerprints do not execute or consume candidate budget.
- [ ] At least one D < R window is attempted where an adverse case has a prior target deployment; otherwise evidence explains why no such window exists.
- [ ] No illegal move/redeployment of an already placed monster occurs.
- [ ] Both 16 and 32 unique-candidate experiments run from the same deterministic stream and compare marginal result.
- [ ] Every local improvement is behavior-distinct and retained/compared before representative selection.
- [ ] Every executable forward branch forks at its actual legal decision round D and is confirmed from pre-D checkpoint.
- [ ] No global/tier/L1/deployment change.

## Delivery

Write `TASKS/tree/T112.report.md` with T110 raw-vs-unique reconciliation; backtrack window table; 16 vs 32 comparison table; unique improvement/non-domination table; forward branch details and source confirmation; no-legal-window cases; evidence row counts; tests; no-apply confirmation; changed files. Commit/push only `agent/tree`.
