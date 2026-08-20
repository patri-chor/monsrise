STATUS: OPEN
DOMAIN: tree
SUPERSEDES: T119-generation2-optimizer-program-correctness-overhaul

# T120 - Generation 2 Event-Sourced Optimizer Runtime

## Rework Trigger

T119 report claims real resume/event journaling, but implementation inspection shows it remains a rerun wrapper:

```text
- resume calls run, which always mines baselines again;
- run overwrites baseline_cases, diagnostics, archive, forward_candidates and
  validations JSONL files;
- stopAfterGeneration breaks only the search loop, then compiler/validator run
  and checkpoint phase becomes complete;
- populationSize remains unused by evolutionary search;
- archive contains only a rewritten final snapshot, not append-only archive
  decision events.
```

Do not soften this with a report or test that only compares final counts. Rebuild the optimizer execution model so continuation, phase boundaries and journals are true runtime behavior.

## Goal

Implement a single event-sourced, resumable optimizer runtime. A run is a deterministic state machine reconstructed from immutable events plus a replaceable checkpoint cache:

```text
NEW
-> BASELINE
-> SEARCH
-> COMPILE
-> VALIDATE
-> COMPLETE
```

It may stop only at safe persisted boundaries. Resume reads the same run journal/checkpoint and advances only unfinished work. A completed run resumes as an idempotent read/return operation, with no new product evaluations and no new events.

Keep the program autonomous: no hard-coded formation/case/branch outcome rules. No active/global formation mutation.

## Deliver in One Cohesive Implementation

Replace/adapt the optimizer runtime under `generation2/optimizer/` in one integrated change:

```text
run_events.ts          event types, IDs, reducer
runtime_state.ts       serializable derived state and phase cursor
runtime.ts             new/resume execution state machine
persistence.ts         append-only journal, atomic checkpoint, reconstruction
program.ts             public API facade only
```

You may refactor existing miner/search/archive/compiler/validator so they execute one requested unit of work at a time. Do not create a second optimizer implementation beside them.

## 1. Immutable Event Journal

Every run has exactly one append-only journal:

```text
reports/tree-cycle/generation2-optimizer/<run-id>/events.jsonl
```

Events have stable IDs and schema version:

```ts
interface OptimizerEvent {
  eventId: string;          // deterministic run/phase/unit identity
  schemaVersion: 'G2_OPTIMIZER_EVENT_V1';
  runId: string;
  sequence: number;
  type: ...;
  payload: ...;
}
```

Required event families:

```text
RUN_CREATED
BASELINE_CASE_CAPTURED
BASELINE_PARITY_CHECKED
DIAGNOSTIC_RECORDED
CANDIDATE_PROPOSED
CANDIDATE_REJECTED
CANDIDATE_EVALUATED
ARCHIVE_ENTRY_ADDED
ARCHIVE_DOMINANCE_UPDATED
GENERATION_COMPLETED
FORWARD_CANDIDATE_COMPILED
FORWARD_STATUS_CHANGED
VALIDATION_COMPLETED
PHASE_COMPLETED
RUN_COMPLETED
```

Append events atomically in sequence order. A duplicate event ID is an error before append, not silently a new record. Reconstruct derived state entirely from events; checkpoint only accelerates reconstruction.

Legacy JSONL files remain materialized projections for inspection:

```text
baseline_cases.jsonl
candidates.jsonl
evaluations.jsonl
archive.jsonl
generations.jsonl
forward_candidates.jsonl
validations.jsonl
diagnostics.jsonl
```

They are regenerated from the event journal into a temporary file and atomically replaced after each safe phase/checkpoint. They are not independently appended or treated as authority.

Required every run:

```text
config.json
manifest.json
events.jsonl
all eight projections above
checkpoint.json
summary.json
```

## 2. Phase-Safe Runtime and Resume

`runGeneration2Optimizer` creates `RUN_CREATED`, then advances phases. `resumeGeneration2Optimizer(runId)`:

```text
- loads config/manifest/events/checkpoint;
- validates runId equality everywhere;
- reconstructs state from events (and verifies checkpoint projection agrees);
- continues from first unfinished unit;
- retains exact runId and output directory;
- never reruns a captured baseline, evaluated candidate, completed generation,
  compiled candidate or validation record with same event ID.
```

Make controlled interruption precise:

```ts
stopAfter?: {
  phase?: OptimizerPhase;
  completedUnits?: number;
}
```

On interruption:

```text
- finish/persist the current atomic unit;
- write checkpoint with its actual non-complete phase cursor;
- return a report marked interrupted (or throw a typed interruption after
  persistence);
- do not enter later phases.
```

Resuming an already complete run is idempotent:

```text
same runId
same derived report
same event count
zero new one-round/full-match product evaluations
```

## 3. Actual Evolution Parameters

Define and implement a deterministic allocation policy that uses all three controls:

