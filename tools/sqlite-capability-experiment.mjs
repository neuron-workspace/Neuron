// EXPERIMENT, not shipping code. Delete with the rest of the evaluation.
//
// Two questions decide most of the file-search recommendation, and neither is
// answerable from a README:
//
//   1. Does the SQLite already in this project (sql.js, WebAssembly) support
//      FTS5? "We already have SQLite" is only true if it is the right one.
//   2. Does a native SQLite (better-sqlite3) support FTS5 and loadable
//      extensions? The second decides whether vector search can be added later
//      without replacing the core index, which is a stated requirement.
//
//   node tools/sqlite-capability-experiment.mjs
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const line = (label, value) => console.log(`${String(label).padEnd(22)} ${value}`);

// --- 1. sql.js, the build already shipped in this app -------------------------
console.log('\n=== sql.js (WebAssembly, already a dependency) ===');
{
  const initSqlJs = (await import('sql.js')).default;
  const wasm = join(dirname(require.resolve('sql.js')), 'sql-wasm.wasm');
  const SQL = await initSqlJs({ wasmBinary: readFileSync(wasm) });
  const db = new SQL.Database();

  line('sqlite version', db.exec('select sqlite_version()')[0].values[0][0]);
  const options = db.exec('pragma compile_options')[0].values.map((r) => r[0]);
  for (const [label, needle] of [['FTS5', 'ENABLE_FTS5'], ['FTS4/3', 'ENABLE_FTS3'], ['extensions', 'OMIT_LOAD_EXTENSION']]) {
    const present = options.some((o) => o.startsWith(needle));
    // OMIT_LOAD_EXTENSION present means extensions are OFF, so invert it.
    line(label, needle === 'OMIT_LOAD_EXTENSION' ? (present ? 'DISABLED (OMIT_LOAD_EXTENSION)' : 'enabled') : (present ? 'yes' : 'NO'));
  }
  try {
    db.exec('create virtual table t using fts5(body)');
    line('fts5 virtual table', 'created');
  } catch (e) {
    line('fts5 virtual table', `refused — ${e.message}`);
  }
  line('threading', options.some((o) => o === 'THREADSAFE=0') ? 'single-threaded (THREADSAFE=0)' : 'threadsafe');
  line('mmap', options.some((o) => o === 'MAX_MMAP_SIZE=0') ? 'unavailable (MAX_MMAP_SIZE=0)' : 'available');
  line('persistence', typeof db.export === 'function' ? 'export() — whole database as bytes' : 'unknown');
  db.close();
}

// --- 2. better-sqlite3, a native candidate -----------------------------------
console.log('\n=== better-sqlite3 (native) ===');
try {
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  line('sqlite version', db.prepare('select sqlite_version() v').get().v);

  try {
    db.exec('create virtual table t using fts5(body)');
    db.exec("insert into t(body) values ('the quick brown fox'), ('lazy dog')");
    const hits = db.prepare("select body from t where t match 'quick'").all();
    line('fts5', `available — matched ${hits.length}`);
  } catch (e) {
    line('fts5', `NO — ${e.message}`);
  }

  // Not loading anything: just asking whether the API exists at all, which is
  // what decides if sqlite-vec could be added later.
  line('loadExtension API', typeof db.loadExtension === 'function' ? 'present' : 'ABSENT');

  const opts = db.prepare('pragma compile_options').all().map((r) => Object.values(r)[0]);
  line('OMIT_LOAD_EXTENSION', opts.includes('OMIT_LOAD_EXTENSION') ? 'PRESENT (extensions off)' : 'absent (extensions possible)');
  line('persistence', 'ordinary file, incremental writes');
  db.close();
} catch (e) {
  line('better-sqlite3', `could not load — ${e.message}`);
}
console.log();
