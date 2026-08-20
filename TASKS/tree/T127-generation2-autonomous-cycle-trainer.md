STATUS: OPEN
DOMAIN: tree
SUPERSEDES: T126-generation2-cycle-actual-branch-trace

# T127 - Generation 2 Autonomous Cycle Trainer

## Goal

Turn the consolidated `runGeneration2OptimizerCycle` into the actual offline long-running all2rush training program. It must repeatedly execute independent optimizer cycles, use measured results to retain isolated pilot libraries, and keep host CPU near a configurable target (default `80%`) without changing active product formation data.

This is the final operational layer, not another optimizer architecture. Reuse the consolidated 7-module cycle and its CLI. Do not reintroduce bulk/iterative/result-driven/event runtimes or task-specific runner chains.

## Operating Model

```text
trainer coordinator
-> keeps an isolated evolving pilot-library snapshot
-> launches independent optimizer-cycle workers
-> worker uses normal product path / cached RoundBoardState / actual branch trace
-> coordinator evaluates each completed cycle report using shared Score70 outcome
-> accepts/rejects its pilot-library result programmatically
-> schedules next cycle from the accepted library
-> continues until time/cycle budget or dynamic plateau
```

Because product battle simulation has mutable singleton state, parallel workers must be separate Node processes. Never run multiple `playFullGame` workers concurrently in one Node process.

## Main Executable

Provide one operational CLI:

```text
scripts/run_generation2_autonomous_trainer.ts
```

Examples:

```text
pnpm tsx scripts/run_generation2_autonomous_trainer.ts --hours 8 --cpu-target 80
pnpm tsx scripts/run_generation2_autonomous_trainer.ts --cycles 20 --workers 4
```

It prints compact live progress:

```text
elapsed / cycles complete / active workers / CPU sample / target workers /
accepted pilot count / best Score70 / plateau count
```

## Primary Runtime Boundary

Add at most five operational files; keep the optimizer cycle as its existing seven primary files:

```text
src/engine/tree/product_training/generation2/trainer/
  types.ts
  cpu_controller.ts
  cycle_worker.ts
  trainer.ts
  index.ts
```

No additional temporary runner hierarchy.

### `types.ts`

Serializable trainer config/state/result types only:

```text
AutonomousTrainerConfig
TrainerCycleResult
PilotLibrarySnapshot
TrainerSummary
```

### `cpu_controller.ts`

Sample host/process CPU through standard Node OS APIs and determine worker concurrency.

Rules:

```text
- configurable targetCpuPercent default 80;
- configurable minWorkers default 1, maxWorkers defaults to logical CPUs - 1;
- adjust one worker at a time with hysteresis/tolerance (default +/- 8%) to
  avoid oscillation;
- CPU target is best effort, never fake/sleep-spin CPU;
- do not exceed maxWorkers or start a replacement while a worker is still
  settling;
- record samples and adjustment decisions.
```

### `cycle_worker.ts`

Runs one isolated cycle in a child Node process. Input contains a config plus isolated pilot-library snapshot and cycle number. Output is a structured JSON result written atomically under its worker directory.

The worker invokes the one consolidated cycle API. It must not invoke archived runners/tests.

### `trainer.ts`

Only orchestrator:

```text
- start a bounded worker pool;
- feed each worker the current accepted pilot snapshot;
- collect result; evaluate it with the cycle outcome comparator;
- accept a worker result only if its post-cycle benchmark strictly improves the
  current accepted snapshot under shared Score70/product comparator and it has
  no accepted-candidate validation regression;
- otherwise record it as rejected/neutral training evidence;
- schedule more cycles while within cycle/time budget;
- dynamically stop on configured plateau cycles or exhausted budget;
- checkpoint a simple current trainer state after each completed worker.
```

When multiple workers start from one pilot snapshot, compare their results against that same parent. Merge no more than one strictly best accepted snapshot per coordinator generation; all others are retained as evidence and not silently combined.

`pilot_library` evolves only in trainer state/artifacts. It never writes active all2rush formation or R0.

### `index.ts`

Exports:

```ts
runGeneration2AutonomousTrainer(config?: Partial<AutonomousTrainerConfig>): Promise<TrainerSummary>
```

## Result Decision

Use only the consolidated cycle `outcome.ts` comparator and actual benchmark/product results. No named opponent, branch ID, coordinate, seed, or manual preference may affect selection.

For each worker result persist:

```text
parent pilot fingerprint
candidate pilot fingerprint
parent and candidate W/D/L/N/Score70 benchmark aggregate
objective comparison
accepted/rejected/neutral
actual branch selected/not-selected counts
validation regression count
cycle runtime
```

Acceptance requires:

```text
strict improvement over parent under comparator
AND no selected-pair regression among pilots newly accepted by that cycle
```

A result that produces no pilot change is neutral. A pilot regression is rejected. The trainer must retain those artifacts for audit but not use them as its next baseline.

## Simple State and Artifacts

Use ordinary files only, no event sourcing:

```text
reports/tree-cycle/generation2-autonomous-trainer/<run-id>/
  config.json
  state.json
  cpu_samples.jsonl
  worker_results.jsonl
  pilot_library.json
  summary.json
  workers/
    cycle-0001/
    cycle-0002/
```

`state.json` is a replaceable current snapshot sufficient to restart manually with `--resume <run-id>`; do not implement event replay. Resume can requeue only unfinished workers and continue from current accepted pilot state.

## Verification and Real Run

Do one broad operational test and one real bounded trainer execution. Verify:

```text
- all workers are separate processes;
- a worker invokes only consolidated cycle API;
- max/min CPU worker policy honors configured bounds and records samples;
- no busy loop/fake CPU consumption;
- every accepted result strictly beats the parent by shared comparator;
- rejected/neutral results do not alter next worker pilot snapshot;
- simultaneous workers from same parent do not silently merge branches;
- actual branch trace evidence remains in child cycle artifacts;
- no active/global R0/tier/L1/deployment mutation;
- a bounded run completes and summarizes CPU samples, worker count, cycle
  outcomes and stopping reason.
```

For verification, CPU target must be treated as a range/observed sample outcome, not a brittle exact percentage assertion. Run a practical 5-10 cycle training session unless dynamic plateau stops earlier.

## Acceptance

- [ ] One CLI runs autonomous repeated cycle training.
- [ ] CPU concurrency is adaptive best effort near default 80%, using separate processes.
- [ ] Trainer selects next pilot snapshot solely from measured product outcomes.
- [ ] Normal cycle stays the sole optimizer authority.
- [ ] State/artifacts are readable and simple; no event-sourced system.
- [ ] A real bounded run and broad operational test pass.
- [ ] No R0/global/tier/L1/deployment modification.

## Delivery

Write `TASKS/tree/T127.report.md` with trainer/cycle architecture; CPU policy and observed sample table; worker/cycle counts; parent-to-candidate selection table; accepted/rejected/neutral results; pilot evolution table; stop reason; test and bounded-run metrics; artifact paths; no-apply confirmation; changed files. Commit/push only `agent/tree`.
