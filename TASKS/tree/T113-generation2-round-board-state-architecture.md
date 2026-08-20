STATUS: OPEN
DOMAIN: tree
SUPERSEDES: T112-generation2-counterfactual-backtrack-search

# T113 - Generation 2 Round Board State Architecture

## Goal

Make the single-round engine simple and fast by introducing a cached **current-round board state**.

The game is five-round first-to-three. A deployed monster reappears in later rounds at its original deployment coordinate with full HP and fresh round combat state. Therefore local round search does not need to replay a complex prior battle state, and it must not re-walk/re-search the formation tree for every candidate.

The target architecture is:

```text
one real baseline product match
-> capture actual accepted deployment history once
-> build a canonical fresh RoundBoardState for each target round R
-> cache it
-> clone cached state for each local candidate
-> edit target-side pre-battle layout/current-R action order
-> execute only authoritative battle R
-> compare observable R output
```

## Product Semantics

At the beginning of any round R, the state required for battle is:

```text
all accepted earlier deployments R1..R-1
at their original accepted coordinates
with their original monster IDs and badges
reset to full HP / normal fresh-round combat state
plus current-R pending placements and deployment order
plus current score/budget/seed and branch selection context
```

Do not carry prior battle HP, targeting, transient movement, status effects, VFX, or cooldown progress into the next round unless the real product game explicitly persists that field. The factory must follow actual `resetBoardForNextRound` semantics rather than guess.

## Required Components

Add under existing `src/engine/tree/product_training/generation2/`:

```text
round_board_state.ts
round_board_state_factory.ts
single_round_engine.ts
```

Keep existing Generation 2 services and adapt them rather than creating a second optimizer path.

### 1. `round_board_state.ts`

Data-only canonical structures. No calls to product engine or filesystem.

```ts
interface RoundBoardUnit {
  instanceId: string; // stable: side + original deployment round/order
  side: 1 | 2;
  monsterId: number;
  badgeIds: number[];
  deployedRound: number;
  deploymentOrder: number;
  originalX: number;
  originalY: number;
}

interface RoundDeploymentAction {
  side: 1 | 2;
  round: number;
  order: number;
  monsterId: number;
  badgeIds: number[];
  x: number;
  y: number;
  accepted: boolean;
  rejectionReason: string | null;
}

interface RoundBoardState {
  schemaVersion: 'GENERATION2_ROUND_BOARD_STATE_V1';
  targetRound: number;
  seed: number;
  p1ScoreBeforeRound: number;
  p2ScoreBeforeRound: number;
  p1BudgetBeforeRound: number;
  p2BudgetBeforeRound: number;
  deployedUnits: RoundBoardUnit[];       // accepted R1..R-1 entries
  pendingActions: RoundDeploymentAction[]; // current-R actions
  targetSide: 1 | 2;
  targetFormationFingerprint: string;
  opponentFormationFingerprint: string;
  targetPolicyFingerprint: string;
  opponentPolicyFingerprint: string;
  selectedBranchIdsThroughRound: string[];
  stateFingerprint: string;
}
```

Canonical fingerprint includes all declared fields sorted in stable order.

### 2. `round_board_state_factory.ts`

This is the only Generation 2 component that converts a real product match/tree decision history into `RoundBoardState`.

```ts
captureStatesFromBaselineMatch(...): RoundBoardState[]
buildStateForRound(...): RoundBoardState
cloneWithEdits(base, edits): RoundBoardState
```

Required construction method:

```text
- run one authoritative baseline product match;
- capture accepted deployment traces from product path;
- use actual accepted x/y, side, round, order, monster ID, badges and branch ID;
- for R, put accepted R1..R-1 entries in deployedUnits;
- put current R actual actions in pendingActions;
- record current score/budget before R;
- form a fresh-round board description, not last-battle runtime monster objects.
```

The trace is the source of truth. Do not independently infer locations or badge data by walking the tree after capture.

### 3. `single_round_engine.ts`

