STATUS: OPEN

# T007 - Fixed Opponent Panel for Tree Optimizer

> Domain: `tree` | Decision owner: tree decision agent | Executor branch: `agent/tree`
> This is a tree-optimizer API task. It enables callers to constrain optimization evaluation to a supplied formation panel without changing the default all-library behavior.

## Objective

Extend the public `optimizeFormation` API in `src/engine/tree/branch_induct.ts` with an optional fixed opponent panel. The supplied panel must govern every optimizer stage: trace collection, branch/split induction, matched-opponent selection, branch-local search, and independent validation.

The generation domain requires this API to optimize frozen new-deck candidates against exactly eight opponents: bundle order first seven plus `壕炸金猴`.

## Required API

Export a named options interface, for example:

```ts
export interface OptimizeFormationOptions {
  opponents?: Formation[];
  searchSeedBase?: number;
  validationSeedBase?: number;
}

export function optimizeFormation(
  BundleAI: any,
  src: Formation,
  gamesPerOpp: number,
  options?: OptimizeFormationOptions,
): OptimizeFormationResult | null;
```

- `opponents` omitted: preserve existing behavior exactly, using `FORMATION_LIBRARY`.
- `opponents` supplied: use precisely that panel in every evaluation/selection/validation path; do not union, replace, reorder, or silently fall back to all formations.
- Reject an empty supplied panel with a clear error before simulation.
- Keep seed defaults and all existing caller compatibility unchanged.

## Required Implementation Scope

1. Derive one immutable `effectiveOpponents` list once near the entry point.
2. Replace all direct optimizer-stage iteration/filtering that relies on global `FORMATION_LIBRARY` with that list.
3. Ensure `searchValidation.matchedOpponents` contains only effective-panel names.
4. Add the effective-panel names/IDs to the result diagnostics or `searchValidation` so callers can audit what was actually evaluated.
5. Update optimizer console output to report the effective opponent count rather than claiming all library formations.

## Tests

Add focused tests to `tests/branch_induct_evaluation.test.ts` or a new dedicated tree-domain test proving:

- no `opponents` option preserves the complete current default panel;
- a custom two-formation panel causes all recorded simulation targets and result diagnostics to contain only those two formations;
- a supplied fixed eight-formation panel is accepted unchanged and appears unchanged in diagnostics;
- no target outside a custom panel is evaluated during trace collection, branch search, or validation;
- empty panel fails explicitly before a simulation is started;
- current independent validation rule remains enforced: `improved=true` requires undefeated delta >= 0.05 with no loss increase.

Mock/stub simulation where practical; do not perform high-cost full matrix or deployment. Do not modify `FORMATION_LIBRARY`, `public/ai-bundle.iife.js`, generation-domain task files, or apply/deploy code.

## Acceptance

- [ ] Backward-compatible existing callers compile and run without passing options.
- [ ] Custom panels constrain every stage listed above, proven by focused tests.
- [ ] Fixed eight-panel caller can audit exact panel identity from result diagnostics.
- [ ] Empty panel fails safely and does not simulate.
- [ ] Existing branch-induction evaluation tests pass and no new TypeScript errors occur in edited files.
- [ ] No active formation is modified or deployed.

## Delivery

Write `TASKS/tree/T007.report.md` with changed files, test commands/results, panel propagation evidence, default compatibility evidence, and confirmation that no active formation/deployment changed. Commit and push only from `agent/tree`; do not modify this task specification.
