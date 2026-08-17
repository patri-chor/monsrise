# Code Exploration Convention (CodeGraph)

This repository has a CodeGraph index (`.codegraph/`). Code exploration must use `mcp__codegraph__codegraph_explore` first; do not drift to scan-first grep/read exploration.

## Local Multi-Session Protocol

The workspace may have separate decision and implementation sessions. They exchange local specifications through `DECISIONS/` (see `DECISIONS/README.md`).

- A `DECISIONS/Txxx.md` file is an implementation specification; implement it and write `Txxx.report.md`.
- A decision session writes `DECISIONS/Txxx.md` with tradeoffs and measurable acceptance criteria.
- Every task file starts with `STATUS: OPEN | IN_PROGRESS | DONE | REJECTED`.
- Record ambiguous requirements as report questions. Do not guess.

## Cross-Harness Protocol: Dual-Domain Git Bus

The Git bus between DSH and Antigravity is defined by `TASKS/README.md`. First identify the immutable `DOMAIN`; never choose the globally newest OPEN task.

| DOMAIN | Task directory | Decision owner | Executor branch | Responsibility |
|---|---|---|---|---|
| `tree` | `TASKS/tree/` | tree decision agent | `agent/tree` | Existing-formation decision-tree optimization |
| `generation` | `TASKS/generation/` | generation decision agent | `agent/generation` | New-formation generation and candidate datasets |

- A decision agent creates, accepts, and closes only tasks in its own domain. It reviews matching-domain records in `TASKS/pending.json` and `TASKS/inbox/`.
- An executor must start with either `DOMAIN=tree` or `DOMAIN=generation`. It reads only `TASKS/<DOMAIN>/`, chooses the highest numbered `STATUS: OPEN` task there, and commits/pushes only `agent/<DOMAIN>`.
- An executor must not read, modify, report on, or close another domain's tasks, and may not push directly to `main`.
- If task path, `Domain` metadata, or current branch disagree, write a `PARTIAL` report explaining the routing error and stop. Do not guess or cross domains.
- Active formation data, bundle artifacts, shared matrix/state reports, and cross-domain changes require a separate integration task after both domain owners approve it.
- `scripts/watch-gemini.ps1` writes local `TASKS/pending.json` records containing `domain`, report blob, and snapshot path. A dirty main worktree only receives a remote snapshot; it is never automatically rebased.

## Hard Rules

1. For architecture or implementation questions, first call `mcp__codegraph__codegraph_explore`; it returns relevant source, call paths, dependencies, and blast radius.
2. Before changing code, inspect target symbols with CodeGraph and assess impact.
3. Treat source returned by `codegraph_explore` as already read; do not read/grep those same files again.
4. Fall back to `grep`, `glob`, or `read` only when CodeGraph has no result or the area is unindexed.
5. For a known file or exact symbol, direct `read`/`grep` is allowed; use CodeGraph first when locating or understanding architecture.

## Usage Notes

- Use specific CodeGraph queries with symbols, paths, or narrow questions.
- Keep each query focused to avoid exhausting context.
- If a query misses, refine it once before falling back to traditional tools.
