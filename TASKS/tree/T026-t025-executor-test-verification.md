STATUS: OPEN
DOMAIN: tree

# T026 - T025 Executor Test Verification

> Domain: `tree` | Executor branch: `agent/tree`
> Verification only. Do not modify runner code, fixtures, archive data, candidate data, tasks other than this report, or start any simulation/formal screening.

## Current Verified Source State

T025 direct repair is present at `agent/tree` commit `d5239df`:

```text
candidateFp: getCandidateObservationFingerprint(c)
sourceFixtureFp: getSourceFixtureObservationFingerprint(sources)
```

The former placeholders are absent. Current four-cost gate also explicitly marks missing trace as `MISSING_TRACE`.

However, no executor has run the focused tests from an `agent/tree` checkout. Static review must not be reported as runtime verification.

## Required Work

1. From the actual `agent/tree` checkout, run exactly:

```bash
npx tsx tests/t025_observation_content_identity.test.ts
npx tsx tests/t024_formal_run_identity_and_coverage.test.ts
```

2. Run static source assertions in the same checkout confirming:
   - candidate/source observation content fingerprints are used at the call site;
   - no old `candidateId_schedule` resume key remains in the runner;
   - no fixed `fp_eleven_frozen_v1` source fixture fingerprint remains;
   - missing raw runtime trace yields `MISSING_TRACE` and no `node.round * 4` synthetic PASS fallback remains.
3. Do not run `runExperiencePipeline`, PersistentSimPool, fidelity gate, smoke, formal screen, promotion, or any other simulation.
4. If either test fails, leave code unchanged and report exact output with `STATUS: PARTIAL`.

## Acceptance

- [ ] Both focused tests pass from actual `agent/tree` checkout.
- [ ] Source assertions confirm T025 identity and missing-trace guards.
- [ ] No simulation or data mutation occurred.
- [ ] T020-T026 task specifications remain Git-tracked.

## Delivery

Write `TASKS/tree/T026.report.md` with commands, concise output, resolved `HEAD`, source-assertion evidence, and explicit no-simulation/no-apply confirmation. Commit/push only `agent/tree`. Do not modify this specification.
