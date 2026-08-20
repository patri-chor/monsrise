STATUS: OPEN
DOMAIN: tree
SUPERSEDES: T110-generation2-enforced-service-architecture

# T111 - Generation 2: Branch Coverage and Conflict Resolution

## Starting Point

T110 delivered one usable all2rush pilot orchestration path and recorded:

```text
6 queued loss cases
88 local trials
33 local L -> D/W improvements
4 exact branches created and fresh-pool confirmed
```

Use these outputs as the starting library. Do not restart architecture work or discard T110 branches solely because the candidate sampler is modest.

## Problem To Solve

T110 source/holdout evidence records branch selection only. It shows that two `gift_jungle` R5 branches can be selected on each other's non-source case. This may be valid reuse if observable results remain improved, or harmful over-broad matching if they regress.

The next decision is therefore not “create more branches first”; it is to determine the actual behavioral coverage of every existing branch and resolve ambiguous overlaps.

## Scope

```text
all2rush only
start from T110 exact branch library
no R0/global main/tier/L1/deployment changes
no broad engine parity rerun
```

## 1. Branch-by-Case Observable Evaluation

For each confirmed T110 exact branch, evaluate it against every T110 source and holdout case using the target-side product path.

For each `(branch, case)` row record:

```text
branch ID
case ID
isSourceCase
target/opponent snapshot fingerprints
side/seed/fork round
whether branch was selected
baseline final W/D/L and score
branched final W/D/L and score
baseline and branched roundResults
baseline and branched per-round survivor/HP digest
classification:
  SOURCE_REPRODUCED
  BENEFICIAL_REUSE
  NEUTRAL_REUSE
  HARMFUL_OVERLAP
  NOT_SELECTED
```

Classification is observable-result based:

```text
SOURCE_REPRODUCED: source branch retains recorded improvement
BENEFICIAL_REUSE: non-source selected and improves over baseline
NEUTRAL_REUSE: non-source selected with no material regression/improvement
HARMFUL_OVERLAP: non-source selected and worsens W/D/L, score, or observable
                 round trajectory against baseline
NOT_SELECTED: no runtime selection
```

## 2. Resolve Overlaps in Favor of Observable Results

For every case selected by multiple branches, evaluate each branch individually and the current runtime selection order.

Rules:

```text
- keep a shared branch only when it is SOURCE_REPRODUCED for its sources and
  BENEFICIAL_REUSE or NEUTRAL_REUSE on every additionally selected case;
- if a branch is HARMFUL_OVERLAP, narrow its legal condition/layout signature
  using only visible fork-round facts, or order a more specific winning branch
  before it;
- do not use opponent ID, seed, future information, or final outcome in a
  runtime condition;
- if no visible distinction can safely separate conflicting branches, retain
  only the branch with better aggregate observable result and archive the
  other as PRUNED_HISTORICAL with evidence.
```

The selected branch order must be deterministic:

```text
most-specific legal condition/layout
-> higher verified source coverage
-> better source aggregate observable result
-> stable branch ID tie-break
```

## 3. Validate Exact and Similar Semantics From Actual Cases

Use actual cases, not synthetic context mutation:

```text
- exact same source observable label/layout selects its branch and reproduces
  the source improvement;
- a case with different visible condition/layout cannot select that narrow
  branch;
- a truly shared visible label/layout may reuse a branch, but only after the
  section-1 observable evaluation classifies it beneficial or neutral;
- where a branch is not runtime-selected, it may be supplied as a marked
  warm-start candidate to the next local search; runtime remains unchanged.
```

## 4. Evidence and Result

Write append-only T111 evidence through the existing Generation 2 writer:

```text
all2rush_g2_t111_branch_case_matrix.jsonl
all2rush_g2_t111_overlap_resolution.jsonl
all2rush_g2_t111_branch_library.jsonl
all2rush_g2_t111_warm_start.jsonl
all2rush_g2_t111_summary.json
```

The summary contains counts of source reproductions, beneficial/neutral reuses, harmful overlaps, narrowed branches, pruned historical branches, and active branches.

## Acceptance

- [ ] Every T110 confirmed branch is evaluated against every T110 source/holdout case with observable outputs.
- [ ] Every non-source branch selection has an observable classification.
- [ ] Every harmful overlap is narrowed, ordered behind a better legal branch, or archived with evidence.
- [ ] Remaining active branches reproduce source improvements.
- [ ] Shared selection is retained only where observable result supports it.
- [ ] Exact/similar/warm-start claims use actual product cases.
- [ ] No global/tier/L1/deployment change.

## Delivery

Write `TASKS/tree/T111.report.md` with starting branch inventory; complete branch-case classification table; overlap resolutions; before/after active ordering; source reproduction results; warm-start rows; evidence counts; no-apply confirmation; changed files. Commit/push only `agent/tree`.
