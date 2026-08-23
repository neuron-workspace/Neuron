# Context packs

A pack is what an agent reads **instead of** exploring a subsystem. One page per
subsystem, enough to make a bounded change without opening twenty files.

If you find yourself reading source to answer "how does X work?", the pack for X
is missing or stale. Fix it in the same commit as your change.

## Packs

| Pack | Subsystem |
| --- | --- |
| `htmx-platform.md` | Sandboxed HTML views, loopback server, capabilities |
| `canvas-system.md` | JSON Canvas model, history, `neuron.style` |
| `frontmatter-properties.md` | YAML frontmatter parse/serialise, properties UI |
| `markdown-mdx-security.md` | Markdown/MDX rendering and its sanitiser |
| `command-keybindings.md` | Palette, keybindings, the planned registry |
| `release-ci.md` | Build, packaging, CI, releases, signing |

## Required sections

Every pack has these, in this order. Empty is fine; missing is not — a pack with
no "Known bugs" reads as "there are none".

1. **Purpose** — one paragraph. What this subsystem is for.
2. **Key files** — paths with a clause each. Not a directory listing.
3. **Current status** — what works, what is partial, what does not exist.
4. **Decisions** — links to numbered entries in `DECISIONS.md`. Do not restate
   them; a copy drifts and then contradicts the original.
5. **Security constraints** — the invariants a change must not break. Write
   these as prohibitions, not aspirations.
6. **Test commands** — exactly what to run to prove this subsystem still works.
7. **Known bugs** — including ones nobody has scheduled.
8. **Next tasks** — task ids from `SHARED_TASKS.md`.

## Rules

**Keep it under a page.** A pack that grows into a manual gets skimmed, and a
skimmed pack is worse than none because it looks read.

**Never duplicate a decision or a task row.** Link to `DECISIONS.md` and
`SHARED_TASKS.md`. Two copies of a binding rule means one of them is wrong and
you will not know which.

**Date nothing; git does that.** `git log --oneline -- .claude/context-packs/X.md`
tells you when it last changed. A hand-written date is a claim that rots.

**Update the pack in the same commit as the change.** A pack updated later is a
pack that was wrong in between, and the next agent read it during that window.

**Say what is not true.** "There is no adversarial test suite" is worth more
than a list of what exists.
