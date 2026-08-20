STATUS: OPEN
DOMAIN: tree
SUPERSEDES: T122-generation2-full-scale-bulk-optimizer-run

# T123 - Generation 2 Iterative Pilot Optimizer

## Direction

Do not expand T121's matrix merely to hit planned counts. The existing reduced bulk evidence is sufficient for the next program decision:

```text
- automatically reject forward candidates with holdout regression;
- retain only candidate-local non-regressing pilot branches;
- use retained pilot behavior as the next optimizer baseline;
- automatically discover and optimize the next remaining adverse cases.
```

The optimizer must advance from its measured output. It must not wait for a task author to prescribe a new opponent, branch ID, coordinate, or desired result.

## Goal

Implement one iterative pilot optimization program that repeatedly:

```text
current pilot branch library
-> real product baseline matrix
-> automatic adverse-case mining
-> cached RoundBoardState local evolutionary search
-> objective/archive selection
-> forward compilation where legal
-> bounded paired validation
-> automatically retain non-regressing pilots / reject regressions
-> next iteration uses retained pilots as its baseline
```

This is the actual result-driven optimization loop for all2rush. It remains pilot-only: no R0/global/tier/L1/deployment mutation.

## Existing Evidence to Seed Iteration 1

Use current T121 output programmatically, not by hard-coded candidate ID:

```text
read available bulk run local solutions, forward candidates and paired
validation results;
reconstruct candidate-local status from the shared objective;
select all candidates meeting the generic non-regression rule;
reject all candidates with measured regression;
```

If T121 artifacts are unavailable/incompatible, rerun the normal bounded baseline/search pipeline to establish iteration 1. Do not hard-code gift_jungle or any known coordinate.

## Program API

Expose one main API and CLI:

```ts
runIterativePilotOptimizer(config): Promise<IterativePilotOptimizerReport>
```

```text
scripts/run_iterative_pilot_optimizer.ts --iterations 3 --config <path>
```

Config:

```ts
interface IterativePilotOptimizerConfig {
  targetFormationId: string;
  opponentFormationIds?: string[];
  baselineSeeds: number[];
  validationSeeds: number[];
  searchSeeds: number[];
  maxIterations: number;
  maxOpponents: number;
  maxAdverseCasesPerOpponent: number;
  uniqueCandidatesPerCase: number;
  populationSize: number;
  maxGenerations: number;
  maxNewPilotBranchesPerIteration: number;
  maxConsecutiveNoImprovementIterations: number;
  dryRun: boolean;
}
```

Defaults should be practical, not ceremonial:

```text
3 iterations
3 opponents
2 adverse cases per opponent
16 unique candidates/case
2 generations
population 8
bounded validation seeds
```

The aim is continuous useful advancement, not maximum one-off audit volume.

## Iteration State

Keep ordinary readable JSON/JSONL artifacts under:

```text
reports/tree-cycle/generation2-iterative-pilot/<run-id>/
  config.json
  pilot_library.json
  iterations.jsonl
  iteration-001/
  iteration-002/
  ...
  summary.json
```

`pilot_library.json` is a simple current-state file, containing only pilot branches selected by the generic measured rule. It is not event sourcing and does not need resume support.

Per iteration output:

```text
baseline_cases.jsonl
local_trials.jsonl
local_archive.jsonl
forward_candidates.jsonl
paired_validations.jsonl
pilot_decisions.jsonl
summary.json
```

## Iteration Semantics

### A. Build Current Pilot Strategy

Start with the original all2rush evolution plus the current `pilot_library` branches. Use an isolated clone only. Never alter active formation data.

### B. Mine Remaining Problems

Run real baseline product matches under that current pilot strategy, and mine adverse rounds automatically using the common objective. Prefer cases not already improved by existing pilots, but allow a recurring case if its current observable objective remains adverse.

No opponent-specific manual priority rules.

### C. Search and Archive

Use cached `RoundBoardState` and `SingleRoundEngine` for local candidates. Use actual state content, seeded search, valid unique state fingerprints and shared objective/dominance functions.

Run normal one-round search only. Full matches remain restricted to selected forward-expressible representatives.

### D. Candidate-Local Paired Decision

For each forward-expressible representative, compare baseline pilot strategy versus baseline-plus-candidate over the configured paired validation matrix.

Candidate status is calculated independently:

```text
PILOT_ACCEPTED:
  no selected paired validation regresses under shared objective
  AND at least one selected pair strictly improves

PILOT_NEUTRAL:
  no selected paired validation regresses
  AND no selected pair strictly improves

PILOT_REJECTED:
  any selected paired validation regresses

LOCAL_ONLY:
  not legally forward-expressible
```

Accept at most `maxNewPilotBranchesPerIteration`, ranked by candidate-local aggregate shared objective, then stable candidate identity. `PILOT_NEUTRAL` may remain in archive/warm-start but does not consume active pilot capacity unless no improving candidate exists and config explicitly allows it.

### E. Stop Dynamically

Stop early when any applies:

```text
no new PILOT_ACCEPTED branch in maxConsecutiveNoImprovementIterations
all selected baseline cases have no loss/draw adverse round
configured maxIterations reached
```

Record the actual stopping reason.

## Required Summary Metrics

Across iterations record:

```text
pilot branch count before/after
baseline product instances and Score70-compatible target score
adverse cases mined
unique one-round trials
local loss->draw / draw->win / loss->win improvements
forward-expressible/local-only/rejected/accepted counts
paired selected/not-selected count
candidate-local paired aggregate objective and Score70-compatible delta
per-opponent and per-side result summaries
iteration runtime and total runtime
stop reason
```

Do not conceal neutral/negative results. A negative candidate is rejection evidence; it still improves future search by narrowing the archive.

## Broad Verification

In one broad test/run, verify:

```text
- iteration 2 baseline includes exactly the accepted iteration 1 pilot library;
- rejected/neutral/local-only candidates do not become active pilots;
- candidate decisions are independent, not aggregate averaging across unrelated branches;
- new adverse cases are mined from actual current pilot strategy;
- ordinary local trials only run one round from cached state;
- accepted pilots are selected only from measured non-regressing/improving pairs;
- stop conditions are dynamic and correctly recorded;
- no R0/global/tier/L1/deployment modification.
```

Use an actual multi-iteration all2rush run. Do not assert known opponent, candidate ID, coordinate, exact number of accepts, or target score outcome.

## Acceptance

- [ ] The optimizer feeds measured accepted pilots back into its next baseline automatically.
- [ ] It discovers the next adverse cases without manual task-authored opponent/branch choices.
- [ ] Pilot decisions are candidate-local and objective-driven.
- [ ] Iteration stops based on actual outcome, not a rigid article workflow.
- [ ] Results retain positive, neutral and negative evidence.
- [ ] No global/tier/L1/deployment modification.

## Delivery

Write `TASKS/tree/T123.report.md` with program loop/call path; initial pilot-library source; per-iteration table; accepted/neutral/rejected/local-only tables; before/after baseline Score70-compatible results; dynamic stop reason; tests/run metrics; artifact paths; no-apply confirmation; changed files. Commit/push only `agent/tree`.
