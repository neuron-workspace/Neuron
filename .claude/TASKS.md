# TASKS.md — pointer

**The task board is [`SHARED_TASKS.md`](../SHARED_TASKS.md) at the repository
root. This file is not a second board.**

`DECISIONS.md` D2 exists because two boards is the specific way a board stops
being trustworthy: one of them goes stale, an agent reads the stale one, and
work gets redone. There is one board. It lives at the root because a delegated
Codex agent must be able to read it from a bare checkout.

## What is on it

`SHARED_TASKS.md` is grouped **by dependency, not priority**, into waves. Each
row carries: ID, task, owner (Claude *or* Codex, never both), status, branch,
touch scope, and acceptance evidence.

Statuses: `BACKLOG` · `NEEDS_USER` · `READY` · `IN_PROGRESS` · `BLOCKED` ·
`REVIEW` · `DONE`. A row is `DONE` only when its acceptance criteria have been
re-run and passed in this environment — not when an agent reports success.

## How to pick work

1. Earliest wave with a `READY` row.
2. `NEEDS_USER` means a human decision is missing. Ask; do not guess.
3. Check `.claude/ACTIVE_TASK.md` for locks on the files you would touch.
4. Claim the row **and** the lock before editing, and commit the claim.

## Milestone backlog

Longer-range grouping lives in `docs/roadmap/production-readiness-plan.md`
(M0–M9). Treat it as **rationale, not status** — it is known to be stale, and
reconciling it is itself a task (T-004), deliberately scheduled last so it is
not reconciled against a moving tree.

Deferred UI and graph work: `docs/roadmap/deferred-work.md`. Canvas backlog:
[`json-canvas-backlog.md`](json-canvas-backlog.md) in this directory.
