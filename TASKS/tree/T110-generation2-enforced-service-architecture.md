STATUS: OPEN
DOMAIN: tree
REISSUE: T110
SUPERSEDES: T109-generation2-architecture-consolidation

# T110 - Generation 2 All2Rush Pilot Orchestration

## Result-Oriented Goal

Use the Generation 2 modules already created by T109 to run a clear, maintainable all2rush multi-case local-optimization pilot.

Do not spend this task chasing architectural purity. Retain and build on the working `generation2/` services. Refactor only where a real ambiguity blocks execution, produces incorrect observable results, loses evidence, or causes duplicate/competing pilot flows.

## Existing Assets to Reuse

```text
product_match_runner.ts: normalized product observable results
round_checkpoint_service.ts: checkpoint/session helpers
loss_case_service.ts: loss-case queue and severity ranking
local_search_service.ts: local candidate evaluation
branch_library.ts: branch representation and attachment
evidence_writer.ts: evidence output helper
```

The target outcome is one understandable orchestration path, not a source-import audit exercise.

## Minimal Flow

Create or complete one callable pilot entry in `generation2/index.ts`:

```text
pin selected all2rush + opponents
-> build ranked loss queue
-> for each queued loss case: sample/evaluate local candidates
-> retain confirmed local improvements as exact branches
-> evaluate source cases and a small holdout
-> write evidence and return pilot summary
```

This entry must be the path used by the T110 test and artifacts. Existing helper exports may remain for compatibility.

## Pilot Scope

```text
all2rush only
up to 3 selected opponents
up to 2 target-side loss/draw cases per opponent
up to 48 unique legal candidates per case
```

Use current selected snapshots where available. Reuse pinned T107/T108 snapshots only when their fingerprints still match selection; otherwise record the new selected snapshot fingerprint.

No R0 mutation, global main replacement, tier/L1 change, or deployment is permitted.

## Search Behavior

For every queued case:

1. Use the actual pre-adverse-round checkpoint.
2. Generate distinct legal candidate changes from available existing local search machinery.
3. Prefer broader variable coverage where cheaply available, but do not block on an ideal catalog rewrite. At a minimum record the actual variable choices and candidate behavior fingerprints.
4. Compare candidates to baseline by observable output:

```text
final target W/D/L
final score
roundResults
per-round survivor/HP digest
```

5. A candidate is an improvement when it changes `L -> D/W` or `D -> W`.
6. Same-outcome trajectory improvements may be saved only as warm-start evidence, not an executable exact branch.

A valid result is `NO_LOCAL_IMPROVEMENT_FOUND`; do not create a branch unless a real improvement exists.

## Branch Behavior

For each improved candidate:

```text
create a narrow exact-case branch from legal visible observation
confirm it once through a fresh worker/pool boundary
prove source case selects the branch and reproduces improved observable result
```

Exact legal observation may execute a confirmed branch. Similar observation must not automatically execute it; it may be offered only as an explicit warm-start input to local candidate generation.

Do not merge branches unless two genuine improved branches have a shared executable prefix and source-case checks show no loss. Otherwise retain exact branches independently.

## Evidence

Use the existing EvidenceWriter where practical. Write T110 artifacts:

```text
all2rush_g2_t110_pilot_manifest.json
all2rush_g2_t110_loss_queue.jsonl
all2rush_g2_t110_trials.jsonl
all2rush_g2_t110_branch_library.jsonl
all2rush_g2_t110_source_holdout_eval.jsonl
all2rush_g2_t110_summary.json
```

Every trial/branch row records:

```text
case ID, target/opponent snapshot fingerprints, side, seed, fork round,
candidate behavior fingerprint, selected variables, baseline/result W/D/L,
score, roundResults, HP digest, and branch status where applicable.
```

## Acceptance

- [ ] T110 uses one documented Generation 2 orchestration call from `index.ts`.
- [ ] A ranked multi-case all2rush queue is processed with recorded observable baselines.
- [ ] Each processed case gets bounded distinct local trials or documented exhaustion.
- [ ] Every branch represents an actual local improvement and has fresh-boundary confirmation.
- [ ] Source and holdout observable results are reported.
- [ ] No-improvement is recorded honestly if that is the result.
- [ ] No R0/global/tier/L1/deployment modification.

## Delivery

Write `TASKS/tree/T110.report.md` with the orchestration call path; selected fingerprints; loss queue; per-case trial/improvement counts; branch confirmation; source/holdout observable comparison; artifact row counts; test commands; no-apply confirmation; and changed files. Commit/push only `agent/tree`.
