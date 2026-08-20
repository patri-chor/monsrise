STATUS: OPEN
DOMAIN: tree
SUPERSEDES: T117-generation2-forward-branch-validation

# T118 - Generation 2 Autonomous Round Optimizer Program

## Product Objective

Build the actual long-running all2rush optimization program, not another task-specific validator or a collection of manually classified branch scripts.

A human specifies only:

```text
optimization target: improve all2rush product results
resource budget: opponents/cases/candidates/generations
legal visibility constraints
no global auto-deployment without explicit later promotion
```

The program itself must:

```text
run real product baselines
find adverse rounds
construct/cache current RoundBoardState
sample and evaluate tactical board edits
retain behavior-distinct candidates
rank/select/archive solutions by a uniform objective
infer/compile legal forward candidates when possible
validate candidates across an automatically generated benchmark
iterate until its configured budget is exhausted
persist resumable state and full evidence
```

Do not encode manual, task-specific branch IDs, opponent-specific conditions, seed-specific rules, or individual “this branch should be kept” articles.

## Delivery Style

This is one large implementation pass. Implement the whole program and its command/API, then run one broad audit suite. Do not split implementation into microtasks or stop after a partial service wrapper.

Use the established `generation2/` RoundBoardState and SingleRoundEngine foundation. Refactor them as needed for a coherent program. Avoid a parallel optimizer path.

## Scope

```text
lineage: all2rush only in this delivery
product path only; no arena.ts/playSpecVsSpec
no R0/global main/tier/L1/UI/deployment modification
```

## Architecture

Create one cohesive program package under:

```text
src/engine/tree/product_training/generation2/optimizer/
  config.ts
  objective.ts
  benchmark.ts
  adverse_case_miner.ts
  candidate_space.ts
  evolutionary_search.ts
  solution_archive.ts
  forward_compiler.ts
  validation.ts
  persistence.ts
  program.ts
  index.ts
```

Existing `RoundBoardStateFactory`, `SingleRoundEngine`, `ProductMatchRunner`, `EvidenceWriter`, and snapshot resolver are dependencies. Reuse, adapt, or move narrow helpers; do not duplicate their product logic.

### 1. Config

A serializable config controls all runtime behavior:

```ts
interface OptimizerConfig {
  targetFormationId: string;
  opponentFormationIds?: string[]; // default automatic active opponent set
  baselineSeeds: number[];
  validationSeeds: number[];
  maxOpponents: number;
  maxAdverseCasesPerOpponent: number;
  populationSize: number;
  uniqueCandidatesPerCase: number;
  maxGenerations: number;
  searchSeed: number;
  allowForwardCompilation: boolean;
  dryRun: boolean;
}
```

Default budget should be substantial but bounded, e.g.:

```text
3 opponents x 2 adverse cases x 32 unique local candidates x 3 generations
```

The program must record actual exhaustion/cost rather than silently substitute a hard-coded smaller loop.

### 2. Objective Function

One programmatic objective ranks all candidate results. It must not contain formation names, fixed branch IDs, or per-case hand-written exceptions.

Use lexicographic/pure functions over observable result:

```text
1. round outcome improvement: loss -> draw -> win
2. target score delta and opponent score delta
3. target survivor count and total HP
4. lower opponent survivor count and total HP
5. lower edit count only as tie-break
```

For full-match validation use the same result-first philosophy:

```text
match W/D/L
Score70-compatible match score
round-result trajectory
survivor/HP aggregate
```

Define `compareObjective(a,b)` and `dominates(a,b)` once. All archive, selection, benchmark and branch choices must use these functions.

### 3. Automatic Benchmark and Adverse-Case Mining

The program automatically resolves active/pinned all2rush and opponents, runs baseline product cases, captures `RoundBoardState`, and chooses adverse rounds through the objective/deficit function.

It must distribute cases across opponents using config quotas; it must not manually privilege named strategies. A no-adverse-case opponent is recorded, not replaced invisibly.

Each case includes canonical snapshots/policy fingerprints, seed/side/round/base state fingerprint and observable baseline output.

### 4. Candidate Space and Evolutionary Search

Generate candidates from actual cached board content only:

```text
reposition target deployed unit
reposition target pending action
reorder target pending actions
compatible 1..3 edit combinations
```

Use deterministic PRNG. Each candidate is a canonical edited `RoundBoardState` fingerprint; duplicates/invalid proposals never consume unique evaluation budget.

Implement a general evolutionary loop, not one fixed list:

```text
initial diverse random population
-> one-round authoritative evaluation
-> objective ranking + non-dominated archive
-> mutate/crossover high-quality edited states with fresh random edits
-> repeat configured generations
```

