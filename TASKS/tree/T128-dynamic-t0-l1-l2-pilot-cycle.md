STATUS: OPEN
DOMAIN: tree
SUPERSEDES: T127-generation2-autonomous-cycle-trainer

# T128 - Dynamic T0 L1/L2 Pilot Cycle

## Policy Change

Previous assumptions that T0/R0 formations are immutable benchmark anchors are obsolete for this optimizer.

Current required model:

```text
T0 = dynamic current strong-formation pool
T0 formations are learners and current baselines
Every optimizer cycle may improve a T0 formation
An accepted improved snapshot replaces that formation's current dynamic baseline
L1 and L2 are training/evaluation layers, not permission gates preventing T0 learning
```

Do not preserve old `T0 immutable`, `T0 isLearner=false`, or `L1 NOT_APPLICABLE` behavior in the new dynamic cycle. Historical source identity/fingerprint remains recorded for lineage/audit, but does not prevent current snapshot evolution.

## Goal

Implement one batch pilot cycle that automatically selects three behavior-distinct T0 formations, then trains and measures each through both:

```text
L1: dynamic-pool cross-formation melee
L2: T0 benchmark matrix
```

For every selected formation, the program must:

```text
current dynamic snapshot
-> L1/L2 baseline measurement
-> adverse-case discovery
-> cached RoundBoardState local search
-> candidate-local product validation
-> accept/reject improved snapshot
-> remeasure L1/L2 using accepted snapshot
-> write it back as that formation's next dynamic-pool baseline
```

The purpose is to establish real pilot data:

```text
per-formation L1/L2 improvement
cross-formation tradeoff
single-round search throughput / unique candidate yield
full-match validation cost
CPU/runtime per formation and per stage
```

Do not manually select a winning formation, opponent, coordinate, or branch. The program selects and retains snapshots through shared product outcome/Score70 comparisons.

## Scope and Architecture

Keep `scripts/run_generation2_optimizer_cycle.ts` and the consolidated 7-file cycle as the **per-formation optimizer**. Add a batch coordinator with at most five files:

```text
src/engine/tree/product_training/generation2/pool/
  types.ts
  dynamic_pool.ts
  l1_melee.ts
  l2_benchmark.ts
  t0_pilot_cycle.ts
  index.ts

scripts/run_dynamic_t0_l1_l2_pilot.ts
```

No parallel bulk/iterative/event runner revival. The pool coordinator calls the one consolidated cycle API for a formation; it does not duplicate RoundBoardState search or branch logic.

## 1. Dynamic Pool

`dynamic_pool.ts` owns one current-state file:

```text
reports/tree-cycle/dynamic-t0-pool/current_pool.json
```

Each pool entry includes:

```ts
formationId
rootSourceId
currentSnapshotFingerprint
previousSnapshotFingerprint | null
behaviorFingerprint
currentEvol / isolated snapshot reference
l1Metrics
l2Metrics
score70Aggregate
optimizationCycles
status: ACTIVE | REPLACED | RETAINED | ARCHIVED_DUPLICATE
lineage[]
```

Initialization:

```text
- resolve current T0/dynamic-pool candidates from current formation library;
- preserve root source identity;
- behavior-deduplicate current snapshots;
- do not silently use obsolete fixed T0 policy files as authority;
- if no dynamic pool file exists, create it from current T0 source formations.
```

Pool replacement rule for a formation:

```text
candidate snapshot replaces its own current pool snapshot only if it strictly
improves its combined L1/L2 shared objective without regression in either level.
Otherwise retain current snapshot and archive candidate evidence.
```

Never mutate the active production formation library or original R0 source record in this pilot.

## 2. Automatic Three-Formation Selection

The coordinator selects exactly up to three pilot entries programmatically:

```text
- ACTIVE entries only;
- exact behavior deduplication first;
- maximize behavior/archetype diversity where observable;
- prioritize entries with weaker combined L1/L2 Score70 or no prior metrics;
- deterministic tie-break: current snapshot fingerprint.
```

Record selection reason and pool size. Do not hard-code all2rush/all2prayer/gift_jungle, although they may naturally be selected.

## 3. L1 Dynamic-Pool Melee

For each target candidate/snapshot, L1 is product-path paired melee against the other dynamic-pool members:

```text
both sides
config-generated deterministic seed set
Score70=(W + 0.70*D)/N
per-opponent and aggregate outcome
```

Use the same normalized `ProductOutcome` comparator as the consolidated cycle. L1 output includes:

