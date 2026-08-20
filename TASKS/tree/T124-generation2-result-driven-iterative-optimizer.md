STATUS: DONE
DOMAIN: tree
SUPERSEDES: T123-generation2-iterative-pilot-optimizer

# T124 - Generation 2 Result-Driven Iterative Optimizer

## Objective

T123 created a runnable loop but it is not yet a result-driven optimizer: iteration Score70 fields are hard-coded to `0`, and candidate pairing decides from raw final score only. Replace this with one complete, practical implementation pass where the iterative program makes every retain/reject/continue decision from real product outcomes.

Do not build event sourcing, interruption/resume machinery, or task-specific rule articles. Do not manually choose a favorable opponent, branch, coordinate or desired outcome.

## Required Program Behavior

The existing `runIterativePilotOptimizer(config)` remains the single public entry. Refactor its supporting modules as needed so each iteration does:

```text
current accepted pilot library
-> actual product baseline benchmark
-> automatic adverse case mining under that exact current strategy
-> cached RoundBoardState evolutionary local search
-> forward compilation where legal
-> candidate-local paired product validation
-> calculate shared aggregate objective / Score70
-> accept, neutralize or reject candidate automatically
-> use accepted candidates in next iteration baseline
-> stop from measured improvement state
```

No active formation/R0/tier/L1/deployment mutation. Pilot library remains isolated to the run.

## 1. Shared Product Outcome Model

Add one reusable normalized result adapter for complete matches and use it everywhere in T124:

```ts
interface ProductOutcome {
  targetSide: 1 | 2;
  winner: 1 | 2 | 0;
  targetW: number;
  targetD: number;
  targetL: number;
  targetScore70: number; // (W + 0.70 * D) / N
  targetRoundResults: Array<1 | 2 | 0>;
  perRoundObservable: Array<{
    round: number;
    winner: 1 | 2 | 0;
    targetScore: number;
    opponentScore: number;
    targetSurvivorIds: string[];
    targetHp: number;
    targetSurvivorCount: number;
    opponentSurvivorIds: string[];
    opponentHp: number;
    opponentSurvivorCount: number;
  }>;
  observableDigest: string;
}
```

`N` is the number of paired matches in the aggregate. A draw is intentionally worth `0.70`; do not penalize draw-heavy all2rush with a separate rule.

Define one pure comparison:

```text
1. target Score70
2. target W, then D, then lower L
3. target aggregate round wins/draws
4. target survivor count/HP
5. lower opponent survivor count/HP
```

Use this one comparator for:

```text
candidate paired validation classification
candidate acceptance ranking
iteration before/after score
stop/no-improvement decision
final pilot library ordering
```

## 2. Real Candidate-Local Paired Validation

For every forward-expressible candidate representative:

```text
baseline = current pilot library only
candidate = current pilot library + this one candidate
```

Across all configured paired validation `(opponent, side, seed)` instances record complete baseline and candidate ProductOutcome objects plus:

```text
candidateId
branchId
branchSelected true/false from actual strategy trace
comparison: IMPROVES | NEUTRAL | REGRESSES | NOT_SELECTED
comparison reason/objective vectors
```

Do not claim an effect on a pair where branch was not selected. Non-selected pairs remain evidence of scope but are excluded from that candidate's selected-pair aggregate.

Candidate automatic decision:

```text
PILOT_ACCEPTED:
  selected-pair count > 0
  AND candidate selected-pair aggregate strictly beats baseline under comparator
  AND no selected pair regresses under comparator

PILOT_NEUTRAL:
  selected-pair count > 0
  AND no selected pair regresses
  AND aggregate is equal

PILOT_REJECTED:
  any selected pair regresses
  OR selected-pair aggregate is lower

LOCAL_ONLY:
  no legal forward compilation
```

No candidate is accepted based only on raw final score or a result from another candidate.

## 3. Measured Iteration Baseline and Search Feedback

Before local search, run and record an iteration benchmark for the current pilot strategy over configured baseline matrix:

```text
all configured opponents
both sides
baseline seeds
```

Store its ProductOutcome aggregate and Score70. Mine adverse cases from this actual strategy execution. The next iteration must repeat this benchmark after accepted pilots are attached.

Iteration report must carry real values, never placeholders:

```text
baselineW/D/L/N, baselineScore70
postDecisionW/D/L/N, postDecisionScore70
Score70 delta
round/survivor/HP aggregate deltas
accepted/neutral/rejected/local-only count
selected/not-selected validation pair count
```

If multiple accepted candidates are possible, choose at most configured capacity in descending candidate-local aggregate comparison order. After each acceptance, re-evaluate its candidate against the updated temporary pilot library before adding another, so accepting one cannot silently invalidate the next.

## 4. Dynamic Program Advance

Use no hard-coded “first/second iteration” or named formation behavior.

Stop when:

```text
- no adverse loss/draw remains under the current pilot baseline;
- configured max iterations reached;
- consecutive iterations have no strict baseline Score70/objective improvement;
- search/validation has no forward-expressible candidate with selected pairs.
```

Record exact stop condition and relevant metrics. Local-only tactical improvements remain warm-start/archive data and do not falsely count as global pilot improvement.

## 5. Broad Practical Verification

Implement first, then run one broad actual multi-iteration audit with generated inputs. It must verify:

```text
- Score70 values are recomputable from recorded W/D/N and never hard-coded;
- every accepted/rejected/neutral decision is reproducible solely from that
  candidate's selected paired ProductOutcome records;
- branchSelected is an actual observed flag, and NOT_SELECTED pairs do not
  contribute to effect claims;
- each iteration baseline uses exactly prior accepted pilots and no rejected or
  neutral/local-only branch;
- iteration N+1 re-mines cases from the changed product strategy, not prior
  cached case lists;
- ordinary local candidates run only one cached current-round battle;
- no-edit selected cases match product observable round data;
- stopping reason agrees with actual iteration metrics;
- no R0/global/tier/L1/deployment change.
```

Run one genuine multi-iteration all2rush execution using practical defaults. Do not assert particular opponent, candidate ID, coordinate, pilot count or positive result. A zero-accept run is valid evidence when metrics support it.

## Artifacts

Keep ordinary readable output only:

```text
reports/tree-cycle/generation2-result-iterative/<run-id>/
  config.json
  pilot_library.json
  iterations.jsonl
  iteration-XXX/
    baseline_benchmark.json
    baseline_cases.jsonl
    local_trials.jsonl
    local_archive.jsonl
    forward_candidates.jsonl
    paired_validations.jsonl
    candidate_decisions.jsonl
    summary.json
  summary.json
```

## Acceptance

- [ ] Iterative decisions are driven by real shared ProductOutcome/Score70 comparator, not raw score or placeholders.
- [ ] Each candidate is judged only against current pilot baseline and its own selected pair results.
- [ ] Next iteration baseline contains only accepted pilots and re-mines actual remaining problems.
- [ ] Program can legitimately stop with no accepted pilot; negative evidence is retained.
- [ ] Broad run verifies observable parity, loop isolation and measured feedback.
- [ ] No global/tier/L1/deployment mutation.

## Delivery

Write `TASKS/tree/T124.report.md` with outcome/comparator definitions; loop call path; real per-iteration W/D/L/N/Score70 table; candidate-local validation table including selected/not-selected; accepted/neutral/rejected/local-only table; before/after iteration metrics; stop reason; audit/run results; artifact paths; no-apply confirmation; changed files. Commit/push only `agent/tree`.
