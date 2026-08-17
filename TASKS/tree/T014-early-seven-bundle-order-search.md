STATUS: OPEN
DOMAIN: tree

# T014 - Early Seven-Bundle Ecosystem and Calculated-Unit Order Search

> Domain: `tree` | Executor branch: `agent/tree`
> Prerequisites: T012 control and T013 task-bus preservation are accepted.

## Objective

Test whether sequence optimization is effective when candidates learn against the complete, representative early seven-bundle ecosystem rather than only the current strong/opponent-changing panel.

Do not divide the seven early bundles into separate A/B opponent groups. All seven must be available to both optimization and independent validation. Isolation comes from held-out variants and seeds within each same bundle family.

## Why This Experiment

Manual inspection found no obvious deck or planned-layout defect in the ten displayed candidates. The existing current strong panel may obscure small but real tree improvements because opponents are stronger and change over time.

Special and aiming units have calculator-controlled final positioning. Their tree coordinates are not an effective search dimension. Their deployment order, round timing, and effect interaction are the controllable dimension. Prayer-like candidates with fewer calculator-controlled units retain meaningful early R1/R2 placement decisions, while their R3-R5 order remains important.

## A. Committed Early Seven-Bundle Fixture

1. Commit a deterministic fixture under `tests/fixtures/tree/` containing exactly seven representative early bundle families.
2. Each family must include:
   - stable family ID and Chinese name;
   - a complete formation snapshot (`team`, badges, tree);
   - at least two deterministic legal variants, including the canonical early snapshot;
   - variant IDs and immutable construction seed/recipe;
   - family-level explanation of the strategic archetype represented.
3. The fixture is the source of truth. Do not read ignored reports or current `FORMATION_LIBRARY` at runtime.
4. Preserve all seven families in both search and validation:
   - search uses one selected training variant per family;
   - validation uses a distinct held-out variant of that same family, or the same variant under a non-overlapping fixed seed schedule only when a valid second variant cannot exist;
   - report the exact family, variant ID, and seed assignment for every match.
5. Add a fixture integrity test proving seven families, complete legal formation data, and no search/validation variant leakage.

## B. Single-Variable Search: Calculated-Unit-Ratio-Driven Order

This task changes only order/timing search. Keep T012 control behavior for all other dimensions.

1. Define and report:

```text
calculatedUnitRatio =
  (special calculator units + aiming calculator units in the candidate team)
  / candidate team size
```

The calculator-controlled set is exactly what `isPositionIrrelevant()` defines. Never infer it from a display coordinate.

2. Route candidate actions deterministically:
   - `ratio >= 0.50`: sequence-only search for all R1-R5; do not generate position candidates for calculator-controlled units.
   - `ratio < 0.50`: R1/R2 may use existing ordinary position search for position-controllable units only; R3-R5 use sequence-only search; no position candidate for calculator-controlled units at any round.
3. Order/timing candidate operators must be bounded and legal:
   - reorder placements inside a round;
   - move one unit earlier or later by at most one round;
   - move one unit into an adjacent round only if budget curve, unique deployment, tree legality, architecture/tactical requirements, and all referenced branch paths remain valid;
   - do not mutate deck membership, badges, branching features, or conditions.
4. Do not limit order search to adjacent swaps. Enumerate all legal within-round orders for the affected round, capped with a documented deterministic maximum; include at least one non-adjacent ordering case in tests.
5. A candidate is accepted only by held-out early ecosystem validation aggregate trainingScore improvement >=0.05 with no increased losses. Search-set gains alone are insufficient.

## C. Current Strong-Panel Generalization Check

1. Do not use the current strong panel to train or select an order candidate.
2. After an early-ecosystem validated improvement, evaluate original and optimized candidate on the current fixed strong panel using the existing T012 panel fixture/definition and non-overlapping fixed seeds.
3. Record this as generalization evidence only. It cannot overturn early-ecosystem acceptance, but must flag any regression worse than:

```text
aggregate trainingScore delta < -0.05
or weakest-cell trainingScore delta < -0.10
```

4. No candidate is applied in this task regardless of result.

## D. Protocol and Controls

- Use the same 8 frozen candidates, exactly 2 each from s1/s2/s3/s4.
- Outer candidate concurrency <=2.
- Final games per opponent/side cell >=5.
- Training score = `(win + 0.5 * draw) / total`.
- No low-score cell pool.
- No external deck search or team membership replacement.
- No badge mutation.
- No R1/R2 opening-specific position operator beyond the existing ordinary position search allowed only for ratio <0.50 and only on controllable units.
- No generation-domain changes, active library mutation, bundle update, shared matrix/state update, apply/deploy, or watcher change.

## Required Output

Output only to:

```text
reports/new-formation-generation/early-seven-bundle-order-search-proof/
```

Include:

- seven-family fixture manifest and search/holdout variant separation;
- per-candidate calculatedUnitRatio and routed operator set;
- per-candidate attempted order moves in Chinese, with before/after R1-R5 order;
- explicit proof that no position candidate was generated for calculator-controlled units;
- early search and held-out validation trainingScore/W-D-L;
- current strong-panel original/optimized generalization result;
- terminal outcomes including validation rejection and generalization warning;
- Chinese final grid for every optimized candidate, with calculator-controlled units clearly marked as computed position.

## Acceptance

- [ ] Exactly seven committed early families with legal canonical and holdout variants.
- [ ] Search and validation include all seven families and do not share a variant/seed pairing.
- [ ] Exactly 8 candidates, 2 per source seed.
- [ ] Calculated ratio is correct and determines operator routing.
- [ ] Calculator-controlled units receive zero position candidates.
- [ ] A non-adjacent legal within-round order case is tested.
- [ ] No external deck, badge, low-score-pool, or new opening-specific operator is used.
- [ ] Held-out early validation controls adoption; current strong panel is report-only generalization.
- [ ] T009, T012, and T013 focused tests still pass.
- [ ] Preservation check passes and no unrelated `TASKS/tree/` file is deleted.
- [ ] Zero worker errors and no candidate application.
- [ ] `npx tsc --noEmit` adds no errors in changed files; pre-existing errors are documented.

## Delivery

Write `TASKS/tree/T014.report.md` with fixture provenance, family/variant assignments, metrics, operator counts, current-panel generalization table, test output, no-apply confirmation, and task-bus preservation result. Commit and push only `agent/tree`. Do not modify this specification.
