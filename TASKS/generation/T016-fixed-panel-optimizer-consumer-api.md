STATUS: OPEN

# T016 - Fixed-Panel Optimizer Consumer API

> Domain: `generation` | Decision owner: generation decision agent | Executor branch: `agent/generation`
> This task serves the generation workflow. It adds a caller-controlled opponent-panel boundary to the existing optimizer without changing its tree-decision algorithm, split logic, search moves, acceptance gate, or default all-library behavior.

## Objective

Enable generation to call the existing `optimizeFormation` implementation against the exact same fixed eight-opponent panel used for candidate generation and screening: bundle order first seven formations plus `壕炸金猴`.

This is an API and evaluation-scope change, not a tree-optimizer algorithm improvement. Do not alter branch induction heuristics, optimization operators, experience semantics, validation thresholds, or tree-domain task files.

## Required API

In `src/engine/tree/branch_induct.ts`, export a backwards-compatible options interface:

```ts
export interface OptimizeFormationOptions {
  opponents?: Formation[];
  searchSeedBase?: number;
  validationSeedBase?: number;
}
```

and update the public function to accept it while preserving existing callers:

```ts
optimizeFormation(BundleAI, src, gamesPerOpp, options?)
```

Behavior:

- Omitted `opponents`: exactly preserve current `FORMATION_LIBRARY` behavior.
- Supplied `opponents`: use exactly that list, preserving order, for initial trace collection, sample derivation, matched-opponent filtering, branch-local search, independent validation, result diagnostics, and console reporting.
- Empty supplied list: throw a clear error before any simulation.
- Do not silently union with, replace with, or fall back to `FORMATION_LIBRARY`.

## Tests

Add focused tests proving:

1. Omitted options preserve the complete current default panel.
2. A custom two-formation panel produces no trace, simulation target, matched opponent, or validation result outside those two formations.
3. The canonical generation panel `FORMATION_LIBRARY.slice(0, 7)` plus `壕炸金猴` is accepted unchanged and appears unchanged in result diagnostics.
4. Empty panel fails before simulation.
5. Existing validation semantics remain intact: optimization is only `improved` when independent validation has undefeated delta >= 0.05 and losses do not increase.
6. Existing callers compile/run without passing options.

Use mocks/stubs for simulations where practical. Do not run full matrix, deployment, apply, or active-library writes.

## Constraints

- Do not modify `src/ai/formation_library.ts`, `public/ai-bundle.iife.js`, tree-domain task files, deployment/apply scripts, or generation candidate datasets.
- Do not alter branch split scoring, branch placement search, validation thresholds, experience storage, or default optimizer semantics.
- Do not run a 24-candidate generation optimization cycle in this task; T015 will consume the API after this task is accepted.

## Delivery

Write `TASKS/generation/T016.report.md` with changed files, tests/results, default-compatibility evidence, panel-propagation evidence, and confirmation that no algorithmic tree-optimizer behavior, active formation, or deployment was changed. Commit and push only from `agent/generation`; do not modify this task file.
