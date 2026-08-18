STATUS: OPEN
DOMAIN: tree

# T022 - Four-Cost Fidelity Gate and Resumable Multi-Source Experience Training

> Domain: `tree` | Executor branch: `agent/tree`
> Run after T021 evidence repair. This task replaces all prior small-sample strength claims with a gated, resumable evidence program. No active bundle change, apply, or deploy.

## Context and Non-Assumption

After error-preserving diagnostics, all-two-cost sources are the only sources with nonzero results in the current short panel, while many formations containing four-cost units complete as `0W/0D/70L` without worker errors. This is a strong diagnostic signal but **not proof** that four-cost handling is already correct or incorrect.

No prior T014/T016/T017/T021 score is adoption evidence. Treat all historical candidates as provenance and diagnostic seeds only. Tier 1 remains exactly the current frozen 11 bundle formations; Tier 2 begins empty.

## Objective

1. Establish whether four-cost units are faithfully deployed, budgeted, ordered, and branched through the same engine/bundle path used for training.
2. If and only if the fidelity gate passes, begin a new high-sample, multi-source, resumable diversity-mutation pipeline covering every executable 8-monster source.
3. Persist every completed comparison, candidate, result, and conclusion in a cumulative experience library so subsequent training reuses evidence rather than replacing it.

## Phase A - Four-Cost Fidelity Gate (Must Complete Before Mutation Training)

### A1. Baseline Executability Matrix

Evaluate each frozen Tier 1 baseline using the repaired worker contract:

- early-seven training variants and held-out variants;
- both sides;
- at least 10 games per family/side cell for diagnosis;
- record W/D/L, completion/error state, and per-round deployment trace.

`gift_jungle` remains a 7-monster legacy baseline and is reported separately. It is not a new-mutation source.

### A2. Matched Four-Cost Differential Tests

For every four-cost unit actually present in the ten executable 8-monster Tier 1 sources:

1. Construct deterministic minimal **matched-control** evol formations using the same legal team/tree context, differing only in the target unit's deployment treatment where permitted:
   - original exact planned deployment;
   - same-round legal order swap with a lower-cost unit;
   - adjacent legal round shift earlier/later when budget/path rules permit;
   - a no-op serialization round trip `Evol -> bundle -> Evol` control.
2. Capture per game and per round:
   - selected branch/node ID;
   - planned placements in order;
   - actual accepted placements / skipped placements;
   - remaining budget before/after each placement;
   - reason for any skipped/failed placement;
   - game completion and worker error.
3. Compare direct Evol execution with `evolToBundleFormation` then `formationToEvol` round-trip execution. Their canonical tree/deployment traces must agree exactly apart from explicitly documented label normalization.
4. A four-cost unit fails fidelity if any valid planned placement is silently skipped, deployed at a wrong round/order, causes an unexplained budget rejection, differs across conversion route, or produces a worker error.
5. Record failures in a committed `four_cost_fidelity_ledger.jsonl` with source, candidate/control ID, monster ID/name, round, side, seed, planned/actual action, budget evidence, error, and deterministic reproduction command.

### A3. Gate Decision

- **PASS** only if all tested valid four-cost placements are trace-equivalent, all evaluation cells complete with zero worker errors, and no unexplained skipped placement exists.
- **FAIL** if any mismatch exists. On failure, stop before mutation training and write `STATUS: PARTIAL` report with root-cause evidence and a narrow rework proposal. Do not reinterpret all-loss results as tactical weakness.
- The acceptance test must include a deliberate four-cost placement corruption and prove the gate fails before any optimizer call.

## Phase B - High-Sample, Multi-Source Mutation and Screening (Only After A3 PASS)

### B1. Candidate Pool

1. Sources: all ten executable 8-monster Tier 1 formations, not only all-two-cost sources. Retain `gift_jungle` separately as legacy baseline.
2. Seed pool per source:
   - frozen Tier 1 baseline;
   - historical candidates as unadopted provenance seeds only;
   - new deterministic mutations.
3. Generate at least 6 structurally coherent, behaviorally distinct new mutations per executable source, balanced across light/medium/heavy novelty where legal. This yields >=60 new candidates.
4. Every new candidate must have exactly 8 monsters, no total-cost ceiling, full static tree/deck closure, and engine preflight before screening.
5. Preserve source identity and canonical tree/deck fingerprint. New mutations never overwrite source baselines or historical candidates.

### B2. Evaluation Evidence Ladder

