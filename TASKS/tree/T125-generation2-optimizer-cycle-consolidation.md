STATUS: DONE
DOMAIN: tree
SUPERSEDES: T124-generation2-result-driven-iterative-optimizer

# T125 - Generation 2 Optimizer Cycle Consolidation

## Goal

Consolidate the working Generation 2 all2rush optimizer into one clear executable cycle with **6-8 primary runtime files**. Archive superseded prototype runners and task-specific checks so the default code path has one authority.

The user-facing outcome is one executable program:

```text
scripts/run_generation2_optimizer_cycle.ts
```

It runs the complete isolated pilot cycle:

```text
current pilot library
-> product benchmark
-> adverse-case mining
-> cached RoundBoardState local search
-> archive/representative selection
-> legal forward compilation
-> candidate-local paired product validation
-> accept/reject pilots
-> next iteration or dynamic stop
```

Do not add a new optimization algorithm, event-sourcing system, UI, active deployment, R0/tier/L1 mutation, or another parallel runner. This is architecture consolidation plus one correctness fix for real branch-selection evidence.

## Mandatory Design Rule

The complete cycle itself must be understandable from these primary runtime files only:

```text
src/engine/tree/product_training/generation2/cycle/
  types.ts
  outcome.ts
  benchmark.ts
  search.ts
  pilot.ts
  evidence.ts
  optimizer_cycle.ts
  index.ts

scripts/run_generation2_optimizer_cycle.ts
```

Seven TypeScript runtime modules plus one CLI is the target. Small existing product foundations may remain outside this directory:

```text
round_board_state.ts
round_board_state_factory.ts
single_round_engine.ts
product_match_runner.ts
snapshot_resolver.ts
branch_library.ts
```

They are dependencies, not alternative cycle entry points.

## 1. File Responsibilities

### `types.ts`

All public config/report/domain types for the cycle:

```text
OptimizerCycleConfig
PilotLibraryEntry
BaselineCase
CandidateTrial
CandidateDecision
PairedValidation
IterationSummary
OptimizerCycleReport
```

No product calls and no filesystem calls.

### `outcome.ts`

The sole normalized observable product outcome and comparator authority:

```text
ProductOutcome
computeProductOutcomeFromMatch
aggregateProductOutcomes
compareProductOutcome
```

It must implement `Score70 = (W + 0.70 * D) / N` and tie-break by product round outcomes/survivors/HP. No duplicate Score70 or comparison logic elsewhere.

### `benchmark.ts`

Runs baseline product matrix under an isolated current pilot library, gathers actual round observations and mines adverse cases from that exact strategy. Expose:

```text
runPilotBenchmark(...)
mineAdverseCasesFromBenchmark(...)
```

### `search.ts`

Owns all local tactical work:

```text
cache RoundBoardState
-> seeded valid unique edit candidates
-> SingleRoundEngine only
-> objective/Pareto archive
-> representatives
```

It consumes case data and emits candidate trials/representatives. No full product match calls here.

### `pilot.ts`

Owns legal forward conversion and candidate-local paired evaluation:

```text
compileForwardCandidate(...)
read actual selected branch trace
validateCandidateAgainstCurrentPilot(...)
selectAcceptedPilots(...)
```

**Correctness requirement:** `branchSelected` must come from actual strategy/deployment trace captured during the product match. It must not be inferred from changed digest, changed score, branch fork round, or a hard-coded boolean.

A candidate-local comparison only includes actual selected pairs. Non-selected pairs are recorded but excluded from effect claims. Acceptance/rejection follows the shared comparator from `outcome.ts`.

### `evidence.ts`

Writes ordinary JSON/JSONL artifacts for one run and each iteration. It contains the one accepted artifact schema/layout. No event sourcing or resume infrastructure.

### `optimizer_cycle.ts`

The only orchestrator. It composes the six modules and implements dynamic iteration/stop behavior. It must not contain Score70 logic, candidate coordinate logic, direct game simulation code, or branch trace heuristics.

### `index.ts`

Exports only:

```ts
runGeneration2OptimizerCycle(config?: Partial<OptimizerCycleConfig>): Promise<OptimizerCycleReport>
```

### CLI

`scripts/run_generation2_optimizer_cycle.ts` parses a compact config path/optional iteration override and invokes the one exported cycle API. Output displays run ID, iteration, benchmark Score70, mined cases, local trials, accepted/rejected/local-only counts and stop reason.

