# Context pack — commands and keybindings

## Purpose

How a user triggers anything: the command palette, keyboard shortcuts, and
menus. Today these are three independent wirings, which is the architectural
debt this subsystem exists to pay off.

## Key files

- `src/renderer/lib/keybindings.ts` — action list, chord normalisation,
  `resolveBindings`. **The only source of truth for default shortcuts.**
- `src/renderer/App.tsx` — a single global `window.keydown` dispatcher.
- `src/renderer/components/CommandPalette.tsx` — props-drilled action list plus
  plugin commands.
- `src/renderer/views/SettingsPage.tsx` — the rebinding UI.

## Current status

Working: eight configurable defaults, capture-to-rebind, reset to defaults,
persistence in settings, plugin-contributed commands.

Missing, and this is the debt: **no central command registry.** The palette, the
dispatcher, and the menus each wire actions separately, so there is no single
list of what Neuron can do. That blocks shortcut hints in the palette, layout
commands, and any future CLI. The dispatcher is one global `keydown` with **no
focus scopes** — the exact anti-pattern the layout work must not extend.

Also missing: conflict detection, multiple bindings per command, a versioned
hotkey schema.

Defaults today: `Mod+K` palette · `Mod+N` new note · `Mod+G` new view ·
`Mod+Shift+O` website tab · `Mod+B` sidebar · `Mod+J` side panel ·
``Mod+` `` bottom panel · `Alt+Z` zen.

## Decisions

**D26** settles the two contested points:

- Scopes, innermost wins: `input → editor → canvas → htmx-webview → modal →
  global`.
- **`Mod+L` = focus search.** This overturns the roadmap, which proposed it for
  layout actions because the chord was *free*. Free is not available: every
  browser trains `Ctrl+L` for the address bar, so spending it on a layout
  palette costs a reflex to buy a keystroke nobody would guess.
- **`Mod+\` = split / layout actions** — what VS Code and Obsidian both use.
  Note it is the **backslash**; ``Mod+` `` (backtick) is already the bottom
  panel. A conflict detector that normalises them together would be wrong.

## Security constraints

Low surface, but: a binding must not fire while an input or the HTMX webview has
focus unless its scope says so, and the dispatcher must respect
`defaultPrevented` and IME composition. A shortcut that fires during
composition corrupts text in CJK input.

## Test commands

```bash
npm run typecheck
npm test                 # no dedicated suite yet — the registry brings one
```

## Known bugs

- No conflict detection: two actions can hold the same chord and both fire.
- No scopes, so editor and global bindings can collide.
- Palette shows no shortcut hints.
- Rebinding is not covered by any test (T-012).

## Next tasks

**T-005** central registry `{ id, title, scope, when(), run(), defaultKeys[] }`
— unblocked by D26 and ready to delegate · **T-006** focus-scoped dispatcher +
versioned schema + migration · **T-007** palette and settings consume the
registry.

All three touch `App.tsx` and must run **strictly one at a time**.
