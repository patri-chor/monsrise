STATUS: OPEN
DOMAIN: tree
SUPERSEDES: T125-generation2-optimizer-cycle-consolidation

# T126 - Generation 2 Cycle Actual Branch Trace

## Rework Reason

T125 consolidated the optimizer into the intended single cycle, but one material correctness claim is false.

`cycle/pilot.ts` currently calculates branch selection as:

```ts
candMatch.roundOutputs.some(ro => ro.round >= branchForkRound)
```

This proves only that the game reached the branch round. It does **not** prove that the candidate branch was selected by the target strategy. Consequently a non-selected candidate can enter selected-pair aggregates and be accepted/rejected using unrelated product outcomes.

Fix this in one cohesive implementation/audit pass. Do not restore parallel runners, add event sourcing, enlarge the architecture, or change product rules.

## Goal

Make `branchSelected` in the consolidated optimizer cycle an actual, auditable product strategy decision trace, and rerun the cycle so pilot decisions use only genuinely selected pairs.

## 1. Product Decision Trace Contract

Add a minimal stable trace capability to the product path used by `ProductMatchRunner.runFullMatch`:

```ts
interface ProductStrategyDecisionTrace {
  round: number;
  side: 1 | 2;
  selectedNodeId?: string;
  selectedBranchId?: string;
  deploymentIntentIds: string[];
  acceptedDeploymentIds: string[];
}
```

The trace must be emitted at the actual point `treeStrategyFor` chooses an Evol node/branch and deployments are accepted. It must remain optional and have no gameplay effect.

`ProductMatchRunner` returns it when a caller requests `collectStrategyTrace: true`:

```ts
strategyDecisionTrace: ProductStrategyDecisionTrace[]
```

Do not infer branch selection from:

```text
round reached
observable digest difference
score difference
forkRound alone
known candidate identity
```

## 2. Trace Through Consolidated Cycle

Only update the existing primary files as needed:

```text
cycle/types.ts
cycle/pilot.ts
cycle/benchmark.ts or cycle/optimizer_cycle.ts if trace plumbing requires it
product_match_runner.ts
product_tree_strategy.ts / nearest existing strategy context hook
```

`CyclePilot.validateCandidateAgainstCurrentPilot(...)` determines selection for the target side by matching:

```text
trace.side == target side
AND trace.round == candidate executableBranch.forkRound
AND trace.selectedBranchId == candidate executableBranch.branchId
```

If exact branch IDs are transformed by branch attachment, expose canonical original branch ID in trace and compare it consistently. Document the mapping.

A validation pair with no matching trace is:

```text
branchSelected: false
classification: NOT_SELECTED
```

It is written to evidence but excluded from candidate effect aggregation. A pair selected on one side only must not be credited to the other side.

## 3. Candidate Decision Rules

Use the established `cycle/outcome.ts` comparator and Score70 rules unchanged.

For each candidate:

```text
selected pair count = count of actual matching branch trace entries
no selected pairs -> PILOT_NEUTRAL with explicit reason
selected pairs -> compare only selected baseline/candidate ProductOutcome values
any selected regression -> PILOT_REJECTED
strict aggregate improvement and no selected regression -> PILOT_ACCEPTED
otherwise -> PILOT_NEUTRAL
```

Candidate decision evidence includes:

```text
candidate ID / branch ID / target side / seed
actual target trace rows
branchSelected
classification
selected-pair aggregate W/D/L/N / Score70
excluded NOT_SELECTED count
```

## 4. Consolidated Retest and Real Run

Retain one current optimizer-cycle test, extending it to prove:

```text
- a match reaching fork round without the candidate branch trace is NOT_SELECTED;
- a match with matching target-side exact branch ID is selected;
- opposite-side or wrong-round/wrong-ID traces are NOT_SELECTED;
- candidate decision aggregates only matching selected traces;
- Score70 and dynamic pilot feedback continue working;
- no product gameplay observable changes when trace collection is disabled.
```

Run the actual consolidated multi-iteration cycle after the trace fix. Do not expect any specific candidate to be accepted. Report the actual selected/non-selected counts and decision changes from the pre-fix cycle if comparable.

## Artifacts

Use the existing consolidated run layout. Add only:

```text
iteration-XXX/strategy_traces.jsonl
```

Each paired validation record references trace identity or includes target trace fields. No new runner/path/directory convention.

## Acceptance

- [ ] `branchSelected` is derived only from exact actual target strategy trace.
- [ ] Reaching fork round alone never marks a pair selected.
- [ ] NOT_SELECTED pairs remain evidence but do not affect candidate outcome.
- [ ] Consolidated 7-module cycle and CLI remain the sole supported entrypoint.
- [ ] One broad cycle test and genuine multi-iteration run pass.
- [ ] No R0/global/tier/L1/deployment modification.

## Delivery

Write `TASKS/tree/T126.report.md` with false-heuristic-to-trace fix; trace schema/source point; branch ID mapping; selected/not-selected examples; candidate decision before/after counts; test/run results; artifact path; no-apply confirmation; changed files. Commit/push only `agent/tree`.
