STATUS: OPEN
DOMAIN: tree

# T048 - Independent L2/L1 Verification and Perfect-Score Quarantine

> Domain: `tree` | Executor branch: `agent/tree`
> T047 found no arithmetic/self-play/worker-error defect in recomputable artifacts, but found 24 aggregate `learning_level_evaluations` records with 100% L2 and L1 scores that lack independently traceable per-opponent/per-side W/D/L vectors. They are `SUSPICIOUS_REQUIRES_RETEST`. This task adds an independent verification gate and quarantines unverified perfect scores from strength claims, tier promotion evidence, L1 web weighting, and presentation.

## A. Preserve but Quarantine Existing Aggregate Results

Do not delete, rewrite, or relabel historic T037-T047 artifacts. Preserve their original aggregate exploration status.

Create an explicit verification state for each candidate/revision:

```text
UNVERIFIED_AGGREGATE_ONLY
INDEPENDENT_VERIFIED
INDEPENDENT_REJECTED
INDEPENDENT_INCONCLUSIVE
```

All current L2/L1 perfect scores that lack raw full-vector evidence begin:

```text
UNVERIFIED_AGGREGATE_ONLY
SUSPICIOUS_REQUIRES_RETEST
```

Until independently verified, they must not:

```text
be presented as 100% strength claims
increase L1 within-root strength weight
serve as binding T2 -> T1 promotion evidence
be exported as high-strength L1 web opponent metadata
be used to label a player-facing opponent "perfect" or "stable"
```

They may remain candidates and continue normal exploration, clearly labelled unverified.

## B. Independent Product-Path L2 Retest

For every candidate whose current L2 score is exactly 1.0, run a fresh, isolated product-path verification against the frozen T0 11 pool.

Required design:

```text
product path only:
PersistentSimPool -> fine_grained_worker(product_path) -> playFullGame -> product_tree_strategy

all 11 frozen T0 opponents x P1/P2
minimum 10 games per opponent x side = 220 games/candidate
new deterministic verification seed schedule distinct from prior training schedules
one actual game per task; retain T039 CPU-saturating task granularity
```

Persist append-only raw records sufficient to independently recompute every result:

```text
verification revision / candidate ID/fingerprint / root T0 source
opponent ID/fingerprint / actual side / game index / exact seed
W/D/L or explicit per-game outcome
execution/provenance manifest hash
worker/deployment error status
```

Then persist a full derived vector:

```text
candidate x opponent x side aggregate W/D/L
per-opponent score
per-side score
weakest opponent / side
total W/D/L / total game count / score / pure win rate
```

A worker/deployment error invalidates that candidate's verification run; it cannot be counted as a win or silently omitted.

## C. Independent Probabilistic L1 Retest

For every candidate with current L1 score exactly 1.0, execute fresh product-path probabilistic melee verification using a frozen T042-compatible catalog revision.

Required design:

```text
root T0 archetype top-level uniform sampling
in-root frozen weights from VERIFIED evidence only; where unavailable use documented neutral/floor weight
mandatory P1/P2 paired games
at least 10 paired samples per root archetype = 11 roots x 10 pairs x 2 sides = 220 games/candidate
new deterministic verification seed schedule
```

Persist raw pair/member/archetype/side/seed/outcome records and per-root, per-member, per-side aggregates. Do not infer a 220-game result from old 32-game aggregate scores.

## D. Verification Classification

Do not require 100% to pass. Classify from independently recomputable evidence:

```text
INDEPENDENT_VERIFIED:
  full required coverage complete
  zero worker/deployment errors
  raw vector reconciles exactly
  no self-opponent/fingerprint leak

INDEPENDENT_INCONCLUSIVE:
  complete valid run but score/weakest-side result is below a configurable verification confidence policy

INDEPENDENT_REJECTED:
  invalid provenance, leak, error, missing coverage, or arithmetic mismatch
```

The policy may separately define “eligible for T1 promotion” and “eligible as weighted L1 web member”; it must never turn an unverified 100% aggregate into a verified claim.

## E. Integrate With T045/T046 Safely

1. Preserve the user-authorized current formation-tier threshold policy. This task does not decide 80/85 vs other policy; it only restricts which evidence can be binding.
2. Tier state must expose both:

```text
training aggregate score
independent verification state/revision
```

3. T046 web export must include verification state. Web selection may include unverified members only under neutral/floor sampling, with no high-strength/perfect presentation; preferred weighting uses independently verified results.
4. Player history records the opponent verification state/revision for each match.
5. Do not block basic player-vs-L1 challenge solely because perfect-score verification is pending; do block misleading labels/weights.

## F. Required Checks

```text
all prior L2/L1 perfect aggregate records are quarantined until independent result exists
no unverified perfect score drives T2->T1 promotion, high weight, or player-facing perfect claim
L2 verification has exact 11 x P1/P2 x 10 coverage with raw outcomes and fresh seeds
L1 verification has 11 root x 10 paired sample x P1/P2 coverage with raw outcomes and fresh seeds
all raw -> aggregate arithmetic recomputes exactly
self-opponent/fingerprint leakage, worker/deployment errors, missing cells fail verification
historic sandbox and early shallow-pool values cannot satisfy verification
verified/neutral weights are deterministic and revision-pinned
T046 web export/history carry verification status without player history leaking into training
```

## Acceptance

- [ ] Every formerly perfect L2/L1 aggregate result is either independently verified, inconclusive, rejected, or explicitly awaiting verification.
- [ ] No result without raw per-opponent/per-side evidence can be claimed as verified 100% strength.
- [ ] L2/L1 verification data is product-path, complete, seed-separated, and independently recomputable.
- [ ] Tier and web paths distinguish exploration results from verified evidence.
- [ ] No active game apply/deploy/publish or training-policy mutation.

## Delivery

Write `TASKS/tree/T048.report.md` with candidate inventory; quarantine states; frozen manifests; raw coverage counts; W/D/L recomputation; L2/L1 classifications; detected errors/leaks; resulting verified-vs-neutral web weighting policy; impact on tier eligibility; checker output; and no-apply confirmation. Commit/push only `agent/tree`.
