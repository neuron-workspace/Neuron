// When Neuron looks for an update, and what it accepts as one.
//
// Each branch here is a case where getting it wrong either offers an update
// that cannot install, or silently offers none at all — and the second is the
// one nobody notices. Everything this project published before 0.4.5 was a
// prerelease, which electron-updater ignores by default.
import { build } from 'esbuild';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = mkdtempSync(join(tmpdir(), 'neuron-updater-'));
const file = join(out, 'updater.mjs');
await build({ entryPoints: [join(root, 'src/main/updater.ts')], outfile: file, format: 'esm', bundle: true });
const { updatePolicy } = await import('file://' + file.replace(/\\/g, '/'));

const base = { platform: 'win32', packaged: true, windowsStore: false, version: '0.4.5', signed: false };
let checks = 0;
const check = (what, fn) => { fn(); checks += 1; console.log(`  ok  ${what}`); };

check('a packaged Windows build checks for updates', () => {
  assert.equal(updatePolicy(base).check, true);
});

check('a development build does not', () => {
  const d = updatePolicy({ ...base, packaged: false });
  assert.equal(d.check, false);
  assert.match(d.reason, /development/);
});

check('a Microsoft Store build defers to the Store', () => {
  const d = updatePolicy({ ...base, windowsStore: true });
  assert.equal(d.check, false);
  assert.match(d.reason, /Store/);
});

check('an unsigned Windows build still updates', () => {
  // The integrity check is the sha512 in latest.yml, fetched over HTTPS — not
  // the code signature. Refusing to update unsigned builds would leave every
  // current user stranded for no security gain.
  assert.equal(updatePolicy({ ...base, signed: false }).check, true);
});

check('an unsigned macOS build does NOT check', () => {
  // Squirrel.Mac will not install into an app it cannot validate, so checking
  // would download an update, fail at install, and repeat on every launch.
  const d = updatePolicy({ ...base, platform: 'darwin', signed: false });
  assert.equal(d.check, false);
  assert.match(d.reason, /Developer ID/);
});

check('a signed macOS build does check', () => {
  assert.equal(updatePolicy({ ...base, platform: 'darwin', signed: true }).check, true);
});

check('Linux checks regardless of signing', () => {
  assert.equal(updatePolicy({ ...base, platform: 'linux', signed: false }).check, true);
});

check('a stable build is not offered prereleases', () => {
  assert.equal(updatePolicy({ ...base, version: '0.4.5' }).allowPrerelease, false);
});

check('a prerelease build is offered prereleases', () => {
  // Otherwise a beta user is told they are up to date forever: the only newer
  // versions are betas, and the updater would not look at them.
  assert.equal(updatePolicy({ ...base, version: '0.4.5-beta.1' }).allowPrerelease, true);
  assert.equal(updatePolicy({ ...base, version: '1.0.0-rc.1' }).allowPrerelease, true);
});

check('the prerelease decision is made even when not checking', () => {
  // So a caller that logs the decision sees the whole of it.
  const d = updatePolicy({ ...base, packaged: false, version: '0.4.5-beta.1' });
  assert.equal(d.check, false);
  assert.equal(d.allowPrerelease, true);
});

// --- what the module must not do ---------------------------------------------
const source = readFileSync(join(root, 'src/main/updater.ts'), 'utf-8');

check('signature verification is never disabled', () => {
  // electron-updater exposes a switch for this. Turning it off would make an
  // unsigned build "work" by removing a check rather than by not needing one.
  assert.doesNotMatch(source, /verifyUpdateCodeSignature/,
    'nothing here should touch signature verification');
});

check('the update provider is not overridden in code', () => {
  // It comes from the publish config electron-builder wrote into the package.
  // Setting a feed URL here is how an update channel quietly stops being the
  // one that was built and tested.
  assert.doesNotMatch(source, /setFeedURL|autoDownload\s*=/,
    'the provider and download policy belong to the build config');
});

rmSync(out, { recursive: true, force: true });
console.log(`\nupdater: ${checks} checks passed`);
