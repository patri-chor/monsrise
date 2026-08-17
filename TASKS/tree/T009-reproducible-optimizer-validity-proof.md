STATUS: OPEN
DOMAIN: tree

# T009 - Reproducible Optimizer Validity Proof

> Domain: `tree` | Executor branch: `agent/tree`
> This is a rework task for failed T008 acceptance. T008 report status is not accepted: its claimed proof run cannot execute in a clean tree checkout.

## Failed Acceptance Evidence

On `agent/tree` commit `11a34e8`, the T008 targeted test produced:

```text
[Test 1] concurrent request isolation: PASS
[Test 2] init singleton guard: PASS
[Test 3] gamesPerCellFinal < 3 rejection: PASS
[Test 4] FAILED
Error: Authoritative candidates file not found at:
reports/new-formation-generation/first-four-cycle/generated_candidates.jsonl
```

The T008 report claimed proof artifacts under `reports/new-formation-generation/optimizer-validity-proof/`, but those artifacts are ignored and absent from a clean `agent/tree` checkout. T008 also added `src/engine/tree/first_four_generation.ts`, violating its prohibition on mutation/generation operators.

## Objective

Make the optimizer-validity proof executable and verifiable from a clean tree checkout without generation-domain data or generation source changes. Preserve the valid T008 request-safety and metric work only after its tests demonstrably pass.

## Allowed Files

- `src/engine/tree/persistent_pool.ts`
- `src/engine/tree/fine_grained_worker.ts`
- `src/engine/tree/candidate_optimization_runner.ts`
- `src/engine/tree/sequential_tree_optimization.ts`
- `src/engine/tree/accelerated_tree_optimization.ts`
- `src/engine/tree/match_metrics.ts`
- Test fixtures under `tests/fixtures/tree/`
- Focused tree tests
- `TASKS/tree/T009.report.md`

## Prohibited Files

- `src/engine/tree/first_four_generation.ts`
- Any mutation/generation operator or generation-domain source/report
- `TASKS/generation/**`
- Active `FORMATION_LIBRARY`, bundle artifacts, shared matrix/state, apply/deploy code
- `scripts/watch-gemini.ps1`

## Required Changes

1. Remove T008's dependency on ignored `reports/new-formation-generation/first-four-cycle/generated_candidates.jsonl` for tests/proof.
2. Add a small committed, deterministic fixture of exactly four valid candidate records under `tests/fixtures/tree/`, or let the proof runner accept an explicit fixture path and have the test pass that fixture.
3. The fixture must provide only candidate data necessary for tree optimization; it must not import generation operators or write generation source artifacts.
4. Ensure the proof test can start from a clean checkout and generate `reports/new-formation-generation/optimizer-validity-proof/` during test execution.
5. Ensure proof output is regenerated, then verify all required files before test success:
   - `panel_manifest.json`
   - `optimization_results.jsonl`
   - `independent_final_evaluation.jsonl`
   - `quality_decision.json`
   - `summary.md`
6. Retain and verify all T008 functional requirements:
   - concurrent pool dispatch attribution is safe;
   - init is singleton-safe;
   - malformed/incomplete results cannot reach W/D/L access;
   - detailed optimizer outcomes are emitted;
   - trainingScore drives classification and quality gate;
   - `gamesPerCellFinal < 3` is rejected;
   - default final games/cell is >=5;
   - weakest cell records opponent, side, W/D/L, trainingScore, pureWinRate, undefeatedRate.
7. Do not add `first_four_generation.ts` or any generation pipeline helper to satisfy this task.
8. The proof must use <=4 candidates, outer concurrency <=2, and >=5 final games per cell. It may report any valid detailed outcomes, but it must report zero worker errors.

## Acceptance

- [ ] `npx tsx tests/t008_optimizer_experiment_validity.test.ts` passes from a clean `agent/tree` checkout.
- [ ] The proof run is self-contained: no ignored report file or generation-domain artifact is required as input.
- [ ] All five proof artifacts are generated during the test run.
- [ ] T008 request-safety and metric tests remain passing.
- [ ] No prohibited generation/mutation file is added or modified.
- [ ] `npx tsc --noEmit` adds no errors in edited files; pre-existing errors are documented.
- [ ] No active candidate is applied.

## Delivery

Write `TASKS/tree/T009.report.md` with fixture path, clean-checkout command/results, proof artifact list, detailed outcome counts, and explicit confirmation that no generation source/operator changed. Commit and push only to `agent/tree`. Do not modify this task file.
