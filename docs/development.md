# Development guide

## Requirements

- Node.js 22 (the version CI tests on every platform)
- npm 10+
- Git
- Windows, macOS, or Linux with a desktop session

Run `npm ci` after cloning. This uses the committed lockfile and should be preferred over `npm install` in CI and routine setup.

## Development loop

```bash
npm run dev
```

The command starts three coordinated processes:

1. Vite serves and hot-reloads the React renderer on port 5174.
2. TypeScript watches the Electron main process and preload bridge.
3. `tools/dev/start-electron.js` waits for both outputs and starts Electron without relying on a fixed delay or `npx` shell resolution.

Stop the parent command to stop all three processes.

## Build environments

Neuron has three build environments:

| Environment | Command | Purpose |
| --- | --- | --- |
| Development | `npm run dev` | Runs the app from Vite and watched TypeScript output. |
| Test | `npm run dist:test` | Creates a local beta installer named **Neuron Test**. It runs like production, but uses a separate app id and does not publish or check production updates. |
| Production | `npm run release` | Creates the final **Neuron** installer and publishes it to GitHub Releases. |

Every build command starts by clearing `dist/` and `release/`, so the generated folders only contain the latest build output.

## Quality checks

```bash
npm run typecheck
npm test
npm run build
npm audit
```

CI runs the first three on every pull request and on pushes to `main` and `dev`.

## End-to-end tests

```bash
npm run build:main
npm run test:e2e:integration                        # every integration spec, a few minutes
npx playwright test e2e/integration/graph.spec.ts   # one feature's integration spec
npm run test:e2e                                    # the full suite
```

Every feature has two kinds of tests (D44): unit tests (`tools/*.test.mjs`,
run by `npm test`) and an **integration** spec, `e2e/integration/<feature>.spec.ts`,
a few end-to-end flows through the feature's main use. The detailed specs in
`e2e/` cover the edge cases; with the integration specs they are the **full**
suite. While working towards `dev`, run the unit tests and the integration spec
of the feature you changed (`tools/affected-e2e.mjs` maps files to features);
run the full suite only when preparing `dev` → `test`. CI follows the same rule:
`dev` runs the affected integration specs (all of them for shared or unmapped
code), `test` and `main` run the full suite.

Playwright drives the real Electron app (`e2e/`). Only the app is launched --
no browser download is needed, so `npx playwright install` is not part of setup.
Each test gets a throwaway copy of `examples/demo-repo` and its own user-data
directory, because the app writes to its workspace as you use it and a suite
pointed at the committed demo content would rewrite it.

The renderer is served by Vite during the run (Playwright starts it), since an
unpackaged Electron loads the dev URL. The e2e scripts are deliberately not
part of `npm test`: they take minutes, need a desktop session, and `npm test`
is the fast gate. `test:e2e` builds the main process itself; the integration
script does not, so run `npm run build:main` (or `npm run build`) first.

Before a release, also run `npm run dist:dir` and open the unpacked application. Verify repository creation, note editing, settings persistence, plugin enablement, the terminal, external links, and the bundled demo repository.

## Useful paths

- Main process: `src/main/main.ts`
- Preload bridge: `src/main/preload.ts`
- App shell: `src/renderer/App.tsx`
- Global tokens and editor styles: `src/renderer/index.css`
- Plugin contracts: `src/renderer/plugins/types.ts`
- Built-in plugins: `src/renderer/plugins/builtin/`
- Demo content: `examples/demo-repo/`
- Packaging configuration: `tools/electron-builder.env.cjs`

## Adding dependencies

Runtime packages belong in `dependencies`; build and test tools belong in `devDependencies`. Commit both `package.json` and `package-lock.json`. Run the production build and audit after upgrades, especially Electron upgrades.

## Environment and secrets

Do not commit `.env` files, API keys, signing certificates, personal note repositories, or generated release output. Release signing values belong in GitHub Actions secrets. Agent-specific files are intentionally ignored.

## Debugging

The renderer can use Chromium DevTools during development. Main-process errors appear in the terminal that launched `npm run dev`. IPC changes usually require coordinated edits to `src/main/main.ts`, `src/main/preload.ts`, and `src/renderer/electron.d.ts`.
