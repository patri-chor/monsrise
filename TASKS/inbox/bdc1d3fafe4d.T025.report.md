STATUS: PARTIAL
DOMAIN: tree

# T025 - Runtime Implementation Enforcement Report

## Direct Repair

Implemented the observation identity repair directly on `agent/tree`:

```text
HEAD: d5239dfe92bae52e39bdcea6032367c09814e77b
fix(tree): preserve runner formatting and observation identity
```

`experience_training_pipeline.ts` now derives observation identity from actual candidate and protocol content:

- `getCandidateObservationFingerprint({ team, tree })` hashes evaluated team, badges, and tree;
- `getSourceFixtureObservationFingerprint(sources)` hashes the frozen source fixture;
- the generated `observationKey` therefore changes when a candidate tree, team/badges, or frozen source fixture changes;
- smoke and formal records continue to differ by `runKind` and `gamesPerCell`.

Added:

```text
tests/t025_observation_content_identity.test.ts
```

The regression covers tree-coordinate change, badge change, source-fixture revision, and smoke/formal key separation.

## Static Verification

Verified from `origin/agent/tree` at delivery HEAD:

```text
candidateFp: getCandidateObservationFingerprint(c)
sourceFixtureFp: getSourceFixtureObservationFingerprint(sources)
```

Verified absence of the former placeholders:

```text
candidateFp: `fp_${c.candidateId}`
sourceFixtureFp: 'fp_eleven_frozen_v1'
```

Verified formal completion guard remains present:

```text
screenMetrics.total === expectedTotalGames
workerErrorCount === 0
screenMetrics.isEvaluationComplete
```

Verified four-cost missing-trace behavior remains explicit:

```text
status: directEvent ? 'FAIL' : 'MISSING_TRACE'
status: rtEvent ? 'FAIL' : 'MISSING_TRACE'
```

No `node.round * 4` synthetic budget fallback remains in `four_cost_fidelity_gate.ts`.

## Test Limitation

This repair was made while the sole permitted local workspace remained on `agent/generation`. Per workspace rule, no tree worktree was created and the branch was not switched. Consequently the tree-branch `npx tsx` test was not run locally from a tree checkout. The implementation is statically verified but awaits execution by the `agent/tree` executor:

```bash
npx tsx tests/t025_observation_content_identity.test.ts
npx tsx tests/t024_formal_run_identity_and_coverage.test.ts
```

No formal multi-candidate training, promotion evaluation, active bundle change, apply, or deploy was started.
