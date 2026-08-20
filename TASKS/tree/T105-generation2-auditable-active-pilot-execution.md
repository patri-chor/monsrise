STATUS: DONE
DOMAIN: tree
SUPERSEDES: T104-generation2-active-snapshot-worker-determinism-and-pilot-run

# T105 - Generation 2: Auditable Active All2Rush Pilot Execution

## T104 Disposition

T104's focused test passes, but its raw artifacts do not substantiate its claimed evidence-valid pilot.

Verified failures:

```text
- pilot manifest uses t0:* directly; it contains no active-library expected,
  resolver, prepared payload, worker-task, or worker-result fingerprint chain;
- worker evidence has only three aggregate W/D/L records, with no worker ID,
  trace, opponent payload/policy, task payload, or result payload fields;
  two pool dispatches do not prove distinct workers;
- local trial artifact has only 14 fixed-template candidates, all L -> L;
  it omits search seed, legal-space accounting, selected action variables,
  checkpoint, policy/payload identity, worker identity, and raw result links;
- T104 source LossCase is Side 2, but branch test calls buildRoundContext(1),
  so it does not prove all2rush's source-side exact branch selection or outcome;
- similar observation is fabricated by changing `ctx.side`; there is no real
  similar legal observation or tested warm-start input/output behavior.
```

T105 is the single next integer task. It combines those corrections with the first auditable all2rush local pilot execution. Do not execute T104 separately.

## Scope

```text
all2rush only
no R0 mutation
no global main/tier/L1/deployment change
no root fallback, arena.ts, or playSpecVsSpec
```

## 1. Pin an Actual Active Pilot Manifest

Discover the current active all2rush and selected active opponents through the active strength library / current product manifest. Do not hard-code `t0:*` unless the active record itself declares that exact R0 snapshot.

For every participant persist and enforce:

```text
formation ID
active-library expected snapshot fingerprint
SnapshotResolver resolved fingerprint
prepared product evol/payload fingerprint
calculator policy fingerprint
worker task target/opponent payload and policy fingerprints
worker result echoed target/opponent payload and policy fingerprints
product/manifest revision
```

All equality checks must run before aggregation. Resolver/identity failures write an append-only quarantine row with source/path/line/reason and fail that case. Never silently skip an opponent.

## 2. Real Worker Determinism, With Worker Attribution

Extend actual product worker protocol/result so every run returns:

```text
workerId or stable worker-instance nonce
product task ID
all target/opponent identity fields
winner/WDL
roundResults
accepted/rejected trace digest
branch IDs and planned/actual coordinate digest
observation digest
```

Use explicit worker-affinity or an observable dispatch mechanism to prove:

```text
same fixed target-side task, same worker, 10 sequential executions
same task on two confirmed distinct worker IDs
pool destroy/recreate, then same task
```

Compare all listed raw fields, not aggregate W/D/L only. Persist one row per run and a separate comparison row. A mismatch is `SINGLE_CASE_UNSTABLE`; block single-game continuation discovery.

## 3. Target-Side Correct Loss Cases and Branch Proof

A LossCase records `targetSide` and all subsequent context/strategy/trace operations must use that side. Add guards so target-side confusion is impossible.

For any improved branch, prove in an actual restored product session:

```text
- buildRoundContext(lossCase.targetSide) is used;
- target-side strategy trace selects stored exact branch ID;
- target-side intents are applied against opponent-side intents;
- full continuation reproduces recorded branch W/D/L and trace digest.
```

If no candidate improves, report `NO_LOCAL_IMPROVEMENT_FOUND`; do not fabricate a branch test using non-improved or opponent-side context.

## 4. Seeded, Legal Candidate Search

Implement persisted-seed sampling from a checkpoint-derived legal variable catalog.

Attempt up to 48 unique behavior fingerprints per eligible loss case, or record legal-space exhaustion. Every trial row includes:

```text
search seed and draw index
legal-space size and candidate behavior fingerprint
1..3 concrete chosen variables/action deltas
candidate policy fingerprint
checkpoint fp, target side, seed, fork round
all exact active/product/worker identity fields
raw product worker result/trace reference
baseline and candidate W/D/L plus improved flag
```

A full 48 is not a requirement where legal candidates exhaust below it, but a fixed 14-item hard-coded template is not sampling.

## 5. Real Similar-Case Warm Start

Create a second legal observation from a distinct product case that is similar but non-identical based only on visible information. Prove:

```text
exact case -> exact branch executes
similar case -> exact branch does not execute
similar case -> branch delta appears as an explicitly marked warm-start input
                to bounded candidate generation
```

Warm start must not mutate runtime strategy selection, inject hidden fields, or automatically apply the narrow branch. Assert none of seed, opponent ID, future state/outcome, or hidden state exists in runtime condition/layout signature.

## 6. Execute and Report Pilot Honestly

Only after determinism passes, execute the first eligible active all2rush loss case(s). A valid completion may report no improvement. It may create `EXACT_CASE_BRANCH` only after source-side continuation reproduction and a fresh worker/pool confirmation.

Any merge needs source-case validation and no empty/default condition. Preserve all pruned historical entries.

## Evidence

Write T105 append-only artifacts:

```text
all2rush_g2_t105_active_manifest.json
all2rush_g2_t105_identity_quarantine.jsonl
all2rush_g2_t105_worker_runs.jsonl
all2rush_g2_t105_worker_comparisons.jsonl
all2rush_g2_t105_loss_cases.jsonl
all2rush_g2_t105_local_trials.jsonl
all2rush_g2_t105_branch_runtime.jsonl
all2rush_g2_t105_warm_start.jsonl
all2rush_g2_t105_merge_prune.jsonl
```

## Acceptance

- [ ] Exact active snapshot chain reaches both worker task and result.
- [ ] 10 same-worker plus two proven-distinct-worker plus recreated-pool product runs match full raw evidence.
- [ ] Every loss/branch operation uses targetSide, enforced by types/guards/tests.
- [ ] Candidate search is seeded, legal, identity-complete, and non-template.
- [ ] Exact branch outcome is proven from target-side context, or no-improvement is explicitly evidenced.
- [ ] Similar-case warm start is real, separate, and cannot trigger narrow runtime execution.
- [ ] No silent resolver skip and no global/tier/L1/deployment change.

## Delivery

Write `TASKS/tree/T105.report.md` with active manifest identities; per-run worker table and raw-digest comparison; target-side proof; loss/candidate/trial distributions; improvement or no-improvement result; exact/similar/warm-start trace evidence; merge/prune state; quarantine/evidence counts; tests; no-apply confirmation; changed files. Commit/push only `agent/tree`.
