// Runnable check for src/main/settings-file.ts: a damaged settings file is kept,
// never silently replaced. Driven by an in-memory file system.
// Run: node tools/settings-file.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import ts from 'typescript';

const source = readFileSync(new URL('../src/main/settings-file.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
const { createSettingsReader, corruptCopyName, CORRUPT_COPY_LIMIT } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);

const dir = path.join(path.sep, 'userData');
const file = path.join(dir, 'neuron-settings.json');
const legacy = path.join(dir, 'autonote-settings.json');

/** A directory in memory; `fail` makes one call throw. */
function memoryFs(initial = {}, fail = {}) {
  const files = new Map(Object.entries(initial).map(([name, content]) => [path.join(dir, name), content]));
  const err = (code) => Object.assign(new Error(code), { code });
  return {
    files,
    existsSync: (f) => files.has(f),
    readFileSync: (f) => {
      if (fail.read) throw err(fail.read);
      if (!files.has(f)) throw err('ENOENT');
      return files.get(f);
    },
    renameSync: (from, to) => {
      if (fail.rename) throw err(fail.rename);
      if (!files.has(from)) throw err('ENOENT');
      files.set(to, files.get(from));
      files.delete(from);
    },
    readdirSync: () => [...files.keys()].map((f) => path.basename(f)),
    unlinkSync: (f) => { files.delete(f); },
  };
}

/** The reader main.ts uses, over this fs; `read` merges onto defaults as readSettings does. */
function session(fs) {
  const notices = [];
  let clock = Date.UTC(2026, 10, 24, 1, 2, 3, 4);
  const reader = createSettingsReader({ fs, file: () => file, legacyFile: () => legacy, notify: (m) => notices.push(m), now: () => clock });
  const read = (now = clock) => {
    clock = now;
    return { repositories: { current: null, recent: [] }, ...reader.read() };
  };
  return { read, notices, stuck: () => !reader.canWrite() };
}

const defaults = { repositories: { current: null, recent: [] } };
const saved = JSON.stringify({ repositories: { current: '/notes', recent: ['/notes'] }, __secrets: { openai: { apiKey: { v: 1, enc: 'x' } } } });
const copies = (fs) => [...fs.files.keys()].map((f) => path.basename(f)).filter((n) => n.startsWith('settings.corrupt-')).sort();

const tests = [
  ['a corrupt file is kept as a copy, the user is told once, defaults are returned', () => {
    const fs = memoryFs({ 'neuron-settings.json': '{"repositories": {"current": "/notes", ' });
    const s = session(fs);
    assert.deepEqual(s.read(), defaults);
    assert.equal(fs.files.has(file), false, 'moved out of the way of the next write');
    const kept = copies(fs);
    assert.deepEqual(kept, [corruptCopyName(Date.UTC(2026, 10, 24, 1, 2, 3, 4))]);
    assert.equal(kept[0], 'settings.corrupt-2026-11-24T01-02-03-004Z.json', 'no colons: legal on Windows');
    assert.equal(fs.files.get(path.join(dir, kept[0])), '{"repositories": {"current": "/notes", ', 'byte for byte');
    assert.deepEqual(s.notices, [`Neuron's settings file was damaged and has been reset. A copy was kept at ${path.join(dir, kept[0])}`]);
    // Every later read is the quiet first-run case, and says nothing more.
    assert.deepEqual(s.read(), defaults);
    assert.equal(s.notices.length, 1, 'told once');
    assert.equal(s.stuck(), false);
  }],
  ['a missing file: defaults, no copy, no notice', () => {
    const fs = memoryFs();
    const s = session(fs);
    assert.deepEqual(s.read(), defaults);
    assert.deepEqual(copies(fs), []);
    assert.deepEqual(s.notices, []);
  }],
  ['an empty file holds nothing to lose: no copy, no notice', () => {
    const fs = memoryFs({ 'neuron-settings.json': ' \n' });
    const s = session(fs);
    assert.deepEqual(s.read(), defaults);
    assert.deepEqual(copies(fs), []);
    assert.deepEqual(s.notices, []);
  }],
  ['a good file is read as it is', () => {
    const fs = memoryFs({ 'neuron-settings.json': saved });
    const s = session(fs);
    assert.deepEqual(s.read(), JSON.parse(saved));
    assert.deepEqual(copies(fs), []);
    assert.deepEqual(s.notices, []);
    assert.equal(fs.files.get(file), saved, 'untouched');
  }],
  ['the legacy file is read when there is no current one, and kept the same way when damaged', () => {
    assert.deepEqual(session(memoryFs({ 'autonote-settings.json': saved })).read(), JSON.parse(saved));
    const fs = memoryFs({ 'autonote-settings.json': 'not json' });
    const s = session(fs);
    assert.deepEqual(s.read(), defaults);
    assert.equal(fs.files.has(legacy), false);
    assert.equal(copies(fs).length, 1);
    assert.equal(s.notices.length, 1);
  }],
  ['JSON that is not a settings object is damage too', () => {
    for (const content of ['[]', 'null', '42', '"text"', '[{"repositories":{}}]']) {
      const fs = memoryFs({ 'neuron-settings.json': content });
      const s = session(fs);
      assert.deepEqual(s.read(), defaults, content);
      assert.equal(copies(fs).length, 1, content);
      assert.equal(s.notices.length, 1, content);
    }
  }],
  ['a file that exists but cannot be read is kept too', () => {
    const fs = memoryFs({ 'neuron-settings.json': saved }, { read: 'EACCES' });
    const s = session(fs);
    assert.deepEqual(s.read(), defaults);
    assert.equal(copies(fs).length, 1);
    assert.equal(s.notices.length, 1);
  }],
  ['a file that vanishes between exists and read is just missing', () => {
    const fs = memoryFs({ 'neuron-settings.json': saved }, { read: 'ENOENT' });
    const s = session(fs);
    assert.deepEqual(s.read(), defaults);
    assert.deepEqual(s.notices, []);
    assert.equal(fs.files.get(file), saved);
  }],
  ['a damaged file that cannot be moved aside is left in place and reported as stuck', () => {
    const fs = memoryFs({ 'neuron-settings.json': '{broken' }, { rename: 'EBUSY' });
    const s = session(fs);
    assert.deepEqual(s.read(), defaults);
    assert.equal(s.stuck(), true, 'main.ts refuses to write while this is so');
    assert.equal(fs.files.get(file), '{broken');
    assert.equal(s.notices.length, 1);
    assert.match(s.notices[0], /could not be moved aside/);
    assert.ok(s.notices[0].includes(file));
  }],
  [`at most ${CORRUPT_COPY_LIMIT} copies are kept, the oldest go first`, () => {
    const fs = memoryFs();
    const s = session(fs);
    const times = [1, 2, 3, 4, 5].map((day) => Date.UTC(2026, 10, day));
    for (const now of times) {
      fs.files.set(file, `{bad ${now}`);
      s.read(now);
    }
    assert.equal(CORRUPT_COPY_LIMIT, 3);
    assert.deepEqual(copies(fs), times.slice(-3).map(corruptCopyName));
    assert.equal(fs.files.get(path.join(dir, corruptCopyName(times[4]))), `{bad ${times[4]}`, 'the newest is the latest damage');
    assert.equal(s.notices.length, 1, 'still told once per run');
  }],
  ['two copies in the same millisecond do not overwrite each other', () => {
    const fs = memoryFs();
    const s = session(fs);
    const now = Date.UTC(2026, 10, 24);
    fs.files.set(file, '{first'); s.read(now);
    fs.files.set(file, '{second'); s.read(now);
    const kept = copies(fs);
    assert.equal(kept.length, 2);
    assert.deepEqual(kept.map((n) => fs.files.get(path.join(dir, n))).sort(), ['{first', '{second']);
  }],
  ['main.ts reads settings through this, and never writes over a stuck file', () => {
    const main = readFileSync(new URL('../src/main/main.ts', import.meta.url), 'utf8');
    assert.match(main, /createSettingsReader\(\{\s*fs,\s*file: settingsFile,\s*legacyFile: legacySettingsFile,/);
    assert.match(main, /function readSettings\(\): Settings \{\s*return \{ repositories: \{ current: null, recent: \[\] \}, \.\.\.settingsReader\.read\(\) \}/);
    assert.match(main, /function writeSettings\(settings: Settings\): boolean \{\s*\/\/[^\n]*\n\s*if \(!settingsReader\.canWrite\(\)\) return false;/);
    assert.match(main, /dialog\.showMessageBox\(\{ type: 'warning', title: 'Neuron', message \}\)/, 'the user is shown the notice');
  }],
];

let failures = 0;
for (const [name, test] of tests) {
  try {
    await test();
    console.log(`ok - ${name}`);
  } catch (error) {
    failures++;
    console.error(`not ok - ${name}\n  ${error.message}`);
  }
}
if (failures) {
  console.error(`settings file: ${failures} of ${tests.length} checks failed`);
  process.exitCode = 1;
} else {
  console.log(`settings file: all ${tests.length} checks passed`);
}
