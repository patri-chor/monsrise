STATUS: OPEN
DOMAIN: tree
REISSUE: T112
SUPERSEDES: prior T112 counterfactual-backtrack wording

# T112 - Generation 2: Single-Round Counterfactual Battle Engine

## Objective

Build the missing product **single-round battle engine** and use it for all2rush local search.

The engine accepts the exact current round's pre-battle state. It does not require replaying from an earlier deployment round and it does not run R+1..end during ordinary candidate search.

```text
current round pre-battle board + current round deployment choices
-> optional counterfactual repositioning of target-side monsters already on board
-> one authoritative product battle round
-> round winner, survivors, HP, score delta
```

This is the intended meaning of:

```text
"If I had put the monster already on the board here before this round,
 could I win this point?"
```

It is a counterfactual pre-battle layout input, not an in-game second deployment or a new movement rule.

## Scope

```text
all2rush only
use real product battle rules through existing authoritative battle path
no arena.ts/playSpecVsSpec
no R0/global main/tier/L1/deployment modification
```

T110 historical full-continuation results remain evidence only. Do not treat its 33 raw improved trials as 33 unique local solutions.

## 1. Single-Round Input Contract

Introduce a named Generation 2 single-round API, for example:

```ts
runCounterfactualRound(input: CounterfactualRoundInput): CounterfactualRoundResult
```

`CounterfactualRoundInput` must contain a complete current-round pre-battle state:

```text
round number and deterministic seed/RNG continuation
both scores and current round budgets
both teams/hands needed for current deployment validation
current board monsters, including identity, team, badges, HP/max HP,
  battle-relevant fields, and current x/y
current-round target-side and opponent-side deployment intents in order
optional target-side existing-board layout overrides keyed by stable monster ID
```

The engine must:

```text
- restore/build the supplied current pre-battle state;
- apply only allowed target-side existing-board coordinate overrides before
  the battle, then apply both sides' current-round deployment intents;
- validate target-zone, collision, bounds and identity rules;
- never duplicate, create, delete, or deploy an already-on-board monster;
- execute exactly one authoritative normal product battle round;
- return observable result only by default.
```

Observable result:

```text
round winner
p1/p2 score delta and cumulative score
surviving units keyed by stable instance ID
per-survivor HP/max HP
per-side survivor count and total HP
accepted/rejected current-round deployment actions
canonical observable digest
```

Internal diagnostics are opt-in only on mismatch/failure.

## 2. Product Equivalence Gate

Use actual formation games to harvest current-round pre-battle inputs. For a broad sample of formations, sides, seeds and reachable rounds:

```text
original ProductGameSession.playRound
== runCounterfactualRound with no board overrides and same deployment intents
```

Compare the complete observable result listed above. This is a single-round equivalence test, not full-match parity.

Minimum coverage:

```text
all available exact formations, up to at least 4 distinct formations
both sides
at least 6 seeds
all reachable rounds from each sampled match
```

Report actual input/round count. On a mismatch, write a diagnostic record containing the original input plus traces/internal fields required to explain it.

## 3. Current-Round Local Search

For each all2rush target-side adverse round R:

1. Capture exact pre-R single-round input from the real baseline match.
2. Build legal counterfactual variables from that input:

```text
A. target-side existing-board monster x/y override
B. target-side current-round new placement x/y
C. current-round target-side deployment order
D. optionally one whitelisted calculator-policy choice if it changes current
   round intents
```

A candidate modifies 1..3 variables. It may alter both existing-board placement and new deployment in the same current-round input.

No candidate may:

```text
move opponent units
move a target unit outside its target-side pre-battle legal board area
place two units in one cell
reposition a dead/nonexistent unit
modify future rounds
implicitly replay an earlier round
```

## 4. Unique Budget Experiments

Use a persisted deterministic random search seed. Proposals may repeat; executed candidates may not.

```text
proposal
-> canonicalize concrete complete single-round input
-> calculate round-input behavior fingerprint
-> duplicate fingerprint: record DUPLICATE_PROPOSAL, do not execute/count
-> unique legal fingerprint: execute/count
```

Run both budgets on the same stream:

```text
Budget 16: first 16 unique legal single-round inputs
Budget 32: first 32 unique legal single-round inputs
```

For each adverse round report:

```text
proposal count
legal unique count
compiled duplicate count
16-result best candidate
32-result best candidate
new unique improvement from candidates 17..32
round winner/score/HP outcome distribution
runtime per candidate
```

This counts distinct **actual round layouts and intents**, not different coordinate labels that canonicalize to the same behavior.

## 5. Local Solution and Forward Branch Semantics

Retain every behavior-distinct single-round improvement for each adverse case. Compare them before selecting a representative:

```text
round loss -> draw/win
round draw -> win
same round result but strictly better target total HP / survivor outcome
```

A selected local solution may be stored as a `ROUND_LOCAL_SOLUTION` immediately.

It becomes an executable forward strategy branch only if its coordinate/action changes can be expressed at a legal decision point visible before that round. If the solution relies on a counterfactual already-on-board layout whose original decision was earlier and cannot be distinguished with legal information then:

```text
retain it as local tactical evidence / warm-start
DO NOT auto-apply it as runtime branch
```

Do not force full-match continuation evaluation for every candidate. For the best representative(s) only, run optional full product continuation as a separate validation column:

```text
CONTINUATION_IMPROVES
CONTINUATION_NEUTRAL
CONTINUATION_REGRESSES
NOT_RUN
```

It does not change the primary single-round finding.

## Evidence

Write append-only T112 artifacts through the Generation 2 evidence writer:

```text
all2rush_g2_t112_round_equivalence.jsonl
all2rush_g2_t112_round_inputs.jsonl
all2rush_g2_t112_round_proposals.jsonl
all2rush_g2_t112_round_trials.jsonl
all2rush_g2_t112_budget_16_vs_32.jsonl
all2rush_g2_t112_local_solutions.jsonl
all2rush_g2_t112_forward_branch_assessment.jsonl
all2rush_g2_t112_mismatch_diagnostics.jsonl
all2rush_g2_t112_summary.json
```

Each trial includes formation fingerprints, source match/case, round/side/seed, baseline input fingerprint, candidate input fingerprint, concrete board overrides, deployment intents/order, selected variables, round observable result and HP digest.

## Acceptance

- [ ] A named single-round API accepts a complete pre-battle current-round input and returns one authoritative product round result.
- [ ] No-override input is observably equivalent to normal product `playRound` across the stated real-battle coverage.
- [ ] Existing-board repositioning is supported as a counterfactual input without duplicate deployment/movement game actions.
- [ ] 16 and 32 experiments count only unique canonical round-input fingerprints.
- [ ] At least one adverse all2rush round searches existing-board layout overrides where units are available; otherwise record why not.
- [ ] All behavior-distinct single-round improvements are retained and compared.
- [ ] Runtime branch conversion is explicitly separated from round-local tactical findings.
- [ ] No global/tier/L1/deployment change.

## Delivery

Write `TASKS/tree/T112.report.md` with API/input schema; equivalence coverage/pass count; candidate uniqueness reconciliation; 16-vs-32 table; existing-board override examples; per-case local solution table; optional continuation outcomes; branch-assessment decisions; artifact rows; tests; no-apply confirmation; changed files. Commit/push only `agent/tree`.
