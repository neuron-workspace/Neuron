# Context pack — JSON Canvas

## Purpose

An infinite spatial board stored as [JSON Canvas](https://jsoncanvas.org), the
open format Obsidian uses. Interoperability is the point: a `.canvas` written by
Neuron opens in Obsidian and vice versa, so the format is a contract, not an
internal detail.

## Key files

- `src/renderer/canvas/` — model, history (undo/redo), Markdown card rendering.
- `src/renderer/surfaces/CanvasSurface.tsx` — the editor surface.
- `tools/canvas-model.test.mjs` — the model's runnable check.
- `.claude/json-canvas-backlog.md` — the long-form backlog and handoff log for
  this subsystem. Read it before planning canvas work.

## Current status

Phase 1 complete: nodes, edges, multi-select, alignment, undo/redo, Markdown
cards, per-node styling via the `neuron.style` extension (v1).

Not built: the wider backlog in `json-canvas-backlog.md`.

## Decisions

- **Unknown fields round-trip.** Unknown top-level keys, unknown node types, and
  unknown per-node properties survive a save untouched. A future Neuron's data —
  or Obsidian's — must not be destroyed by this version. This is the canvas
  rule that D28 later copied for `.db` v2.
- **`neuron.style` is versioned, and a newer version is read-only.** A file
  declaring a style version this build does not understand renders as best it
  can and is **not rewritten**. Silently downgrading someone's file is worse
  than refusing to edit it.

## Security constraints

- Canvas Markdown renders through the same sanitiser as note Markdown
  (`lib/sanitize-html.ts`). A canvas card is untrusted content; it must never
  reach `dangerouslySetInnerHTML` directly.
- Node `file` references resolve inside the workspace only.
- Parsed canvas JSON is untrusted: no prototype-polluting keys, no assumption
  that declared types are known.

## Test commands

```bash
npm run test:canvas
npm run test:e2e         # surfaces.spec.ts asserts a canvas mounts as a board
```

## Known bugs

- E2E covers only that a canvas **opens**. No coverage of editing, undo/redo,
  multi-select, or alignment (T-012).
- Canvas JSON parsing is not fuzzed (risk R8).
- `examples/demo-repo/Idea board.canvas` picks up stray empty text nodes when
  the app is open — the app writing to its own demo workspace, which is why E2E
  runs against a temp copy.

## Next tasks

T-012 (editing coverage) · the backlog in `.claude/json-canvas-backlog.md`.
