# Security roadmap: Neuron desktop

**Reviewed:** `dev` at `3a5917b`, plus the Electron Fuses change

Each item is either done, with where it lives, or open, with what it would take. Priorities are a recommendation. The owner decides the order.

## Done

| Item | Where |
| --- | --- |
| Electron Fuses: `NODE_OPTIONS` and `--inspect` off; app code from `app.asar` only, with integrity validation; cookie encryption on | `package.json` `build.electronFuses`, flipped by electron-builder before signing, pinned by `tools/fuses.test.mjs`. Checked on a packaged Windows build. |
| The packaged smoke test works with the inspector fused off | `tools/smoke-packaged.mjs` attaches over `--remote-debugging-port` instead of Playwright's `_electron.launch` |
| Scanners in CI: OSV-Scanner, Gitleaks, Semgrep, CodeQL, Electronegativity (report only) | `.github/workflows/security-scan.yml`, `codeql.yml` |

## Open

### 1. Turn off the `RunAsNode` fuse (P2)
**Why it is still on:** node-pty's Windows `kill()` calls `child_process.fork()` to list the console's processes. With the fuse off, `fork()` throws on every terminal close. On a packaged build this showed up as `main.unhandled-rejection` in the diagnostic log, and node-pty's process sweep was skipped.
**What it takes:** a terminal that does not fork. node-pty's `useConptyDll` option takes a path in `kill()` that does not call `fork()`, but it switches to the bundled ConPTY and needs its own terminal testing on Windows. Then set `runAsNode: false` and update `tools/fuses.test.mjs`.

### 2. Serve the renderer from a custom protocol, then turn off `GrantFileProtocolExtraPrivileges` (P3)
**Why it is still on:** the renderer loads from `app.asar` with `loadFile()`. With the fuse off, `file://` cannot read inside the archive, and the window failed with `ERR_FILE_NOT_FOUND`.
**What it takes:** register a privileged app scheme, serve `dist/renderer` through `protocol.handle`, update the CSP and `isAppContent`, then flip the fuse.

### 3. Move secret storage to the async `safeStorage` API (P2, before Electron 46)
`src/main/main.ts` (`secretCodec`) and `src/main/secret-storage.ts` use the synchronous `isEncryptionAvailable`, `encryptString` and `decryptString`. Electron 45 deprecates them. The callers are IPC handlers, which may return promises, so the change stays inside main.

### 4. Path-based rename, unlink and trash (accepted)
The window between the last check and the call in `src/main/safe-fs.ts` is accepted for now; the owner chose not to add a native dependency (D43.2). Closing it would take a handle-based helper: `renameat`/`unlinkat` on POSIX, `SetFileInformationByHandle(FileRenameInfo)` on Windows. That is a native module, and a new dependency needs its own decision (D8).

### 5. Empty conflict copy after a crash in `writeUnattended` (before sync ships)
`src/main/journal.ts` reserves the conflict-copy name with an empty file, then writes into it. A crash in between leaves the empty file behind. Nothing calls `writeUnattended` until sync exists. Fix it before sync does: write to a temp file, then link or rename it into the reserved name.

### 6. Plugin isolation (P3)
Plugins run in the renderer with the full bridge. A capability model, with per-plugin consent for network and file access, would limit what one plugin can do.

### 7. Chrome cookie import: app-bound encryption (P3)
Chrome on Windows now encrypts many cookies with app-bound encryption (the `v20` prefix). The import skips these and reports them as `skipped`. The UI could say which sites need a normal sign-in instead.

### 8. WebGL on macOS CI (P3)
The macOS runner has no GPU, and the graph tests skip there. A runner with a GPU, or a software WebGL path that works on it, would close the gap.

## Ongoing

| Activity | How |
| --- | --- |
| Dependency advisories | OSV-Scanner on every CI run and weekly. Exceptions are kept in `osv-scanner.toml`, each with an end date. |
| Secrets in history | Gitleaks on every CI run |
| Static analysis | CodeQL and Semgrep on every CI run and weekly |
| Electron upgrades | Dependabot, plus manual upgrades; re-run `tools/fuses.test.mjs` against a packaged build after each one |
