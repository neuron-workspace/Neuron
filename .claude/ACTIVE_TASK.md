# ACTIVE_TASK.md — file locks

Who is holding which files **right now**. Check this before editing anything.
Overlapping file sets mean you wait, not race.

Two writing agents in one checkout can leave a half-written file that still
compiles and still passes review. That is the failure this file prevents.

---

## Currently held

| Task | Owner | Branch / worktree | Files held | Claimed |
| --- | --- | --- | --- | --- |
| T-028 | Codex `task-mt5chme8-5bcgr2` | `feature/T-028-plain-html-views` · `../neuron-worktrees/T-028` | `src/main/main.ts` (regex only), `src/main/htmx/**`, `surfaces/index.ts`, `HtmxViewSurface.tsx`, `components/Sidebar.tsx` (mini-app slices), `App.tsx` (view-creation slices), `CanvasSurface.tsx`, `examples/**`, docs, `skills/**`, `tools/htmx-views.test.mjs`, `e2e/**` | 2026-08-23 |

## Permanent serialization points

Never two writers, in any checkout, ever:

`src/renderer/App.tsx` · `src/main/main.ts` · `src/main/htmx/**` ·
`src/renderer/index.css` · `package.json`

---

## Claiming

Add a row **before** you edit, and commit the claim on its own so a concurrent
session sees it:

```
| T-0xx | Claude | feature/T-0xx-slug | path/a.ts, path/b.tsx | 2026-08-23 |
```

List the files you *expect* to touch. If the work grows beyond them, update the
row before touching the new file — a lock that lags the edit protects nothing.

## Releasing

Remove your row in the **same commit** that updates `.claude/HANDOFF.md`. A lock
released without a handoff loses why the work stopped; a handoff without the
release blocks the next session for no reason.

## Stale locks

A lock is stale when its branch has no recent commits and its Codex job is not
running (check with the worktree-walking status command in
`.claude/AGENT_PROTOCOL.md` §1 — jobs launched into a worktree are **invisible**
from the main checkout).

Do not silently delete a stale lock. Release it deliberately and say so in the
handoff, including what state you found the branch in. A lock that vanishes
without explanation is indistinguishable from work someone is still doing.
