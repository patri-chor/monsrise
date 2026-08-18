STATUS: OPEN
DOMAIN: tree

# T030 - T029 Tracked Delivery and Provenance Audit

> Domain: `tree` | Executor branch: `agent/tree`
> Verification/recovery only. Do not run screening, promotion, continuous optimization, H2H, apply, deploy, or alter formation data.

## Delivery Failure

A local T029 report claims `STATUS: DONE`, but current `origin/agent/tree` resolves to `30a14fe`, which contains only `TASKS/tree/T029-repair-real-entry-engine-parity.md`.

The reported implementation is absent from the tracked tree ref:

```text
TASKS/tree/T029.report.md
src/engine/tree/<independent real-entry adapter>
tests/t029_independent_real_entry_parity.test.ts
artifact provenance manifest/gate
```

A report snapshot from an untracked/deleted checkout is not implementation evidence. T029 remains unaccepted, and T014-T027 remain `SANDBOX_ENGINE_UNVERIFIED`.

## Required Work

1. From actual `agent/tree`, inspect whether a real implementation exists outside the tracked ref. If it does, preserve and commit/push it. If it does not, write `TASKS/tree/T030.report.md` as `STATUS: PARTIAL`; do not fabricate implementation or PASS output.
2. Any recovered implementation must be Git tracked on `agent/tree` together with:
   - `TASKS/tree/T029.report.md`;
   - explicit authority artifact manifest/gate;
   - independent real-entry adapter module;
   - `tests/t029_independent_real_entry_parity.test.ts`;
   - complete test output and resolved commit in report.
3. Prove source provenance after push using:

```bash
git rev-parse HEAD
git ls-tree -r --name-only HEAD -- TASKS/tree/T029.report.md src tests
git show --stat HEAD
```

4. Audit independent-entry condition from tracked source:
   - real adapter must not import/call `PersistentSimPool`, `fine_grained_worker`, `arena.ts`, or `playSpecVsSpec`;
   - side must be passed to actual execution paths, not only recorded;
   - test must include artifact mismatch, fake-tree-adapter, coordinate/budget/branch mismatch, and side-propagation negative controls.
5. If the recovered code fails any item, keep T029 blocked and report exact tracked evidence. Do not call byte identity alone behavioral parity.

## Acceptance

- [ ] All claimed T029 implementation, test, and report files are present in `origin/agent/tree` at a stated commit.
- [ ] Report test output is reproducible from that commit.
- [ ] Tracked-source audit demonstrates genuine independent real entry and actual dual-side execution.
- [ ] Otherwise T029 remains `PARTIAL` and all historical strength data remains sandbox-unverified.
- [ ] No simulation or strength-changing data mutation.

## Delivery

Write `TASKS/tree/T030.report.md` with result, commit, file list, test command/output, provenance audit, and explicit gating status. Commit/push only `agent/tree`. Do not modify this specification.
