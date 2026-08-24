STATUS: OPEN

# T023 - Three-Shell All-Four-Cost Core-Replacement Generation

> Domain: `generation` | Decision owner: generation decision agent | Executor branch: `agent/generation`
> This task resumes new-deck generation. It does not run tree optimization, deployment, or active-library mutation.

## Objective

Add **core replacement** as a first-class, high-weight deck mutation operator to discover new cross-core synergies while preserving ordinary mutations. Core replacement is deliberately limited to three general-purpose shell formations:

| Shell ID | Canonical source | Intended shell behavior |
|---|---|---|
| `prayer_shell` | `泉水剑` | prayer/formation/continuity shell |
| `half_rush_shell` | `坚果救星` | half-rush tempo shell |
| `full_rush_shell` | `经典救星` | full-rush pressure shell |

Specialized formations are **not** eligible for core replacement. In particular `梯子塞雷` remains a Selei-specialized formation and must not receive replacement-core attempts. The same rule applies to other source-specific/specialist builds such as `肃清`, `铲土多核`, `礼物救星`, `礼物丛林`, and `壕炸金猴`.

## Dynamic Four-Cost Core Set

At runtime, derive the candidate core set from the current frozen eleven-source dataset, not from a hard-coded card list:

1. inspect all source formations with `hasFourCost === true` or equivalent authoritative four-cost metadata;
2. collect unique four-cost monster IDs/names;
3. persist the resolved set with source provenance in the run manifest;
4. include each target core in replacement attempts for each of the three shells, including a no-op/self-core entry only for accounting, not as a retained novelty candidate.

The task must therefore attempt structured combinations such as `祷徒 + 救星` and `全冲 + 金猴` whenever those cores exist in the dynamically resolved set.

## Core-Replacement Operator

Implement a named, auditable operator, e.g. `core_replacement`, which receives `(shell, targetFourCostCore)` and performs a structured composition rather than arbitrary single-card swapping:

1. identify and remove/replace the shell's current four-cost core and explicitly recorded conflicting/support slots;
2. inject the target four-cost core;
3. preserve the chosen shell's defining early-game and tempo structure where legal;
4. choose legal compensating cards, badges, timing, and tree repairs using deterministic core-package rules or bounded search;
5. remove, replace, or repair tree placements that reference absent cards;
6. validate exactly eight team slots, legal total cost, valid badges, deployability, and tree/deck closure;
7. attach complete provenance: shell ID/source, removed core, target core, companion additions/removals, badge changes, tree repairs, and deterministic generation seed.

A candidate is not valid merely because it contains the target core. It must remain an executable, closed formation with a coherent generated tree.

## Ordinary Mutations Remain Active

Keep existing ordinary deck/tree mutations active for all eligible generation sources, including specialized formations. Core replacement is an additional operator only, not a replacement for:

- ordinary deck substitutions/module changes;
- badge variation;
- placement/timing/tree changes;
- existing structural legality and deduplication rules.

Use an explicit documented operator-weight table. `core_replacement` must receive a material exploration share of **at least 30% and at most 45%** for the three general shell sources. For specialist sources its weight must be exactly 0%. The remaining weight remains distributed among ordinary operators.

## Generation and Screening

- Keep sources transactionally isolated: finish one source/operator batch's generation, validation, fixed-panel coarse screening, and retention snapshot before advancing.
- Fixed screening panel: bundle first seven plus unique `壕炸金猴`, both sides.
- Production screening requests up to 16 workers, capped by host logical CPUs; persist requested/effective/peak resource data.
- Retain candidates by `(shell, targetCore)` combination independently before any optional cross-combination summary. Do not let one core combination displace another merely because it has more raw candidates.
- Preserve minimum score/exploration policies already used by generation; never retain zero-score candidates.

## Outputs

Write only under `reports/new-formation-generation/three-shell-core-replacement/`:

- `core_catalog.json`
- `shell_manifest.json`
- per-shell/per-core attempt and validity records
- `generated_candidates.jsonl`
- `retention_by_shell_core.json`
- `frozen_candidates.jsonl`
- `summary.md`

Every frozen record must include `shellId`, `targetCore`, `operator: 'core_replacement' | <ordinary operator>`, and complete mutation provenance.

## Tests

Add focused tests proving:

- runtime core catalog contains exactly the unique four-cost cores from frozen source metadata;
- `泉水剑 + 救星` and `经典救星 + 金猴` core-replacement attempts are constructed when those cores are in catalog;
- only the three named shells are eligible for `core_replacement`;
- `梯子塞雷` and every specialist source have core-replacement weight zero and never receive a core-replacement attempt;
- ordinary mutation operators remain reachable for all eligible sources;
- invalid cost/team/tree combinations are rejected with explicit reasons;
- core-replacement candidate provenance is complete;
- fixed eight-panel/both-side screening is used, worker cap is observed, and output isolation holds;
- no source dataset, `FORMATION_LIBRARY`, active bundle, deployment/apply code, or prior report is modified.

Use mock/synthetic evaluation for unit tests. Run one bounded production generation-and-screening cycle only; do not invoke tree optimization in T023.

## Delivery

Write `TASKS/generation/T023.report.md` with resolved core catalog, shell/core coverage matrix, operator weights, attempts/valid/rejected/retained counts per combination, examples of discovered cross-core candidates, worker evidence, tests, output paths, and explicit confirmation that specialized sources never received core replacement. Commit and push only from `agent/generation`; do not modify this task specification.
