// Windows shell integration: argv parsing and symmetric registry cleanup.
import { build } from 'esbuild';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const out = mkdtempSync(join(tmpdir(), 'neuron-windows-installer-'));
const bundled = join(out, 'workspace-argv.mjs');
await build({
  entryPoints: ['src/main/workspace-argv.ts'],
  outfile: bundled,
  format: 'esm',
  bundle: true,
  platform: 'node',
});
const { workspacePathFromArgv } = await import('file://' + bundled.replace(/\\/g, '/'));

let checks = 0;
const check = (what, fn) => { fn(); checks += 1; console.log(`  ok  ${what}`); };

const spaceDir = join(out, 'workspace with spaces');
const trailingDir = join(out, 'trailing');
const file = join(out, 'note.md');
mkdirSync(spaceDir);
mkdirSync(trailingDir);
writeFileSync(file, '# note');

check('packaged argv accepts quoted paths with spaces', () => {
  assert.equal(workspacePathFromArgv(['Neuron.exe', `"${spaceDir}"`], true), spaceDir);
});

check('packaged argv accepts a trailing backslash', () => {
  assert.equal(workspacePathFromArgv(['Neuron.exe', `${trailingDir}\\`], true), trailingDir);
});

check('development argv skips the Electron app argument', () => {
  assert.equal(workspacePathFromArgv(['electron.exe', '.', spaceDir], false), spaceDir);
});

check('no workspace argument returns null', () => {
  assert.equal(workspacePathFromArgv(['Neuron.exe'], true), null);
});

check('a file is not a workspace', () => {
  assert.equal(workspacePathFromArgv(['Neuron.exe', file], true), null);
});

check('an Electron flag is not a workspace', () => {
  assert.equal(workspacePathFromArgv(['Neuron.exe', `--user-data-dir=${spaceDir}`], true), null);
  assert.equal(workspacePathFromArgv(['Neuron.exe', '--user-data-dir', spaceDir], true), null);
});

const nsh = readFileSync('build/installer.nsh', 'utf-8');
const nsis = JSON.parse(readFileSync('package.json', 'utf-8')).build.nsis;
const installed = [...nsh.matchAll(/WriteRegStr HKCU "([^"]+\\OpenWithNeuron)"/g)].map((m) => m[1]);
const uninstalled = [...nsh.matchAll(/DeleteRegKey HKCU "([^"]+\\OpenWithNeuron)"/g)].map((m) => m[1]);

check('NSIS is a non-elevating one-click per-user installer', () => {
  assert.equal(nsis.oneClick, true);
  assert.equal(nsis.perMachine, false);
  assert.equal(nsis.allowElevation, false);
  assert.equal(nsis.allowToChangeInstallationDirectory, undefined);
  assert.equal(nsis.include, 'build/installer.nsh');
});

check('uninstall removes every registered Explorer verb root', () => {
  assert.deepEqual([...new Set(installed)].sort(), [...new Set(uninstalled)].sort());
  assert.equal(new Set(installed).size, 2);
});

check('both commands pass the Explorer directory value', () => {
  assert.equal((nsh.match(/%V/g) ?? []).length, 2);
  assert.doesNotMatch(nsh, /%1/);
});

rmSync(out, { recursive: true, force: true });
console.log(`\nwindows-installer: ${checks} checks passed`);