## 2. Remove Competing Runtime Entrypoints

Archive, do not delete, superseded task/prototype implementations. Move them under:

```text
src/engine/tree/product_training/generation2/archive/
  t109_t124_prototypes/

tests/archive/tree-generation2/
  t101_t124_task_checks/

scripts/archive/tree-generation2/
```

Include a short `README.md` in each archive stating:

```text
historical prototype/check only
not imported by production optimizer cycle
not part of default test command
use git history/artifacts for task-specific evidence
```

Archive candidates include old/parallel runtime and runner files such as:

```text
optimizer/bulk_runner.ts
optimizer/iterative_runner.ts
optimizer/result_driven_runner.ts
optimizer/runtime.ts
optimizer/run_events.ts
optimizer/runtime_state.ts
optimizer/program.ts
optimizer/evolutionary_search.ts when its behavior is absorbed by cycle/search
older task-specific runner scripts
T101-T124 task-specific tests
```

Do not blindly move shared dependencies still used by external code. First update imports and run type/tests. Preserve historical task reports and evidence files under `reports/`; do not rewrite them.

The root/default test surface should contain:

```text
tests/generation2_optimizer_cycle.test.ts
```

It replaces the chain of T101-T124 task-specific tests as the supported optimizer verification entry. Historical tests go to archive and are excluded from default test scripts.

## 3. Current Feature Preservation

The consolidated cycle must retain these actual behaviors, no more and no less:

```text
- isolated pilot library, never active product formation mutation;
- cached RoundBoardState per target round;
- candidate clone/edit/one-round battle evaluation;
- valid unique state-fingerprint budget;
- existing deployed-unit counterfactual reposition plus pending placement/order;
- behavior/objective archive and non-dominated representative selection;
- legal visible-only forward compilation;
- candidate-local product paired validation;
- Score70 draw weighting 0.70;
- accepted pilot feedback into next iteration;
- dynamic stop on measured results.
```

When features overlap between old modules, prefer the T124 outcome semantics except for T124's invalid branch-selected heuristic, which must be replaced by actual trace evidence.

## 4. Consolidated Artifact Layout

Only current-cycle artifacts are written to:

```text
reports/tree-cycle/generation2-optimizer-cycle/<run-id>/
  config.json
  pilot_library.json
  iterations.jsonl
  iteration-XXX/
    benchmark.json
    adverse_cases.jsonl
    candidate_trials.jsonl
    candidate_archive.jsonl
    paired_validations.jsonl
    pilot_decisions.jsonl
  summary.json
```

No task-number-prefixed artifacts, no competing run directory conventions, and no event journal.

## 5. One Broad Verification Pass

After consolidation, run one broad integrated test and one genuine multi-iteration all2rush execution. The test must verify:

```text
- the primary cycle runs from the one public API/CLI;
- all primary runtime imports stay within the 7-file cycle design plus listed
  product foundations;
- no archived runner/test/script is imported by the cycle or default tests;
- Score70 is computed only through outcome.ts and equals (W + 0.70*D)/N;
- cached no-edit state equals actual product round observations;
- local search invokes only SingleRoundEngine for ordinary trials;
- branchSelected derives from actual strategy/deployment trace;
- non-selected validation pairs do not affect candidate acceptance;
- next iteration baseline contains exactly accepted pilots;
- accepted pilots are candidate-local non-regressing improvements;
- rejected, neutral and local-only candidates never enter pilot library;
- dynamic stop is recorded;
- no active/global formation mutation.
```

The real run may produce zero accepted pilots. That is valid and must be reported rather than compensated by manual selection.

## Acceptance

- [ ] One CLI and one API execute the entire optimizer cycle.
- [ ] Cycle logic resides in 7 primary runtime modules, with product foundations reused.
- [ ] No competing current runner remains outside archive.
- [ ] Actual trace, not heuristic, establishes branch selection.
- [ ] Only one normalized outcome/comparator authority exists.
- [ ] Historical checks/runners are archived and default verification is one broad cycle test.
- [ ] A real multi-iteration run completes with ordinary artifacts.
- [ ] No R0/global/tier/L1/deployment modification.

## Delivery

Write `TASKS/tree/T125.report.md` with before/after entrypoint map; primary 7-file responsibility table; archived file table; import-boundary proof; actual branch-trace evidence example; real run summary; broad test result; current artifact layout; no-apply confirmation; changed files. Commit/push only `agent/tree`.