```text
populationSize: maximum valid unique candidate population per generation
maxGenerations: number of search generations
uniqueCandidatesPerCase: absolute case lifetime cap
```

Example valid policy:

```text
generation 1: min(populationSize, remaining cap) diverse random candidates
later: min(populationSize, remaining cap) offspring, with a deterministic mix
of mutation/crossover/exploration based on archive parents
```

If `populationSize * maxGenerations > cap`, subsequent generation capacity is the remaining cap. If the space exhausts, journal an explicit exhaustion event.

Every `GENERATION_COMPLETED` event includes:

```text
requestedPopulation
remainingBefore/after
randomProposalCount
mutationProposalCount
crossoverProposalCount
selectedParentIds
valid/invalid/duplicate counts
unique evaluations this generation/cumulative
archive frontier count
exhaustion reason or N/A
```

Crossover must be real compatible edit composition from two parents where available, otherwise journal why it was unavailable. Do not write a separate arbitrary coordinate template.

Defaults:

```text
populationSize: 16
maxGenerations: 3
uniqueCandidatesPerCase: 48
```

## 4. Objective, Archive and Branch Lifecycle

The event reducer owns archive and forward status. Use shared `compareObjective`/`dominates` and a single match-level objective adapter for all decisions.

Archive events must retain objective vectors, domination transitions and representative changes. A representative derives from current event-reconstructed archive, never from stale JSONL.

Forward lifecycle:

```text
COMPILED
-> SOURCE_VALIDATING
-> BENCHMARK_VALIDATING
-> PILOT_ACTIVE | FORWARD_REJECTED | LOCAL_ONLY
```

A `FORWARD_REJECTED` event is mandatory for any regression and removes it from active list immediately. Final projections/report must be derived after validation; no stale `PILOT_ACTIVE` records.

## 5. Product Fidelity and Evaluation Isolation

Baseline phase journals complete no-edit round parity on all selected cases:

```text
winner
score deltas and score after R
survivor stable IDs
HP/max HP
survivor count/total HP
accepted/rejected R actions
```

Candidate phase journals one `CANDIDATE_EVALUATED` event per unique edited board state and calls only `SingleRoundEngine`.

Full product match calls are permitted only in compile/validate phases and their count is journaled. Every report includes counters:

```text
baseline product matches
one-round candidate evaluations
full-match source validation evaluations
full-match benchmark validation evaluations
```

## 6. Process-Level Broad Audit

Replace the T119 audit with a broad integration suite that tests actual lifecycle, not only end counts.

Run a bounded config in three **separate Node processes** or independently clean module processes, so static game state cannot hide defects:

```text
A. uninterrupted run
B. new run deliberately stopped mid-generation, then resume same run
C. resume already-complete B run
D. fresh same-config deterministic run
```

Assert:

```text
- B checkpoint phase is SEARCH (or exact requested phase), not complete;
- after B resume, runId/event IDs/sequence are preserved and no baseline event
  is repeated;
- interrupted+resumed equals A in logical baseline cases, evaluated candidate
  fingerprint set, full archive objective/dominance/representatives, final
  forward statuses, validation result set and summary;
- C performs zero product evaluations and adds zero events;
- fresh D has a different runId but same logical results/event payloads after
  removing runId/sequence fields;
- every required projection exactly matches reconstruction from events;
- events are strictly append-only: pre-resume events are byte-identical prefix;
- populationSize/maxGenerations/cap rule and real random/mutation/crossover
  accounting are honored;
- no-edit parity compares every required observable field;
- normal candidates only invoke one-round evaluator;
- any validation regression ends as FORWARD_REJECTED and never active;
- no R0/global/tier/L1/deployment modifications.
```

Also execute one substantial default-config dry-run with `48 candidates/case x 3 generations`. Report actual phase duration, events, baseline matches, one-round evaluations, full matches, archive/frontier count, forward lifecycle counts and final active pilot count. Do not assert a named opponent/coordinate/branch/win outcome.

## Acceptance

- [ ] One immutable event journal is authoritative and projections reconstruct from it.
- [ ] Resume continues same run without replaying completed units; complete resume is idempotent.
- [ ] Interruptions stop before later phases and persist correct phase state.
- [ ] Population, generations and cap govern real random/mutation/crossover execution.
- [ ] Archive/forward statuses are event-derived and consistent with validation.
- [ ] Process-level audit proves event-prefix, resume and deterministic equivalence.
- [ ] Substantial default dry-run completes with measured evidence.
- [ ] No global/tier/L1/deployment mutation.

## Delivery

Write `TASKS/tree/T120.report.md` with T119 failure-to-runtime-fix table; event schema/reducer diagram; interruption/resume timeline; event count/prefix proof; population allocation and generation accounting; counters; parity matrix; forward lifecycle matrix; process audit comparison; default dry-run metrics; artifact directory; tests; no-apply confirmation; changed files. Commit/push only `agent/tree`.
