STATUS: OPEN
DOMAIN: tree

# T051R - Real Active-L2 Score70 Calibration and Dynamic Regrade

> T051 is rejected as an implementation of the accepted dynamic-ladder model. It created artifacts but did not implement a dynamic T0-T3 strength ladder. It re-labeled the immutable R0 originals as all 11 current T0 mains, used invalid T050 evidence, left most Active-L2 metrics null, and assigned a fixed 0.88/0.60 policy without the required calibration. Preserve R0, Score70 formula, and historical artifacts; rebuild only current dynamic evidence and labels.

## Verified Defects

1. `active_l2_manifest.json` contains the 11 original snapshots as `t0:*`, with `selectionEvidenceId=t050_product_path_verified_retest`. T050 was invalidated due to self-opponent/provenance defects. It cannot select a dynamic current main.
2. `formation_strength_library.v4.json` gives all R0 snapshots `currentDynamicTier=T0` despite missing Active-L2 metrics for several entries and no valid T050R evidence.
3. V4 policy sets `Score70 >= 0.88` / `>=0.60` directly, but produces no required calibration comparison (quantile/fixed/relative options) or evidence basis.
4. Report says regrade uses L1 alone, contradicting accepted Active-L2 as the current strength benchmark.
5. Current checker still asserts old frozen-T0 L2 and old 80/85/80 policy; T051 did not become the active training/evaluation path.
6. T051 tests only assert hardcoded counts and file existence. They do not verify manifest member evidence, metric non-nullness, raw W/D/L, Score70 recomputation, dynamic replacement, or T050R prerequisite.

## A. Preserve Accepted Model

```text
R0: immutable original 11 historical root snapshots
T0/T1/T2/T3: dynamic active-strength labels
Active-L2: versioned current main formation pool
primaryScore70 = (W + 0.70D) / N
W/D/L and Score50 remain audit data
high-draw strategies are valid; do not add draw penalty
no Top-1-per-root restriction
```

Do not reinstate frozen T0 L2 or Score50 as a current gate.

## B. Hard T050R Dependency

T051R must begin only after T050R raw retest has passed:

```text
exact formation/opponent/policy fingerprints
product-path provenance and manifest hash
zero self opponents, including R0 diagonal exclusion
W+D+L reconciliation
fresh valid seed schedule
```

Invalid T050 data must remain historical invalid and cannot select Active-L2 mains or current tiers.

## C. Real Active-L2 Main Selection

Build `Active-L2 v2` only from candidates/snapshots with valid current evidence. For each R0 lineage:

```text
select a CURRENT_ROOT_MAIN from verified available active candidates/snapshots
if no valid descendant currently exists:
  retain the R0 snapshot temporarily as a bootstrap main,
  mark bootstrap=true and T0_PENDING_DYNAMIC_EVIDENCE,
  do not claim it is a current strength-selected T0
```

A main selection record must include:

```text
R0 root ID
formation ID
formation and calculator-policy fingerprints
candidate/lineage provenance
selection evidence revision/raw vector references
Score70/W/D/L
bootstrap flag/reason if applicable
previous-main and supersession linkage
manifest revision/hash
```

Multiple dynamic T0 formations within one lineage are permitted. R0 snapshot identity must remain distinct from the selected active snapshot even if a bootstrap uses it.

## D. Current Product-Path Calibration

Evaluate active-library formations against `Active-L2 v2` using product path only:

```text
PersistentSimPool -> fine_grained_worker(product_path) -> playFullGame -> product_tree_strategy
```

Rules:

```text
exact manifest snapshot/policy fingerprints
P1/P2 coverage
fresh deterministic seed schedule
one game per work item / CPU target near 80%
exclude exact same formation + policy fingerprint opponent
persist raw per-game records and derived vectors
Score70 must recompute from W/D/L
```

L1 scores must be refreshed from the current dynamic L1 manifest only for permitted learners. R0 may be opponent but never learner. T0/T1 current active formations may learn/optimize and receive L1 evidence.

## E. Calibrate, Then Regrade

Produce all three required threshold analyses from the same valid Active-L2 v2 evidence:

```text
A. quantile/distribution bands
B. fixed Score70 gates calibrated from observed distribution
C. relative-to-Active-L2 median/percentile gates
```

For each, show:

```text
T0/T1/T2/T3 counts
per-root distribution
previous -> proposed transitions
high-draw strategy examples
confidence / coverage / unknowns
```

Select one explicitly documented provisional dynamic policy only after showing those alternatives. It must define all tier meanings, hysteresis/demotion, and bootstrap treatment. The policy must not hardcode desired counts, capacity quotas, or a Top-1 cap. Do not preselect 0.88/0.60 without the calibration table.

A formation with incomplete evidence remains `PENDING_REGRADE`, not forced into T0/T1/T2/T3. Its R0 lineage may still have a bootstrap main for pool continuity, marked clearly.

## F. Make Dynamic Policy Active

Replace old current training dispatch/checker assumptions with the new revisioned dynamic model:

```text
current Active-L2 manifest, not frozen original-T0 11
Score70, not Score50, for current strength decision
R0 vs dynamic T0 distinction
T0/T1 active training parent and L1 eligibility semantics
```

Legacy T045/T046 checks/artifacts remain historical and must not be reported as validation of T051R. Add current focused checks that fail on:

```text
R0 automatically labelled dynamic T0 without evidence/explicit bootstrap
Active-L2 member without exact fingerprints/evidence
null Active-L2 metric on a non-pending graded formation
use of invalid T050 result
same formation/policy opponent
Score70 mismatch
old frozen-L2 or 80/85/80 path used as current dynamic gate
fixed-count/quota-driven regrade
```

## G. Ledger, Web, and Safety

Create V5/current audit ledger/report with:

```text
R0 identity and active snapshot identity
bootstrap or selected-main state
Active-L2 v2 manifest hash
raw Active-L2 and L1 W/D/L / Score70 / Score50
policy fingerprints
verification and regrade state
old-to-new mapping/supersession
```

Web L1 export/history use only current exact dynamic snapshot and policy metadata. Unverified/bootstrap states must be shown/weighted conservatively. Player history stays local and never affects training.

No active playable formation replacement, R0 mutation, arena/rule-random/separation/self-play, apply/deploy/publish.

## Acceptance

- [ ] R0 originals are history roots, not automatically the dynamic T0 tier.
- [ ] Active-L2 v2 consists of evidence-backed current main snapshots, with explicit bootstrap handling for unavailable lineages.
- [ ] All current strength labels derive from raw, manifest-pinned Score70 evidence.
- [ ] Regrade follows a published calibration comparison rather than hardcoded counts or unexplained gates.
- [ ] T0 and T1 both operate as evolving active parent/competitor formations and receive current mixed-melee evidence when permitted.
- [ ] Current training/checks use dynamic policy; legacy frozen-L2 checks are historical only.

## Delivery

Write `TASKS/tree/T051R.report.md` with T050R dependency evidence; Active-L2 v2 selection/bootstrap table; raw coverage/vector totals; calibration A/B/C table and selected policy; dynamic regrade mapping/counts; Score70 high-draw evidence; current checker results; V5 ledger/web metadata; no-apply confirmation; and every changed file. Commit/push only `agent/tree`.
