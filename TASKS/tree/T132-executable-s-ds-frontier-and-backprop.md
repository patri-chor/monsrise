STATUS: OPEN
DOMAIN: tree
SUPERSEDES: T131-s-and-ds-lineage-optimizer

# T132 - Executable S/D+S Frontier and Back-Propagation

## Rework Fact

T131 is not accepted. Its implementation adds snapshot input and `LocalLineage` types, but no executable D+S path exists:

```text
missing: D catalog, L2<.70 + S-no-signal trigger, 4×8 D+S loop,
D_NO_LOCAL_SIGNAL handling, ds_trials, backprop validations, lineage selection
```

The current test also does not exercise these requirements and exceeded the practical re-run time budget. Implement the actual loop in one pass; do not add another architecture layer.

## Goal

Make the existing consolidated optimizer cycle execute exactly:

```text
S frontier discovery
-> conditional D+S discovery
-> bounded lineage back-propagation
-> L1/L2 measured lineage selection
-> exact dynamic snapshot becomes next pool baseline
```

Only modes:

```text
S
D_PLUS_S
```

No O/opening dependency. No event sourcing. No new runner. Keep current cycle/pool APIs and snapshot propagation.

## 1. Executable S Frontier Discovery

For each adverse case:

```text
32 unique valid S trials/case
```

S uses existing cached state and SingleRoundEngine. Record every proposal:

```text
proposal / invalid / duplicate / unique
objective
improvement class
state/output fingerprint
```

Retain all behavior-distinct local improvements in evidence. Derive non-dominated frontier programmatically.

For expensive back-propagation only:

```text
select <=8 lineages/case
select <=16 lineages/target snapshot total
```

Selection ordering:

```text
shared local objective
-> diversity by edited state fingerprint/edit family
-> stable lineage ID
```

## 2. D+S Exact Trigger

D+S is evaluated per target snapshot/case group only if:

```text
L2 Score70 < 0.70
AND no S local improvement retained for that group
```

No trigger otherwise. Persist `D_NOT_TRIGGERED` with measured reason.

D catalog: deterministic, max 4 valid changes, derived from current target snapshot:

```text
BADGE_CHANGE
DECK_INTERNAL_REASSIGNMENT
CONSTRAINED_EXTERNAL_REPLACEMENT
REPLACEMENT_WITH_BADGE_VARIANT
```

Required constraints:

```text
team 6..8
no duplicate monster
legal badges
cost/team/tree legality
role/round compatibility
preserve required module invariants where applicable
```

No full catalog brute force. Each catalog record has source/validity/rejection reason.

## 3. D+S Execution

For each valid D:

```text
create exact D snapshot
rebuild affected baseline state/case using D snapshot
run up to 8 unique valid S trials
```

Behavior:

```text
first local S improvement -> retain D+S lineage and stop S for that D
no local improvement by 8 -> D_NO_LOCAL_SIGNAL; no full/L2 validation
continue remaining D attempts to retain multiple D+S lineages
```

All D+S local signals go to the same bounded global lineage frontier. D does not get a direct whole-match/L2 test without an S signal.

## 4. Actual Back-Propagation

For retained S and D+S lineages only:

```text
- materialize isolated candidate snapshot/tree;
- run L1 and L2 against exact immutable pool_before revision;
- for D+S, re-mine adverse cases from its D snapshot before final result;
- calculate target-relative W/D/L/N, Score70, rounds, survivor/HP;
- classify IMPROVES / NEUTRAL / REGRESSES using shared comparator.
```

Pool selection:

```text
strict L2 improvement
AND no L1 regression
AND no selected-pair regression
=> replace parent with one best lineage
else retain parent
```

All other local/frontier lineages remain warm-start evidence.

## 5. Required Artifacts

Cycle iteration:

```text
s_trials.jsonl
d_catalog.jsonl
ds_trials.jsonl
local_lineages.jsonl
backprop_validations.jsonl
lineage_selection.json
```

Explicit zero-record/schema output required for non-triggered D+S.

Metrics:

```text
S: proposals/invalid/duplicate/unique/improvements/frontier count
D: catalog/valid/rejected/not-triggered/no-signal
D+S: attempts/S trials/local signals/retained
backprop: selected/validated/improves/neutrals/regresses
```

## 6. Test + Practical Three-T0 Run

Test the full control flow with a bounded config that completes under 120 seconds:

```text
- S 32 unique trials/case is configurable; test may use lower override only
  while asserting default is 32;
- direct synthetic/fixture cases prove D trigger/no-trigger, 4×8 bound and
  no-signal skips backprop;
- real product smoke proves snapshot propagation and one S/backprop path.
```

Then run one practical three-T0 pilot:

```text
3 active entries
L1/L2: >=2 disjoint seeds each
S discovery default 32/case
cycle >=1 iteration
```

If runtime exceeds practical budget, report partial actual counts and the stage reached; do not reduce silently or mark full run complete.

## Acceptance

- [ ] D+S is actual executable code, not only type declarations.
- [ ] Trigger/4×8/no-signal behavior has direct tests.
- [ ] Multiple S/D+S local lineages are retained before L1/L2 selection.
- [ ] Only local-signal D+S lineages consume backprop budget.
- [ ] Dynamic snapshot replacement uses measured L1/L2 results.
- [ ] T131 artifacts/metrics are generated.
- [ ] No active/global mutation.

## Delivery

Write `TASKS/tree/T132.report.md` with T131 missing-to-implemented table; S/D+S counts; trigger/no-trigger matrix; 4×8 accounting; local/frontier/backprop lineage counts; three-T0 pilot actual stage/results/runtime; test outputs; artifact paths; no-apply confirmation; changed files. Commit/push only `agent/tree`.
