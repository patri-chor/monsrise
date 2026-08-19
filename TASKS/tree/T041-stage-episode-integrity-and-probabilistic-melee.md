STATUS: OPEN
DOMAIN: tree

# T041 - Stage Episode Integrity and Probabilistic Archetype Melee

> Domain: `tree` | Executor branch: `agent/tree`
> T040 report is not accepted as the long-running training implementation. Repair its stage-machine evidence and replace its fixed 16-member melee traversal with a frozen, probabilistic archetype sampler. Preserve T037-T040 historical records; do not rewrite them as T041 evidence.

## Why T040 Cannot Be Accepted

Independent ledger inspection found:

```text
STAGE_2_STRONG_POOL -> STAGE_1_STRONG_EPISODE is recorded,
but candidate proceeds to MELEE / EXPERIMENTAL_FRONTIER without an auditable Stage-1 focused episode record.

all2rush Early Bundle record has sourceRelativeScore=+0.125,
but transition text says rel=+0.125 < -0.05 and retains Stage 3.

T040 melee is a fixed 16-member full traversal,
which conflicts with the approved direction: equal probability by archetype,
then strength-weighted sampling within archetype.
```

## A. Strict Stage-1 Episode Gate

A candidate may enter `MELEE` only after a recorded Stage-1 episode, never directly after a single Stage-2 pass.

The Stage-1 episode must contain at least three *actual, distinct, eligible* targeted optimization attempts against the frozen current strong pool. Each attempt records:

```text
candidate and parent fingerprint
operator family and atomic change
triggered weak opponent / weak side / branch diagnosis
full 11 opponent x P1/P2 aggregate vector reference
stage sample tier and deterministic seeds
attempt outcome and resulting next parent selection
```

Required rules:

```text
no fabricated/synthetic STAGE_1 completion row
no MELEE task dispatch before the three-attempt episode ledger is complete
failed Stage-1 attempts remain coverage evidence, not erased
all transition predicate text must be recomputed from stored numeric values
checker must reject any contradiction such as x >= threshold being described as x < threshold
```

Candidates failing melee still return to an explicitly recorded Stage-1 diagnostic obligation. They may not return to Stage 3 unless a new Early Bundle benchmark revision invalidates their prior stage result.

## B. Probabilistic Melee Instead of Fixed Traversal

Replace T040's fixed `MELEE_MIXED_POOL_16` exhaustive traversal. A melee revision defines a finite, frozen opponent catalog, but a candidate's melee screen samples from its probability distribution rather than traversing every catalog member.

Each melee sampled opponent must run paired actual sides:

```text
candidate P1 vs sampled opponent
candidate P2 vs sampled opponent
```

Sampling algorithm for every pair:

```text
1. sample primaryArchetype uniformly among eligible archetypes
2. sample one member within that archetype using its frozen smoothed strength weight
3. dispatch paired P1/P2 product-path games
```

The manifest freezes:

```text
melee revision ID and hash
base seed and deterministic sampling schedule
eligible primary archetypes
member IDs/fingerprints/provenance
member primaryArchetype and auxiliary tags
raw strength evidence reference
smoothed member weight
minimum pair quota per archetype
sample pair budget per melee tier
```

Requirements:

```text
all archetypes have equal top-level probability
no member has zero probability within an eligible archetype
stronger members have non-decreasing in-archetype probability
weights are frozen for the entire melee revision
per-archetype minimum quotas are met before discretionary pair allocation
results report by archetype, member, and actual side
```

Use a bounded smooth weighting method with a nonzero floor. Persist formula version and exact normalized weights; do not recalculate from the candidate's own ongoing wins/losses.

## C. Archetype Governance: No Guessing, No Silent Drift

`primaryArchetype` is a structural gameplay classification, not a current Tier label, current score, or source-parent identity. It denotes the dominant mechanism / opening tempo / core-monster interaction / win pattern used to balance melee exposure.

An archetype record consists of:

```text
formation snapshot fingerprint
primaryArchetype: exactly one stable declared value
auxiliary tags: zero or more
classification rationale
archetype revision
```

Do not infer or fabricate the current 11-T1 mapping. Add a versioned editable archetype configuration and validator. Until every eligible melee member has an explicit declared primary archetype and rationale, melee dispatch must fail closed with:

```text
MELEE_ARCHETYPE_CONFIG_REQUIRED
```

A formation snapshot normally retains its primary archetype when its score/T1 membership changes. A new snapshot needs reclassification only when its dominant mechanism, opening tempo, core monster interaction, or win pattern changed materially; record old/new classification and reason. 

When a T1 snapshot changes:

```text
same structure: new fingerprint/strength evidence in a new revision; retain archetype
material structure change: new snapshot, explicit reclassification required
new T1 entrant: add to next strong-pool and melee revisions after archetype declaration
T1 exit: remove from next strong-pool revision; retain in melee only if it contributes a declared distinct archetype or documented counter pressure
```

Existing T040's fixed melee pool is historical-only and must not serve as a T041 current melee revision.

## D. Benchmark and Evidence Boundaries

Retain only these benchmark families:

```text
Stage 3: frozen Early Bundle 8
Stage 2 / Stage 1: frozen current strong pool 11
Melee: frozen probabilistic archetype catalog
```

Do not dispatch:

```text
candidate-vs-parent or self-play benchmark
rule-random benchmark
old three-target separation/adScore benchmark
arena / old round-robin implementation
```

Use product path only. All T041 output remains:

```text
AGGREGATE_EXPLORATION_ONLY
EXPERIMENTAL_UNVERIFIED_NOT_FOR_AUTO_INTEGRATION
NO_APPLY_NO_DEPLOY_NO_PUBLISH_NO_TIER_CHANGE
```

## E. Artifacts and Checks

Extend `run_cycle.ts` as the sole unattended entry. Add/extend durable append-only records:

```text
stage1_episode_ledger.jsonl
melee_archetype_config.json
melee_sampling_manifest.json
melee_sample_pairs.jsonl
```

Extend checker/tests to prove:

```text
no MELEE dispatch occurs before three recorded Stage-1 targeted attempts
Stage-1 entries contain actual strong-pool vector references
transition predicate wording and numeric comparisons agree exactly
old T040 fixed melee artifacts are not presented as current T041 evidence
melee fails closed without a complete archetype config
complete config has exactly one primary archetype and rationale per eligible member
top-level archetype sampling is uniform
in-archetype weights are positive, deterministic, normalized, and non-decreasing with frozen strength
minimum pair quotas and P1/P2 pairing are fulfilled
same revision/seed resumes idempotently without duplicate sample pairs
T1 snapshot membership changes produce a new benchmark revision without mutating historical results
no prohibited benchmark or arena path is dispatched
```

## Acceptance

- [ ] Stage-1 focused episode is real, durable, and blocks melee until complete.
- [ ] No contradictory numeric transition explanation exists.
- [ ] T041 melee uses archetype-balanced probabilistic P1/P2 pair sampling, not fixed full traversal.
- [ ] Missing archetype governance configuration fail-closes melee rather than guessing classifications.
- [ ] T1 movement creates versioned revisions and does not silently alter old rankings.
- [ ] No self-play, rule-random, old separation/adScore, Tier change, apply, deploy, or publish.

## Delivery

Write `TASKS/tree/T041.report.md` with checker commands/results; rejected T040 evidence separation; Stage-1 episode examples; any fail-closed config state or complete declared archetype configuration; frozen melee weights and sampling quotas; sampled pair distribution and P1/P2 coverage; T1 revision handling proof; telemetry; and aggregate-only/no-apply confirmation. Commit/push only `agent/tree`.
