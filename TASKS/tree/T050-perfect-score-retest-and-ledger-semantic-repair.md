STATUS: OPEN
DOMAIN: tree

# T050 - Suspicious Perfect-Score Retest and Ledger Semantic Repair

> T049R corrected the impossible W/D/L arithmetic and migrated the audit ledger to V2, but the previously required independent retest of suspicious L2/L1 perfect scores was not executed. T050 combines that forgotten retest with the remaining verification-state semantic repair from T049R2. T049R2 is superseded by this task; do not execute both independently.

## Objective

Complete the missing independent verification for every current L2/L1 aggregate result that reported a suspicious perfect score, while producing an audit ledger whose evidence kind and verification state cannot contradict each other.

This task is evidence/retest only. Do not automatically apply formations, deploy, publish to the active game library, alter frozen T0, alter authorized tier thresholds, or auto-adopt a calculator policy.

## A. Repair Verification-State Semantics

Preserve T049R V2 rows as historical provenance. Create a new current ledger/index revision rather than rewriting history in place.

Strict invariant:

```text
AGGREGATE_SCORE_ONLY
  w = null, d = null, l = null, pureWinRate = null
  scoreFormula = SOURCE_AGGREGATE_UNRECONSTRUCTABLE
  verificationState = UNVERIFIED_AGGREGATE_ONLY

RAW_OUTCOMES_RECONCILED
  w + d + l = totalGames
  pureWinRate = w / totalGames
  verificationState may be INDEPENDENT_VERIFIED only after complete retest
```

The current index/checker must fail if:

```text
AGGREGATE_SCORE_ONLY + INDEPENDENT_VERIFIED
raw counts violate W+D+L=totalGames
pureWinRate is outside [0,1] or does not reconcile
```

Do not call an aggregate product-path score independently verified merely because it came from `playFullGame`; independent verification requires the raw coverage defined below.

## B. Inventory of Retest Targets

Build a deterministic inventory from current V2 ledger/library records:

```text
all formations with L2 score == 1.0 and aggregate-only evidence
all formations with L1 score == 1.0 and aggregate-only evidence
all equivalent perfect W/D/L claims lacking complete T048 raw coverage
```

Deduplicate targets by:

```text
formation canonical fingerprint
calculator policy fingerprint
benchmark revision / learning level
```

Record the inventory before execution, including target count and source record IDs. Do not silently omit T0 aggregate perfect rows; T0 is an immutable benchmark/opponent anchor, not an L1 learner, but its suspicious benchmark result still requires honest verification classification.

## C. Independent L2 Retest

For each target with suspicious L2 perfect evidence, run a fresh, isolated product-path retest:

```text
PersistentSimPool
-> fine_grained_worker(product_path)
-> playFullGame
-> product_tree_strategy
```

Coverage per formation/policy target:

```text
11 frozen T0 opponents
x P1/P2
x 10 games per opponent-side cell
= 220 games
```

Use a new deterministic verification seed schedule, distinct from all T037-T049 training schedules. Persist every game:

```text
verification revision
formation ID / canonical fingerprint
calculator policy schema/fingerprint/payload reference
opponent ID / opponent fingerprint
side / game index / exact seed
winner or draw / round summary
product-path provenance
worker/deployment error status
```

A worker or deployment error invalidates the run; it cannot count as a win, be omitted, or be silently retried without recording the retry.

Derive and persist:

```text
per-opponent x side W/D/L vector
per-opponent score
per-side score
weakest opponent and side
total W/D/L / totalGames / pureWinRate
```

## D. Independent L1 Retest

For each target with suspicious L1 perfect evidence and eligible T1 learner status, run a fresh probabilistic melee retest using a frozen catalog revision:

```text
11 root T0 archetypes uniformly sampled
10 paired member samples per root
P1/P2 for each pair
= 220 games per formation/policy target
```

Use verified evidence weights only. If weights are not independently verified, use a documented neutral/floor weight and record that choice. Exclude candidate self-opponents by exact formation/policy fingerprint. Persist member, root, side, seed, outcome, and raw per-game provenance.

