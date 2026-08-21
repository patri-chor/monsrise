STATUS: DONE
DOMAIN: tree
SUPERSEDES: T130-dynamic-snapshot-opening-cycle-integration

# T131 - S and D+S Lineage Optimizer

## Policy

The optimizer cycle has exactly two optimization modes:

```text
S     local current-round tactical search
D + S deck/badge snapshot change followed by local tactical search
```

Explicitly remove opening (`O`) from this cycle:

```text
- do not integrate OPENING_MODULES into cycle/search;
- do not generate O or O+S candidates in dynamic T0 optimization;
- opening-library optimization belongs to formation generation, not existing
  formation cycle training;
- preserve flow_library and historical opening research, but they are not
  runtime dependencies of this optimizer cycle.
```

## Core Principle

A single-round result is discovery evidence, not final selection evidence.

Do not choose one “best” S result during local search. Preserve multiple locally improved lineages, then re-evaluate them by feeding each lineage back through product/L2 measurement.

```text
baseline snapshot
-> find multiple local S improvements
-> retain candidate lineages
-> bounded back-propagation / L2 comparison
-> select retained dynamic snapshot only from measured whole-result evidence
```

The same rule applies to D+S:

```text
D modification
-> S local search on D snapshot
-> no local S improvement: discard D immediately
-> one or more local S improvements: retain D+S lineage
-> only retained D+S lineages receive whole-match/L2 back-propagation
```

There is no direct D-only global evaluation. A deck/badge change must first show a local improvement through S before consuming full L2 validation budget.

## Goal

Refactor the consolidated dynamic T0 cycle into a lineage-based S/D+S optimizer. Fix dynamic snapshot propagation at the same time:

```text
DynamicPoolEntry.currentEvol/current snapshot
-> exact cycle target snapshot
-> S search
-> retained S lineage(s)
-> optional D+S trigger/lineages
-> L2 back-propagation
-> dynamic pool replacement
-> next cycle receives exact accepted snapshot
```

Keep the existing 7-file cycle as the only optimizer authority. Add at most one cycle module only if it makes lineage handling clear:

```text
cycle/lineage.ts
```

No opening integration, no event system, no old runner restoration, and no global production/R0/tier/L1/deployment mutation.

## 1. Exact Dynamic Snapshot Propagation

Add exact target/opponent snapshot inputs to consolidated cycle config/API:

```ts
interface CycleSnapshotInput {
  formationId: string;
  displayName: string;
  canonicalFingerprint: string;
  rootSourceId: string;
  team: TeamSlot[];
  evol: EvolFormation;
}

interface OptimizerCycleConfig {
  targetSnapshot?: CycleSnapshotInput;
  opponentSnapshots?: CycleSnapshotInput[];
}
```

When supplied, these snapshots are the authority for:

```text
benchmark
adverse-case mining
RoundBoardState construction
S search
D+S search
forward compilation
paired validation
post-cycle measurement
```

Resolver may provide immutable metadata only; it must not replace supplied evol/team with original formationId data.

Artifacts include input/current/candidate snapshot fingerprints. Test with deliberately altered `currentEvol` to prove every cycle stage uses it.

## 2. S Local Search: Retain a Frontier

For every adverse case, run cached-state one-round S search as now:

```text
reposition deployed target unit
change target pending placement
reorder target pending actions
compatible 1..3 edit combinations
```

Budget is configurable. Default practical pilot:

```text
S unique candidates/case: 16
```

Candidate identity:

```text
source snapshot fingerprint
+ base RoundBoardState fingerprint
+ edited state fingerprint
+ observable digest
```

Do not stop at the first local improvement and do not collapse all equivalent-score results to one record.

## 2A. S Frontier Discovery Measurement

Do not assume a fixed useful-S count. The first real dynamic-T0 pilot must measure it before adopting a tight retention cap.

Discovery budget per adverse case:

```text
32 unique valid S board states/case
```

During discovery, do not stop at the first improvement and do not apply the old provisional `4 per case` frontier cap. Retain every behavior-distinct local improvement and calculate the full local Pareto frontier.

For every case record:

```text
proposals
invalid / duplicate / unique valid S states
local improvements by class
behavior-distinct improvement count
full non-dominated S frontier count
objective-ranked cumulative gain at 1, 2, 4, 8, 16, 32 unique trials
frontier members surviving later L2 back-propagation
```

After the real three-T0 pilot, derive a future normal-case retention cap from observed frontier distribution:

```text
- retain enough members to cover at least 95% of observed useful/frontier cases;
- record recommended cap, p50/p90/max frontier count and marginal-gain curve;
- do not impose a smaller hard-coded cap without this evidence.
```

For this task's bounded back-propagation, use an explicit high discovery allowance:

```text
max 8 non-dominated S lineages per adverse case
max 16 retained lineages per target snapshot before L2 back-propagation
```

If a case produces more than 8 non-dominated S members, keep all in local evidence and choose the top 8 only for expensive L2 back-propagation by shared objective, diversity of edit/state fingerprint, then stable lineage ID.

Lineage record must include:

```text
lineageId
mode: S | D_PLUS_S
parent snapshot fingerprint
D delta or N/A
S edits
source case identity
local ProductOutcome/objective
state/result fingerprints
search seed/generation
```

## 3. D+S Trigger and Budget

D+S triggers only when all conditions hold for a target snapshot/case group:

```text
L2 target Score70 < 0.70
AND S search produces no retained local improvement for that group
```

D candidates are constrained snapshot edits:

```text
A. same monster, legal badge variant
B. deck-internal monster/round/order reassignment
C. constrained deck-external replacement
D. replacement plus legal badge variant
```

Do not enumerate full monster/badge catalog. Derive a deterministic capped D catalog from:

```text
current deck/role/round/cost/team size
existing flow/combo compatibility
known legal badge-switch patterns
no duplicate monster
budget/tree legality
```

D+S budget per trigger:

```text
max D attempts: 4
max S trials per D: 8 unique valid current-round states
```

For a D attempt:

```text
construct exact D snapshot
-> mine/rebuild affected current-round state
-> run up to 8 S candidates
-> first local improvement ends S trials for this D attempt
-> retain resulting D+S lineage
-> continue next D attempt so multiple D+S lineages can be found
```

If no local S improvement occurs within 8 unique valid S trials, discard D immediately:

```text
no L2/full-match validation
record D_NO_LOCAL_SIGNAL
```

A successful D may retain one first-improved S lineage, plus further non-dominated S alternatives only if they occur before the configured D-local budget is exhausted. Cap retained D+S lineages at 4 per source case group.

## 4. Back-Propagation and Selection

After local discovery, collect retained lineages across S and D+S.

Do not globally validate every raw candidate. Bounded back-propagation:

```text
per target snapshot:
- retain max 8 non-dominated lineages across cases/modes;
- each lineage creates isolated candidate snapshot/tree;
- rerun product benchmark and L2 matrix using exact same parent pool revision;
- for D+S, re-mine adverse cases from the D snapshot before its S evidence is
  evaluated in whole-result context;
- optionally run a bounded follow-up S pass on the re-mined cases;
- calculate L2 W/D/L/N, Score70, round outcomes, survivor/HP against parent.
```

Lineage selection comparator:

```text
1. L2 Score70
2. L2 W, then D, then lower L
3. L1 Score70, no L1 regression
4. reduced adverse loss/draw case count
5. target round wins/draws
6. target survivor/HP and lower opponent HP
7. lower structural complexity: S < badge D < deck D
8. stable lineage ID
```

Pool replacement requires one lineage with:

```text
strict L2 improvement
AND no L1 regression
AND no paired selected validation regression
```

All non-selected retained lineages remain as warm-start evidence. Do not destroy a local solution merely because another currently wins L2.

## 5. Cycle Flow

```text
exact current dynamic snapshot
-> L1/L2 baseline
-> adverse-case mining
-> S frontier search per case
-> if L2 < .70 and S frontier empty: D+S attempts
-> retain local lineage frontier
-> bounded L2/back-propagation of retained lineages
-> choose one measured best lineage or retain parent
-> update isolated dynamic pool snapshot
-> next cycle starts from chosen exact snapshot
```

## 6. Evidence

Cycle run artifacts:

```text
input_snapshot.json
iteration-XXX/
  s_trials.jsonl
  d_catalog.jsonl
  ds_trials.jsonl
  local_lineages.jsonl
  backprop_validations.jsonl
  lineage_selection.json
```

Dynamic T0 pilot adds:

```text
formation-XXX/lineage_summary.json
formation-XXX/dynamic_snapshot_propagation.json
```

Required counts:

```text
S proposals/invalid/duplicate/unique/frontier retained
D catalog/invalid/discarded no-signal
D+S attempts/S trials/local signals/retained lineages
back-propagated lineages
L1/L2 validation count/runtime
selected/warm-start/rejected lineage counts
```

## 7. Broad Test and Real Pilot

Implement once, then run one broad test and a real three-T0 pilot.

Verify:

```text
- supplied dynamic snapshot is used through every cycle stage;
- S retains multiple non-dominated local lineages when present;
- D+S does not trigger if L2 >= .70 or S has local signal;
- D+S triggers exactly at L2 < .70 + no S local signal;
- each D gets <=8 valid unique S trials and no-signal D receives no L2 run;
- multiple D+S local signals are retained before back-propagation;
- only retained lineages are back-propagated;
- final replacement is selected by L2/L1 product outcome, not local score;
- opening modules are not imported by cycle runtime;
- no R0/active production/tier/L1/deployment mutation.
```

No test may require a named formation, expected D trigger, exact coordinate, or positive replacement.

## Acceptance

- [ ] Cycle contains S and conditional D+S only; opening is excluded.
- [ ] Dynamic snapshots propagate exactly through repeated cycles.
- [ ] S and D+S preserve multiple local lineages before whole-result selection.
- [ ] D lacks local signal -> no expensive global evaluation.
- [ ] L2 < .70 + S no-signal triggers bounded 4 x 8 D+S search.
- [ ] Dynamic pool uses selected measured lineage as next baseline.
- [ ] Real three-T0 L1/L2 pilot reports lineage and throughput results.
- [ ] No active/global mutation.

## Delivery

Write `TASKS/tree/T131.report.md` with policy transition; exact snapshot call path; S/D+S trigger matrix; retained/back-propagated lineage counts; D no-signal savings; three-T0 L1/L2 W-D-L-N/Score70 table; selected/warm-start/rejected lineage table; dynamic pool revisions; runtime/throughput; tests/run results; artifact paths; no-apply confirmation; changed files. Commit/push only `agent/tree`.
