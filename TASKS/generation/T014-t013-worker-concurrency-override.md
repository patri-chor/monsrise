STATUS: OPEN

# T014 - T013 Worker Concurrency Override

> Domain: `generation` | Decision owner: generation decision agent | Executor branch: `agent/generation`
> This task supersedes only T013's worker-count constraint. All other T013 scope, seeds, panel, retention policy, and output isolation remain unchanged.

## Objective

Run T013's fixed-eight-panel coarse evaluation using **16 arena workers whenever the host has at least 16 logical CPUs available**. This replaces the prior two-worker constraint.

## Required Change

1. Update the T013 runner/configuration so the default requested worker count is `16`.
2. Determine the effective worker count at runtime as:
   ```text
   min(16, available logical CPUs)
   ```
   and require a minimum of 1.
3. Persist both `requestedWorkers: 16` and `effectiveWorkers` in the per-seed diagnostics, run manifest, and summary.
4. A caller may explicitly request a smaller worker count for focused tests only; production T013 CLI/default execution must request 16.
5. Do not change games per pairing, seed/panel definitions, 20 attempts-per-seed bound, per-seed maximum-six retention policy, or output directory.

## Acceptance

- [ ] Focused test mocks/uses host CPU availability to prove default production configuration requests 16 and clamps only when fewer CPUs are available.
- [ ] Production-style isolated runner invocation records requested `16` and effective worker count in its manifest/diagnostics.
- [ ] Existing T013 fixed-panel and per-seed retention tests still pass.
- [ ] No worker count above the effective CPU cap is spawned.
- [ ] No tree optimizer, active-library mutation, bundle build, deployment, or output outside T013's declared isolated directory occurs.

## Delivery

Write `TASKS/generation/T014.report.md` with requested/effective worker evidence, host CPU count, commands/tests, output paths, and confirmation that all non-concurrency T013 requirements remain unchanged. Commit and push only from `agent/generation`; do not modify this task file.
