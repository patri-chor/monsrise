STATUS: OPEN
DOMAIN: tree

# T042 - Complete Root-Lineage Melee Catalog

> Domain: `tree` | Executor branch: `agent/tree`
> T041R repaired distinct Stage-1 attempts, but its melee catalog is incomplete. Preserve all prior artifacts. Extend only the root-lineage member discovery and versioned melee catalog construction; retain the existing P1/P2 paired probabilistic sampling algorithm.

## Verified Remaining Defect

T041R's config has 18 members:

```text
11 current T1 roots
+ 7 Early Bundle held-out snapshots
```

It omits existing eligible generated candidates and descendants despite their complete lineage/coverage records. That does not meet the agreed rule:

```text
one root T1 source + all traceable variants/descendants/snapshots in that root lineage = one melee archetype
```

Early Bundle snapshots are valid lineage members when provenance maps to the root, but they are not a substitute for actual generated candidate descendants.

## A. Deterministic Complete Member Discovery

Construct a new versioned T042 melee catalog from all eligible traceable snapshots per root T1 source:

```text
1. current frozen root T1 snapshot
2. current experimental/frontier candidates and descendants from candidate_lineage / registry / catalog
3. Stage-1 generated descendants with a valid canonical fingerprint and completed product-path screen
4. Early Bundle held-out snapshot only when explicit root provenance exists
5. historical snapshot only when explicit root provenance exists and its historical role is permitted by the current revision policy
6. retained specialist snapshot only with an explicit source-root chain
```

Do not assume every file line is eligible. Exclude:

```text
current candidate fingerprint when constructing its own opponent sample
invalid / rejected / duplicate candidates
unresolved roots
missing product-path screen evidence
stale snapshots explicitly retired by a newer revision policy
any candidate whose lineage root cannot be proven
```

Each catalog member must persist:

```text
memberId
snapshot fingerprint
rootSourceId / primaryArchetype
complete lineage proof or explicit historical/heldout provenance
origin kind: ROOT | GENERATED_DESCENDANT | EARLY_HELDOUT | HISTORICAL | SPECIALIST
eligibility evidence reference and revision
strength evidence kind/revision/score/fingerprint
```

## B. Revision-Safe Membership Lifecycle

A melee revision is immutable. Do not mutate T041/T041R manifests or mix their records with T042 scores.

Create a new revision when:

```text
eligible descendant set changes
root T1 source fingerprint changes
strength evidence revision changes
member retirement/invalidity changes
```

Existing experimental candidates may become opponent members only after their own stage evidence exists. A candidate must never fight its exact own fingerprint, but sibling/ancestor/descendant variants in the same root lineage are allowed as opponents if eligible.

Record catalog-level counts:

```text
members by root
members by origin kind
excluded candidates with concrete reason
multi-member root count
```

## C. Strength Weights

Retain uniform top-level root selection and positive, frozen, normalized in-root weighting. Recompute from each eligible member's actual strongest completed frozen benchmark evidence, not a hardcoded value.

When evidence scores differ, weights must differ monotonically after smoothing. Persist formula version, floor, input score, evidence fingerprint and normalized output. New generated descendants must be capable of affecting the next revision's within-root distribution.

## D. Required Checks

Extend checks/tests to prove:

```text
all eligible lineage-traceable generated descendants are included in their root catalog
Early Bundle heldouts do not mask missing generated descendants
all exclusions have explicit concrete reasons
no unresolved root or missing product-path evidence enters the catalog
same candidate fingerprint is excluded only for its own melee sample, not globally
catalog revision changes on eligible-descendant or strength-evidence change
member weight evidence is non-hardcoded and normalized per root
root top-level selection remains uniform and P1/P2 pairs remain mandatory
T041R artifacts are recognized as prior revision only, never mixed into T042 metrics
```

## Acceptance

- [ ] Each root archetype contains all currently eligible traceable candidate descendants, not roots plus Early Bundle alone.
- [ ] Every member and exclusion is explainable from a durable lineage/eligibility record.
- [ ] Member additions create a new frozen revision and affect only future melee sampling.
- [ ] No self-opponent, no prohibited benchmark, no Tier/apply/deploy/publish action.

## Delivery

Write `TASKS/tree/T042.report.md` with T041R membership gap audit; member/exclusion counts by root; examples of generated descendants admitted; revision identity and diff; frozen evidence/weight table; paired sampling verification; and aggregate-only/no-apply confirmation. Commit/push only `agent/tree`.
