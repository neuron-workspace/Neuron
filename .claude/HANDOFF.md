# HANDOFF.md — session log

Newest first. **Append, never rewrite.**

The per-task delegation log — Codex job ids, session ids, what was corrected vs.
kept, measured verification — is [`HANDOFF.md`](../HANDOFF.md) at the repository
root. That file is the audit trail for *delegated work*; this one is the
*session* summary a fresh agent reads to know where things stand.

---

## 2026-08-23 — dual-agent context system

**Branch:** `dev` @ `39f0469` · working tree clean apart from
`examples/demo-repo/Idea board.canvas`, which is the user's running app writing
to it and is deliberately never committed.

**Done this session (merged to `dev`, nothing pushed — D27 hold active):**

- Workflow bootstrapped: `AGENTS.md`, `SHARED_TASKS.md`, `DECISIONS.md` (35+),
  root `HANDOFF.md`. Pre-existing WIP landed as 10 topic commits.
- CI now gates on typecheck + tests + build + E2E, proven to bite by injection.
- Governance files, feature guide, support policy.
- `neuron://` transport decision record (hybrid, with "keep loopback" as the
  fail-closed outcome).
- Two security fixes: parsed-origin navigation guard, fragment capability gate.
- Playwright harness, 19 tests.
- Pre-image write journal + Version history panel.
- Apache 2.0 relicence, version 0.4.2, GitHub releases/tags/Actions cleared.
- Three usage bugs fixed: dead view session on first open, invisible error
  pages, MDX imports rendered as prose. Plus an E2E teardown stall previously
  misdiagnosed as a flaky test.

**Commands run:** `npm run typecheck` ✅ · `npm test` ✅ 7/7 ·
`npm run build` ✅ · `npm run test:e2e` ✅ 19/19 (~48s) ·
`npm audit --omit=dev` ⚠️ 1 high (`js-yaml`).

**Not run:** packaging (`npm run dist:*`), any push, any tag. The push hold
(D27) is active and deliberate — the remote is a clean slate ahead of a
Microsoft Store submission.

**In flight:** T-022 (`.db` v2) and T-028 (plain `.html` views), both Codex,
both in worktrees, both holding locks in `.claude/ACTIVE_TASK.md`.

**Blockers / needs the user:** T-020 appx Partner Center placeholders ·
T-021 write down the PTY and plugin trust model · T-005 command-registry scopes
(now unblocked by D26 and ready to delegate) · T-027 whether Live view should
dim or hide MDX ESM lines.

**Next recommended action:** review and merge T-022, then T-028. T-028 unblocks
three wave-B rows (T-023, T-029, T-030). Do **not** start anything touching
`src/main/main.ts` or `src/main/htmx/**` until T-028 lands — it holds both.

**Note for the next session:** four delegated packets today were rejected by
Codex for the same reason — an acceptance criterion requiring a file the packet
forbade (D35). Before sending a packet, walk each criterion back to the files it
forces and confirm every one is authorized. Every rejection was correct.
