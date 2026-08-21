STATUS: OPEN
DOMAIN: tree
SUPERSEDES: T129-dynamic-t0-pilot-real-measurement

# T130 - Dynamic Snapshot and Opening-Cycle Integration

## Facts to Preserve

1. The opening library still exists:

```text
src/engine/tree/flow_library.ts -> OPENING_MODULES
11 R1 user opening modules
```

2. Old `branch_induct.ts` has opening-candidate operators.

3. Neither is currently part of the consolidated Generation 2 cycle candidate space.

4. T129 pool L1/L2 evaluates `DynamicPoolEntry.currentEvol` correctly, but its per-formation cycle accepts only `targetFormationId` and resolves the original snapshot again. Therefore an accepted dynamic snapshot cannot become the next cycle's optimized baseline.

## Goal

Fix dynamic snapshot propagation and integrate constrained R1 opening-library search into the existing single 7-module optimizer cycle.

After this task, a dynamic T0 entry evolves continuously:

```text
pool currentEvol
-> cycle baseline/search/validation
-> accepted branch/opening delta
-> candidate currentEvol
-> L1/L2 remeasurement
-> accepted pool snapshot
-> next cycle receives that exact currentEvol
```

No parallel optimizer, old runner revival, event system, global active formation mutation, or manual per-formation opening choice.

## 1. Exact Dynamic Snapshot Input

Extend only the consolidated cycle types/API:

```ts
interface OptimizerCycleConfig {
  targetSnapshot?: {
    formationId: string;
    displayName: string;
    canonicalFingerprint: string;
    team: TeamSlot[];
    evol: EvolFormation;
    rootSourceId: string;
  };
  opponentSnapshots?: ...;
}
```

Rules:

```text
- if supplied, `targetSnapshot` is the exact target authority for all baseline,
  adverse-case mining, RoundBoardState capture, local search, branch validation,
  post-benchmark and artifact fingerprinting;
- resolver is used only when explicit snapshot is absent;
- all cycle artifacts contain target input fingerprint and resulting snapshot
  fingerprint;
- dynamic pool passes its actual currentEvol/current fingerprint as targetSnapshot;
- test a deliberately altered isolated currentEvol and prove cycle strategy trace
  / candidate space differs from resolver-original evolution;
- opponent snapshots are similarly accepted where pool entries have dynamic
  currentEvol; never silently resolve a named original opponent when an exact
  dynamic entry is supplied.
```

## 2. Opening Library as Constrained R1 Candidate Space

Integrate `OPENING_MODULES` into `cycle/search.ts`; do not import old
`branch_induct.ts` search loop.

Opening candidates are generated only for adverse cases at R1 or R2:

```text
- select compatible opening module from OPENING_MODULES;
- candidate must be satisfiable by target team IDs/badges/current budget;
- construct legal R1 deployment intent/layout/order delta;
- preserve no duplicate monster, zone/collision, budget and tree legality;
- create an R1 branch/action delta only at a legal visible decision point;
- include module ID and source in candidate evidence.
```

For R2 cases, an opening candidate may modify R1 only when the necessary
condition is visible at R1. Otherwise retain it as local-only/search evidence.

Search mix per case:

```text
- normal board edits: deployed reposition / pending placement / order;
- opening module candidates: only R1/R2 adverse cases;
- configurable `openingCandidateShare` default 0.30, capped so opening search
  cannot drown normal local board search;
- all candidates still use canonical edited state fingerprint; invalid/duplicate
  do not consume unique budget.
```

Do not brute force all 11 modules against every case. First filter compatibility;
then use deterministic seeded selection within the opening budget.

## 3. Unified Candidate/Objective Path

Opening candidate and board-edit candidate share the same flow:

```text
candidate
-> exact snapshot / cached RoundBoardState state construction
-> SingleRoundEngine for target round
-> common objective/Pareto archive
-> legal forward compile
-> actual strategy trace paired validation
-> candidate-local Score70 accept/reject
```

Opening candidate must be judged by full product result before it can enter the
pilot library. A local R1 gain alone never replaces a dynamic pool snapshot.

## 4. Dynamic Pool and L1/L2 Pilot Rerun

Correct T129 result accounting and execute a real three-entry dynamic pilot:

```text
- exactly 3 selected ACTIVE behavior-distinct pool entries where available;
- use actual dynamic pool snapshots as targets and opponents throughout;
- L1/L2 seeds: at least 3 disjoint deterministic seeds each;
- cycle: at least 2 iterations, 16 unique candidates/case, population 8,
  2 generations;
- record normal/opening candidate counts separately;
- record target snapshot fingerprint at every stage;
- candidate L1/L2 uses same immutable pool_before revision;
- apply replacements after all three decisions.
```

A replacement requires:

```text
exact dynamic snapshot propagation proven
AND at least one accepted cycle pilot branch/opening delta
AND L1 non-regression
AND L2 non-regression
AND strict combined Score70/product-outcome improvement
```

## 5. Architecture Boundaries

Keep the 7 primary cycle files. Allowed additions are limited to:

```text
cycle/opening.ts (optional, preferred if search.ts would become unclear)
```

If added, it is the 8th and final cycle module, responsible only for compatible
opening candidate catalog/construction. No other new cycle runner.

`pool/` remains its current coordinator boundary. Archive/legacy opening code
stays historical and is not imported by runtime cycle.

## Evidence

Current cycle artifacts add:

```text
input_snapshot.json
iteration-XXX/opening_candidates.jsonl
```

Dynamic pilot adds:

```text
formation-XXX/snapshot_propagation.json
formation-XXX/opening_search_metrics.json
```

Every candidate trial records:

```text
candidate kind: BOARD_EDIT | OPENING_MODULE
opening module ID or N/A
source snapshot fingerprint
edited/candidate snapshot fingerprint
R1/R2 eligibility reason
valid/invalid/duplicate/unique status
```

## Broad Verification

One broad test and one actual three-T0 run verify:

```text
- supplied target/currentEvol is used through every cycle stage;
- no resolver original snapshot is silently used when exact dynamic snapshot is
  supplied;
- opening modules are considered only for R1/R2 adverse cases;
- incompatible module/budget/team/visibility candidates are excluded;
- R3+ cases create zero opening candidates;
- opening and board candidates share unique-budget/objective/validation path;
- branchSelected remains actual exact strategy trace evidence;
- pool replacement uses dynamic candidate snapshots and same pool_before matrix;
- normal/opening search counts and throughput are recorded;
- no active/R0/global/tier/L1/deployment mutation.
```

Do not assert a named opening, formation, coordinate, accepted count, or positive result.

## Acceptance

- [ ] Dynamic T0 snapshots, not resolver originals, become the next cycle baseline.
- [ ] Opening library is a bounded legal R1/R2 search dimension in the one cycle.
- [ ] Full three-T0 L1/L2 pilot is executed and reports real normal/opening search performance.
- [ ] Candidate replacement remains result-driven and no-regression guarded.
- [ ] Cycle remains one entrypoint with at most eight primary runtime modules.
- [ ] No active/global formation mutation.

## Delivery

Write `TASKS/tree/T130.report.md` with snapshot propagation map; opening integration map; compatibility/rejection accounting; normal-vs-opening candidate/search table; three formation L1/L2 before/candidate/after Score70 W-D-L-N; pool decisions; actual runtime; test/run results; artifact paths; no-apply confirmation; changed files. Commit/push only `agent/tree`.
