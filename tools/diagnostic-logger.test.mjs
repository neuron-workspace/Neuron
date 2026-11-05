import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const out = mkdtempSync(join(tmpdir(), 'neuron-diagnostics-test-'));
const bundle = join(out, 'diagnostic-logger.mjs');
await build({ entryPoints: ['src/main/diagnostic-logger.ts'], outfile: bundle, format: 'esm', bundle: true, platform: 'node' });
const loggerModule = await import('file://' + bundle.replace(/\\/g, '/'));
const { createDiagnosticLogger, formatLogLine, LOG_FILE_NAME, redactMessage, shouldRotate } = loggerModule;

let checks = 0;
const check = async (what, fn) => { await fn(); checks += 1; console.log(`  ok  ${what}`); };

await check('rotation triggers at the cap and keeps three files total', async () => {
  const directory = join(out, 'rotation');
  mkdirSync(directory);
  writeFileSync(join(directory, LOG_FILE_NAME), 'old'.repeat(100));
  const logger = createDiagnosticLogger(directory, { maxBytes: 200, files: 3 });
  await logger.write({ level: 'error', category: 'test', message: `first-${'a'.repeat(100)}` });
  await logger.write({ level: 'error', category: 'test', message: `second-${'b'.repeat(100)}` });
  await logger.write({ level: 'error', category: 'test', message: `third-${'c'.repeat(100)}` });
  assert.ok(shouldRotate(199, 2, 200));
  assert.ok(existsSync(logger.filePath));
  assert.ok(existsSync(`${logger.filePath}.1`));
  assert.ok(existsSync(`${logger.filePath}.2`));
  assert.ok(!existsSync(`${logger.filePath}.3`));
  assert.match(readFileSync(logger.filePath, 'utf8'), /third-/);
  assert.match(readFileSync(`${logger.filePath}.1`, 'utf8'), /second-/);
  assert.match(readFileSync(`${logger.filePath}.2`, 'utf8'), /first-/);
});

await check('a very large message cannot create an unbounded line', () => {
  const line = formatLogLine({ level: 'error', category: 'test', message: 'x'.repeat(1_000_000) });
  assert.ok(Buffer.byteLength(line) < 3_000);
  assert.match(line, /truncated/);
});

await check('content-bearing messages are redacted', () => {
  const secret = 'private note sentence';
  const redacted = redactMessage(`Compilation failed <style>${secret}</style>`);
  assert.ok(!redacted.includes(secret));
  assert.match(redacted, /content redacted/);
  assert.equal(redactMessage(`Compilation failed\n${secret}`), 'Compilation failed [multiline content redacted]');
});

await check('malformed or unreadable existing logs never throw during startup', async () => {
  const malformedDirectory = join(out, 'malformed');
  mkdirSync(malformedDirectory);
  const malformed = createDiagnosticLogger(malformedDirectory);
  writeFileSync(malformed.filePath, '{this is not json}\n');
  assert.equal(await malformed.startSession({ appVersion: '1', platform: process.platform, arch: process.arch, electronVersion: '1' }), true);

  const unreadableDirectory = join(out, 'unreadable');
  mkdirSync(join(unreadableDirectory, LOG_FILE_NAME), { recursive: true });
  const unreadable = createDiagnosticLogger(unreadableDirectory);
  assert.equal(await unreadable.startSession({ appVersion: '1', platform: process.platform, arch: process.arch, electronVersion: '1' }), false);
});

console.log(`\ndiagnostic-logger: ${checks} checks passed`);
rmSync(out, { recursive: true, force: true });
