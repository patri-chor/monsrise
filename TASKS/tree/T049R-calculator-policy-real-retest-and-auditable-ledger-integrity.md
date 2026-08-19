STATUS: OPEN
DOMAIN: tree

# T049R - Calculator Policy Real Retest and Auditable Ledger Integrity

> T049 is partially accepted only for the typed `calculatorContextPolicy` infrastructure, default canonicalization, fingerprint participation, and controlled policy-sensitive placement test. It is rejected as evidence/training completion: the win-rate ledger has impossible W/D/L arithmetic and the report contains no actual all2rush calculator-policy L3/L2/L1 training/retest evidence. Repair this without discarding valid policy infrastructure.

## Verified Blocking Ledger Defect

Current `formation_winrate_audit_ledger.jsonl` contains internally impossible records, for example:

```text
formation: cand:springsword:spatial_local:0
level: L3
totalGames: 32
W/D/L: 100 / 30 / 10
pureWinRate: 3.125
```

This invalidates the ledger's purpose as an audit surface. Likely cause: incompatible aggregate score fields were incorrectly transformed into W/D/L while retaining a different total-games value. Regardless of cause, no ledger row may claim raw W/D/L unless it is directly derived from compatible raw outcomes.

## A. Strict Ledger Schema and Invariants

Create a new ledger revision/schema; preserve the invalid T049 ledger as historical invalid provenance and do not overwrite it.

For every record containing raw counts:

```text
w, d, l are nonnegative safe integers
w + d + l === totalGames
pureWinRate === w / totalGames (within documented precision)
score formula is explicit and independently recomputable
0 <= pureWinRate <= 1
```

For aggregate-only legacy evidence that does not have raw W/D/L:

```text
outcomeEvidenceKind: AGGREGATE_SCORE_ONLY
w/d/l/pureWinRate: null
score: source aggregate score only
scoreFormula: SOURCE_AGGREGATE_UNRECONSTRUCTABLE
verificationState: UNVERIFIED_AGGREGATE_ONLY
rawOutcomeRef: null
```

It must never invent W/D/L, opponent cell aggregates, weakest opponent, side minimum, or independent verification from an aggregate-only input.

For raw product-path evidence:

```text
outcomeEvidenceKind: RAW_OUTCOMES_RECONCILED
rawOutcomeRef present
per-opponent/per-side vector present or referenced
all arithmetic invariants pass
```

Only a complete, seed-separated T048 verification run may use:

```text
verificationState: INDEPENDENT_VERIFIED
```

The old T037/T039/T040/T045 aggregate data remains `AGGREGATE_EXPLORATION_ONLY`, regardless of a record being non-perfect.

## B. Active Library Coverage Means Honest Coverage

Every active formation still needs a current audit index entry for L3/L2/L1, but an absent/raw-unavailable evaluation must be recorded honestly:

```text
NOT_YET_EVALUATED
AGGREGATE_SCORE_ONLY
RAW_OUTCOMES_RECONCILED
INDEPENDENT_VERIFIED
INDEPENDENT_INCONCLUSIVE
INDEPENDENT_REJECTED
```

Do not fill missing cells with made-up totals. The generated human-readable table must visibly distinguish:

```text
aggregate score only
raw reconciled score
independent verification
not evaluated
```

and show unknown W/D/L as `-`, not numerical values.

## C. Real All2Rush Calculator-Policy Learning and Retest

The T049 report only demonstrated a policy seed and a controlled placement change. It did not show product-path training/retest outcomes for that seed. Execute the actual required sequence for the user-optimized all2rush policy:

```text
1. freeze all2rush optimized base + exact calculator policy payload/fingerprint as a new candidate seed
2. produce isolated calculator_context_policy candidates only for applicable all2rush calculators
3. run deterministic validation plus controlled placement-difference tests
4. run real product-path L3 coverage with P1/P2 and a fresh seed schedule
5. only if L3 meets the authorized gate, run real L2 frozen-T0 coverage with P1/P2 and fresh seeds
6. if L2/T1 permission is satisfied, run L1 only under existing eligibility rules
```

All evaluation records must use:

```text
PersistentSimPool -> fine_grained_worker(product_path) -> playFullGame -> product_tree_strategy
```

Persist raw outcomes sufficient to reconcile all all2rush policy candidate W/D/L. Do not reuse historical score records based on a different policy fingerprint.

## D. Policy Semantics and Runtime Integrity

Retain the actual T049 policy controls only where policy setting changes a valid calculator decision for an applicable monster/context. Add a per-field effect classification:

```text
OBSERVED_EFFECT
VALID_BUT_CONTEXT_DEPENDENT
NO_OBSERVED_EFFECT_IN_COVERAGE
```

Do not claim a field is optimized merely because it passes whitelist validation. Do not allow policy fields for absent monsters to be mutated in all2rush candidates.

Continue to enforce:

```text
runtime context read-only
R1 visibility limitations
no generic BattleAI fallback
policy snapshot/fingerprint exact through worker and web export
```

## E. Checks

```text
new ledger never has W+D+L != totalGames
new ledger never has pureWinRate outside [0,1]
legacy aggregate-only score rows expose no invented raw counts or verification
all INDEPENDENT_VERIFIED rows trace to complete raw T048-format coverage
active library audit index contains no fabricated outcomes
all2rush optimized policy has a traceable candidate seed and fresh product-path outcome evidence
all2rush candidates do not inherit scores across policy fingerprints
L3/L2/L1 permissions and T048 quarantine remain in force
policy field effect classification is evidence-based
web export/history preserve exact calculator-policy fingerprint or fail closed
no T0 mutation/apply/deploy/publish, arena/rule-random/self-play/separation path, or player history leakage
```

## Acceptance

- [ ] Formation win-rate audit data is mathematically valid or explicitly aggregate-only/unknown.
- [ ] T048 verification labels are never fabricated from old aggregate results.
- [ ] User-optimized all2rush calculator policy has actually begun/finished product-path learning and retesting with audit-grade evidence.
- [ ] The review table lets a human distinguish real W/D/L evidence from exploratory score-only evidence.

## Delivery

Write `TASKS/tree/T049R.report.md` with invalid-ledger migration/provenance; invariant checker results; coverage counts by evidence kind/verification state; all2rush policy candidates and L3/L2/L1 raw coverage/results; field-effect classification; active library audit table; web policy fidelity; and no-apply confirmation. Commit/push only `agent/tree`.
