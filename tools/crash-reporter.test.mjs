// Native crash capture: where it writes, and that it never sends.
//
// The promise this module makes is that nothing leaves the machine. Neuron's
// pitch is no account and no telemetry, and a crash reporter is the one
// component most likely to quietly break that -- every crash reporter's default
// posture is to upload. So the absence of upload is asserted here, not left to
// a comment and a code review.
import { build } from 'esbuild';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = mkdtempSync(join(tmpdir(), 'neuron-crash-'));
const file = join(out, 'crash-reporter.js');
await build({
  entryPoints: [join(root, 'src/main/crash-reporter.ts')],
  outdir: out,
  format: 'esm',
  bundle: true,
  external: ['path'],
});
const {
  crashDumpDirectory, crashReporterOptions, configureCrashReporter,
} = await import('file://' + file.replace(/\\/g, '/'));

let checks = 0;
const check = (what, fn) => { fn(); checks += 1; console.log(`  ok  ${what}`); };

check('dumps land beneath the logs folder', () => {
  // So the existing "Open logs folder" action reveals them, rather than needing
  // a second action nobody knows about.
  const dir = crashDumpDirectory(join('C:', 'logs'));
  assert.ok(dir.startsWith(join('C:', 'logs')), dir);
  assert.ok(dir.endsWith('crashes'), dir);
});

check('nothing is ever uploaded', () => {
  const options = crashReporterOptions('0.4.5');
  assert.equal(options.uploadToServer, false);
  assert.equal('submitURL' in options, false, 'no endpoint to submit to');
});

check('the system crash handler is left alone', () => {
  // Suppressing it would hide the crash from the user entirely. They should
  // still learn the app died; the dump explains why.
  assert.equal(crashReporterOptions('0.4.5').ignoreSystemCrashHandler, false);
});

check('the extra parameters carry no workspace path or note content', () => {
  // A dump is already a memory image. Attaching identifying strings to one is
  // how a local file becomes something the user cannot safely share.
  const { extra } = crashReporterOptions('0.4.5');
  assert.deepEqual(Object.keys(extra), ['neuronVersion']);
  assert.equal(extra.neuronVersion, '0.4.5');
});

check('the dump path is set BEFORE Crashpad starts', () => {
  // Crashpad reads the path once, when it initialises. Setting it afterwards
  // silently writes dumps somewhere else.
  const order = [];
  const app = {
    setPath: (name, value) => order.push(`setPath:${name}:${value}`),
    getVersion: () => '9.9.9',
  };
  const crashpad = { start: () => order.push('start') };

  const dir = configureCrashReporter(app, crashpad, join('C:', 'logs'));

  assert.equal(order.length, 2);
  assert.ok(order[0].startsWith('setPath:crashDumps:'), order[0]);
  assert.equal(order[1], 'start');
  assert.ok(order[0].endsWith(dir), 'set to the directory it returns');
});

// --- what the module must not contain -------------------------------------
const source = readFileSync(join(root, 'src/main/crash-reporter.ts'), 'utf-8');

check('there is no upload endpoint anywhere in the source', () => {
  assert.doesNotMatch(source, /submitURL/, 'a submit URL is an upload');
  assert.doesNotMatch(source, /https?:\/\/(?!\S*example)/, 'no outbound URL');
  assert.doesNotMatch(source, /setUploadToServer\s*\(\s*true/);
});

check('uploadToServer is typed as the literal false', () => {
  // So flipping it is a compile error rather than a review comment someone
  // might miss.
  assert.match(source, /uploadToServer:\s*false;/, 'the type, not just the value');
});

rmSync(out, { recursive: true, force: true });
console.log(`\ncrash reporter: ${checks} checks passed`);
