STATUS: OPEN

# T009 - Diversity-Aware Candidate Retention

> Domain: `generation` | Decision owner: generation decision agent | Executor branch: `agent/generation`
> Prerequisites: T006 and T008 are accepted. This task analyzes existing pilot output only. It must not evaluate battles or mutate active formations.

## Objective

Turn an evaluated new-formation pilot dataset into a small, explainable retained candidate pool that balances performance, archetype/module coverage, and innovative mutation directions.

The retained pool has a hard maximum of **6 candidates**. Exploratory candidates require a coarse `adScore` of at least **0.25**. A candidate with coarse score `0` must never be retained as exploration.

## Input and Output

- Read only the current isolated pilot dataset: `reports/new-formation-pilot/candidates.jsonl`.
- Write only under `reports/new-formation-pilot/`:
  - `retention.json`: machine-readable analysis and retained candidates;
  - `retention.md`: human-readable decision report.
- Do not overwrite `candidates.jsonl`, `summary.md`, or `diagnostics.json`.
- If input is missing, malformed, or has no evaluated candidate, terminate with a clear non-zero error and do not create a misleading retention result.

## Required Analysis

For every candidate, calculate and persist an explainable mutation vector relative to its recorded `referenceFormation`:

1. `deckMutation`
   - monster set additions, removals, and symmetric-difference count relative to reference team;
   - core-change boolean (`coreKey` versus reference core when derivable; otherwise record `unknown`, never invent a value);
   - total cost delta.

2. `badgeMutation`
   - count of common monster IDs whose sorted badge lists differ from the reference;
   - count of badge IDs added/removed across common monsters.

3. `treeMutation`
   - canonical tree fingerprint comparison;
   - placement differences counted by `(round, monsterId, x, y)` relative to the reference tree;
   - branch/node-structure difference count when structurally derivable.

4. `direction`
   - `archPath`, `modulePath`, `coreKey`, and a deterministic mutation bucket: `light`, `medium`, or `heavy`.
   - Bucket thresholds must be documented in code and the report. Use normalized component distances; do not classify from display name.

5. `noveltyScore`
   - a deterministic 0..1 score derived only from the preceding mutation components;
   - persist its component values and formula/version so results are auditable;
   - do not use arena score as an input to novelty.

Reference formation team/tree must be read from the existing formation library using `referenceFormation`; missing references must yield an explicit per-candidate analysis error and prevent that candidate from retention.

## Retention Policy

Rank performance using `refinedEvaluation.adScore` when present; otherwise use `coarseEvaluation.adScore`. Persist the score source.

Select without duplicates by `canonicalKey` or `treeFingerprint`, in this priority order until the maximum of 6 is reached:

1. **Performance baseline**: retain the highest-ranked evaluated candidate overall.
2. **Direction representatives**: retain the best eligible candidate for each uncovered `archPath`; then, while capacity remains, prefer candidates that cover an uncovered `(archPath, modulePath)` direction.
3. **Mutation coverage**: retain the best eligible candidate for each uncovered mutation bucket (`light`, `medium`, `heavy`) where one exists.
4. **Exploration**: use remaining capacity for candidates not already covered by the preceding selections, ordered by novelty score descending, subject to coarse score >= `0.25`.

Each retained record must contain one or more explicit `retentionReasons` from: `performance_baseline`, `archetype_coverage`, `direction_coverage`, `mutation_bucket_coverage`, `exploration_novelty`.

Candidates that are not retained must have a deterministic `rejectionReason`, including score-floor rejection where applicable. Do not force six records if the evaluated input does not justify them.

## CLI and Tests

1. Add a CLI runner, for example `src/engine/tree/candidate_retention.ts`, with:
   - `--input <path>` (default isolated pilot JSONL);
   - `--output-dir <path>` (default isolated pilot directory);
   - `--max-retained <n>` (default 6; reject values outside 1..6);
   - `--exploration-floor <0..1>` (default 0.25).

2. Add focused tests using fixtures or in-memory records. Tests must prove:
   - novelty vector and bucket calculation are deterministic;
   - a high-score performance baseline is kept;
   - each available archetype gets coverage before extra exploration selections;
   - low-score exploration candidates below 0.25 are rejected;
   - no duplicate canonical team or tree fingerprint is retained;
   - output has at most six records and every retained record has an explicit reason;
   - malformed/missing input fails safely;
   - `FORMATION_LIBRARY` is unchanged.

3. Run `npx vite-node` for the focused test and one CLI invocation against the current isolated pilot dataset. Do not invoke `evaluateBatchParallel`, workers, or any arena command.

## Constraints

- Do not modify `src/ai/formation_library.ts`, `public/ai-bundle.iife.js`, `arena.ts`, tree-domain task files, or any deployment/apply code.
- Do not run an arena evaluation, full matrix, cycle optimizer, or any worker process.
- Do not promote, deploy, or apply retained candidates. Retention is a review artifact only.
- Do not write outside `reports/new-formation-pilot/`.

## Delivery

Write `TASKS/generation/T009.report.md` with changed files, exact test commands/results, the documented novelty formula and bucket thresholds, retained/rejected counts by reason, output paths, and explicit confirmation that no battle evaluation or active-library mutation occurred. Commit and push only from `agent/generation`; do not modify this task file.
