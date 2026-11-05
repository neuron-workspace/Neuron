// Run: node tools/row-window.test.mjs
import { transform } from 'esbuild';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const src = readFileSync(join(root, 'src/renderer/lib/row-window.ts'), 'utf-8');
const { code } = await transform(src, { loader: 'ts', format: 'esm' });
const tmp = join(root, 'tools/.row-window.tmp.mjs');
writeFileSync(tmp, code);
let rowWindow;
try { ({ rowWindow } = await import(pathToFileURL(tmp))); }
finally { rmSync(tmp); }

const base = { scrollTop: 0, viewportHeight: 360, rowHeight: 36, count: 1000, overscan: 10 };
const check = (options, expected) => assert.deepEqual(rowWindow({ ...base, ...options }), expected);
check({}, { start: 0, end: 20, padTop: 0, padBottom: 35280 });
check({ scrollTop: 18000 }, { start: 490, end: 520, padTop: 17640, padBottom: 17280 });
check({ scrollTop: 35640 }, { start: 980, end: 1000, padTop: 35280, padBottom: 0 });
check({ scrollTop: 999999 }, { start: 980, end: 1000, padTop: 35280, padBottom: 0 });
check({ count: 3 }, { start: 0, end: 3, padTop: 0, padBottom: 0 });
check({ count: 0 }, { start: 0, end: 0, padTop: 0, padBottom: 0 });
check({ scrollTop: 18000, pinned: 2 }, { start: 2, end: 520, padTop: 72, padBottom: 17280 });
check({ pinned: 999 }, { start: 0, end: 1000, padTop: 0, padBottom: 0 });
check({ pinned: -1 }, { start: 0, end: 20, padTop: 0, padBottom: 35280 });
check({ pinned: 1000 }, { start: 0, end: 20, padTop: 0, padBottom: 35280 });
check({ overscan: 2000 }, { start: 0, end: 1000, padTop: 0, padBottom: 0 });
check({ overscan: -1 }, { start: 0, end: 10, padTop: 0, padBottom: 35640 });
check({ scrollTop: -100, rowHeight: 0 }, { start: 0, end: 20, padTop: 0, padBottom: 35280 });
check({ scrollTop: 18, overscan: 0 }, { start: 0, end: 11, padTop: 0, padBottom: 35604 });
console.log('row-window: all 14 checks passed');
