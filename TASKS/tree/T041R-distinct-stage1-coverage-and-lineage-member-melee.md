STATUS: OPEN
DOMAIN: tree

# T041R - Distinct Stage-1 Coverage and Lineage-Member Melee

> T041 is rejected for long-running use despite its checker passing. Preserve all T037-T041 records as historical artifacts. Repair only the false Stage-1 completion and degenerate melee membership/weights. No Tier/apply/deploy/publish action.

## Verified Defects

### 1. Stage-1 evidence is repeated, not distinct work

`stage1_episode_ledger.jsonl` writes attempts 1/2/3 for the same candidate fingerprint and same atomic change. Example pattern:

```text
same candidateId
same candidateFingerprint
same operatorFamily
same atomicChanges
same strongPoolVectorRef
only attemptOrdinal and wording differ
```

This does not satisfy the required three actual distinct targeted optimization attempts. It is repeated evidence, not coverage.

### 2. Melee archetypes contain only their roots

`melee_archetype_config.json` has:

```text
totalArchetypes = 11
totalMembers = 11
one root T1 member per archetype
rawStrengthScore = 0.85 for every member
smoothedWeight = 1 for every member
```

Thus its two-stage sampling is degenerate: it samples an archetype but has no root descendants/variants to weight and sample within it. This violates the approved definition:

```text
one root T1 source + all traceable candidates/variants/historical snapshots in its lineage = one archetype
```

## A. Distinct Stage-1 Episode Contract

A Stage-1 episode requires at least three distinct attempts **for the same episode parent context** before melee dispatch.

Two attempts are distinct only if their stable attempt identity differs in at least one substantive field:

```text
candidate canonical fingerprint
parent fingerprint (when a new accepted parent advances the episode)
operator family
canonical atomic change set
primary diagnostic target: opponent + actual side
```

Attempt identity must be a stable hash of those fields. Identical identity may be reused only as a sample extension record and must be labelled `SAMPLE_EXTENSION`; it cannot increment `distinctAttemptCount`.

Each countable attempt must:

```text
be generated anew from the current episode parent or a recorded valid branch
have a distinct canonical candidate fingerprint
have a distinct atomic change set or a distinct documented diagnostic target
execute a real current-strong-pool 11 x P1/P2 screen
reference its own vector result
```

Rules:

```text
MELEE dispatch fails closed until distinctAttemptCount >= 3
checker rejects duplicate attempt identity, candidate fingerprint, or atomic change set within a countable episode
an attempt must not repeat the same strongPoolVectorRef under a new ordinal
all attempt records expose countable=true/false and dedupe reason
```

A strong source with no legal third single-change candidate must record concrete exhausted legal directions, then may use deterministic multi-monster exploration to reach distinct coverage; it must never fabricate repeat attempts.

## B. Build Real Root-Lineage Melee Membership

For each root T1 `sourceId`, construct its melee archetype membership from all eligible, traceable snapshots:

```text
1. current root T1 snapshot
2. current and historical experimental candidates whose lineage resolves to that root
3. Early Bundle / historical snapshots only when explicit provenance maps them to that root
4. retained specialist snapshots whose lineage resolves to that root
```

The current candidate being evaluated must be excluded from its own opponent pool by fingerprint, but other variants from the same root remain eligible.

An eligible member requires:

```text
unique snapshot fingerprint
rootSourceId
lineage proof or explicitly mapped historical provenance
at least one frozen strength-evidence reference
not retired/invalid/duplicate
```

There is no requirement that every root immediately has >=2 members. But a revision with only one-member archetypes must be classified:

```text
MELEE_DEGENERATE_LINEAGE_POOL
```

and must not claim flow-level weighted within-archetype sampling has been exercised. The training loop should continue Stage-1/coverage work until enough variants exist; it may run a root-only safety smoke sample but cannot mark a candidate stable/`EXPERIMENTAL_FRONTIER` from that result.

## C. Frozen Strength Evidence and Non-Degenerate Weights

Use each member's frozen, revision-scoped strength evidence from the strongest completed applicable benchmark record, with provenance:

```text
strengthEvidenceKind
strengthEvidenceRevision
strengthEvidenceScore
strengthEvidenceFingerprint
```

Create bounded smoothed weights with a positive floor. All weights must be normalized within each root lineage and deterministic from the revision evidence. Do not use a single hardcoded constant.

Checker must verify:

```text
at least one multi-member root lineage exists before weighted sampling is claimed
all eligible members have positive normalized weights
members with greater frozen strength have non-decreasing weight
member sample records contain expected weight and actual selected member
sample distribution is consistent with deterministic schedule/weights
current candidate fingerprint never appears as its own opponent
```

Top-level root/archetype selection remains uniform. Every sampled member remains P1/P2 paired.

## D. Evidence and State Boundaries

- T041's `stage1_episode_ledger.jsonl`, `melee_archetype_config.json`, `melee_sampling_manifest.json`, and `melee_sample_pairs.jsonl` are historical/rejected baseline artifacts. Never re-label them as T041R proof.
- Write versioned T041R artifacts or add an explicit `revision` and `supersedes` boundary that prevents mixed scoring.
- Do not use candidate-vs-parent/self-play, rule-random, old separation/adScore, arena, old round-robin, formal promotion, or automatic integration.
- Keep product path and aggregate-only labels.

## Acceptance

- [ ] No candidate reaches Melee based on duplicate Stage-1 attempt records.
- [ ] Three countable Stage-1 attempts are genuinely different, each with its own strong-pool screen evidence.
- [ ] Melee config resolves real root-lineage members and excludes current candidate self-opponents.
- [ ] Strength weights derive from frozen evidence, are nonconstant when member evidence differs, and are normalized per lineage.
- [ ] Degenerate root-only pools cannot yield an experimental-frontier stability decision.
- [ ] Uniform root selection and paired P1/P2 scheduling remain intact.

## Delivery

Write `TASKS/tree/T041R.report.md` with duplicate evidence audit; distinct Stage-1 attempt identities; episode parent/lineage examples; root-member counts; provenance of every non-root member; frozen strength evidence and weights; degenerate-pool handling; pair samples; checker results; and no-apply confirmation. Commit/push only `agent/tree`.
