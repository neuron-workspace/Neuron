# Security tests: Neuron desktop

**Reviewed:** `dev` at `3a5917b`, plus the Electron Fuses change

There are four layers. Each catches something the others cannot:

| Layer | Where | Runs |
| --- | --- | --- |
| Static analysis | `.github/workflows/codeql.yml`, `security-scan.yml` | Called from `ci.yml` on every push to `dev`, `test` and `main` and on every pull request, and weekly |
| Unit suites | `tools/*.test.mjs`, all wired into `npm test` | Every CI run, on all three platforms |
| End-to-end | `e2e/integration/security.spec.ts` (integration); `e2e/security.spec.ts`, `e2e/secrets.spec.ts`, `e2e/view-trust.spec.ts` (detailed) | Integration specs on `dev` for affected areas; the full suite into `test` and `main` (decision D44) |
| Packaged | `npm run smoke` (`tools/smoke-packaged.mjs`) | CI into `test` and `main`; the release workflow on every platform before publishing |

## Unit suites with security coverage

| Suite | Covers |
| --- | --- |
| `tools/main-guards.test.mjs` | Sender and argument guards on all 48 IPC channels |
| `tools/safe-fs.test.mjs` | Handle identity checks, parent and link swaps (with injected races), traversal, unattended writes (`writeUnattended`) |
| `tools/save-file.test.mjs`, `tools/external-change.test.mjs`, `tools/file-writer.test.mjs` | Atomic saves, retries that do not block, refusing to overwrite an outside change |
| `tools/journal.test.mjs` | Pre-image capture and restore |
| `tools/htmx-views.test.mjs` | View server host/origin checks, boot tokens, session cookies, content-hash trust, capabilities, path policy |
| `tools/settings-schema.test.mjs`, `tools/settings-file.test.mjs` | Per-key schema and byte limits, prototype keys, corrupt settings recovery |
| `tools/secret-storage.test.mjs` | Encryption, the Linux `basic_text` refusal, redaction, legacy key migration |
| `tools/public-network.test.mjs` | Blocked address ranges, DNS pinning, redirects, size caps, timeouts |
| `tools/portable-path.test.mjs`, `tools/repo-path.test.mjs` | Windows device names, control characters, trailing dots and spaces, containment |
| `tools/mdx-security.test.mjs`, `tools/sanitize-html.test.mjs` | URL neutralisation, raw HTML, component prop tokens |
| `tools/terminal-bus.test.mjs` | Refusing hidden or multi-line Run commands |
| `tools/file-kinds.test.mjs` | Blocked file kinds, `neuron-file://` token and headers |
| `tools/cookie-domain.test.mjs`, `tools/chrome-cookies.test.mjs` | Hostname validation and matching, AES-GCM tag length |
| `tools/csp.test.mjs` | Production and development CSP |
| `tools/updater.test.mjs` | Update policy (Store builds, unsigned macOS) |
| `tools/fuses.test.mjs` | The `electronFuses` values in `package.json`, carried into both build configs. Given an executable path, it also checks the built binary. |

## Static analysis

- **CodeQL:** `security-extended` queries over JavaScript and TypeScript.
- **OSV-Scanner:** advisories in `package-lock.json`. Accepted ones are listed, each with an end date, in `osv-scanner.toml`.
- **Gitleaks:** the full git history.
- **Semgrep OSS:** `p/javascript`, `p/typescript`, `p/nodejs`, `p/react` and `p/secrets`. Any finding fails the job.
- **Electronegativity:** report only.

## Platform matrix

`ci.yml` runs Windows and Linux first. macOS starts only after both pass. Typecheck, unit tests and the build run on all three platforms.

The macOS runner has no GPU and gives no WebGL, so the WebGL graph tests skip there.

## Packaged build checks (manual, Windows)

```powershell
npm run dist:dir
npx @electron/fuses read --app "release/test/win-unpacked/Neuron Test.exe"
node tools/fuses.test.mjs "release/test/win-unpacked/Neuron Test.exe"
npm run smoke -- release/test/win-unpacked
```

To confirm that `NODE_OPTIONS` and `--inspect` are ignored, start the packaged executable with `NODE_OPTIONS=--require <script>` and with `--inspect=0`. The app should start normally, and the script should not run.

## Running the security suites locally

```bash
npm test                                   # every unit suite, including the above
npm run build:main
npx playwright test e2e/integration/security.spec.ts
```
