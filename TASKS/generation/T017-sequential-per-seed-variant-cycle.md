STATUS: OPEN

# T017 - Sequential Per-Seed Variant Cycle

> Domain: `generation` | Decision owner: generation decision agent | Executor branch: `agent/generation`
> This corrects T013's batch execution order. T013 artifacts remain historical baseline only and must not be used as the formal input to later tree optimization.

## Objective

Process bundle-order first four seeds **strictly one at a time**. A source seed must complete bounded mutation, fixed-eight-panel coarse evaluation, per-seed retention, and per-seed freeze before generation begins for the next source seed.

The output is the authoritative sequential frozen candidate pool for later tree optimization. Do not run tree optimization in this task.

## Canonical Inputs

- Seeds: `FORMATION_LIBRARY.slice(0, 4)` in current order.
- Opponent panel: `FORMATION_LIBRARY.slice(0, 7)` plus the unique formation named `壕炸金猴`; require exactly eight unique formations.
- Preserve the user-selected policy: at most six retained variants **per seed**, 25% exploration floor, and never retain a zero-score candidate.
- Production evaluation requests 16 workers and clamps to available logical CPUs. Persist requested/effective worker counts.

## Mandatory Execution Order

For `sourceSeedIndex` 0, then 1, then 2, then 3, execute this entire transaction before starting the next index:

1. Generate up to 20 bounded mutation attempts for that source only, using existing mutation operators and documented deterministic seed derivation.
2. Deduplicate against prior finalized seeds and within the current seed by canonical team key and tree fingerprint. Earlier finalized source index owns cross-seed duplicates.
3. Evaluate only this source's newly valid candidates against the fixed eight-opponent panel, both sides, one game per pairing, with deterministic seed bases and effective worker count.
4. Apply retention only to this source's evaluated candidates, with `maxRetained: 6` and exploration floor `0.25`.
5. Persist that source's completed transaction before the next seed begins:
   - source manifest and attempt/rejection counts;
   - evaluated candidates;
   - retained/rejected records and explicit reasons;
   - frozen candidate snapshot for this source;
   - source start/end timestamps and a `status: COMPLETED` marker.
6. Only after the previous source manifest is durable and `COMPLETED` may processing begin for the next source.

Do not collect all four seeds' candidates before evaluation. Do not run a global batch evaluation or global retention pass.

## Output Isolation

Write only under `reports/new-formation-generation/sequential-per-seed-cycle/`:

- `run_manifest.json`
- `seed-00-<id>/manifest.json`, `generated_candidates.jsonl`, `retention.json`, `frozen_candidates.jsonl`, `summary.md`
- corresponding directories for seed indexes 01, 02, and 03
- `frozen_candidates.jsonl` at the cycle root, formed by concatenating only already-frozen source snapshots in seed order
- `summary.md`

Do not overwrite `reports/new-formation-generation/per-seed-expansion/`, `first-four-cycle/`, `reports/new-formation-pilot/`, or shared reports.

## Tests

Add focused tests that instrument the runner and prove:

- event order is strictly `seed0 generate -> seed0 evaluate -> seed0 retain/freeze -> seed1 generate`, continuing through seed3;
- seed1 generation cannot begin if seed0 retention/freeze fails;
- each source gets at most 20 attempts and independently retains at most six;
- each source evaluation sees only candidates from that source;
- all eight opponents and both sides are used for each source evaluation;
- 25% and zero-score exclusion apply independently per seed;
- cross-seed duplicate ownership goes to the earliest finalized source;
- production output directories and prior T013 artifacts remain byte-identical during tests;
- production default requests 16 workers and clamps to CPU capacity;
- `FORMATION_LIBRARY` is unchanged.

Run the focused tests and one production sequential cycle with the fixed resources. Do not invoke tree optimizer, deployment, apply, or bundle build.

## Acceptance

- [ ] Four source transaction manifests prove sequential completion in bundle order.
- [ ] Every seed completes generation, evaluation, and retention before the next starts.
- [ ] Each source retains at most six; root frozen pool has at most 24 candidates and source provenance on every line.
- [ ] Eight-opponent/both-side evaluation, 25% floor, and 16-worker requested configuration are recorded per seed.
- [ ] Tests prove no global pre-evaluation batching or global retention capacity competition remains.
- [ ] Outputs are isolated and no active formation or historical artifacts are changed.

## Delivery

Write `TASKS/generation/T017.report.md` with exact per-seed execution timestamps/order, attempts/evaluated/retained/shortfall counts, worker evidence, fixed panel, test results, output paths, frozen total, and confirmation that no tree optimization or active-library mutation occurred. Commit and push only from `agent/generation`; do not modify this task file.
