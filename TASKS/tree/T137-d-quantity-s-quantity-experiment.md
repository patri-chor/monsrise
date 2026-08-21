STATUS: OPEN
DOMAIN: tree
SUPERSEDES: T136-finish-flat-runtime-deletion

# T137 - D Quantity and S Quantity Experiment

## Objective

Replace the remaining placeholder D catalog and run a measured experiment to determine useful D and S budgets.

## D Candidate Policy

Only two D paths:

```text
D1 same monster, alternate legal badge combinations
D2 external replacement, cost exactly 2
```

D1:

```text
for each current team monster
-> enumerate all legal badge combinations from the real badge rules
-> keep 1-2 seeded candidates per monster for this experiment
```

D2:

```text
from the real monster database
-> filter cost === 2
-> remove current team IDs and obvious non-replaceable candidates
-> seeded random sample
```

Do not add:

```text
internal deck reorder
4-cost replacement
hand-order strategy
opening O/O+S
```

Do not hard-code badge IDs or external monster IDs. Maintain stable seed ordering and record candidate source/rejection reason.

## Experiment Matrix

Run selected dynamic T0 cases with these controlled budgets:

```text
D candidate cap: 2, 4, 6
S trials per D: 4, 8, 16
```

Use the same target snapshots, adverse cases, seeds, pool revision, and worker backend for all cells. Do not compare cells with different baseline evidence.

D+S trigger remains:

```text
L2 Score70 < 0.70 AND pure S produced no retained local signal
```

For each D:

```text
D snapshot -> D-specific state capture
-> S unique trials up to cell budget
-> first local signal ends S for that D
-> retain signal lineage; no signal skips L1/L2
```

## Required Metrics

Per matrix cell and aggregate:

```text
D catalog generated / valid / rejected
D attempts
D-specific state valid / missing
S proposals / invalid / duplicate / unique
D local signal count
D+S retained lineage count
D_NO_LOCAL_SIGNAL count
backprop candidate count
backprop improvements / neutrals / regressions
L1/L2 before/candidate W/D/L/N/Score70
selected/rejected lineages
wall / CPU / worker count / RSS
S unique/sec / D attempt/sec / D+S signal rate
```

Distinguish:

```text
local S signal
forward-expressible
full-match accepted
L2 accepted
```

Do not label a candidate “effective” based on local single-round improvement alone.

## Verification

1. Update `tests/tree_cycle_product.test.ts` for D1/D2 generation:

```text
real legal badge combinations
external candidates cost 2
no internal reorder / cost 4 / fixed IDs
```

2. Add the matrix experiment to `tests/tree_cycle_pilot.test.ts` with reduced budgets only for test control-flow; assert production defaults separately.

3. Run one real experiment through `scripts/run_tree_cycle.ts --pilot` or its flat runtime API. Do not use the old nested cycle.

4. If D trigger is not reached in a cell, record zero D attempts with exact trigger reason; do not fabricate D results.

## Acceptance

- [ ] D catalog contains only same-monster badge variants and external 2-cost replacements.
- [ ] D/S matrix executes with stable shared baseline and seeds.
- [ ] D count vs S count relationship is measured through local signal and full backprop outcomes.
- [ ] No placeholder fixed IDs remain in formal D generator.
- [ ] No internal reorder/hand/opening paths enter this experiment.
- [ ] No active/global mutation.

## Delivery

Write `TASKS/tree/T137.report.md` with D catalog examples/source counts; full 3x3 budget table; local-signal/D+S/backprop relationship; L1/L2 results; resource/throughput table; recommended D/S budgets based on data; test/run outputs; no-apply confirmation; changed files. Commit/push only `agent/tree`.