1. **Preflight**: early-seven × both sides × 1 game/cell. Structural/runtime only.
2. **Initial screen**: early-seven held-out × both sides × 10 games/cell (140 games/candidate). Do not rank any incomplete/error candidate.
3. **Promotion evaluation**: candidates meeting documented source-relative signal floor receive three independent seed schedules, each early-seven held-out × both sides × 25 games/cell (1,050 games/candidate total).
4. **Generalization**: promoted candidates receive independent current strong-panel evaluation using the same three-schedule high-sample policy. It is not a training signal.
5. Report W/D/L, trainingScore, source-baseline delta, schedule median/minimum, error counts, and uncertainty interval (bootstrap or an explicit deterministic binomial interval). Do not call a candidate strong based only on a point estimate.
6. Candidate selection must compare against its own source baseline and the best complete prior experience record from that source; it must not compare broken/absent sources against all-two-cost candidates only.

### B3. Cumulative Experience Library

Create a committed append-only experience library under:

```text
tests/fixtures/tree/experience_library/
```

Required data:

1. `manifest.json` - schema version, protocol version, source/fixture fingerprints, code commit, run IDs, seeds, and archive references.
2. `source_baseline_evidence.jsonl` - every baseline panel result and trace summary.
3. `four_cost_fidelity_ledger.jsonl` - Phase A evidence, including pass/fail status.
4. `candidate_registry.jsonl` - immutable candidate identity, source, parent/provenance, mutation vector, canonical deck/tree fingerprint, legality and preflight status.
5. `evaluation_observations.jsonl` - append-only per schedule/panel aggregate W/D/L/score/error/uncertainty records. Never overwrite an earlier observation.
6. `promotion_decisions.jsonl` - decision, evidence references, reason, and whether candidate was promoted/rejected/deferred.
7. `source_frontiers.json` - deterministic current best complete candidates by source and diversity behavior, derived from observations only.
8. `README.md` in Chinese explaining that historical small-sample data is provenance, not adoption evidence, and documenting append-only semantics.

A new run must deduplicate by canonical fingerprint and reuse existing complete observations for the exact same protocol/seed schedule; changed code/protocol creates a new observation rather than overwriting old data.

## Phase C - Tiering Rules

Do not create Tier 2 merely to fill it. Tier 2 requires high-sample evidence:

- zero runtime errors;
- complete preflight and all promoted schedules;
- source-relative held-out median improvement with its lower uncertainty bound > 0;
- no schedule worse than source baseline beyond a documented tolerance;
- independent strong-panel result complete and no material regression;
- unique behavior/deck/tree fingerprint.

Tier 3 may contain complete, safe exploratory candidates with documented uncertainty, but must not be called stronger than its source baseline unless its high-sample evidence supports that statement.

Tier 1 remains the frozen 11 current formations. No candidate is applied automatically.

## Operational Requirements

1. The pipeline must be a deterministic script with `--smoke`, `--resume`, `--phase=fidelity|screen|promotion|full`, atomic cursor/checkpoint after every candidate/schedule, and no overnight AI decisions.
2. Outer candidate concurrency <=2; worker concurrency must be explicitly recorded.
3. A fidelity failure, worker error, incomplete schedule, or insufficient evidence must halt only the affected candidate/source and record a clear status; never convert it into a loss or silently continue as a ranking result.
4. Full run may continue overnight only after `--smoke` and Phase A acceptance pass. It must leave a recoverable cursor and append to the experience library.
5. Preserve all `TASKS/tree/` files. Do not modify `TASKS/generation/**`, `FORMATION_LIBRARY`, bundle artifacts, shared matrix/state, or `scripts/watch-gemini.ps1`.

## Acceptance

- [ ] Four-cost fidelity ledger covers every four-cost unit in executable Tier 1 sources, with per-round planned-vs-actual deployment/budget evidence.
- [ ] A negative four-cost control is caught before optimization; no unexplained placement mismatch or worker error exists on Phase A PASS.
- [ ] New mutation training starts only after documented Phase A PASS; otherwise a partial diagnostic report stops safely.
- [ ] At least 6 new candidates per executable 8-monster source and >=60 total, not concentrated on all-two-cost sources.
- [ ] Every candidate is static-valid, engine-preflighted, and evaluated with error-preserving metrics.
- [ ] No high-sample Tier 2/Tier 3 strength conclusion depends on the prior small-sample records alone.
- [ ] Experience library is committed, append-only, fingerprinted, resumable, and records all source baselines/candidates/observations/decisions.
- [ ] T013 preservation and new fidelity/experience tests pass, with no apply/deploy.

## Delivery

Write `TASKS/tree/T022.report.md` with Phase A PASS/FAIL evidence, four-cost coverage and mismatch table, source coverage, exact completed evaluation counts, experience-library paths, resumable command/cursor, test commands, and explicit no-apply confirmation. Commit/push only `agent/tree`. Do not modify this specification.
