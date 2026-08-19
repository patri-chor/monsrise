STATUS: OPEN
DOMAIN: tree

# T050R - Retest Self-Opponent and Provenance Repair

> T050 is rejected as an independent verification result. The raw retest file has no formation/opponent fingerprints or explicit product-path provenance fields, and inspection shows T0 retest rows such as `formationId=t0:springsword` with `opponentId=springsword`. The T0 formation was included as its own L2 opponent. The prior self-opponent check was ineffective because the required fingerprint fields were absent.

## Verified Blocking Defects

```text
raw fields:
revision, formationId, level, opponentId, side, gameIndex, seed,
outcome, winnerSide, workerError

missing:
formationFingerprint
opponentFingerprint
calculatorPolicyFingerprint
executionProvenance
opponentPoolManifestHash
```

Observed self-opponent case:

```text
formationId = t0:springsword
opponentId = springsword
```

Equivalent T0 diagonal cases must be assumed invalid until fully audited. No T050 `INDEPENDENT_VERIFIED` result may survive from a run whose opponent exclusion cannot be proven by exact canonical formation/policy fingerprint.

## Required Repair

1. Preserve all T050 raw/vector/V3 artifacts as historical `INVALID_RETEST_SELF_OPPONENT_OR_UNPROVEN_PROVENANCE`; do not delete or rewrite history.
2. Build a new deterministic inventory of every T050 target and exact opponent set. For L2:

```text
T0 learner/benchmark target:
exclude exact same canonical formation/policy fingerprint from opponents
for non-T0 candidates:
use the full frozen T0 opponent pool, with exact fingerprint identity
```

If the experimental policy intentionally evaluates a T0 anchor against the T0 pool, omit its diagonal rather than count it. Report actual coverage; do not claim 220 games if diagonal omission reduces cells.

3. Rerun all affected targets with a fresh T050R seed schedule. Retain exact raw per-game fields:

```text
revision
formationId
formationFingerprint
calculatorPolicyFingerprint
opponentId
opponentFingerprint
opponentPolicyFingerprint
level
opponentRootT0SourceId
side
gameIndex
seed
outcome / winnerSide
executionProvenance = PRODUCT_PATH
benchmarkRevision
opponentPoolManifestHash
workerError / deploymentError
```

4. For L1, exclude candidate self by exact formation + calculator-policy fingerprint, not display ID. Record sampled root/member/policy identities and paired P1/P2 coverage.
5. Ensure all executions are the real product path:

```text
PersistentSimPool -> fine_grained_worker(product_path) -> playFullGame -> product_tree_strategy
```

6. Recompute vectors and current ledger V4 (or equivalent), with strict rules:

```text
AGGREGATE_SCORE_ONLY -> UNVERIFIED_AGGREGATE_ONLY
RAW_OUTCOMES_RECONCILED -> only verified after complete valid coverage
no self-opponent
no missing identity/provenance fields
W+D+L=totalGames
pureWinRate=W/totalGames
```

7. T0 remains an immutable L2 benchmark anchor and L1 opponent member, never an L1 learner. Do not change T045 80/85/80 thresholds or automatically change tier/library membership.

## Required Checks

```text
zero exact formation/policy self-opponent pairs in new raw data
all target/opponent identities have canonical fingerprints
all raw rows have PRODUCT_PATH provenance and pool manifest
no diagonal T0 rows unless explicitly excluded and documented
P1/P2 coverage and seed uniqueness pass
worker/deployment errors are zero or invalidate target
all vectors reconcile from raw rows
all new independent states trace only to new valid raw evidence
old T050 rows remain historical invalid and cannot drive tier/web weights
```

## Delivery

Write `TASKS/tree/T050R.report.md` with before/after invalid-row counts; exact diagonal exclusions; new target coverage; raw field schema; self-opponent proof; seed/provenance audit; vector arithmetic; V4 ledger state distribution; T0/Tier/web boundary audit; tests/check output; and no-apply confirmation. Commit/push only `agent/tree`.
