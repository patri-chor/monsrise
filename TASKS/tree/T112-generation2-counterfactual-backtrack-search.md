STATUS: DONE
DOMAIN: tree
REISSUE: T112
SUPERSEDES: prior T112 wording

# T112 - Generation 2: Sequence-Driven Single-Round Battle Engine

## Correct Model

Every simulated game is an independent new individual. It starts from the beginning with the fixed seed, teams, badges and product rules; monsters acquire their actual state naturally as the game advances.

Therefore do **not** build the single-round engine by accepting an externally edited live monster-state snapshot or by trying to inject a monster move into an already-running round.

The simple authoritative input is the deployment sequence that constructs the current round:

```text
fixed seed
+ both exact teams and badges
+ ordered deployment sequence for R1..R
  (side, round, monster ID, badges, x, y, order)
+ optional edits to entries in that sequence
-> start a fresh independent product game
-> replay setup/history actions through pre-battle R
-> execute only battle round R
-> return R observable result
```

A monster already on the board in R is repositioned by editing its original deployment-sequence entry. Since every trial starts fresh, the product engine recalculates all its real state naturally: board position, HP, effects, cooldowns and later-round state. No manually reconstructed mutable monster state is required.

This is the intended local workflow:

```text
find adverse round R
-> obtain its actual R1..R deployment sequence
-> edit one to three sequence actions affecting the current board/current R
-> fresh replay from game start through R pre-battle
-> simulate only R battle
-> compare R outcome and survivor HP
```

It is not a full-match candidate search: after R battle the ordinary trial stops. The short setup replay is only the deterministic, authoritative way to obtain the right current-round state for that independent game.

## Scope

```text
all2rush only
real product rules only; no arena.ts/playSpecVsSpec
no R0/global main/tier/L1/deployment modification
```

T110's 33 raw improved trials are historical raw records, not 33 independent behavior-distinct local solutions.

## 1. Sequence Capture

Implement a compact, canonical `RoundSetupSequence` representation sourced from real product games:

```ts
interface RoundSetupAction {
  side: 1 | 2;
  round: number;
  order: number;
  monsterId: number;
  badgeIds: number[];
  x: number;
  y: number;
}

interface RoundSetupSequence {
  seed: number;
  targetSide: 1 | 2;
  targetFormationFingerprint: string;
  opponentFormationFingerprint: string;
  targetPolicyFingerprint: string;
  opponentPolicyFingerprint: string;
  targetRound: number;
  actions: RoundSetupAction[]; // R1..R, canonical side/round/order sequence
}
```

Capture actions from actual accepted product deployment traces. Preserve actual accepted coordinates rather than planned coordinates. Include both sides. The sequence must contain IDs and badges so it can recreate the same product deployment identity.

Provide deterministic canonicalization/fingerprint:

```text
sort by round, side, accepted deployment order
serialize fixed scalar fields and badge IDs
hash canonical sequence
```

## 2. Sequence-Driven Single-Round API

Create a named API, for example:

```ts
runSingleRoundFromSequence(input: {
  sequence: RoundSetupSequence;
  edits: SequenceEdit[];
}): SingleRoundResult
```

`SequenceEdit` changes only a legal sequence action:

```text
- placement x/y of an action
- order among actions in the same side/round
- move an action from a later R1..R slot into an earlier legal round,
  removing its original action
- optionally a whitelisted current policy decision that changes an action
```

The engine:

```text
1. validates edited sequence: no duplicate monster deployment, legal team/badges,
   coordinates and round budgets;
2. starts a fresh product game from the sequence seed and exact teams;
3. replays deployment actions for R1..R-1 and advances their normal rounds;
4. applies R deployment actions, including edits;
5. executes battle R only and stops;
6. returns canonical observable result.
```

No edit may directly mutate live board-monster state. No candidate may modify opponent actions. All target-side position changes are edits to target-side deployment sequence entries.

