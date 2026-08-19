STATUS: OPEN
DOMAIN: tree

# T049 - Calculator Context-Policy Learning, Retest, and Formation Win-Rate Audit Ledger

> Domain: `tree` | Executor branch: `agent/tree`
> Add a persistent, versioned, whitelist-constrained `calculatorContextPolicy` to formation/candidate snapshots. It supplies learnable policy parameters to special/aim calculator placement behavior while preserving runtime battle context as read-only. Train and retest these policies through the product path, beginning with the user's optimized `all2rush` / 全二冲, and persist a separate complete formation win-rate audit ledger for review.

## A. Non-Negotiable Separation

```text
Runtime context:
  current round, side, revealed enemy hand/badges, legal board snapshot,
  budgets, alive units, occupancy, and other battle facts
  READ-ONLY. Never candidate-controlled.

calculatorContextPolicy:
  formation-owned, serializable, versioned, whitelist-constrained parameters
  READ/used by special and aim calculator logic when it evaluates runtime context
  candidate-controlled and therefore fingerprinted, trained, retested, exported.
```

Do not permit arbitrary mutation/replacement of a runtime context object. Do not use player/opponent hidden state or future-round information. Any policy access must obey the same R1/R2+ visibility boundaries as `product_tree_strategy`.

## B. Discover and Formalize Actual Calculator Controls

First inspect the actual special/aim calculator implementation and enumerate its real decision controls. Do not invent parameters based on names or generic heuristics.

Define an explicit typed schema, for example:

```ts
interface CalculatorContextPolicy {
  schemaVersion: '...';
  special?: { ...actual allowed settings... };
  aim?: { ...actual allowed settings... };
}
```

For every field document:

```text
field name
applicable monster IDs/calculator(s)
type and finite legal domain/range
default that reproduces current behavior exactly
runtime context inputs it may observe
R1/R2+ legality
semantics and expected effect
validation/canonicalization rule
```

Requirements:

```text
unknown fields reject
out-of-range values reject
missing policy normalizes to a versioned exact-current-behavior default
canonical serialization is stable and participates in fingerprinting
changing a policy field changes candidate/formation fingerprint
policy cannot access or mutate global engine state
policy cannot bypass placement legality, budget, collision, or relocation rules
```

If a named special calculator has no legitimate configurable decision control, explicitly record it as non-learnable rather than adding a fake parameter.

## C. Product Path Integration

Thread the immutable policy only through the declarative/product strategy path:

```text
formation/candidate snapshot
-> treeStrategyFor / web-compatible strategy adapter
-> declared placement intent or calculator invocation
-> actual special/aim calculator evaluates read-only runtime context + policy
-> product validation / placement / collision / combat / scoring
```

The strategy must not mutate context, call `placeMonster`, set board state, or skip product validation.

Ensure exact policy fidelity across:

```text
frozen source/candidate snapshot
candidate lineage and canonical fingerprint
PersistentSimPool + fine_grained_worker(product_path)
playFullGame + product_tree_strategy
L1 catalog member snapshot and web export
T046 web challenge adapter/history snapshot fingerprints
```

A missing/mismatched policy payload fails closed for a policy-bearing candidate; it must not silently use an unrelated root/default policy while retaining that candidate's identity.

## D. Candidate Learning Operators

Add a distinct candidate operator family:

```text
calculator_context_policy
```

It can mutate only validated policy fields applicable to monsters actually present in the candidate team. It must produce atomic delta metadata:

```text
policy schema/version
field path
old canonical value
new canonical value
applicable monster IDs
parent fingerprint
result fingerprint
reason / operator seed
```

Initial focus:

```text
all2rush / 全二冲
including the user's current optimized base and its newly added special-calculator context behavior
```

Do not replace or overwrite T0 frozen originals. Treat the user-optimized all2rush policy as a versioned immutable input snapshot/seed and record its provenance. Other formations containing applicable special/aim monsters may opt in only after their supported parameters are enumerated.

Policy changes must be tested as separate candidates from spatial/tree/branch changes. Combined mutations are allowed only after isolated policy effects have been measured and are fully attributed.

## E. Learning and Retest Ladder

Use only the product path:

```text
PersistentSimPool
-> fine_grained_worker(product_path)
-> playFullGame
-> product_tree_strategy / calculator policy adapter
```

For each calculator-policy candidate:

```text
1. deterministic validation and policy-sensitive unit/integration tests
2. L3 Early Bundle screening under current authorized T-tier gate policy
3. L2 frozen T0 testing only after applicable L3 qualification
4. L1 only under existing T1 / eligibility permissions
```

