STATUS: DONE
DOMAIN: tree
SUPERSEDES: T115-generation2-complete-single-round-optimizer

# T116 - Generation 2: Diverse Local Search and Solution Selection

## Starting Point

T115 completed the usable end-to-end single-round optimizer and produced real cached-board results:

```text
6 adverse cases
192 unique one-round trials
48 recorded local improvements
3 cases with loss -> draw improvement
```

Keep and reuse the T113 cached RoundBoardState / SingleRoundEngine and T115 optimizer. Do not restart architecture or repeat engine construction.

## Why This Next Iteration Is Needed

T115 is a useful first pilot, but its result set shows three material search-quality gaps:

```text
1. Baseline severity ranking selected six cases concentrated on all2prayer,
   rather than enforcing the intended maximum two cases per opponent.
2. Candidate generation chooses one edit per proposal in the current code path,
   despite the intended 1..3 compatible edit search.
3. Local solution extraction collapses by observable digest alone and leaves all
   retained improvements marked non-dominated. Different board states can share
   an observable digest and must remain distinguishable; actual dominance must
   be calculated before representative selection.
```

T116 is a single cohesive search-quality iteration: diverse case selection, genuine 1..3-edit search, behavior-correct solution sets, and result-driven representative validation.

## Goal

Produce a diverse, non-duplicative set of all2rush current-round tactical solutions, then verify the best representative from each opponent/case with an optional whole-match continuation.

No global/main/tier/L1/deployment application is permitted.

## 1. Diverse Baseline Selection

Use real cached RoundBoardStates from baseline product matches. Select at most:

```text
3 opponents
x 2 adverse target-side cases per opponent
= 6 cases
```

First rank cases per opponent by:

```text
round loss before draw
larger post-round target score deficit
earlier adverse round
```

Then take the top two per opponent before constructing the global queue. A missing opponent/case is explicit evidence, not replacement by a third case from another opponent.

Retain actual selected opponent distribution in manifest and summary.

## 2. Genuine Compatible 1..3 Edit Search

Replace single-edit-only proposal generation with seeded combinations sampled from each cached state’s real available target-side edits:

```text
REPOSITION_DEPLOYED_UNIT(instanceId, x, y)
CHANGE_PENDING_PLACEMENT(action identity, x, y)
REORDER_PENDING_ACTIONS(order)
```

For each draw:

```text
- sample desired edit count 1, 2, or 3;
- select compatible edit targets without contradictory edits to same unit/action;
- select legal target-zone coordinates and valid pending order;
- compose all selected edits into one candidate;
- canonicalize cloned state and use its stateFingerprint as uniqueness key.
```

Ensure the executed 32-candidate stream has explicit recorded distribution for one-, two-, and three-edit candidates. If a state cannot produce a legal 2/3-edit combination, report its concrete catalog limitation rather than filling with duplicates.

Run the same deterministic 16-prefix / 32-full stream for every case.

## 3. Correct Local Solution Identity and Dominance

A local solution identity is:

```text
editedStateFingerprint + observable digest
```

Do not deduplicate by observable digest alone. Different edited states yielding the same outcome remain different tactical alternatives.

Within each case, calculate Pareto dominance using:

```text
improvement class rank
round score delta for target and opponent
own survivor count
own total HP
opponent survivor count
opponent total HP
number of edits
```

A solution is dominated only if another solution is no worse on every relevant battle metric and strictly better on at least one, with edit count used only as a tie-break when battle metrics are equal.

Persist all candidates with fields:

```text
isDominated
dominatedBySolutionId or N/A
isRepresentative
representativeReason
```

Representative selection uses best result class, then Pareto non-dominated status, score, own survivor/HP, opponent survivor/HP, fewer edits, stable fingerprint.

## 4. Representative Full-Match Check

For the best non-dominated representative of every case that is legally forward-expressible:

```text
- compile/apply the corresponding legal action change at its actual decision
  point when possible;
- run baseline and altered full product match with same seed/opponent;
- record final W/D/L, score, roundResults, and per-round HP digest;
- classify CONTINUATION_IMPROVES, CONTINUATION_NEUTRAL, or
  CONTINUATION_REGRESSES.
```

For layout changes that require earlier hidden/non-visible context, mark them `LOCAL_ONLY` and do not force an invalid runtime branch.

This is a validation of selected representatives only, not a full-match evaluation of every one-round trial.

## 5. Keep Existing Evidence, Add T116 Revisioned Artifacts

Write:

```text
all2rush_g2_t116_manifest.json
all2rush_g2_t116_baseline_cases.jsonl
all2rush_g2_t116_edit_catalog.jsonl
all2rush_g2_t116_proposals.jsonl
all2rush_g2_t116_unique_trials.jsonl
all2rush_g2_t116_budget_16_vs_32.jsonl
all2rush_g2_t116_local_solutions.jsonl
all2rush_g2_t116_representative_continuations.jsonl
all2rush_g2_t116_summary.json
```

Each trial includes case/opponent distribution, base/edited state fingerprint, search seed/draw, 1..3 concrete edits, round output and improvement class. Every solution includes dominance and representative fields.

## Verification

Focused tests must prove:

```text
- max two selected cases per opponent and actual 3-opponent distribution where
  adverse cases exist;
- 16 executed stream is exact prefix of 32;
- executed candidates have unique edited state fingerprints;
- 1-, 2-, and 3-edit executed candidates occur where each legal catalog allows;
- no contradictory edits occur in one candidate;
- same observable digest with different state fingerprints is retained as
  distinct alternatives;
- dominance flags/dominator references are consistent;
- representatives are non-dominated;
- selected full-match continuation checks are recorded without applying runtime
  changes.
```

## Acceptance

- [ ] Search cases are diverse by opponent, not concentrated through global rank.
- [ ] Search genuinely evaluates compatible 1..3-edit board states.
- [ ] Local solution identity and dominance are correct and auditable.
- [ ] 16/32 marginal results are available per selected diverse case.
- [ ] Forward-expressible representatives have a limited full-match validation.
- [ ] No global/tier/L1/deployment modification.

## Delivery

Write `TASKS/tree/T116.report.md` with T115-to-T116 change summary; selected opponent/case table; edit-count distribution; unique/proposal accounting; 16-vs-32 results; full solution/dominance table; representative continuation table; evidence counts; tests; no-apply confirmation; changed files. Commit/push only `agent/tree`.
