STATUS: OPEN
DOMAIN: tree

# T032 - T031 Tracked Failure Delivery and Reproducibility

> Domain: `tree` | Executor branch: `agent/tree`
> Recovery/audit only. Do not modify training results, run screening/H2H/promotion/optimization, change bundles/formations, apply, or deploy.

## Current Delivery Gap

The local T031 report describes a correct and important result:

```text
INDEPENDENT_REAL_PARITY: FAIL
SANDBOX_ENGINE_UNVERIFIED
TRAINING GATE: BLOCKED
```

It claims new product-entry/canonical-trace implementation and a 60-case comparison that honestly finds 60/60 divergences. However, after fetch, `origin/agent/tree` still resolves to `e183617`, containing only the T031 specification. The claimed tracked files are absent:

```text
TASKS/tree/T031.report.md
src/engine/real_application_entry.ts
src/engine/canonical_trace.ts
tests/t031_independent_entry_parity_repair.test.ts
updated src/engine/tree/independent_real_entry_parity.ts
amended T029/T030 reports
```

A local snapshot is not auditable evidence until it is pushed to `agent/tree`.

## Required Work

1. Recover the exact existing T031 implementation and report from the executor checkout, without weakening its result or changing its stated `FAIL` classification.
2. Commit/push all listed T031 artifacts and amended T029/T030 reports to `agent/tree`.
3. From the resulting tracked commit, run:

```bash
npx vite-node tests/t031_independent_entry_parity_repair.test.ts
```

If the project uses a different installed runner, record exact runner/version and output. Do not replace the test with a static-only check.

4. Confirm reproducibly:
   - absolute authority artifact provenance is cwd-independent and fail-closed;
   - real adapter executes `playFullGame`, not `playSpecVsSpec` / tree runner dependencies;
   - both real and tree canonical traces are fully compared;
   - matrix result remains an honest failure if traces differ;
   - D1-D5 negative controls execute and pass as negative controls;
   - T029/T030 remain `PARTIAL` and T014-T027 remain `SANDBOX_ENGINE_UNVERIFIED`.
5. Include the exact `git rev-parse HEAD`, `git show --stat HEAD`, and `git ls-tree -r --name-only HEAD` evidence in report.

## Acceptance

- [ ] All T031 claimed source/test/report files exist in `origin/agent/tree` at stated commit.
- [ ] T031 test runs from that commit and reproduces independent parity `FAIL`, not an invented PASS.
- [ ] Historical strength evidence stays sandbox-unverified and training stays blocked.
- [ ] No simulation/strength evidence mutation, apply, deploy, or bundle change.

## Delivery

Write `TASKS/tree/T032.report.md` with commit, file list, exact test output, first mismatches/case summary, gate classification, and no-training confirmation. Commit/push only `agent/tree`. Do not modify this specification.