T0 may be an L1 opponent catalog member but must never be scheduled as an L1 learner. T2/T3 cannot receive L1 retests.

## E. Classification and Tier/Web Boundaries

Classify each target only from the new raw retest:

```text
INDEPENDENT_VERIFIED:
  complete required coverage, zero unresolved errors,
  exact raw-to-derived reconciliation, no self/leakage

INDEPENDENT_INCONCLUSIVE:
  complete valid coverage but confidence/strength policy does not establish stability

INDEPENDENT_REJECTED:
  missing coverage, error, leakage, fingerprint mismatch, or arithmetic failure
```

A perfect result is not required for `INDEPENDENT_VERIFIED`; verification means evidence integrity and complete coverage, not winning every game.

Until classification exists:

```text
old aggregate perfect scores remain UNVERIFIED_AGGREGATE_ONLY
cannot bind T2->T1 promotion
cannot increase L1 weights
cannot be presented as verified 100% strength
cannot receive a perfect/stable player-facing label
```

Do not change the authorized T045 policy during this task:

```text
T3 -> T2: L3 >= 80%
T2 -> T1: L2 >= 85%
T1 -> T2: L2 < 80%
[80%,85%) hysteresis
no Top-1-per-root cap
```

The new results may be recorded as verification evidence; changing current tier/library membership requires a separate explicit decision if not already part of the existing gate process.

T046 web exports must consume only exact formation/policy snapshots and carry verification state. Unverified members may remain playable only with neutral/floor weighting and no perfect/stable label. Player history remains browser-local and never enters this ledger.

## F. All2Rush Calculator-Policy Continuity

Retest targets must remain separated by calculator policy fingerprint. Preserve the T049R all2rush baseline/user-policy comparison:

```text
old policy result is not inherited by new policy
new policy result is not merged into baseline
```

If an all2rush policy target is suspiciously perfect, include it in the same L2/L1 retest inventory. Do not auto-adopt the current user policy merely because it has a valid schema.

## G. Required Audit Outputs

Write a new append-only/current-index artifact set:

```text
perfect_score_retest_inventory.json
perfect_score_retest_raw.jsonl
perfect_score_retest_vectors.jsonl
formation_winrate_audit_ledger.v3.jsonl or equivalent V3 current index
formation_winrate_audit_report.md
```

The report must include:

```text
inventory count and source records
per-target L2/L1 coverage
raw W/D/L and exact arithmetic checks
per-opponent/per-side minima
verification classification counts
perfect-result before/after comparison
T0 benchmark handling
calculator policy fingerprints
seed schedule revisions
worker/deployment errors
which old scores remain aggregate-only
web weighting/label implications
```

## H. Acceptance Checks

```text
all suspicious perfect L2/L1 aggregate targets are inventoried
all eligible targets receive complete 220-game product-path retests or explicit blocked/error classification
L2 and L1 raw vectors are independently recomputable
zero AGGREGATE_SCORE_ONLY rows are marked INDEPENDENT_VERIFIED in current index
raw rows satisfy W+D+L=totalGames and pureWinRate formula
no self-opponent, same-policy leakage, seed reuse, empty-opponent fallback, or worker-error-as-win
T0 remains immutable and not an L1 learner
T045 80/85/80 policy remains unchanged
all2rush policy fingerprints remain separate
T048 quarantine is resolved only by new raw retest classification
player history/training evidence remain isolated
no apply/deploy/publish/active formation replacement
```

Run focused tests, the current tree checker, relevant product-path tests, and `npx vite build` only if web artifacts change. Do not start a replacement server.

## Delivery

Write `TASKS/tree/T050.report.md` with the complete inventory, retest commands, raw/vector counts, target-by-target classifications, before/after score table, ledger V3 semantic audit, T0/Tier/web boundary checks, test/build output, and no-apply confirmation. Commit/push only `agent/tree`.
