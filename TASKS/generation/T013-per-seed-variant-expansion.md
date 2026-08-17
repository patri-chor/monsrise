STATUS: OPEN

# T013 - Per-Seed Variant Expansion and Independent Retention

> Domain: `generation` | Decision owner: generation decision agent | Executor branch: `agent/generation`
> Prerequisite: T011/T012 first-four cycle artifacts are retained as historical evidence. This task expands the candidate pool only; it does not run tree optimization.

## Objective

Correct the retention unit from one global six-candidate pool to **up to six retained variants per source seed**. Use the current bundle-order first four formations as independent sources, expand their mutation search, and freeze a per-seed candidate pool of at most 24 total variants for later generation-stage tree optimization.

## Canonical Seeds and Evaluation Panel

Resolve at runtime and persist names/IDs:

- Source seeds: exactly `FORMATION_LIBRARY.slice(0, 4)`.
- Evaluation panel: exactly `FORMATION_LIBRARY.slice(0, 7)` plus the unique formation named `壕炸金猴`.
- The panel must have exactly eight unique opponents; fail before generation if not.
- Every candidate/panel pairing must evaluate both sides.

## Required Workflow

1. **Independent bounded expansion**
   - Use existing `variant_generate.ts` mutation operators through shared helpers; do not copy or rewrite operators.
   - For each of the four source seeds independently, make at most **20 attempts** with a deterministic seed stream derived from a documented global base and source index.
   - Track generated, duplicate, structural-rejection, evaluation-failure, and accepted counts per seed.
   - A source that yields fewer than six eligible variants is valid; report its shortfall. Never fill its pool with invalid, duplicate, or below-floor candidates.

2. **Fixed-panel screening**
   - Evaluate only against the canonical eight-opponent panel, both sides, using at most two workers.
   - Use fixed, persisted seed bases. Do not use all-library or three-target fallback evaluation.
   - Keep coarse evaluation budget bounded at one game per opponent/side for this expansion. No refined evaluation in T013.

3. **Per-seed retention**
   - Apply `selectRetainedCandidates` separately to each source seed's own generated candidate list with `maxRetained: 6` and `explorationFloor: 0.25`.
   - Do not place candidates from different seeds in the same capacity competition.
   - Each source's retention must preserve, when available and eligible: performance baseline, module/direction coverage, mutation-bucket coverage, then novelty exploration.
   - Candidates with coarse `adScore < 0.25` may not be retained as exploration. Candidates at `0` must never be retained.
   - Deduplicate within a seed and globally across all generated candidates by canonical team key and tree fingerprint. For a cross-seed duplicate, retain it only under the earliest source index and record deterministic duplicate rejection under subsequent sources.

4. **Freeze outputs for later tree optimization**
   - Write a single `frozen_candidates.jsonl` containing every per-seed retained candidate with source metadata, coarse score, mutation vector, retention reasons, canonical identities, and reproducibility data.
   - The expected capacity is `4 * 6 = 24`, not a mandatory count. No tree optimizer, branch induction, arena evaluation beyond screening, deployment, or active-library mutation occurs in this task.

## Output Isolation

Write only under `reports/new-formation-generation/per-seed-expansion/`:

- `seed_manifest.json`
- `generated_candidates.jsonl`
- `retention_by_seed.json`
- `retention_by_seed.md`
- `frozen_candidates.jsonl`
- `summary.md`
- optional diagnostics JSON

Do not overwrite T011 outputs in `reports/new-formation-generation/first-four-cycle/` or anything under `reports/new-formation-pilot/`.

## Tests

Add focused tests proving:

- runtime seed/panel resolution returns four sources and eight unique opponents;
- each source receives no more than 20 independent attempts;
- two sources with six eligible variants each retain up to six each rather than sharing a global cap of six;
- below-25% and zero-score candidates cannot be retained as exploration;
- cross-seed duplicate canonical/team-tree records have one deterministic owner;
- frozen output count is at most 24 and records source provenance and reasons;
- test execution uses only `tests/.tmp/` and preserves all production pilot/T011/T013 output files byte-identically;
- `FORMATION_LIBRARY` remains unchanged.

Run focused tests and one explicit isolated CLI/runner invocation. Do not run an arena worker count above two.

## Constraints

- Do not modify `src/ai/formation_library.ts`, `public/ai-bundle.iife.js`, `branch_induct.ts`, `tree_ops.ts`, `evol_gene.ts`, `cycle_optimize.ts`, tree-domain tasks, deployment/apply code, or task-system files.
- Do not call a tree optimizer in T013. The fixed-panel optimizer interface is a separate tree-domain prerequisite.
- No output outside the declared isolated output directory or test temp paths.

## Delivery

Write `TASKS/generation/T013.report.md` with per-seed attempts/generated/retained/shortfall counts; resolved seeds/panel; seed bases; score and mutation-bucket distributions; cross-seed duplicate decisions; frozen total; test results; output paths; and explicit confirmation that no tree optimization, deployment, or active-library mutation occurred. Commit and push only from `agent/generation`; do not modify this task file.