```text
W/D/L/N, Score70
round win/draw/loss totals
survivor/HP aggregates
per-opponent result
runtime/match count
```

## 4. L2 T0 Benchmark

For each target candidate/snapshot, L2 evaluates against the current dynamic T0 benchmark pool excluding itself:

```text
both sides
separate deterministic L2 seed set
same product outcome / Score70 comparator
```

This is not a frozen immutable T0 list. It uses the pool snapshot revision at the start of that pilot formation's evaluation and records it.

## 5. Per-Formation Optimization Cycle

For every selected T0 entry:

```text
A. record L1/L2 baseline
B. invoke consolidated optimizer cycle against config-generated relevant opponents
C. collect accepted isolated pilot branches/snapshot candidate from cycle
D. record candidate L1/L2 on the same paired matrices
E. decide candidate vs its parent using combined objective:
   1. no L1 regression
   2. no L2 regression
   3. strictly improve combined Score70, then W/D/L, rounds, survivor/HP
F. replace or retain in dynamic pool
G. record search / validation / CPU-runtime accounting
```

A cycle with no accepted branch is a retained result, not a failure. A local-only result remains local search evidence and cannot replace a pool snapshot by itself.

The candidate’s L1/L2 comparison uses the same pool revision as its baseline. Do not compare against a pool that has already changed due to another pilot in this batch; apply accepted replacements only after all three evaluations complete, ordered by combined objective and then fingerprint.

## 6. Search and Resource Metrics

For every selected formation and each optimizer iteration record:

```text
baseline L1/L2 match count and runtime
adverse cases mined
one-round candidate proposals / invalid / duplicate / unique evaluated
unique candidates per second
local loss->draw / draw->win / loss->win / HP-only changes
full-match candidate validations and runtime
branch selected / not selected counts
accepted / neutral / rejected / local-only candidate counts
candidate L1/L2 W/D/L/N / Score70
combined before/after Score70
pool replacement decision/reason
```

No artificial CPU spin. Record normal process CPU time and wall time; T127-style autonomous continuous scheduling is deferred until this pilot yields practical throughput measurements.

## 7. Artifacts

```text
reports/tree-cycle/dynamic-t0-l1-l2-pilot/<run-id>/
  config.json
  pool_before.json
  pilot_selection.json
  l1_matrix_baseline.jsonl
  l2_matrix_baseline.jsonl
  formation-XXX/
    cycle/                 # existing consolidated-cycle artifacts
    l1_before.json
    l2_before.json
    l1_candidate.json
    l2_candidate.json
    search_metrics.json
    decision.json
  pool_after.json
  aggregate.json
  by_formation.jsonl
  by_level.jsonl
  summary.json
```

`current_pool.json` is updated only after the whole batch decision stage and contains snapshot lineage/metric revisions.

## 8. Broad Pilot Verification

Implement first, then run one actual three-formation L1/L2 pilot plus one broad test. Verify:

```text
- exactly up to 3 behavior-distinct ACTIVE dynamic-pool entries chosen without
  hard-coded formation names;
- each formation receives actual L1 and L2 before/candidate outcomes;
- both levels use product path, both sides and disjoint deterministic seed sets;
- per-formation optimizer invokes the consolidated cycle rather than duplicate
  local search;
- candidate replacement is judged against its own immutable parent/pool revision;
- replacements are applied only after all pilot evaluations;
- rejected/local-only/neutral candidates do not alter pool;
- L1/L2/combined Score70 values are recomputable;
- search count/throughput and product validation costs are recorded;
- active production/R0 source data remain unchanged.
```

No assertion depends on specific selected formation, exact winner, positive improvement count, or exact throughput.

## Acceptance

- [ ] T0 becomes a dynamic learnable pool in this optimizer path.
- [ ] Three auto-selected behavior-distinct T0 formations complete L1/L2 pilot cycles.
- [ ] Per-formation improvements and search performance are measured with real product outcomes.
- [ ] Only objectively better no-regression snapshots replace dynamic pool entries.
- [ ] The existing consolidated cycle remains the only local optimizer authority.
- [ ] No active/R0/tier/L1 production policy mutation outside isolated dynamic pool pilot state.

## Delivery

Write `TASKS/tree/T128.report.md` with dynamic-policy change; pool selection table; L1/L2 before/candidate/after Score70 W-D-L-N table; replacement decisions; per-formation search/throughput/cost table; cross-formation effects; artifact paths; broad test + real pilot outcome; no-active-apply confirmation; changed files. Commit/push only `agent/tree`.
