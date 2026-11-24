# Electron security checklist: Neuron desktop

**Electron:** 45.4.1 (Chromium 156, Node.js 24)
**Reviewed:** `dev` at `3a5917b`, plus the Electron Fuses change
**Standard:** the recommendations in Electron's security tutorial

Code references name a file and a function or setting rather than a line number. Line numbers drift with every change.

| # | Recommendation | Status | Where |
| :-: | :--- | :---: | :--- |
| 1 | Only load secure content | Pass | `createWindow` in `src/main/main.ts` calls `loadFile('../renderer/index.html')` when packaged. The Vite dev server (`http://localhost:5174`) is used only in development (`IS_DEV`). |
| 2 | Disable Node.js integration | Pass | `nodeIntegration: false` in the `BrowserWindow` webPreferences. `will-attach-webview` forces it off for every `<webview>`, including `nodeIntegrationInSubFrames`. |
| 3 | Enable context isolation | Pass | `contextIsolation: true` on windows. Forced on for webviews in `will-attach-webview`. |
| 4 | Enable process sandboxing | Pass | `sandbox: true` on windows. Forced on for webviews. The preload uses only `contextBridge` and `ipcRenderer`. |
| 5 | Handle permission requests | Pass (webviews) | `web-contents-created` installs `setPermissionRequestHandler(... callback(false))` on every webview's session. The app's own window session keeps Electron's default handler. |
| 6 | Do not disable `webSecurity` | Pass | Never set. |
| 7 | Define a Content Security Policy | Pass | `index.html` meta CSP: `default-src 'self'; script-src 'self'`. No `unsafe-eval`, plus `object-src 'none'`, `base-uri 'none'`, `form-action 'none'` and `frame-src 'none'`. Images may come from `https:`, `data:`, `blob:` and `neuron-file:`; styles and fonts also from Google Fonts. In development, `vite.config.ts` adds `'unsafe-inline'` to `script-src` and the HMR socket to `connect-src`. Tests: `tools/csp.test.mjs`. |
| 8 | Do not enable `allowRunningInsecureContent` | Pass | Never set. |
| 9 | Do not enable experimental features | Pass | Never set. |
| 10 | Do not use `enableBlinkFeatures` | Pass | Never set. |
| 11 | `<webview>`: do not use `allowpopups` | Pass | Not set. `setWindowOpenHandler` returns `deny` for every web contents. |
| 12 | Verify webview options before creation | Pass | `will-attach-webview` deletes `preload` and forces `nodeIntegration`, `nodeIntegrationInSubFrames`, `contextIsolation` and `sandbox`. |
| 13 | Limit navigation | Pass | `will-navigate` and `will-redirect` keep the app window on its bundled content (`isAppContent`). HTML views are pinned to the view server's origin. The in-app browser webview may navigate anywhere. |
| 14 | Limit new windows | Pass | `setWindowOpenHandler` always denies. `http(s)` popups from anything except an HTML view go to the OS browser. |
| 15 | Do not use `shell.openExternal` with untrusted content | Pass | Called only for URLs matching `^https?://`. Workspace files are revealed with `shell.showItemInFolder`, never opened. |
| 16 | Use a current Electron | Pass | Electron 45.4.1. |
| 17 | Validate the sender of all IPC messages | Pass | `entryOf(event)` requires the top-level frame of one of Neuron's windows. See the [IPC matrix](IPC_SECURITY_MATRIX.md). |
| 18 | Do not use the `file://` protocol | Partial | The renderer loads from `app.asar` through `file://`. Workspace media uses the custom `neuron-file://` protocol. Moving the renderer to a custom protocol is what would let `GrantFileProtocolExtraPrivileges` be turned off. |
| 19 | Check which fuses you can change | Done, two left at default | `package.json` `build.electronFuses`. See below. |
| 20 | Do not expose Electron APIs to untrusted web content | Pass | `src/main/preload.ts` exposes one wrapper function per channel on `window.electronAPI`, never `ipcRenderer` itself. Webviews get no preload. |

## Fuses

electron-builder flips the fuses from `build.electronFuses` after packing and before signing. On macOS that order matters: changing a fuse changes the binary, so the ad-hoc signature made with `mac.identity: "-"` has to come afterwards, and it does. `tools/fuses.test.mjs` pins the values. Given an executable, it also checks the built binary.

| Fuse | Neuron | Reason |
| --- | --- | --- |
| `RunAsNode` | Default (enabled) | node-pty's Windows `kill()` lists the console's processes with `child_process.fork()`, which needs this fuse. On a packaged build with the fuse off, every terminal close logged "child_process.fork() is not supported when the runAsNode fuse is disabled". |
| `EnableCookieEncryption` | Enabled | Cookies on disk are encrypted with the OS key. Tested on Windows: a cookie saved with the fuse off still read after it was turned on, and new cookies were stored encrypted. One-way: turning it off later leaves the store unreadable. |
| `EnableNodeOptionsEnvironmentVariable` | Disabled | Nothing in Neuron uses `NODE_OPTIONS`. |
| `EnableNodeCliInspectArguments` | Disabled | Nothing in Neuron uses `--inspect`. The packaged smoke test attaches over `--remote-debugging-port` instead. |
| `EnableEmbeddedAsarIntegrityValidation` | Enabled | electron-builder writes the header hash into the Windows executable's resources and the macOS `Info.plist`. Electron supports the check on Windows and macOS only. |
| `OnlyLoadAppFromAsar` | Enabled | Without it, the integrity check could be bypassed with a loose `app/` folder. |
| `LoadBrowserProcessSpecificV8Snapshot` | Default (disabled) | Not used. |
| `GrantFileProtocolExtraPrivileges` | Default (enabled) | With it off, a packaged build's window failed to load `index.html` from `app.asar` (`ERR_FILE_NOT_FOUND`). |

Files listed in `asarUnpack` (`node-pty` and `sql-wasm.wasm`) sit outside the archive, in `app.asar.unpacked`. Electron's documentation does not say whether the integrity check covers them, so treat them as unverified. The packaged Windows build starts and runs terminals with the check on.