Mutation and crossover must validate edit compatibility and still produce canonical board states. No hand-coded coordinates or particular monster assumptions.

The normal fitness loop evaluates exactly one current round from cached state. It must not replay the full match for every candidate.

### 5. Solution Archive

Keep an append-only/resumable archive keyed by:

```text
case identity + edited-state fingerprint + observable digest
```

Store every unique evaluated candidate and its objective vector. Mark dominated/non-dominated programmatically using the shared `dominates` function. Keep a Pareto frontier per case and a global frontier over normalized case improvements.

The archive decides candidates; it must not use task-authored solution IDs or hard-coded expected winner labels.

### 6. Automatic Forward Compiler

For selected archive representatives, attempt forward compilation generically:

```text
- map an edit to its original legal deployment/current pending action;
- derive legal condition features from actual visible observation at that action;
- compile Evol subtree/action delta;
- run source product match to see whether runtime selects it;
- benchmark it automatically.
```

A solution remains `LOCAL_ONLY` if not expressible at a legal visible decision point. This is a program output, not a manually chosen label.

A forward branch becomes `PILOT_ACTIVE` only if its benchmark aggregate does not regress versus baseline according to `compareObjective`; otherwise archive it as `FORWARD_REJECTED` with measured reason.

No active product formation is mutated. Pilot branches live only in optimizer state/artifacts.

### 7. Automatic Validation

After each generation, validate only archive representatives and pilot branches, not all candidates, on an automatically built benchmark:

```text
source case seeds
other configured baseline seeds
both sides where applicable
non-source opponents from active opponent set
```

Validation classifies objective comparison programmatically. On an observable mismatch between cached no-edit state and normal product round, collect diagnostics; otherwise do not inspect transient internals.

### 8. Persistence and Resume

Persist a revisioned optimizer run directory/state:

```text
reports/tree-cycle/generation2-optimizer/<run-id>/
  config.json
  manifest.json
  baseline_cases.jsonl
  candidates.jsonl
  evaluations.jsonl
  archive.jsonl
  generations.jsonl
  forward_candidates.jsonl
  validations.jsonl
  summary.json
  diagnostics.jsonl
  checkpoint.json
```

The program resumes from `checkpoint.json` without re-evaluating completed unique fingerprints. State contains PRNG state, current generation, per-case candidate set, and archive references.

Use append-only JSONL for events; only config/checkpoint/summary may be replaceable revisioned JSON.

## Public API and CLI

Expose:

```ts
runGeneration2Optimizer(config: OptimizerConfig): Promise<OptimizerRunReport>
resumeGeneration2Optimizer(runId: string): Promise<OptimizerRunReport>
```

Add a script:

```text
scripts/run_generation2_optimizer.ts --config <path> [--resume <run-id>]
```

The program prints compact progress:

```text
run ID / generation / case / unique evaluated / archive size /
current best objective / pilot branches / elapsed time
```

## Broad Audit Suite

After the large implementation, run one broad program audit, not many isolated manual workflows. Add tests covering:

```text
- deterministic complete run with same config/searchSeed;
- resume yields same completed candidate/archive result as uninterrupted run;
- unique fingerprint budget and invalid/duplicate accounting;
- objective and dominance consistency over generated results;
- diverse opponent quota behavior;
- no-edit cached-state product equivalence over all selected cases;
- evolutionary generations actually generate new valid candidate states;
- no full-match execution in ordinary candidate fitness loop;
- automatic forward compiler respects legal visibility and leaves local-only
  results uncompiled;
- pilot branches are rejected automatically on benchmark regression;
- no R0/global tier/L1/deployment modification.
```

Run a substantial real all2rush dry-run using defaults and include actual aggregate numbers. Do not make test assertions depend on a specific branch ID, exact coordinate, named opponent outcome, or expected number of wins.

## Acceptance

- [ ] One configurable/resumable program runs the complete baseline -> mine -> search -> archive -> compile -> validate loop.
- [ ] Decisions are made by shared objective/dominance functions, not manual per-branch rules.
- [ ] Search is evolutionary, seeded, unique, and based on cached single-round board states.
- [ ] Full matches are restricted to automatic representative/branch validation.
- [ ] Archive, validation, forward decisions and resume state are complete and evidence-backed.
- [ ] Broad audit suite and substantial dry-run complete.
- [ ] No global/tier/L1/deployment mutation.

## Delivery

Write `TASKS/tree/T118.report.md` with package/call path; config/default budget; objective vector; dry-run run ID and aggregate counts by generation/case; archive frontier counts; forward compiler/validation counts; resume comparison; audit outputs; evidence paths; no-apply confirmation; changed files. Commit/push only `agent/tree`.
