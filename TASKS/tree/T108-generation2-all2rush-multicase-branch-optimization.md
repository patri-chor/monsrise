STATUS: OPEN
DOMAIN: tree
SUPERSEDES: T107-generation2-bulk-observable-round-parity-and-all2rush-search

# T108 - Generation 2: All2Rush Multi-Case Branch Optimization

## Starting Point

T107 has completed the broad observable single-round fidelity gate. Treat the round-session/checkpoint mechanism as available for Generation 2 local discovery.

T108 begins the actual concentrated optimization phase for `all2rush` only:

```text
one concrete loss/draw case
-> earliest observable adverse round
-> repeated local trial from exact pre-round checkpoint
-> retain every local improvement as narrow legal branch
-> proceed to the next loss case
-> later merge only proven common prefixes
```

This task must not repeat the broad engine-parity matrix except when a candidate produces an observable mismatch. Do not mutate the global main tree, R0, tier/L1 policy, or game deployment.

## Scope and Inputs

Use the currently selected all2rush snapshot and current active opponents. Record formation and calculator-policy fingerprints for every input. T107's pinned test snapshots may be reused only where their recorded fingerprint still matches current selection.

Select up to:

```text
3 worst current opponents
x 2 target-side loss/draw cases per opponent
= 6 LossCases maximum
```

Use both sides when their loss cases differ. A case is keyed by exact target/opponent snapshot, side, deterministic seed, fork round, and pre-round checkpoint fingerprint.

## 1. Loss-Case Queue

Rank opponent cases by current target-side observable loss severity:

```text
loss before draw
larger final score deficit
earlier first adverse round
```

For each selected case identify the earliest round at which target-side observable trajectory first becomes adverse. Persist baseline:

```text
case ID
rank/reason
target/opponent snapshot and policy fingerprints
side/seed/fork round/checkpoint fingerprint
baseline final W/D/L, score, roundResults
per-round observable survivor/HP digest
legal visible target-side observation at fork
```

## 2. Concentrated Branch-First Search

Process cases in priority order. For each case generate up to 48 unique legal candidates from the pre-round checkpoint using persisted search seed.

Sample 1..3 compatible variables from actual legal catalog:

```text
R placement/action choice and coordinate
same-round deployment ordering
R+1/R+2 deployment action/timing when reachable
whitelisted calculator-policy choice
complete serializable tree action-subtree delta
```

Use checkpoint continuation and target-side product evaluation. A candidate result is compared with its exact baseline using observable outputs:

```text
final target W/D/L
final score
roundResults
per-round survivors/HP digest
```

Preference order:

```text
L -> W
L -> D
D -> W
same final W/D/L with a strictly later adverse round or better observable
score/HP trajectory, retained only as warm-start evidence
```

When a case yields an improvement, retain the local solution and then continue to the next highest-priority unresolved case. Do not replace an earlier narrow branch with a later one merely because they differ.

## 3. Exact Branch Library

Every confirmed local improvement first becomes `EXACT_CASE_BRANCH` containing:

```text
branch ID
parent all2rush fingerprint
candidate behavior/policy fingerprint
source case IDs and observable baseline/improvement evidence
fork round
minimal legal FeatureMask
optional canonical visible-layout signature
executable action subtree
source-side exact replay result
coverage and confirmation count
```

Exact matching legal observation/layout may select the branch first. Similar observations must not automatically execute it; they can submit the branch action delta as an explicitly marked warm-start candidate for their own bounded local search.

Confirm each new exact branch once after a fresh worker/pool boundary before it is active in the pilot branch library.

## 4. Multi-Case Reuse, Merge, and Prune

Once at least two exact branches exist:

```text
- evaluate each against every source case it claims to cover;
- look for identical executable R..K prefixes and a legal generalized visible
  condition derived from those source observations;
- create MERGED_PREFIX_BRANCH only when every originating case retains its
  improved observable result;
- otherwise retain individual branches.
```

Prune only behavior duplicates, proven dominated branches, or illegal/future-visible conditions. Preserve all historical records and source evidence. Never merge to an empty/default condition in this task.

## 5. End-of-Task Evaluation

Evaluate only the branch-library pilot version against the selected source cases and a small holdout of matching/nonmatching active cases. Report:

```text
per-source baseline vs exact-branch observable result
holdout results
exact branch hit count
similar warm-start count
merge/prune outcomes
```

This is local branch-library evidence only. It must not trigger global main, tier, L1, or deployment adoption.

## Evidence

Append T108 evidence:

```text
all2rush_g2_t108_loss_queue.jsonl
all2rush_g2_t108_trials.jsonl
all2rush_g2_t108_branch_library.jsonl
all2rush_g2_t108_branch_confirmations.jsonl
all2rush_g2_t108_reuse_merge_prune.jsonl
all2rush_g2_t108_source_holdout_eval.jsonl
```

Each row preserves source identities, side/seed/fork checkpoint, search seed/candidate variables, observable baseline/result output, and branch action where applicable.

## Acceptance

- [ ] At most six ranked target-side cases are recorded with complete observable baselines.
- [ ] Each processed case gets up to 48 seeded, distinct, legal candidate trials or documented legal-space exhaustion.
- [ ] Local improvements are stored first as exact legal branches and confirmed across a fresh worker/pool boundary.
- [ ] Similar observations only receive warm-start input, never automatic narrow branch selection.
- [ ] Merge/prune is evidence-based and preserves history.
- [ ] Source and holdout evaluations report observed behavior without global adoption.
- [ ] No R0/global main/tier/L1/deployment modification.

## Delivery

Write `TASKS/tree/T108.report.md` with input fingerprints; ranked loss queue; per-case candidate/trial/improvement counts; branch table; confirmation outcomes; exact/similar hit counts; merge/prune decisions; source/holdout comparison table; evidence row counts; tests; no-apply confirmation; changed files. Commit/push only `agent/tree`.