Retest rules:

```text
any formation whose previous score was evaluated with a different calculator policy is a different evidence revision
no previous score may be inherited across calculatorContextPolicyFingerprint changes
all policy-bearing candidates get fresh P1/P2 coverage and independent seed schedules
T048 quarantine/independent-verification requirements remain authoritative for suspicious perfect L2/L1 aggregates
```

Do not use old sandbox arena, rule-random, separation scores, self-play, or player history as evidence.

## F. Separate Complete Formation Win-Rate Audit Ledger

Persist a durable, append-only, review-oriented ledger separate from ephemeral training records, for **every formation in the active experimental library**, including T0 as benchmark records and all T1/T2/T3 candidates.

Suggested path:

```text
tests/fixtures/tree/experience_library/product_path_t037/formation_winrate_audit_ledger.jsonl
```

One immutable ledger record per:

```text
formation/canonical fingerprint
calculatorContextPolicy fingerprint (or explicit default/none)
benchmark revision / learning level
opponent-pool manifest hash
side coverage
seed schedule revision
evaluation revision
```

Each record must include:

```text
record ID / evaluatedAt
formation ID / root T0 / tier-at-evaluation
canonical formation fingerprint
calculator policy schema/version/fingerprint/canonical payload reference
execution provenance = product path
learning level and benchmark/pool manifest identity
opponent coverage, P1/P2 coverage, games-per-cell/pair
raw/derived W/D/L totals, score, pure win rate
per-opponent and per-side vector reference or inline summary
minimum opponent / weakest side
verification state from T048
worker/deployment error counts
supersedes/supersededBy linkage for changed formation or policy
strict evidence class and no-apply confirmation
```

Requirements:

```text
never overwrite prior records
every active formation has a current ledger index/summary pointing to latest valid L3/L2/L1 records or explicit NOT_YET_EVALUATED
policy revisions are visibly incomparable until independently retested
T0 benchmark records are anchors/opponents, not L1 learners
player web histories never enter this ledger
ledger supports simple audit by formation, root lineage, tier, calculator policy, and benchmark revision
```

Create a human-readable generated report/table that lists all active formations and their latest valid L3/L2/L1 win rate, policy fingerprint, sample size, verification state, and missing/retest obligations. Do not confuse aggregate exploration score with independently verified strength.

## G. Tests and Required Checks

```text
actual calculator controls and default-equivalence are documented/tested
policy validation rejects unknown/illegal fields and normalizes default canonically
same formation/tree/team with different policy has different fingerprint
same canonical policy has stable fingerprint across worker/browser serialization
R1 has no forbidden context access; R2+ visibility rules remain correct
policy changes observed calculator placement outcome in a controlled product-path test where applicable
all2rush policy seed/candidate is isolated, lineage-traceable, and gets fresh P1/P2 L3 retest
policy candidate cannot inherit pre-policy scores or promotion evidence
full active library receives ledger index entries and latest win-rate rows
ledger is append-only, policy-aware, product-path-only, and independently recomputable where raw vectors exist
T048 verification state propagates; unverified perfects are neither amplified nor advertised
L1 catalog/web export carries exact policy snapshot/fingerprint, with mismatch fail-closed
player L1 history remains browser-local and absent from ledger/training evidence
no T0 mutation, no active apply/deploy/publish, no sandbox arena/rule-random/self-play/separation path
```

Run focused tests, `npx vite-node scripts/tree_product_training/check_cycle.ts`, relevant product-path tests, and `npx vite build` for web adapter changes. Do not start a replacement web server. Verify the existing GUI after refresh when practical and state exact method/limitations.

## Acceptance

- [ ] Calculator policy is a typed, finite, versioned formation parameter; runtime context remains read-only.
- [ ] User's optimized all2rush special-calculator configuration is preserved as a traceable seed and can be learned/retested safely.
- [ ] Calculator policy changes produce distinct candidates/evidence and real product-path behavior.
- [ ] Existing T/L permissions plus T048 verification quarantine remain enforced.
- [ ] Every active experimental-library formation has independently inspectable current win-rate ledger state, including policy and verification provenance.
- [ ] Web challenge uses exact policy snapshot or fails closed; player data stays isolated.

## Delivery

Write `TASKS/tree/T049.report.md` with actual calculator control inventory; policy schema/default equivalence; all2rush seed/provenance; operator examples; product call path; L3/L2/L1 retest coverage/results; ledger schema/path and active-formation coverage totals; sample audit table; verification/quarantine state distribution; web fingerprint fidelity; check/build/UI results; no-apply confirmation; and every changed file. Commit/push only `agent/tree`.
