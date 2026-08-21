STATUS: DONE
DOMAIN: tree
SUPERSEDES: T128-dynamic-t0-l1-l2-pilot-cycle

# T129 - Dynamic T0 Pilot: Real Three-Formation Measurement

## Objective

Finish the dynamic T0 L1/L2 pilot as a real measured program run, not a two-formation smoke test.

T128 establishes the package but must be corrected before its outputs can support a pool replacement decision:

```text
- default pool initialization hard-codes four formation IDs;
- L1 round-win metric counts absolute winner `1`, producing wrong target-side
  metric for target side 2;
- the test runs only 2 formations and low search budget;
- per-formation metrics omit proposal/invalid/duplicate/throughput/CPU/full
  validation cost required to judge search feasibility;
- candidate evaluation must prove it uses each entry's currentEvol snapshot and
  never silently resolves a pre-improvement evolution by formation ID.
```

Correct these in one integrated implementation pass, then run the actual three-formation L1/L2 pilot and publish real outcome/throughput data. No new architecture, event system, or task-specific outcome rules.

## 1. Dynamic Pool Truth

`DynamicPoolManager` initializes from the current dynamic active pool / formation registry programmatically. Do not store an in-code list such as:

```text
all2rush, golden_boom, all2prayer, gift_jungle
```

Use existing active formation/snapshot catalog APIs where possible. If a temporary bootstrap fallback is unavoidable because no dynamic pool exists, put IDs in a versioned data/config file, record `bootstrapSource` in `current_pool.json`, and ensure future updates load pool state rather than reselect IDs.

Behavior fingerprint must include canonical full behavior: node conditions, placement IDs/coordinates/order, badges and branches, not merely number of nodes/monster IDs.

Auto-selection chooses exactly up to 3 ACTIVE behavior-distinct entries using documented generic priority:

```text
missing metrics / lower combined score / fewer prior cycles / stable fingerprint
```

## 2. Snapshot-Correct L1/L2

L1/L2 evaluators must construct both strategies from the supplied `DynamicPoolEntry.currentEvol`; they may use resolver snapshots only for immutable team metadata and display IDs.

Add a test probe proving that a supplied entry with a deliberate isolated currentEvol branch produces a different strategy trace/output than the resolver's original formation evolution. Candidate L1/L2 must therefore measure the actual candidate snapshot.

Correct all target-side metrics:

```text
- target round wins/draws/losses normalize absolute winner by target side;
- target survivor/HP and W/D/L/Score70 use same target-side normalization;
- L1/L2 candidate comparison uses a single target-relative comparator.
```

## 3. Full Search/Cost Metrics

Expose from the consolidated cycle and record per formation:

```text
baseline product match count / wall time / process CPU time
adverse cases mined
proposals
invalid proposals
duplicate proposals
unique one-round trials
unique trials per second
one-round battle wall/CPU time
full-match source/paired validation count and wall/CPU time
actual branch selected/not-selected count
accepted / neutral / rejected / local-only candidate count
```

No artificial CPU work. CPU is a measured resource, not a target in this pilot.

## 4. Real Pilot Run

Run one actual batch with:

```text
maxPilotFormations: 3
all active behavior-distinct pool entries available for opponent selection
L1 seeds: at least 3 deterministic seeds
L2 seeds: at least 3 disjoint deterministic seeds
per-formation cycle: at least 2 iterations
uniqueCandidatesPerCase: at least 16
populationSize: at least 8
maxGenerations: at least 2
```

These are practical pilot settings, not a statistical certification requirement. Record exact config/sample counts and runtime.

Evaluate each selected formation against the same immutable `pool_before` revision. Apply replacements after all three decisions, ordered by generic combined comparator. A replacement requires:

```text
L1 non-regression
AND L2 non-regression
AND strict combined target-relative Score70/objective improvement
AND candidate contains at least one actual accepted pilot branch
```

No manual override for positive/negative outcome.

## 5. Broad Test and Evidence

One broad test must verify:

```text
- no hard-coded production pool list in dynamic_pool runtime;
- exactly 3 selected when >=3 active behavior-distinct entries exist;
- candidate currentEvol is used in L1/L2 rather than resolver original evol;
- side-2 round metrics are target-relative;
- full per-formation search/cost metrics exist and reconcile to cycle totals;
- replacements use same pool_before revision and are applied after batch;
- no R0/active production/tier/L1/deployment mutation.
```

Write complete artifacts under existing dynamic pilot layout, adding:

```text
selection_diagnostics.json
formation-XXX/performance_metrics.json
```

Summary must state actual three-formation result, including zero replacements if that is the measured result.

## Acceptance

- [ ] Dynamic pool and pilot selection are not runtime hard-coded to named formations.
- [ ] Actual 3-formation pilot completes with snapshot-correct L1/L2 evaluation.
- [ ] Target-side Score70/round/HP metrics are correct for both sides.
- [ ] Search throughput and product validation cost are measured per formation.
- [ ] Pool replacement decisions are automatic and evidence-backed.
- [ ] No active/global R0/tier/L1/deployment mutation.

## Delivery

Write `TASKS/tree/T129.report.md` with T128 correction table; pool bootstrap/discovery source; three-form selection table; L1/L2 before/candidate/after W-D-L-N/Score70; replacement table; complete per-formation search/cost metric table; cross-formation result; actual runtime; test/run result; artifacts; no-apply confirmation; changed files. Commit/push only `agent/tree`.
