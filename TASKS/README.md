# TASKS — Dual-Domain Decision Bus

This repository uses two independent decision/execution lanes. A task path, domain, executor prompt, and Git branch must agree. Do not select work by the largest task number across the whole repository.

## Domains

| Domain | Task directory | Decision owner | Execution branch | Purpose |
|---|---|---|---|---|
| `tree` | `TASKS/tree/` | Tree decision agent | `agent/tree` | Optimize decision trees for existing formations |
| `generation` | `TASKS/generation/` | Generation decision agent | `agent/generation` | Generate and evaluate new formation candidates |

Shared integration into `main`, `FORMATION_LIBRARY`, bundle artifacts, matrix reports, or cycle state requires a separate integration task after both domain owners approve it.

## File Protocol

Within one domain directory:

| File | Writer | Purpose |
|---|---|---|
| `Txxx-*.md` | That domain's decision agent | Task specification |
| `Txxx.report.md` | That domain's Antigravity executor | Implementation report |
| `Txxx.closed.md` | That domain's decision agent | Acceptance decision |

Every task/report/closed file starts with `STATUS: OPEN | IN_PROGRESS | DONE | REJECTED`.

A bus task identity is always `domain/Txxx`, never `Txxx` alone. Numeric IDs may repeat across domains; queue consumers must match both `domain` and the domain-qualified report path. Legacy root-level `TASKS/Txxx.*` files are historical only and must not enter `pending.json`.

## Domain Routing Rules

1. An executor receives one immutable `DOMAIN`: either `tree` or `generation`.
2. It reads only `TASKS/<DOMAIN>/` and selects the highest-numbered file with `STATUS: OPEN` in that directory.
3. It must use only its assigned branch: `agent/tree` or `agent/generation`.
4. It never reads, edits, reports on, or closes a task in the other domain.
5. It may not push directly to `main`; it pushes its own branch. Its decision owner reviews and integrates changes.
6. A specification must state allowed files, prohibited files, outputs, worker limit, and acceptance checks.
7. If a task conflicts with the executor's domain or branch, it must stop and report the routing error rather than implementing it.

## Mandatory Antigravity Prompts

### Tree Executor Prompt

```text
You are the TREE execution agent. DOMAIN=tree. Before every task: git fetch origin; switch to agent/tree; pull/rebase origin/agent/tree. Read only TASKS/tree/. Select the highest-numbered STATUS: OPEN task there. Never read or act on TASKS/generation/. Never modify active formation data, bundle artifacts, shared matrix/state reports, or main unless the tree task explicitly permits it. Implement only the specified files, write TASKS/tree/Txxx.report.md, commit all implementation and report changes to agent/tree, and push agent/tree. Do not modify the task specification. If routing, scope, or branch is wrong, write a PARTIAL report and stop.
```

### Generation Executor Prompt

```text
You are the GENERATION execution agent. DOMAIN=generation. Before every task: git fetch origin; switch to agent/generation; pull/rebase origin/agent/generation. Read only TASKS/generation/. Select the highest-numbered STATUS: OPEN task there. Never read or act on TASKS/tree/. Never modify active formation data, bundle artifacts, shared matrix/state reports, or main unless the generation task explicitly permits it. Implement only the specified files, write TASKS/generation/Txxx.report.md, commit all implementation and report changes to agent/generation, and push agent/generation. Do not modify the task specification. If routing, scope, or branch is wrong, write a PARTIAL report and stop.
```

## Watcher

`scripts/watch-gemini.ps1` fetches remote reports, queues remote snapshots in `TASKS/inbox/`, and writes `TASKS/pending.json`. Pending entries include their domain. It never rebases a dirty main worktree. A closed task is not queued again.

## Decision Agent Rules

- Tree decision agent owns only `TASKS/tree/` tasks and their acceptance.
- Generation decision agent owns only `TASKS/generation/` tasks and their acceptance.
- Each owner evaluates its own executor's branch before creating a domain-local `closed` file.
- Cross-domain changes require a new integration task owned jointly or explicitly transferred.
