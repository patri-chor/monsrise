STATUS: OPEN

# T011 - First-Four Bundle Seed Variant and Tree Optimization

> Domain: `generation` | Decision owner: generation decision agent | Executor branch: `agent/generation`
> This is a new-formation generation task. It may invoke the existing tree optimizer as a consumer, but must not modify tree-optimizer algorithms or tree-domain tasks.

## Objective

Run the first multi-seed generation cycle using the first four formations in bundle order as independent mutation seeds. For retained generated card-deck variants, optimize their decision trees with the existing optimizer and evaluate the resulting `new deck + optimized tree` candidates against the fixed eight-opponent panel.

This task produces isolated candidate evidence only. It must not modify `FORMATION_LIBRARY`, deploy candidates, or apply optimized trees.

## Canonical Seed and Opponent Definitions

Resolve formations from the current `FORMATION_LIBRARY` at runtime and persist the resolved names/IDs in every output:

- **Mutation seeds**: exactly `FORMATION_LIBRARY.slice(0, 4)`. Do not substitute a single seed or hard-code names.
- **Evaluation panel**: exactly `FORMATION_LIBRARY.slice(0, 7)` plus the unique formation named `壕炸金猴`.
- The panel must contain exactly eight unique opponents. Fail clearly before generation/evaluation if the named eighth opponent is missing, ambiguous, or already among the first seven.
- Evaluate both sides for every candidate/opponent pairing.

## Required Workflow

1. **Multi-seed deck mutation**
   - Reuse `variant_generate.ts` existing mutation operators; do not duplicate or rewrite them.
   - Generate a bounded candidate set independently from each of the four resolved seeds.
   - Use a fixed generation seed per source seed and persist it.
   - Use no more than 6 generation attempts per source seed in this first cycle; record attempts, accepted mutations, duplicate rejections, and structural rejections.
   - Preserve card/monster, badge, combo-module, placement/layout variation exposed by the existing generator. Record mutation direction and canonical team/tree fingerprints.

2. **Pre-tree screening and retention**
   - Before tree optimization, evaluate or score deck variants only against the fixed eight-opponent panel with deterministic seed bases, both sides, and at most 2 workers.
   - Retain a bounded input set for tree optimization using the accepted policy: performance plus archetype/module/mutation coverage, maximum 6 total.
   - Exploratory retention requires coarse `adScore >= 0.25`; `0` score candidates cannot be retained.
   - Persist why each source candidate was retained or rejected. Do not force capacity.

3. **Tree optimization as a generation-stage consumer**
   - For each retained deck candidate, create an isolated evol formation that retains the candidate team and uses its mapped/reference tree as the baseline.
   - Invoke the existing public tree optimization entry point without modifying `branch_induct.ts`, `tree_ops.ts`, `evol_gene.ts`, `cycle_optimize.ts`, `arena.ts`, or any tree-domain task file.
   - The optimizer's search and independent validation must use deterministic, distinct seed bases, recorded per candidate.
   - Restrict all optimizer evaluation and final comparison to the fixed eight-opponent panel. Do not silently fall back to all formations or the old three-target evaluator.
   - Preserve base-tree and optimized-tree fingerprints and all optimizer trigger/validation/no-op diagnostics.

4. **Final comparison and quality report**
   - For every retained deck, compare baseline mapped/reference tree versus optimized tree against the eight-opponent panel using independent final-validation seeds.
   - Report per candidate: source seed, deck mutation summary, base and optimized fingerprints, both-side score, per-opponent result, aggregate score, weakest cell, optimizer verdict, and independent before/after delta.
   - Categorize each as exactly one of:
     - `tree_optimized_candidate`: independent validation passes the existing optimizer gate;
     - `deck_only_candidate`: valid deck but optimization no-op or validation does not pass;
     - `archive`: fails the 25% performance floor or structural/validation requirements.
   - Do not claim optimization success from a search-only improvement.

## Output Isolation

Write only under `reports/new-formation-generation/first-four-cycle/`:

- `seed_manifest.json`
- `generated_candidates.jsonl`
- `retention.json` and `retention.md`
- `tree_optimization_results.jsonl`
- `summary.md`
- optional diagnostics JSON files

Every output must include run timestamp, resolved seed list, resolved eight-opponent panel, effective resource settings, and seed bases. Do not write or overwrite `reports/new-formation-pilot/`, `reports/optimized/`, shared matrix/state reports, or any active-library artifact.

## Safety and Resource Constraints

- At most 2 arena workers for this cycle.
- No `apply_optimized.ts`, deployment, bundle build, active-library mutation, or full matrix.
- Do not modify `src/ai/formation_library.ts`, `public/ai-bundle.iife.js`, tree optimizer source files, or tree-domain tasks.
- If the tree optimizer cannot accept a fixed opponent panel through an existing interface, write `STATUS: PARTIAL` with the exact missing interface and stop before running any candidate tree optimization. Do not edit the optimizer to work around it in this task.

## Acceptance

- [ ] Manifest resolves exactly four source seeds by current bundle order and exactly eight unique panel opponents (first 7 plus `壕炸金猴`).
- [ ] Each source seed has independent bounded mutation statistics; no seed is silently skipped.
- [ ] Generated and retained records have canonical deck/tree identity, source seed, mutation direction, and reproducibility metadata.
- [ ] No more than six candidates enter tree optimization; no zero-score or below-25%-coarse exploration candidate enters it.
- [ ] Each optimized candidate has an explicit baseline-versus-optimized comparison on the fixed eight-opponent panel, both sides, with independent validation seeds.
- [ ] Search-only improvements are never labeled `tree_optimized_candidate`.
- [ ] All output is isolated in `reports/new-formation-generation/first-four-cycle/`.
- [ ] `FORMATION_LIBRARY` remains byte-identical; no deployment/apply operation runs.
- [ ] Add focused tests for seed/panel resolution, bounded per-seed mutation scheduling, retention-floor enforcement, and output isolation. Run these plus existing relevant generator/optimizer regression tests.

## Delivery

Write `TASKS/generation/T011.report.md` with resolved seed/panel names, mutation and retention counts per seed, exact commands/settings, test results, optimizer/no-op/pass counts, final category counts, output paths, and explicit confirmation that no active formation was changed. Commit and push only from `agent/generation`; do not modify this task file.
