STATUS: OPEN
DOMAIN: tree
SUPERSEDES: T113-generation2-round-board-state-architecture

# T114 - Generation 2: Unique Round-Board Search for All2Rush

## Starting Point

T113 delivered the usable single-round foundation:

```text
baseline product match
-> actual accepted deployment traces
-> cached RoundBoardState for R
-> clone/edit state
-> SingleRoundEngine executes only R battle
```

Use this path directly. Do not redesign the engine, replay whole games per trial, or re-walk the formation tree for every candidate.

## Goal

Run the first real all2rush local tactical search using unique edited current-round board states, and compare 16 versus 32 unique candidates.

The target is not a global formation replacement. It is to find which current-round counterfactual layouts turn a concrete lost/drawn round into a better observable round outcome.

## Scope

```text
all2rush only
up to 3 active/pinned opponents
up to 2 adverse target-side rounds per opponent
no R0/global main/tier/L1/deployment change
```

Use current selected snapshots where available. Retain T110/T113 historical evidence.

## 1. Baseline Round Cases

For selected all2rush opponent matches, capture all `RoundBoardState` values once from real baseline product matches.

Select at most six adverse target-side round cases, ranked by:

```text
round loss before round draw
larger score deficit after round
earlier adverse round
```

Each case records:

```text
case ID
target/opponent snapshot and policy fingerprints
side, seed, target R
base RoundBoardState fingerprint
baseline R winner/score delta/score after R
baseline survivors, HP/max HP, total HP and observable digest
```

## 2. Unique Board-Edit Candidate Generator

Add/complete a seeded generator in `LocalSearchService` that consumes one cached `RoundBoardState`.

Candidate variables, target-side only:

```text
A. reposition one existing deployed unit
B. reposition one current-R pending deployment
C. reorder current-R pending actions
D. combinations of 1..3 of A/B/C
```

Rules:

```text
- generate proposal with persisted random seed and draw index;
- clone base state and apply edit proposals;
- validate bounds, target zone, collision, identity and budget;
- canonicalize the fully edited RoundBoardState;
- `stateFingerprint` is the uniqueness key;
- duplicate/invalid proposals are recorded but neither executed nor counted;
- a budget counts only unique valid edited states;
- never modify opponent-side board/action.
```

Use actual existing deployed units as reposition candidates. This is the main new search dimension absent from tree-only placement search.

## 3. 16 vs 32 Experiment

Run a deterministic proposal stream for each case:

```text
Budget 16: execute first 16 unique valid state fingerprints
Budget 32: continue the same stream through first 32 unique valid fingerprints
```

If legal space exhausts sooner, report actual count and reason.

For every executed candidate record:

```text
case ID, source state fingerprint, edited state fingerprint
random seed/draw index
one to three concrete edits
round winner and score delta/after score
survivor stable IDs + HP/max HP
total HP/survivor count
observable digest
comparison classification
```

Classify relative to baseline target-side result:

```text
ROUND_WIN_IMPROVEMENT
ROUND_DRAW_IMPROVEMENT
HP_SURVIVOR_IMPROVEMENT
NO_IMPROVEMENT
```

A same winner/result can be an `HP_SURVIVOR_IMPROVEMENT` only when target side's survivor count or total HP is strictly higher without increasing opponent total HP.

Report for each case:

```text
proposal count
invalid count
duplicate count
unique count
16 best result
32 best result
new distinct improvement count from positions 17..32
runtime per candidate
```

## 4. Local Solution Selection

Keep every behavior-distinct improvement. Behavior identity is the edited state fingerprint plus observable digest.

Within each case:

```text
- remove only exact same state/result duplicates;
- retain non-dominated alternatives;
- select one best representative using result class, then target score delta,
  then target HP/survivor outcome, then fewer edits, then stable fingerprint.
```

Record all retained local solutions. Do not create runtime branches in this task.

For up to one representative per adverse case, optionally run a full-match continuation check after the single-round result. Record it as informational only:

```text
CONTINUATION_IMPROVES
CONTINUATION_NEUTRAL
CONTINUATION_REGRESSES
NOT_RUN
```

## 5. Focused Equivalence Use

Do not repeat a broad engine redesign. Add only a focused regression around the actual selected baseline cases:

```text
normal product R observable result
== no-edit cached RoundBoardState -> SingleRoundEngine result
```

Compare winner, score delta/after score, survivors and HP/max HP, total HP, and current-R accepted/rejected actions. This ensures the particular states searched are trustworthy.

## Evidence

Write append-only records through EvidenceWriter:

```text
all2rush_g2_t114_round_cases.jsonl
all2rush_g2_t114_proposals.jsonl
all2rush_g2_t114_unique_trials.jsonl
all2rush_g2_t114_budget_16_vs_32.jsonl
all2rush_g2_t114_local_solutions.jsonl
all2rush_g2_t114_continuation_checks.jsonl
all2rush_g2_t114_summary.json
```

## Acceptance

- [ ] All ordinary candidate evaluations clone cached RoundBoardState and execute exactly one R battle.
- [ ] Existing deployed-unit reposition is represented and searched legally.
- [ ] 16/32 budgets count only unique valid edited state fingerprints.
- [ ] Observable output comparisons include round result, score, survivors and HP.
- [ ] Per-case 16 vs 32 marginal results are recorded.
- [ ] Behavior-distinct improvements are retained and compared before selecting a representative.
- [ ] No runtime/global strategy deployment occurs.

## Delivery

Write `TASKS/tree/T114.report.md` with selected case table; base-state reuse proof; unique/invalid/duplicate accounting; 16-vs-32 comparison; local solution table with actual edits; optional continuation results; focused equivalence results; artifact counts; no-apply confirmation; changed files. Commit/push only `agent/tree`.
