// Electron Fuses: the switches flipped inside the packaged binary.
//
//   node tools/fuses.test.mjs                 the config (runs in npm test)
//   node tools/fuses.test.mjs <executable>    also the fuses inside a build
//
// electron-builder flips them from `build.electronFuses` in package.json, right
// before signing. A key it does not know is ignored without a word, and a
// dropped block just ships a binary with Electron's defaults -- nothing fails
// either way. So the values are pinned here, and so are the two fuses that are
// deliberately left alone, with the reason each one would break the app.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(root, 'package.json'));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'));
const fuses = pkg.build?.electronFuses;

let checks = 0;
const check = (what, fn) => { fn(); checks += 1; console.log(`  ok  ${what}`); };

const PINNED = {
  // NODE_OPTIONS / NODE_EXTRA_CA_CERTS: nothing in Neuron sets them, and
  // honouring them lets any local process inject code into the main process.
  enableNodeOptionsEnvironmentVariable: false,
  // --inspect / SIGUSR1: a debugger on the main process is a full bypass of
  // every IPC guard. The packaged smoke test attaches over Chromium's
  // --remote-debugging-port instead, which this fuse does not govern.
  enableNodeCliInspectArguments: false,
  // Load app code from app.asar only, and check its header hash at startup
  // (Windows and macOS). One without the other can be bypassed.
  onlyLoadAppFromAsar: true,
  enableEmbeddedAsarIntegrityValidation: true,
  // Cookies on disk (the in-app browser's persist:neuron-browser session, where
  // Chrome sign-ins are imported) encrypted with the OS key, as Chrome does.
  // One-way: switching it off again leaves the store unreadable.
  enableCookieEncryption: true,
};

check('package.json build.electronFuses exists', () => {
  assert.ok(fuses && typeof fuses === 'object', 'build.electronFuses is missing: the packaged app would ship with every fuse at its default');
});

for (const [key, value] of Object.entries(PINNED)) {
  check(`${key} is ${value}`, () => assert.equal(fuses[key], value, `build.electronFuses.${key} must be ${value}`));
}

check('runAsNode is left at its default (enabled)', () => {
  // node-pty's Windows kill() calls child_process.fork() to list the console's
  // processes, and fork() needs ELECTRON_RUN_AS_NODE. With the fuse off it
  // throws on every terminal close (seen on a packaged build: logged as
  // main.unhandled-rejection, and node-pty's process sweep is skipped).
  // Turn it off only after the terminal no longer forks -- node-pty's
  // useConptyDll path does not -- and this check is updated with it.
  assert.notEqual(fuses.runAsNode, false, 'runAsNode=false breaks node-pty terminal kill on Windows; see the comment above');
});

check('grantFileProtocolExtraPrivileges is left at its default (enabled)', () => {
  // The renderer is loaded with loadFile() from inside app.asar. With this
  // fuse off, file:// reverts to Chromium's own handler, which cannot read
  // into an asar archive: a packaged build opened a window that failed with
  // ERR_FILE_NOT_FOUND on index.html. Needs the renderer served from a custom
  // protocol first.
  assert.notEqual(fuses.grantFileProtocolExtraPrivileges, false, 'grantFileProtocolExtraPrivileges=false stops the packaged renderer loading; see the comment above');
});

check('every key is one electron-builder recognises', () => {
  const scheme = JSON.parse(readFileSync(require.resolve('app-builder-lib/scheme.json'), 'utf-8'));
  const known = Object.keys(scheme.definitions.FuseOptionsV1.properties);
  for (const key of Object.keys(fuses)) assert.ok(known.includes(key), `electron-builder does not know "${key}" and would ignore it`);
  for (const value of Object.values(fuses)) assert.equal(typeof value, 'boolean');
});

check('the per-environment config (npm run dist:*) carries the same fuses', () => {
  const config = join(root, 'tools', 'electron-builder.env.cjs');
  for (const env of ['test', 'prod']) {
    const previous = process.env.NEURON_BUILD_ENV;
    process.env.NEURON_BUILD_ENV = env;
    delete require.cache[require.resolve(config)];
    try {
      assert.deepEqual(require(config).electronFuses, fuses, `${env} builds must flip the same fuses as package.json`);
    } finally {
      if (previous === undefined) delete process.env.NEURON_BUILD_ENV; else process.env.NEURON_BUILD_ENV = previous;
    }
  }
});

// Optional: read the fuses out of a packaged executable.
const executable = process.argv[2];
if (executable) {
  const { getCurrentFuseWire, FuseV1Options } = require('@electron/fuses');
  const ENABLE = 49;
  const DISABLE = 48;
  const wire = await getCurrentFuseWire(executable);
  const option = {
    enableCookieEncryption: FuseV1Options.EnableCookieEncryption,
    enableNodeOptionsEnvironmentVariable: FuseV1Options.EnableNodeOptionsEnvironmentVariable,
    enableNodeCliInspectArguments: FuseV1Options.EnableNodeCliInspectArguments,
    enableEmbeddedAsarIntegrityValidation: FuseV1Options.EnableEmbeddedAsarIntegrityValidation,
    onlyLoadAppFromAsar: FuseV1Options.OnlyLoadAppFromAsar,
  };
  for (const [key, value] of Object.entries(PINNED)) {
    check(`${executable}: ${key} is ${value ? 'enabled' : 'disabled'}`, () => {
      assert.equal(wire[option[key]], value ? ENABLE : DISABLE);
    });
  }
}

console.log(`\nfuses: ${checks} checks passed`);
