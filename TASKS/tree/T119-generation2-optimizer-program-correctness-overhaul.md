STATUS: DONE
DOMAIN: tree
SUPERSEDES: T118-generation2-autonomous-round-optimizer-program

# T119 - Generation 2 Optimizer Program Correctness Overhaul

## Reason for Rework

T118 created a useful package, but the reported program does not yet satisfy the program contract. This is a correctness overhaul, completed in one implementation pass and one broad audit pass.

Observed failures in actual T118 artifacts/code:

```text
1. `resumeGeneration2Optimizer(runId)` calls `run(...)` again. It regenerates a
   new run ID, reruns baseline/search, and overwrites the target output folder;
   it does not resume from checkpoint or skip completed fingerprints.
2. `checkpoint.json` embedded runId differs from its enclosing run directory,
   proving run identity/persistence inconsistency.
3. Required `candidates.jsonl` and `diagnostics.jsonl` artifacts are absent.
4. Persistence `writeJsonl` overwrites event history; it is not append-only.
5. `populationSize` is declared but not used by evolutionary search.
6. Default `maxGenerations` is 2, despite the stated substantial default target
   of three generations.
7. A candidate remains recorded `PILOT_ACTIVE` in `forward_candidates.jsonl`
   even though validation records it as `REGRESSES`; final branch status and
   persisted evidence are inconsistent.
8. T118 audit only checks counts/basic uniqueness; it does not validate resume
   equivalence, candidate-loop isolation, append-only artifacts, objective
   decisions, branch rejection, or no-edit observable parity as required.
```

Do not patch these with test-only assertions or report wording. Correct the implementation and persisted state model.

## Goal

Deliver a genuinely resumable, programmatically self-governing optimizer where checkpoint/run identity, event journal, archive, generation budget, objective decisions and final pilot statuses agree with real execution.

Keep scope in existing `generation2/optimizer/`. No task-specific branch or opponent rules. No runtime/global deployment mutation.

## 1. Immutable Run Identity and Persistence

Create a run directory once and bind it to one immutable `runId`:

```text
reports/tree-cycle/generation2-optimizer/<run-id>/
```

`runId` must be generated only for a new run. It is passed through all program/checkpoint/report paths and never regenerated during resume.

Persist a checkpoint sufficient to continue, not merely summarize:

```text
runId
normalized config fingerprint/current config
completed generation per case
PRNG state or deterministic per-case/generation cursor
all completed candidate fingerprints keyed by case
baseline case identities/snapshot fingerprints
serialized archive entries/objective vectors/dominance/representatives
forward candidates and final statuses when reached
phase cursor: baseline | search | compile | validate | complete
```

On `resume(runId)`:

```text
- load config/checkpoint/archive/events;
- validate directory runId == checkpoint runId == config run identity;
- do not create a new run ID;
- do not rerun completed baseline cases;
- do not reevaluate completed case/fingerprint pairs;
- continue only incomplete generation/case/phase work;
- return report with the original runId.
```

Add deterministic interruption support usable by tests, for example `stopAfterGenerationEvents` or a test cancellation hook in config. Resume after forced mid-search interruption must produce the same archive, generation event identities, candidate fingerprint set and final summary as an uninterrupted run of the same config.

## 2. Append-Only Event Journal

Implement `appendJsonl` in optimizer persistence. Use it for baseline cases, candidate proposals, candidate evaluations, generation events, archive decision events, forward candidates and validations.

A resume appends only newly completed events. It never truncates an event journal. If state reconstruction reads JSONL, use stable event keys and ignore only exact duplicate event IDs defensively; do not omit real distinct events.

Required artifacts for every run, including empty header/schema event where applicable:

```text
config.json
manifest.json
baseline_cases.jsonl
candidates.jsonl
evaluations.jsonl
archive.jsonl
generations.jsonl
forward_candidates.jsonl
validations.jsonl
diagnostics.jsonl
checkpoint.json
summary.json
```

`archive.jsonl` records archive mutations/representative changes, not just one final rewrite.

## 3. Real Evolutionary Budget

Use `populationSize` and `maxGenerations` as actual execution controls:

```text
- generation 1 creates up to populationSize diverse valid unique candidates;
- later generations select parents from current non-dominated/ranked archive;
- create configured offspring through mutation and valid crossover;
- each generation has an explicit configured per-case unique budget;
- uniqueCandidatesPerCase is an absolute per-case cap across all generations.
```

