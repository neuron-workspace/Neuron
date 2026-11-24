# Security review: Neuron desktop

**Reviewed:** `dev` at `3a5917b` (PR #94, "Security hardening, Electron 45 upgrade, and reliability improvements"), plus the Electron Fuses change on `fix/electron-fuses`.
**Version:** 0.5.0
**Runtime:** Electron 45.4.1, Chromium 156, Node.js 24
**Platforms:** Windows x64, macOS (x64 and arm64), Linux x64

This review was first written by an outside audit. Its claims were then checked against the code. Claims that could not be checked were removed.

Related documents:

- [Threat model](THREAT_MODEL.md)
- [Electron security checklist](ELECTRON_SECURITY_CHECKLIST.md)
- [IPC security matrix](IPC_SECURITY_MATRIX.md): all 48 renderer-to-main channels
- [Security tests](SECURITY_TEST_PLAN.md)
- [Remediation roadmap](SECURITY_REMEDIATION_ROADMAP.md)

To report a vulnerability, see the [security policy](../../.github/SECURITY.md).

## Summary

No open critical or high-severity issue was found in the areas reviewed. That is not the same as "no risk". The risks below are known and documented, and each one was accepted or deferred on purpose:

1. **Path-based rename, unlink and trash.** `src/main/safe-fs.ts` reads and writes bytes only through file handles whose identity (device and inode) is checked after opening. Rename, unlink and `shell.trashItem` still take paths, though. If a parent folder or the target is swapped for a link in the instant between the last check and the call, the call follows the link. After a rename the destination is verified and a failure is raised. Unlink and trash cannot be verified afterwards. The owner accepted this window rather than add a native module (decision D43.2 in the project's decision log). See the header of `safe-fs.ts`.
2. **Empty conflict copy after a crash.** `writeUnattended` in `src/main/journal.ts` reserves a conflict-copy name by creating an empty file before writing to it. A crash between the two leaves an empty `<name> (conflict …)` file in the workspace. Nothing calls `writeUnattended` yet: it exists for sync, which is not built.
3. **No WebGL on the macOS CI runner.** The runner is a VM with no GPU. Tests that need WebGL (the knowledge graph) skip there, so only Windows and Linux CI exercise them.
4. **Deprecated `safeStorage` calls.** Secret storage uses the synchronous `safeStorage.isEncryptionAvailable`, `encryptString` and `decryptString`. Electron 45 deprecates the synchronous API; the packaged app prints a deprecation warning for `isEncryptionAvailable` at startup. They have to move to the async API before the Electron 46 upgrade.
5. **Two Electron fuses stay at their defaults.** `runAsNode` stays on because node-pty's Windows terminal kill calls `child_process.fork()`. `grantFileProtocolExtraPrivileges` stays on because the renderer loads from `app.asar` through `file://`. See [Electron Fuses](#electron-fuses).
6. **Plugins are not sandboxed.** Plugins run in the renderer with the same bridge as the app. Secrets are write-only from the renderer, but a plugin can still call any bridge method the app can.

## Trust boundaries

```
Untrusted input: notes and MDX, cloned repositories, canvases, HTML views, web pages in the in-app browser
        |
        v
Renderer (sandbox: true, contextIsolation: true, nodeIntegration: false; CSP script-src 'self')
        |   preload: contextBridge exposes window.electronAPI, one function per channel
        v
Main process: entryOf(event) on every channel; file, network and secret access live here
        |
        v
OS: workspace files, app data (settings.json, write journal), OS key store (DPAPI / Keychain / libsecret or kwallet)
```

## Verified controls

### SEC-01: Handle-based file access (`src/main/safe-fs.ts`)
`openSafe` takes a snapshot of every path segment from the workspace root down, pinned by BigInt `dev`/`ino`. It then opens the file, with `O_NOFOLLOW` on macOS and Linux, and compares the handle's identity with the snapshot. On a mismatch the handle is closed and `EUNSAFEPATH` is thrown before any byte is read or written. Windows has no `O_NOFOLLOW`, so there the post-open identity check does the refusing. The path-based remainder is residual risk 1. Tests: `tools/safe-fs.test.mjs`.

### SEC-02: IPC sender check (`entryOf` in `src/main/main.ts`)
`entryOf(event)` accepts a sender only if it is the top-level frame of one of Neuron's own windows: `event.sender` must be that window's `webContents`, and `event.senderFrame` must be its main frame. Subframes, `<webview>` guests and HTML views get `null`. Each of the 48 channels checks it, directly or through `windowOf`, `repoOf` or `resolveInRepo`. Tests: `tools/main-guards.test.mjs`.

### SEC-03: Plugin network requests (`src/main/public-network.ts`)
`plugin:net-request` accepts only `http:` and `https:` URLs without credentials. Every hop's DNS answers are checked, and any loopback, private, link-local (169.254/16, which includes cloud metadata), CGNAT, multicast, IPv6 ULA or link-local, or IPv4-in-IPv6 address refuses the request. The connection is pinned to the vetted address, so a second lookup cannot rebind it. Request and response bodies are capped at 10 MB. The socket times out after 30 s idle, and the whole request after 60 s across at most 5 redirects. Cross-origin redirects drop the `authorization`, `cookie` and `host` headers. Tests: `tools/public-network.test.mjs`.

### SEC-04: Secret storage (`src/main/secret-storage.ts`, `main.ts`)
API keys are encrypted with Electron `safeStorage`. On Linux, Neuron refuses to store a key when the backend is `basic_text`, meaning no keyring is available. The renderer can set a secret and ask whether one exists (`settings:set-secret`, `settings:has-secret`), but it can never read one back:

- `settings:get` never returns the `__secrets` key and redacts API keys from what it does return.
- `settings:set` refuses any value that carries an `apiKey`.
- `ai:complete` reads the key, the endpoint and the model defaults in main and ignores any the renderer sends.

Provider errors have the key replaced with `[key]` before they are returned. Tests: `tools/secret-storage.test.mjs`, `tools/settings-schema.test.mjs`.

### SEC-05: HTML views (`src/main/htmx/`)
- **Server.** Views are served from a server bound to `127.0.0.1` on a random port.
- **Origin checks.** Requests whose `Host` does not match the server's origin, or that carry a foreign `Origin`, get 403.
- **Session.** The document URL carries a one-time boot token (32 random bytes). The first document request consumes it and sets an `HttpOnly; SameSite=Strict` session cookie. Each view runs in its own in-memory partition.
- **Trust.** A SHA-256 content hash (`computeTrust`, `trust.ts`) covers the view, its manifest and the files it serves. A view must be approved for that exact hash. If the hash changes, the view asks again and any running session is revoked.
- **Capabilities.** File access needs capabilities declared in the manifest (`workspace.files.read`, `.write`, `.create`, `.delete`). It is limited to the manifest's path globs (`pathPolicy.ts`).

Tests: `tools/htmx-views.test.mjs`.

### SEC-06: Saves that do not block the main thread (`src/main/save-file.ts`)
A save that hits a transient lock (an indexer or antivirus scanner) is retried after an awaited timer. The old code used `Atomics.wait`, which froze the main process, and with it every window. Saves to one file run one at a time, in call order, through `createSaveQueue`. A save based on a version that has since changed outside Neuron is refused as a conflict, and the renderer shows the external-change bar. Tests: `tools/save-file.test.mjs`, `tools/external-change.test.mjs`.

### SEC-07: Markdown and MDX rendering (`src/renderer/components/MDXPreview.tsx`)
`javascript:`, `vbscript:` and `data:text/html` links are neutralised. Raw HTML such as `<script>`, event-handler attributes and `<iframe>` is not rendered. Component props are checked against fixed token sets. Tests: `tools/mdx-security.test.mjs`, `tools/sanitize-html.test.mjs`.

### SEC-08: Run buttons and the terminal (`src/renderer/lib/terminal-bus.ts`)
`isRunnableCommand()` refuses commands that contain newlines, C0/C1 control characters, zero-width characters (U+200B–U+200D, U+2060, U+FEFF) or bidi overrides and isolates (U+202A–U+202E, U+2066–U+2069). A command runs only when the user clicks, and it is typed into the visible terminal. Each window can drive only the terminals it started (`ownsPty`). Tests: `tools/terminal-bus.test.mjs`.

### SEC-09: Workspace files over `neuron-file://` (`src/main/file-protocol.ts`)
- Media and images are served only to the window whose random per-window token is in the URL, compared with `timingSafeEqual`.
- The scheme is registered with `supportFetchAPI: false` and `corsEnabled: false`.
- Responses carry `X-Content-Type-Options: nosniff` and `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'`, so an SVG cannot run script.

Tests: `tools/file-kinds.test.mjs`.

### Electron Fuses
Configured in `package.json` `build.electronFuses`. electron-builder flips them before signing, and `tools/fuses.test.mjs` pins them.

| Fuse | State |
| --- | --- |
| `EnableNodeOptionsEnvironmentVariable` | Disabled |
| `EnableNodeCliInspectArguments` | Disabled |
| `OnlyLoadAppFromAsar` | Enabled |
| `EnableEmbeddedAsarIntegrityValidation` | Enabled. Validated on Windows and macOS; Electron has no ASAR integrity support on Linux. |
| `EnableCookieEncryption` | Enabled |
| `RunAsNode` | Left enabled (default). node-pty's Windows `kill()` forks a helper. With the fuse off, `fork()` throws on every terminal close. |
| `GrantFileProtocolExtraPrivileges` | Left enabled (default). With it off, `file://` cannot read inside `app.asar` and the window fails with `ERR_FILE_NOT_FOUND`. |

Checked on a packaged Windows build:

- `@electron/fuses read` shows the states above.
- `NODE_OPTIONS=--require <file>` and `--inspect=0` are ignored: the app starts normally and neither runs.
- With one byte of the `app.asar` header changed, the app stopped at startup with "Integrity check failed for asar archive entry '<header>'".
- The packaged smoke test passes. This held for both the test configuration and the release configuration, which also edits the executable's resources after the fuses are flipped.

The macOS and Linux packages are built and smoke-tested by the release workflow only.

## Static analysis in CI

`ci.yml` calls these workflows before the platform jobs, and they also run weekly:

- `codeql.yml`: CodeQL with the `security-extended` queries.
- `security-scan.yml`:
  - OSV-Scanner on `package-lock.json`. Accepted advisories, each with an end date, are listed in `osv-scanner.toml`.
  - Gitleaks over the full history.
  - Semgrep OSS. Any finding fails the job.
  - Electronegativity. Report only; it does not fail the job.
