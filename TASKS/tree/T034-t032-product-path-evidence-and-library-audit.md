STATUS: OPEN
DOMAIN: tree

# T034 - T032 Product-Path Evidence Recovery and Experience-Library Audit

> Domain: `tree` | Executor branch: `agent/tree`
> Audit/recovery only. Do not generate new mutations, run additional optimization/H2H/promotion, apply/deploy, alter active bundles, or overwrite historical results.

## Accepted T032 Implementation Facts

Tracked commit `6b21b4a` establishes:

```text
playFullGame supports typed declarative strategy intents
product_tree_strategy emits intents without direct placement / arena / bundle injection
fine_grained_worker product_path tasks execute playFullGame
PersistentSimPool worker scheduling remains present
formal old arena tasks fail closed
```

The alignment implementation is therefore present. Historic results remain `SANDBOX_ENGINE_UNVERIFIED_PRE_T032`.

## Unaccepted Data Claim

T032 reports a product-path 60-candidate × 140-game screen, but tracked source writes output by default under:

```text
reports/t032-product-path-formal/
```

The current tracked `tests/fixtures/tree/experience_library/manifest.json` and
`evaluation_observations.jsonl` still show the prior T024 sandbox protocol. No committed product-path JSONL/manifest/cursor evidence is currently present in the canonical experience library.

A markdown frontier table is insufficient evidence, especially because it claims several 140/0/0 source frontiers. Product-path scores must not be treated as updated strength data until raw observations, baseline records, seeds/sides, metrics, and provenance are available and audited.

## Required Work

### A. Recover and Track Existing T032 Output (No New Simulations)

1. Locate the exact output directory used by the completed T032 run, expected `reports/t032-product-path-formal/`.
2. Do **not** rerun the screen. Recover its existing immutable files only:

```text
manifest.json
observations.jsonl
cursor.json
product_path_frontiers.json
baseline records and four-cost ledger if separate
```

3. Copy/re-home them losslessly into a Git-tracked append-only product-path namespace:

```text
tests/fixtures/tree/experience_library/product_path_t032/
```

Do not overwrite `evaluation_observations.jsonl`, `manifest.json`, frontiers, cursor, registry, or any historical sandbox asset.

4. Include an index/README explicitly linking historic sandbox protocol and product-path protocol. Original output SHA-256 and recovered-file SHA-256 must match.

### B. Raw Evidence Audit

1. Verify exactly 60 unique candidate records, each with:

```text
PRODUCT_PATH_FORMAL_SCREEN_T032_V1
manifest hash
candidate/source identity
7 held-out families × 2 actual sides × 10 games = total 140
workerErrorCount=0
isEvaluationComplete=true
```

2. Verify 10 product-path source baseline records with equivalent 140-game coverage. Baselines must be retained even if not yet used for promotion.
3. Verify all raw four-cost fidelity coverage units have actual product `playFullGame` traces. Check expected matrix count, side/route identity, budget flow, and missing trace behavior. Do not accept aggregate `64/64` without individual records.
4. Verify candidate side coverage and seed schedule from raw records, not report prose.
5. Check canonical candidate fingerprint/content identity and flag duplicate/no-op variants. Do not count duplicate variants as independent evidence.
6. Independently recompute W/D/L totals and `trainingScore=(W+0.5D)/total` from raw records. Compare to summary/frontiers; any mismatch is `PRODUCT_PATH_DATA_INTEGRITY_FAIL`.
7. Investigate extreme 100% outcomes:
   - demonstrate candidate and opponent both supplied nonempty valid teams;
   - demonstrate actual opposing strategy/placements occurred for each cell;
   - show source-side and opponent-side deployment traces;
   - exclude early termination, default-empty opponent, side mapping, and W/D/L inversion bugs.
   A candidate remains `SUSPICIOUS_UNTIL_AUDITED` until this evidence passes.

### C. Correct Classification

1. If raw output is missing or incomplete, publish `STATUS: PARTIAL`, retain the report claim as unverified, and do not fabricate/re-run data.
2. If raw evidence is complete and all checks pass, classify records:

```text
PRODUCT_PATH_FORMAL_SCREEN_T032_V1
PRODUCT_PATH_SCREEN_SIGNAL_ONLY
NOT_TIER_2
```

3. This task may correct/report T032 data classification but must not promote candidates, launch T027, or use scores to bias further mutation.

## Acceptance

- [ ] Exact pre-existing T032 output is tracked losslessly under product_path_t032 with matching SHA-256 provenance.
- [ ] Raw 60 candidate observations and 10 baseline observations meet complete 140-game product-path coverage.
- [ ] Raw product four-cost traces are individually auditable.
- [ ] Scores/frontiers recompute exactly from raw W/D/L; duplicates/no-ops flagged.
- [ ] Any 100% frontier has cell-level opponent/deployment evidence and passes integrity checks, otherwise remains suspicious.
- [ ] Historic sandbox data remains untouched and new data is clearly separate.
- [ ] No new simulation, optimization, Tier promotion, apply, or deploy.

## Delivery

Write `TASKS/tree/T034.report.md` with recovered file hashes, raw record counts, coverage/seed/side audit, baseline table, candidate integrity/duplicate findings, recomputed frontier table, 100% investigation, final classification, and explicit no-simulation/no-apply statement. Commit/push only `agent/tree`. Do not modify this specification.
