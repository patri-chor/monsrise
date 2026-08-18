STATUS: OPEN
DOMAIN: tree

# T021 - T020 Elite Retest Fidelity and Runtime-Diagnostic Repair

> Domain: `tree` | Executor branch: `agent/tree`
> Preserve T020's error-propagation API repair. This task fixes invalid evidence and missing diagnosis only. Do not start broad mutation training or apply any candidate.

## T020 Cannot Be Accepted as Delivered

T020 correctly changes the worker/pool contract so task errors are observable rather than counted as losses. However its elite retest evidence is invalid and its required all-zero diagnosis was not delivered.

### A. Invalid Elite Conversion

`persistent_elite_seeds.json` stores T014 elite trees in Evol shape: nodes use `condition` and `placements`. T020 test and likely retest invoke:

```ts
formationToEvol(e as Formation)
```

but `formationToEvol()` expects bundle shape (`tree.placement`, `label`) and converts `placements` to an empty array. The TypeScript cast hides this incompatible runtime shape. Therefore the claimed retests of `cand_s1_1_2a`, `cand_s1_2_2b`, and `cand_s2_1_8e` may evaluate an empty placement tree, not the preserved elite tree.

### B. Missing All-Zero Diagnostic Delivery

T020 requires a clean error-preserving rerun and committed table for every T017 exact `0W/0D/70L` candidate. The runner writes `runtime_diagnostic_ledger.jsonl` in principle, but no such file is tracked in the committed T017 archive and `T020.report.md` does not show the candidate/error classification table.

### C. Task Bus Deletion

T020 delivery deletes `TASKS/tree/T020-runtime-integrity-and-elite-seed-continuity.md`. Restore it unchanged and prevent this regression.

## Objective

Retest persistent elites using their exact preserved Evol trees, obtain a complete error-preserving engine diagnostic for every historical T017 all-zero candidate, and commit the evidence. No score/tier conclusion may be drawn from the invalid T020 elite retest.

## A. Canonical Formation Shape and Elite Retest

1. Define/use an explicit shape-safe conversion for elite data:
   - if fixture stores `EvolFormation`, use it directly after structural validation; or
   - convert explicitly with `evolToBundleFormation` then `formationToEvol`, preserving every node, branch, condition, placement order, and badge.
   Do not use `as unknown as Formation` to cross incompatible tree formats.
2. Add a structural round-trip assertion for each elite seed comparing canonical fingerprints of:
   - team IDs + badges;
   - every root-to-leaf node ID/round;
   - every placement monster ID/order/coordinate;
   - every condition/branch label.
3. Retest the original exact elite formations `cand_s1_1_2a`, `cand_s1_2_2b`, and `cand_s2_1_8e` through the repaired worker/bundle path:
   - preflight: early-seven, both sides, one deterministic game/cell;
   - held-out: early-seven held-out, both sides, 5 games/cell;
   - current strong panel: fixed protocol/seed schedule.
4. Commit an `elite_seed_retests.jsonl` ledger with original ID, canonical fingerprint, historical T014 metrics, new W/D/L/trainingScore, worker errors, seed schedules, and exact conversion route.
5. A retest with any error is `RUNTIME_INVALID`, not PASS. Never replace T014 historical numbers; report them separately.

## B. Diagnose Every Historical T017 All-Zero Candidate

1. Identify all candidate IDs whose T017 committed attempt archive contains `initialHeldOutScore=0`, `finalHeldOutScore=0`, and `initialHeldOutLoss=70` across all 3 attempts.
2. Re-run each through the repaired error-preserving worker contract using the original fixture and matching early-seven protocol. For every candidate commit `runtime_diagnostic_ledger.jsonl` with:
   - candidate ID/source/bucket;
   - static coherence outcome;
   - preflight W/D/L and exact task-level error records;
   - whether evaluation is complete;
   - classified result: `RUNTIME_INVALID`, `COMPLETE_VALID_ALL_LOSS`, or `OTHER`;
   - error signature grouping and root-cause explanation where available;
   - seed schedule and rerun command/provenance.
3. Do not merely state a zero count. The ledger must contain every all-zero ID, including all three `坚果救星` T017 candidates.
4. Keep T017 archive immutable. Commit diagnostics to a new `tests/fixtures/tree/t020_runtime_diagnostics/` archive, explicitly naming T017 as superseded for source ranking.

## C. Task-Bus and Test Integrity

1. Restore `TASKS/tree/T020-runtime-integrity-and-elite-seed-continuity.md` byte-for-byte and preserve all unrelated task records.
2. Add a regression test that proves T020/T021 specifications and reports are Git-tracked at `HEAD`.
3. Add tests that fail if an Evol elite is passed to `formationToEvol` without an explicit correct conversion, and fail if an elite retest loses any original non-empty placement/branch.
4. Keep T020's worker-error propagation test, then run T013 preservation.

## Prohibited

- No broad mutations, tier recomputation, reinforcement, new source ranking, active bundle modification, apply/deploy, or generation-domain changes.
- No modification of original T017 JSON/JSONL result archive.
- No swallowing worker errors or counting errored games as W/D/L.

## Acceptance

- [ ] All three elite retests use a lossless, verified tree conversion and commit comparable W/D/L/score/error evidence.
- [ ] Every T017 historical `0/70` all-zero candidate is present in committed diagnostics with explicit classification and task errors where applicable.
- [ ] T020 specification is restored and all task-spec preservation tests pass at delivery HEAD.
- [ ] No runtime-invalid candidate is ranked, tiered, or described as weak performance.
- [ ] T020 error propagation, new conversion/diagnostic tests, and T013 preservation pass.
- [ ] No simulation beyond required diagnostics/retests, and no apply/deploy.

## Delivery

Write `TASKS/tree/T021.report.md` with the exact elite conversion route, retest table, all-zero diagnostic count/table, error root causes, restored file evidence, test output, and explicit no-apply confirmation. Commit/push only `agent/tree`. Do not modify this specification.