Do not rely on `floor(uniqueCandidatesPerCase / maxGenerations)` as the only control if it ignores `populationSize` or silently changes final budget. Define and persist a clear allocation rule, including remainder allocation and exhausted-space behavior.

Default configuration must be substantial and documented:

```text
maxGenerations: 3
populationSize: 16
uniqueCandidatesPerCase: 32 or larger
```

Generation events include selected parent IDs/count, random/mutation/crossover counts, proposal/invalid/duplicate/unique counts, unique cumulative count, exhaustion reason, and objective frontier size.

## 4. Single Source of Truth for Objective and Status

Use `compareObjective` / `dominates` exclusively for archive selection and benchmark comparison. Add a programmatic match-level objective adapter with explicit Score70-compatible computation rather than winner/score string shortcuts.

Forward candidate lifecycle is stateful and final:

```text
COMPILED
-> SOURCE_VALIDATING
-> BENCHMARK_VALIDATING
-> PILOT_ACTIVE | FORWARD_REJECTED | LOCAL_ONLY
```

After validation, update the final candidate status and append a lifecycle event. A candidate with any benchmark regression is `FORWARD_REJECTED`, with measured records/reason. It must never remain listed as active in final artifacts/report.

Persist final active pilot branches separately or with final-status records. `forward_candidates.jsonl` must be truthful after all phases, not a stale pre-validation snapshot.

## 5. Product Fidelity and Loop Isolation

For every mined baseline case, compare normal product R to no-edit cached `RoundBoardState -> SingleRoundEngine` output over:

```text
winner
score delta/after score
survivor stable IDs
HP/max HP
survivor count/total HP
accepted/rejected current-R actions
```

Write mismatch diagnostics only if needed; otherwise journal an explicit parity-pass record.

Ordinary candidate evaluation must remain one-round only. Instrument program-level evaluator counters so audit can prove:

```text
candidate one-round evaluations
full-match runs used only for source/benchmark validation
```

## 6. Broad Program Audit

Replace the narrow T118 test with a broad integration audit. It must run at least:

```text
A. uninterrupted deterministic program run
B. intentionally interrupted run followed by resume
C. same config and seed fresh comparison run
```

Validate:

```text
- original run ID is retained across resume;
- interrupted+resumed equals uninterrupted in final fingerprint set, archive
  entries/objective vectors/dominance, generation event identities and summary;
- same config/searchSeed produces same logical results independent of run ID;
- no event journal shrinks on resume; completed candidate evaluation events are
  not duplicated;
- all required artifacts exist, parse and contain explicit schema/empty record
  when empty;
- populationSize/maxGenerations/cumulative unique budget behavior is real;
- every evaluation is unique within case and candidate loop uses one-round path;
- objective comparator/dominance agrees with archived flags/representatives;
- no-edit parity includes all required observable fields;
- final forward statuses agree with validation records; regressing candidates are
  rejected and absent from active pilot list;
- no R0/global tier/L1/deployment mutation.
```

Use a bounded but nontrivial config in the test. Then run one substantial default-config dry-run, report its actual runtime and generation/case/evaluation/archive/forward counts. No assertions may depend on named opponent, exact coordinate, exact branch ID, or a particular desired winner.

## Acceptance

- [ ] Resume is real continuation with immutable run identity, not fresh rerun.
- [ ] All required evidence exists and journals append across resume.
- [ ] Generation parameters genuinely control evolutionary population/budget.
- [ ] Objective/status evidence is consistent; a regression cannot remain active.
- [ ] Complete parity and evaluator isolation are audited.
- [ ] Interrupted/resumed and uninterrupted runs match logically.
- [ ] One substantial default dry-run completes.
- [ ] No global/tier/L1/deployment modification.

## Delivery

Write `TASKS/tree/T119.report.md` with failure-to-fix table; state/checkpoint schema; run/resume identity proof; append journal counts before/after resume; evolution allocation table; parity/evaluator counters; final forward lifecycle table; interrupted/resumed/uninterrupted comparison; default dry-run aggregate metrics/runtime; tests; artifact paths; no-apply confirmation; changed files. Commit/push only `agent/tree`.