`SingleRoundResult` contains:

```text
round winner
p1/p2 score delta and cumulative score
accepted/rejected R deployment actions
survivors keyed by stable product instance ID
survivor HP/max HP
per-side survivor count and total HP
canonical observable digest
sequence fingerprint and edited-sequence fingerprint
```

## 3. Equivalence Gate

For real matches across available exact formations, both sides, at least six seeds and every reachable round:

```text
normal product game round R
== runSingleRoundFromSequence(original captured R1..R sequence, no edits)
```

Compare complete single-round observable output. The test verifies that sequence capture/replay reconstructs the same current-round battle without manually serializing internal monster state.

When output differs, write diagnostic trace and stop use of that setup/case until diagnosed.

## 4. Unique 16 / 32 Local Searches

For each target-side adverse round:

```text
capture original RoundSetupSequence
-> generate proposals that alter 1..3 target-side sequence actions
-> canonicalize edited sequence
-> identical edited-sequence fingerprint: record duplicate, do not execute/count
-> unique legal sequence: execute single round and count
```

Run two fixed-seed budgets from the same proposal stream:

```text
Budget 16 = first 16 unique legal edited sequences
Budget 32 = first 32 unique legal edited sequences
```

Search variables include existing target monster placement edits from earlier rounds, current R placement edits, deployment order and legal forward/backward timing of target actions within R1..R.

Compare against baseline R result by:

```text
round loss -> draw/win
round draw -> win
same round result + better target survivor count/total HP/HP digest
```

Record proposal count, duplicate count, legal unique count, outcome distribution, best 16, best 32, and unique incremental wins from 17..32.

## 5. Local Findings vs Runtime Branches

Every behavior-distinct round improvement is kept in a `ROUND_LOCAL_SOLUTION` set first.

A solution can become a runtime branch only when its edited deployment action occurs at a legal decision round and its condition can be derived from legally visible facts at that decision point. Then compile the action change at its original deployment round, not at R.

If it cannot be safely expressed at that earlier visible decision, retain it as local evidence/warm-start only. Never auto-apply it.

Full-match continuation is optional for selected best local solutions only. It is not part of the ordinary 16/32 single-round budget.

## Evidence

Write append-only artifacts:

```text
all2rush_g2_t112_sequence_equivalence.jsonl
all2rush_g2_t112_sequences.jsonl
all2rush_g2_t112_proposals.jsonl
all2rush_g2_t112_single_round_trials.jsonl
all2rush_g2_t112_budget_16_vs_32.jsonl
all2rush_g2_t112_local_solutions.jsonl
all2rush_g2_t112_branch_assessment.jsonl
all2rush_g2_t112_mismatch_diagnostics.jsonl
all2rush_g2_t112_summary.json
```

Each trial records source case/round/side/seed, original and edited sequence fingerprints, concrete edited actions, proposal/unique index, observable round result and HP digest.

## Acceptance

- [ ] Actual product deployment traces produce compact canonical R1..R setup sequences including monster ID, badge IDs, actual coordinate and order.
- [ ] No-edit sequence replay matches normal product round observable output across stated matrix.
- [ ] Every trial begins as an independent fresh game and stops after target R battle.
- [ ] Position changes for already-on-board monsters are represented by their earlier sequence placement action, never illegal live-board mutation.
- [ ] 16/32 budgets count only unique canonical edited sequences.
- [ ] Behavior-distinct improvements are retained before representative/branch assessment.
- [ ] Branch application remains optional and legally forward-expressible.
- [ ] No global/tier/L1/deployment change.

## Delivery

Write `TASKS/tree/T112.report.md` with sequence schema/call path; equivalence matrix; representative captured sequence; 16-vs-32 table; unique improvement table; examples of earlier placement edits affecting R; optional continuation/branch assessments; evidence rows; tests; no-apply confirmation; changed files. Commit/push only `agent/tree`.
