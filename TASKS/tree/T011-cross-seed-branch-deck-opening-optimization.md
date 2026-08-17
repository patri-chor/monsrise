STATUS: OPEN
DOMAIN: tree

# T011 - Cross-Seed Branch, Deck, and Opening Optimization

> Domain: `tree` | Executor branch: `agent/tree`
> Prerequisites: T009 and T010 are accepted. This is a bounded diagnostic optimization task, not a production candidate run and not an apply task.

## Objective

Evaluate tree optimization fairly across all four generation seeds, expand branch-local search beyond the current deck, and add controlled R1/R2 opening modifications for early-round weak matchups.

## Decision Context

The earlier proof selected four `cand_s1_*` candidates from only the first source seed. It cannot establish whether the other three source seeds respond to branch optimization.

Current branch-local replacement is limited to:

```ts
const teamIds = branched.team.filter(...).map(...)
for (const toMid of teamIds) { ... }
```

It can only exchange monsters already in the deck. It cannot search a constrained external deck pool. Existing `evolution2.ts` already contains reusable early-game mutation primitives (move earlier, R1/R2 order swap, position change), but `optimizeBranchParallel` does not use them.

## Scope

Allowed files:
- `src/engine/tree/branch_induct.ts`
- `src/engine/tree/candidate_optimization_runner.ts`
- `src/engine/tree/sequential_tree_optimization.ts`
- `src/engine/tree/deck_ontology.ts`
- directly-required tree operator helpers
- focused tests and committed tree fixtures

Do not modify:
- generation-domain tasks/source/reports
- active `FORMATION_LIBRARY`, bundle artifacts, shared matrix/state, apply/deploy code
- `scripts/watch-gemini.ps1`
- mutation/generation pipelines or candidate retention logic

## A. Balanced Four-Seed Candidate Set

1. Use exactly eight frozen candidates: two candidates from each source seed index `s1`, `s2`, `s3`, and `s4`.
2. Add/commit a deterministic tree fixture. Do not read ignored historical report files.
3. Emit the seed distribution in manifest, JSONL, quality decision, and summary.
4. Run with fixed eight-opponent panel, outer candidate concurrency <=2, and final games per cell >=5.

## B. Low-Score Cell Pool, Not Single Weakest Lock-In

1. Compute cell trainingScore for every opponent/side cell.
2. Select a low-score target pool: include the worst cell plus all cells within a documented score band of it, capped at a deterministic maximum (recommended 3 or 4 cells).
3. Route optimization diagnostics through this pool. Do not optimize only one weakest cell.
4. A branch may be attempted only where the target pool has actual runtime observations at the proposed fork round.
5. Report target-pool cells, weights/ordering, observed-trigger coverage, and whether each target was addressed, not addressable, or rejected by validation.
6. Adoption still requires independent aggregate trainingScore improvement and no loss increase. Improving one cell while regressing aggregate score is rejected.

## C. Constrained External Deck Search

1. Extend branch-local replacement candidates beyond existing deck IDs using a constrained external pool derived from `deck_ontology.ts`.
2. The pool must be deterministic and explainable. Restrict it by all of:
   - candidate architecture compatibility;
   - role/round placement compatibility;
   - cost budget <=18 after replacement;
   - team size 6..8;
   - tactical-required invariants;
   - no duplicate monster ID;
   - existing tree legality validation.
3. Do not enumerate the entire monster catalog blindly. Cap external candidates per slot (recommended <=8) and emit their source/rejection reason in diagnostics.
4. Search both in-deck and external replacements. Preserve experience keys/fingerprints so invalid external replacements are cached correctly.
5. Report separate counts: in-deck candidates, external candidates, rejected-by-constraint candidates, and accepted external replacements.

## D. Early Opening Optimization

1. Apply opening modifications only for target-pool cells whose weakness is demonstrated in R1 or R2. Later-round weaknesses stay on normal branch/deck search.
2. Reuse/adapt existing tree operators where possible to generate bounded R1/R2 actions:
   - earlier deployment into R1/R2 where legal;
   - order swap within R1/R2;
   - legal placement/zone change for R1/R2;
   - permitted R1/R2 branch placement modifications after a branch is created.
3. Opening moves must preserve tree legality and deck constraints.
4. Keep an explicit operator budget per iteration so opening candidates cannot drown out branch/deck candidates. Record operator type and count.
5. Final independent validation must evaluate the full candidate, not only the targeted early cell.

## Proof Run

Run one isolated diagnostic proof under:

```text
candidates: 8 exactly (2 per source seed)
panel: fixed 8 opponents
outer concurrency: <=2
final games per cell: >=5
output: reports/new-formation-generation/cross-seed-branch-deck-opening-proof/
```

## Acceptance

- [ ] Manifest proves exactly 2 candidates from each s1/s2/s3/s4.
- [ ] Low-score target pool has >1 cell whenever scores fall within the configured band, and never exceeds cap.
- [ ] Branch attempts use observed trigger evidence at fork round.
- [ ] External deck search is constrained, deterministic, capped, and separately reported.
- [ ] At least one test proves an eligible external monster can be considered; another proves a cost/role/duplicate/legality violation is excluded.
- [ ] Opening operators run only for R1/R2 weakness and are absent for later-only weakness.
- [ ] Aggregate trainingScore and loss guard decide adoption; single-cell-only gains do not bypass validation.
- [ ] Proof run has no worker errors and does not modify active library or apply candidates.
- [ ] Existing T008/T009 validity tests remain passing and new focused tests pass.
- [ ] `npx tsc --noEmit` adds no errors in changed files; document pre-existing errors only.

## Delivery

Write `TASKS/tree/T011.report.md` with candidate seed distribution, target-pool diagnostics, external/in-deck/opening operator counts, detailed terminal outcomes, proof metrics, tests, and explicit no-apply confirmation. Commit/push only `agent/tree`. Do not modify this task specification.
