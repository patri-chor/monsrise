STATUS: OPEN
DOMAIN: tree

# T053R - Product Payload Evidence and Malformed Lineage Audit

## T053 Partial Acceptance

T053 correctly added per-record lineage quarantine, fail-closed snapshot resolution, active-library exclusion, and a batch-level in-memory fingerprint helper. Current artifact evidence shows:

```text
formation library total: 118
SNAPSHOT_IDENTITY_INVALID_PRE_T053: 43
DUPLICATE_BEHAVIOR_FINGERPRINT_HISTORICAL: 0
active evaluated: 75
```

Focused tests pass:

```text
t053_candidate_identity_and_quarantine: 5/5
snapshot_resolver: 5/5
```

T053 is not fully accepted because its evidence contract remains incomplete.

## Verified Gaps

### 1. Worker/raw results do not prove both evaluated payloads

`fine_grained_worker.ts` still exposes only old `candidateFp` in task/result data. It does not carry or return:

```text
target formation ID + payload fingerprint + calculator-policy fingerprint
opponent formation ID + payload fingerprint + calculator-policy fingerprint
```

`run_cycle.ts` aggregates W/D/L directly from these unproven worker results. Therefore a later raw/evidence audit cannot prove the exact target/opponent payload actually evaluated.

### 2. Batch gate is self-referential

`verifyBatchPayloadIdentity()` is called with each target/opponent spec fingerprint as both the expected library value and resolved snapshot value. It verifies `spec fp == computed evol fp`, but lacks an explicit immutable active-library record -> resolved snapshot -> task payload chain.

### 3. Malformed JSON lines are silently dropped

Registry and lineage loaders contain JSON parse `catch { continue; }` paths. The task required every rejected record to be observable; malformed lines need a quarantine/audit record too.

## Scope

Do not change Score70, opponent sampling, candidate operators, tier thresholds, branch learning, CPU throttling, active-game deployment, or R0.

## A. Explicit Identity Carriage Through Product Worker

Extend `SimTaskMessage` and `SimResultMessage` with lightweight identity fields:

```ts
targetFormationId: string
targetPayloadFingerprint: string
targetCalculatorPolicyFingerprint: string | null
opponentFormationId: string
opponentPayloadFingerprint: string
opponentCalculatorPolicyFingerprint: string | null
```

At product-path task construction:

```text
active-library expected fingerprint
== resolver exact snapshot fingerprint
== computeCandidateFingerprint(prepared target/opp evol)
== task target/opp payload fingerprint
```

At worker result return, echo identity fields unchanged. Any mismatch or missing field is a structured `PRODUCT_PAYLOAD_IDENTITY_MISMATCH` error and its W/D/L must not be aggregated.

Do not recompute deep fingerprints every game. Compute/verify once per formation per batch and carry immutable strings per task/result.

## B. Append-Only Product Evaluation Evidence

Create a revisioned append-only product evaluation evidence artifact, separate from existing historical/aggregate ledgers. One record per dispatched product task is sufficient; it may aggregate that task's `games` result, but must include:

```text
recordKind: PRODUCT_PATH_PAYLOAD_EVIDENCE_V1
cycle/phase/batch ID
task ID
side and seed range
game count
W/D/L and total reconciliation
target/opponent formation IDs
target/opponent payload fingerprints
target/opponent calculator-policy fingerprints
snapshot provenance or snapshot identity reference
manifest/benchmark revision and hash
worker execution mode
worker error if any
createdAt
```

The aggregate outcome must only include returned task records whose identity matches expected fields and whose W+D+L equals task games. Fail closed per task; do not substitute zero/error results into a valid aggregate without explicit failed-task accounting.

## C. Library-to-Snapshot Gate

Refactor the batch gate API/call sites so the expected fingerprint is read from the active-library entry (or pinned benchmark manifest member), not merely copied from the already-prepared `EvalTargetSpec`.

Tests must prove a malicious/stale spec whose `evol` is self-consistent but differs from its active-library fingerprint is rejected before task dispatch.

## D. Malformed Record Quarantine

For invalid JSON in candidate registry/lineage:

```text
recordKind: MALFORMED_LINEAGE_RECORD
source file
line number
stable line hash (not raw huge payload required)
reason: MALFORMED_JSON
```

must appear in the resolver quarantine/audit output. Valid following lines must still load. Do not silently skip malformed records.

Persist resolver quarantine findings as an append-only/revisioned artifact, not merely a process-memory array or report text.

## E. Verification

Add focused tests proving:

- a valid product task produces a result/evidence record with identical target/opponent fingerprints;
- a mismatched returned fingerprint is rejected and excluded from aggregate W/D/L;
- stale library fingerprint vs self-consistent prepared evol is rejected before dispatch;
- malformed JSON record produces a quarantined audit entry while a subsequent valid record remains resolvable;
- task W+D+L reconciliation is enforced.

Run focused T053R tests, T053 tests, snapshot resolver tests, and an actual bounded product-path worker task. Report exact command output and evidence row count.

## Acceptance

- [ ] Every accepted product result has target/opponent payload identities that can be audited from raw evidence.
- [ ] Aggregation cannot consume an unproven/mismatched worker result.
- [ ] Batch identity gate links independent library/manifest expectation to resolved and task payload identity.
- [ ] Malformed registry/lineage lines are observable quarantines, not silent drops.
- [ ] No unrelated scoring/training-policy changes.

## Delivery

Write `TASKS/tree/T053R.report.md` with code paths, artifact schema/path, evidence count and one redacted sample, malformed-line quarantine count, focused product-path test output, existing quarantined/active counts, no-apply confirmation, and changed files. Commit/push only `agent/tree`.
