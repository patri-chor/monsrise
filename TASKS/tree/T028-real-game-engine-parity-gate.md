STATUS: OPEN
DOMAIN: tree

# T028 - Real Game Engine Parity Gate for Tree Training Evidence

> Domain: `tree` | Executor branch: `agent/tree`
> This task blocks real-game strength claims, Tier promotion, active-bundle replacement, and continued optimization targeting until engine parity is proven.

## Verified Risk

`src/engine/tree/fine_grained_worker.ts` loads its runtime engine with:

```ts
readFileSync(resolve('public/ai-bundle.iife.js'), 'utf8')
```

This path resolves relative to the executor checkout. The tree runner therefore evaluates the `public/ai-bundle.iife.js` available in the `monsrise-tree-decision` checkout, not automatically the current real application's bundle in the sole main workspace `D:\develope\monsrise1`.

T026's 8,400 formal-screen games and 1,870 H2H games are consequently **sandbox-engine evidence only** until byte-level and behavioral parity with the real game runtime are established. They must not currently justify Tier 2, Tier 1 replacement, frontier strength, pruning effectiveness, or optimization targeting.

## Objective

Prove or disprove that tree training evaluates the exact real-game engine/bundle and observable deployment/battle semantics. If parity fails, stop all tree strength interpretation and produce a minimal migration plan to run against the real bundle without copying/diverging engine code.

## A. Explicit Runtime Artifact Identity

1. Define the authoritative real-game artifact source and build command. It must be the bundle actually used by the real application, not a tree checkout copy or hand-maintained replica.
2. At every tree run, write immutable manifest fields:

```text
realGameBundleAbsoluteSource
realGameBundleSHA256
treeRunnerBundleAbsoluteSource
treeRunnerBundleSHA256
bundleBuildCommand
bundleBuildCommit
runnerCodeCommit
node/runtime version
```

3. Before any simulation, compare exact SHA-256 values. A mismatch is `ENGINE_PARITY_FAIL` and blocks simulation/strength output.
4. Do not solve mismatch by manually copying a bundle into a tree checkout. The runner must consume a declared immutable artifact path or a verified build artifact produced from the same source commit.

## B. Behavioral Parity Tests

Even equal bundle bytes are insufficient if `arena.ts` wrapper behavior diverges. Build a deterministic parity harness that, for a matrix of Tier 1 sources and representative candidate trees, runs the same:

```text
formation / candidate fingerprint
opponent
side
seed
round
```

through:

1. the real application battle/bundle entry path;
2. the tree runner path.

Compare at minimum:

```text
selected branch/node
planned and actual deployment trace
budget before/cost/after
accepted/rejected placement outcomes
round observations
final W/D/L
```

All outputs must be exactly equal except explicitly documented nondeterministic presentation fields. Any mismatch is `ENGINE_BEHAVIOR_PARITY_FAIL` and blocks strength claims.

## C. Historical Evidence Reclassification

1. Mark T014-T027 scores, frontiers, H2H matrix, pruning results, and promotion decisions as:

```text
SANDBOX_ENGINE_UNVERIFIED
```

until A and B pass.
2. Preserve all data, but do not delete it, apply it, use it to replace Tier 1, or bias the continued optimizer's mutation budget.
3. T027 must not run high-sample promotion against an unverified engine. If already started, pause after current atomic cursor and publish `STATUS: PARTIAL` with completed work clearly marked unverified.

## D. Parity-Pass Next Action

Only on byte and behavioral parity PASS may the runner resume T027 or launch continuous training. Its experience library observations must carry the verified parity manifest hash and protocol version. A code/bundle change invalidates reuse for strength decisions and requires a new observation record.

## Acceptance

- [ ] Real-game artifact and tree runner artifact are explicitly identified and byte-SHA256 compared before simulation.
- [ ] Tree runner consumes the verified real artifact directly or a same-commit deterministic build artifact, without manual copy drift.
- [ ] Deterministic behavioral parity harness passes for Tier 1 and representative candidate trees across both sides and fixed seeds.
- [ ] Any mismatch has a reproducible failure record and blocks training/tiering.
- [ ] All historical T014-T027 strength evidence is clearly reclassified pending parity.
- [ ] No new Tier promotion, active bundle change, apply/deploy, or continued optimization targeting occurs before PASS.

## Delivery

Write `TASKS/tree/T028.report.md` with exact artifacts/hashes, parity matrix, behavioral trace diff evidence, PASS/FAIL result, historical reclassification, any paused cursor, next safe action, and no-apply confirmation. Commit/push only `agent/tree`. Do not modify this specification.
