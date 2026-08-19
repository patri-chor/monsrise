STATUS: OPEN
DOMAIN: tree

# T047 - Read-Only Audit of Perfect Win Rates and Benchmark Integrity

> Domain: `tree` | Executor branch: `agent/tree`
> This is a read-only forensic audit assigned for independent review. Do not alter training policies, thresholds, tiers, source formations, candidate artifacts, benchmark manifests, web export, runtime catalog, or rerun long-duration training. Do not apply/deploy/publish. The purpose is to explain or invalidate suspicious 100% win-rate results before they influence decisions.

## Audit Trigger

Several current aggregate training/library records report 100% scores, while the historic 11x11 round-robin matrix had a highest aggregate score around 80%. This is suspicious until provenance, sample distribution, seed independence, opponent coverage, and scoring arithmetic are independently reconciled.

Do not assume either result is wrong. Determine whether they are comparable, and if not, state exactly why.

## Questions to Answer

### 1. Enumerate Every Perfect Result

Find every current record with exactly `score=1`, pure win-rate `1`, or equivalent perfect W/D/L across:

```text
T037 observations/cells
T039 stage screen records
T040 benchmark cell/vector records
T041R/T042 melee records/catalog evidence
T045 current formation strength library / learning-level evaluations
```

For every perfect result, report:

```text
formation ID / fingerprint / root T0 source
candidate or T0 role
learning level / benchmark revision / opponent pool identity
exact W/D/L and score formula
total games / games per cell / opponent x side coverage
sample tier and seed set
execution mode / product entry provenance
whether result is raw measured, inherited/copied, or derived
```

### 2. Independently Recompute Arithmetic

From raw cell or pair records, independently recompute each reported perfect result:

```text
total W/D/L
total game count
score
pure win rate
per-opponent / per-side minima
```

Flag any mismatch, missing raw record, reused aggregate, or report/catalog field that cannot be traced to raw inputs.

### 3. Detect Evaluation Leakage and Degeneracy

Specifically audit for:

```text
candidate evaluated against itself or exact same fingerprint
candidate/fingerprint accidentally used as both opponent and learner
T0 vs T0 matrix diagonal included as positive evidence
same seed reused across all supposedly independent games/cells
single-game Stage A score presented as final strength
same raw vector reused under multiple candidate IDs or benchmark revisions
opponent resolution falling back to wrong/default formation
empty/invalid opponent or placement failure counted as win
worker errors silently treated as wins or omitted from denominator
P1/P2 coordinate/strategy mismatch that trivially benefits one side
incorrect score aggregation or denominator
```

### 4. Compare With Historic 11x11 Correctly

Inspect the historic 11x11 report and its implementation path. It is known to be sandbox-era (`arena` / `playSpecVsSpec`) and must be labelled:

```text
SANDBOX_ENGINE_UNVERIFIED_PRE_T032
```

Produce a comparison table separating, not combining:

```text
historic 11x11 sandbox matrix
T037 current product-path held-out panel
T044/T045 L2 frozen-T0 evaluation
T042 L1 probabilistic melee
```

For each, show:

```text
execution path
formation versions (including historical 7-monster vs repaired 8-monster Gift Jungle)
opponent count and selection rule
P1/P2 coverage
games per cell/pair and seeds
scoring formula
whether it supports a claim of absolute strength
```

### 5. Statistical Plausibility and Required Repair Boundary

For each perfect result, state whether its sample size and opponent diversity make it:

```text
EXPECTED
PLAUSIBLE_BUT_LOW_CONFIDENCE
SUSPICIOUS_REQUIRES_RETEST
INVALIDATED_BY_AUDIT
```

Use clear quantitative reasons, not intuition. If a problem is found, propose the narrowest repair task/specification but do not implement it.

## Allowed Actions

```text
read source/artifacts
run existing read-only checkers
write audit report and optional read-only audit script
run small deterministic recomputation scripts that do not alter artifacts
```

## Prohibited Actions

```text
rerun run_cycle.ts or any long training
append/modify JSONL evidence
change T0/T1/T2/T3 or L1/L2/L3 policy
change thresholds/weights/catalog membership
modify source formations, product engine, UI, bundle, or web artifacts
apply/deploy/publish
```

## Acceptance

- [ ] Every 100% result has a raw traceable provenance chain or is explicitly marked untraceable.
- [ ] Exact arithmetic is independently recomputed from raw records.
- [ ] Leakage/degeneracy checks have explicit PASS/FAIL evidence.
- [ ] Old 11x11 and modern product-path numbers are compared only with clear non-comparability labels.
- [ ] Report concludes whether current perfect results are trustworthy, merely low-confidence, suspicious, or invalid.
- [ ] No production/training artifacts are changed.

## Delivery

Write `TASKS/tree/T047.report.md` with findings first, ordered by severity; a perfect-result inventory; raw recomputation table; leakage audit table; benchmark comparison table; statistical confidence classifications; any proposed narrow repair boundary; commands run; and a statement of every file changed. Commit/push only `agent/tree`.