The only Generation 2 component that turns `RoundBoardState` into one authoritative battle.

```ts
runSingleRound(
  base: RoundBoardState,
  edits: RoundBoardEdit[],
): SingleRoundResult
```

Supported target-side-only edits:

```text
REPOSITION_DEPLOYED_UNIT(instanceId, x, y)
CHANGE_PENDING_PLACEMENT(action identity, x, y)
REORDER_PENDING_ACTIONS(action identities/order)
```

Rules:

```text
- clone base; never mutate cached state;
- a repositioned unit retains same identity/monster/badges/deployment origin;
- it is not deployed a second time and no live movement action is invented;
- validate coordinate bounds, side zone, collision, uniqueness and current-R budget;
- build fresh R board from deployedUnits plus valid pending actions;
- use authoritative product placement/battle logic to settle exactly R;
- stop immediately after R.
```

Return normalized observable output:

```text
round winner
p1/p2 score delta and score after round
survivors keyed by stable instanceId
survivor HP/max HP
per-side survivor count and total HP
accepted/rejected current-R actions
base/edited state fingerprints
observable digest
```

Internal diagnostics remain opt-in and are collected only for mismatch/invalid edit.

## Integration Path

The only local-search path after this task:

```text
ProductMatchRunner baseline
-> RoundBoardStateFactory cache per-R states
-> LocalSearchService samples RoundBoardEdit combinations
-> SingleRoundEngine evaluates cloned state
-> BranchLibrary assesses forward expressibility
-> EvidenceWriter
```

`LocalSearchService` must not call `ProductGameSession` directly for ordinary single-round trials after migration. It receives a cached `RoundBoardState` and `SingleRoundEngine` result.

Old T112 sequence-replay helpers may remain as compatibility/diagnostic input only. They must not be the ordinary 16/32 candidate evaluation path.

## Equivalence Gate

For actual baseline matches, all reachable rounds, both sides, and at least six seeds:

```text
normal product round R
== no-edit RoundBoardState -> SingleRoundEngine R
```

Compare observable result:

```text
round winner
score delta / score after R
survivor instance IDs
HP/max HP
survivor counts / total HP
accepted/rejected current-R actions
```

Report actual number of match-round inputs. On failure write diagnostic trace/state only for the first divergence.

## Search Readiness Demonstration

For at least one all2rush adverse round with existing target units:

```text
- capture one base RoundBoardState once;
- run 16 candidate clones and show all share same base fingerprint;
- change an existing target unit's pre-battle coordinate through edit;
- prove no duplicate deployment occurs;
- show each candidate does not invoke tree traversal/re-search;
- compare no-edit against edited single-round observable outcome.
```

Do not execute broad multi-case optimization in this task. The next task will use this reusable engine for 16/32 unique board-state search.

## Evidence

Write:

```text
all2rush_g2_t113_round_state_schema.json
all2rush_g2_t113_baseline_states.jsonl
all2rush_g2_t113_equivalence.jsonl
all2rush_g2_t113_cache_reuse.jsonl
all2rush_g2_t113_mismatch_diagnostics.jsonl
all2rush_g2_t113_summary.json
```

## Acceptance

- [ ] `RoundBoardState` captures roster/IDs/badges/original positions/current pending actions/score/budget without transient previous-battle state.
- [ ] Factory builds state once from actual accepted product traces.
- [ ] No-edit state produces the same observable current-R outcome as normal product round.
- [ ] Candidates clone cached state rather than replaying/reinterpreting full tree.
- [ ] Existing target-unit reposition is a valid pre-battle state edit without duplicate deployment.
- [ ] Single-round engine settles exactly one round through authoritative product rules.
- [ ] No global/tier/L1/deployment change.

## Delivery

Write `TASKS/tree/T113.report.md` with architecture/call-path diagram; state schema; trace-to-state mapping; equivalence matrix; cache reuse/candidate proof; existing-unit reposition example; diagnostic count; tests; no-apply confirmation; changed files. Commit/push only `agent/tree`.
