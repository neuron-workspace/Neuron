# DECISIONS.md — index

**The decision log is [`DECISIONS.md`](../DECISIONS.md) at the repository root:
35+ numbered, binding entries, each recording what was decided, who approved it,
and the consequence.** This file is an index into it, not a copy.

It lives at the root because commit messages cite decision numbers and a
delegated Codex agent must read them from a bare checkout. Duplicating entries
here would create two versions of a binding rule, and the stale one would win an
argument eventually.

## Architecture decisions, by subject

**Storage stays Markdown-first.** Plain `.md`/`.mdx` on disk is the source of
truth. No block-editor JSON model — evaluated and rejected, because a JSON block
model breaks both Markdown-first storage and MDX (`docs/design/notion-like-ui-roadmap.md`).
Reasoning recorded because the conclusion is *negative*: without it, the next
pass re-evaluates BlockNote and rediscovers the same answer.

**Views are sandboxed, capability-routed, never a filesystem proxy.**
→ D31 (plain `.html` replaces `.nhtml`/`.ndash`; one CSP, scripts allowed,
`connect-src 'self'` untouched), D30 (a database fragment route reusing
`workspace.files.read` rather than inventing a second capability over the same
access). The standing non-goal: **no raw filesystem function URLs** — routes are
semantic and versioned, never `/fs/readFile`.

**JSON Canvas round-trips unknown fields.** Unknown top-level and per-node keys
survive a save, so a future Neuron's data is not destroyed by this one. Same
rule now applies to `.db` v2 → D28.

**`neuron.style` is versioned, and a future version is read-only.** A file
declaring a newer style version renders but is not rewritten, rather than being
silently downgraded.

**`.db` v2 holds multiple tables, and migration is read-only until the user
edits.** → D28. A v1 file stays v1 on disk; rewriting every database on open is
indistinguishable from corruption in a workspace that syncs.

**Recovery is a journal, not an overlay.** → D19, D20. Pre-images in `userData`,
never in the workspace; never reachable from a view route.

**No new runtime dependency without its own numbered decision.** → D8.
Exercised: D32 accepts the Vercel AI SDK and states the cost; D33 declines SES
and `quickjs-emscripten` because the view sandbox already exists.

## Workflow decisions

D1 (documents at the root, because `.claude/` was ignored), D2 (one board),
D5 (only Claude commits, single author), D10 (`feature/* → dev → test → main`),
D13/D14/D21 (worktrees, and what they cost), D16 (route by effort, not model),
D22 (a test may not escape its process), D27 (**push hold active**),
D35 (a criterion may not require a forbidden file).

## Rules for adding one

Numbered, append-only, under **Accepted** or **Proposed** — nothing may be
implemented from Proposed. Every entry records the **consequence**: what it
forbids, or the specific trap it stops an implementer from walking into. A
decision without a consequence is a preference and will not survive contact with
a delegated agent.
