# Context pack — sandboxed HTML view platform

## Purpose

Lets a user put an HTML file in their workspace and have it run as a real
application against their own notes — without granting it their machine. This is
Neuron's strongest differentiator: capability-scoped, per-view sandboxing rather
than the all-or-nothing plugin trust most note apps use.

## Key files

- `src/main/htmx/index.ts` — view lifecycle: open, manifest load, approval,
  session creation. **Revokes any existing session for the same path on open** —
  the detail behind a first-open race fixed in T-024.
- `src/main/htmx/server.ts` — loopback HTTP server, route dispatch, `/api/v1/*`,
  CSP, fragments. Also the largest file and the one T-008 says must be split.
- `src/main/htmx/sessions.ts` — per-view sessions, one-time boot token, cookie
  token, TTL, rate limits.
- `src/main/htmx/pathPolicy.ts` — workspace-relative resolution and glob policy.
- `src/main/htmx/manifest.ts` — manifest validation, capability grants.
- `src/main/htmx/appPaths.ts` — electron-free: which paths are views, where a
  manifest lives. Deliberately separate so it is unit-testable.
- `src/main/htmx/theme.ts` — the served `neuron.css` component kit.
- `src/renderer/surfaces/HtmxViewSurface.tsx` — the webview host, permission
  prompt, reload-on-save.

## Current status

Working: loopback server on an ephemeral port, per-view session tokens, path
policy, manifest validation, capability grants, approval prompts, rate limits,
DNS-rebinding host check, a served CSS kit.

**In flux — T-028:** `.nhtml` and `.ndash` are being removed in favour of plain
`.html` (D31). One CSP, scripts allowed. Until it merges the old extensions are
still in the tree.

Missing: no route renders `.db` rows (D30, optional now that all views can run
scripts). No adversarial test suite. `server.ts` fuses transport, auth, routing,
services and presentation into one module.

## Decisions

D31 (plain `.html`, one CSP), D30 (database fragment route reusing
`workspace.files.read`), D15 and `docs/architecture/neuron-protocol-api.md`
(the `neuron://` transport evaluation — decision: hybrid, with "keep loopback"
as the fail-closed outcome).

## Security constraints — do not break these

- **`connect-src 'self'` never widens.** It is what leaves a view no route to
  the network. Everything else is defence in depth; this is the wall.
- Webview stays sandboxed: no Node, no preload, no `ipcRenderer`, own partition.
  `will-attach-webview` in `main.ts` forces this and renderer options cannot
  weaken it.
- No manifest ⇒ no capabilities. Default deny, always.
- No generic filesystem proxy. Routes are semantic and versioned — never
  `/fs/readFile`.
- Every response escapes user content. Never return stack traces, absolute
  paths, tokens, or raw exception text.
- The write journal is **not** reachable from any route (D20). It holds
  pre-images from across the whole workspace; exposing it would hand a view
  content outside its path policy.
- The approval prompt is a security control, not UI copy — an `.html` can arrive
  by sync from someone else.

## Test commands

```bash
npm run test:htmx        # the unit suite
npm run test:e2e         # surfaces + security specs drive real views
```

## Known bugs

- `server.ts` has no separation between transport and routing; T-008 requires
  extracting a dispatcher **before** any transport change.
- No adversarial coverage: symlink/junction escape, proto-pollution, token
  forgery under race, zip bombs (risk R2).
- Error documents were unstyled and unreadable on a dark shell — fixed in T-024;
  they are served before a session exists so they cannot use the themed kit.

## Next tasks

**T-028** (in flight) · T-023 (demo dashboards on the new format) ·
T-025 (database fragment route, optional) · T-030 (plugins as HTML apps) ·
M6 (adversarial suite).
