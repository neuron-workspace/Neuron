# SECURITY_RISKS.md

Open and mitigated risks. Risk IDs `R1`–`R8` come from
`docs/roadmap/production-readiness-plan.md` §5; anything newer is recorded here
first.

**Rule:** a risk moves to *Mitigated* only when a test would fail if the
mitigation were removed. "Fixed" without a failing-without-it check is a claim,
not a control.

---

## Mitigated

### R1 — Stored XSS in Markdown/MDX rendering
Note content reached `dangerouslySetInnerHTML`, so `<img onerror>` and event
handlers in a note executed **in the privileged renderer**.
**Mitigation:** `src/renderer/lib/sanitize-html.ts` — allowlist DOMParser walk to
React nodes; drops `script`/`style`/`iframe`, event handlers, and
`javascript:` / `data:` URLs; `href`/`src` through `safeUrl`.
**Check:** `tools/sanitize-html.test.mjs` (`npm run test:sanitize`).

### Navigation guard accepted off-origin URLs
`will-navigate` compared a **string prefix**, so `http://localhost:5174@evil.com`
(real host `evil.com`) and `http://localhost:51740` both passed. The frame it
guards is the **privileged app frame**, the one carrying the preload bridge.
**Mitigation:** `src/main/navigation.ts` — parsed-origin comparison at three
call sites (app frame + both view pins); `file://` matched by scheme since file
URLs have an opaque origin; unparseable URLs denied, never thrown on.
**Check:** `tools/navigation.test.mjs` + three E2E cases. Verified by reverting
the fix: the app frame genuinely navigated to `example.com`.

### Fragment interpolation leaked variables past its capability
`apiFragment` interpolated workspace variables with **no `variables.read`
check**, while the variables API and document interpolation both gated on it.
**Mitigation:** empty variable scope when the capability is absent — the
fragment still renders, values blank, params intact.
**Check:** `tools/htmx-views.test.mjs`.

### E2E suite reached outside the test process
Security specs drove the app at external URLs; a blocked navigation is handed to
the OS browser, so the suite opened real tabs in the developer's browser —
seven runs, all green. → D22.
**Mitigation:** `shell.openExternal` stubbed in the Playwright app fixture before
any test body runs, and asserted on, so a stub that stops working turns the test
red instead of silently resuming the side effect.

---

## Open

### R3 — Plugins run unsandboxed in the renderer · **High**
Built-in plugins are in-renderer trusted modules with the full `electronAPI`:
read, write, and delete any workspace file, plus the network proxy. No isolation
boundary exists for a third-party plugin.
**Planned:** D33 — third-party plugins become HTML apps in the existing view
sandbox rather than adopting SES or `quickjs-emscripten`. Task **T-030**,
blocked on T-028.
**Undocumented today:** the *current* trust model is not written down as a
decision. Task **T-021**.

### PTY inherits the full environment · **High, deliberate**
`terminal:spawn` (`main.ts:482`) starts a real shell with the workspace as cwd
and `env: process.env` passed wholesale — every variable, including any API
keys. This is the widest code-execution surface in the app and is intentional
for a user-invoked terminal.
**Undocumented:** no decision records the acceptance. Task **T-021**.

### R2 — View platform adversarial coverage · **Medium**
Tokens, path policy, CSP, Host/Origin checks and rate limits exist and are unit
tested. There is no adversarial suite: traversal via symlink and junction,
proto-pollution through parsed JSON/YAML, token forgery under race, zip bombs.
**Planned:** M6.

### Arbitrary workspace `.html` becomes a runnable view · **Medium, accepted**
Under D31 any `.html` in the workspace opens as a sandboxed view. A file arriving
by Git/Dropbox sync or in a downloaded template renders and can request
permissions.
**Why accepted:** it cannot exfiltrate (`connect-src 'self'`), cannot reach Node,
and gets nothing without an approved manifest.
**Consequence:** the approval prompt is the last line of defence, which makes
its **wording a security control**. It must name the file and state capabilities
in terms a user can refuse.

### R4 — Watcher / save races · **Medium**
Atomic temp+rename and `lastWritten` suppression exist. The pre-image journal now
makes overwrites and deletes recoverable, but there are no tests for interrupted
writes, disk-full, rename races, or deleted-open-file.

### R5 — Unsigned artifacts · **Medium**
No Authenticode, no Developer ID, no notarization. SmartScreen and Gatekeeper
warn. The Store path signs for you; the Releases-page installers do not.

### Supply chain · **Medium**
`js-yaml` carries a high-severity advisory (CVE-2026-59870, quadratic CPU)
reaching **production** deps transitively; `fixAvailable: true`. Task **T-013**.
Real-world exposure is low — a DoS on self-parsed frontmatter — but it is one
command. D32 will add five AI SDK dependencies; each new dependency widens this.

### R8 — Prototype pollution via parsed input · **Low**
`interpolate()` blocks `__proto__` / `constructor` / `prototype`. Canvas and
frontmatter parsing paths are not fuzzed.

---

## Reporting

Vulnerabilities go through GitHub **private vulnerability reporting**, never a
public issue. Both issue templates and `.github/SUPPORT.md` route there.
Policy: `.github/SECURITY.md`.
