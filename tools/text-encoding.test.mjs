// Run: node tools/text-encoding.test.mjs
// No text file under src/, docs/ or examples/ may carry the marks of a botched
// re-encoding: U+FFFD (a byte that did not decode), UTF-8 read as Windows-1252
// and written back (â€ for curly quotes and dashes, Ã© for é, Ã¢ for â), or a
// literal "?" standing where a curly quote was. The last is how the layout
// switcher came to read `Update ?Writing?`.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const TEXT = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.css', '.html', '.md', '.mdx', '.json', '.yml', '.yaml', '.txt', '.svg', '.csv', '.db', '.canvas', '.mmd', '.xml', '.toml']);
const SKIP = new Set(['node_modules', '.git', 'dist', 'release', 'build', 'out', '.vite']);

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (entry.isFile() && TEXT.has(extname(entry.name).toLowerCase())) yield path;
  }
}

// Each is what a real character becomes after UTF-8 bytes are read as
// Windows-1252 (or Latin-1): â€ starts every curly quote, dash and ellipsis.
const MOJIBAKE = [
  ['�', 'U+FFFD replacement character'],
  ['â€', '"â€" (a curly quote, dash or ellipsis decoded as Windows-1252)'],
  ['Ã©', '"Ã©" (é decoded as Windows-1252)'],
  ['Ã¢', '"Ã¢" (â decoded as Windows-1252)'],
  ['Ã¨', '"Ã¨" (è decoded as Windows-1252)'],
  ['Â ', '"Â" before a non-breaking space'],
];

/** The scan, over named text. Returned as findings so the rule itself can be tested. */
export function findings(files) {
  const found = [];
  for (const [name, text] of files) {
    text.split('\n').forEach((line, i) => {
      for (const [needle, what] of MOJIBAKE) if (line.includes(needle)) found.push(`${name}:${i + 1}: ${what}`);
      // A label quoting a name between two literal question marks: ?{name}? or ?${name}?
      if (/\?\$?\{[\w.]+\}\?/.test(line)) found.push(`${name}:${i + 1}: "?" where a quote mark belongs`);
    });
  }
  return found;
}

// The rule finds what it is meant to, and leaves good text alone.
assert.deepEqual(findings([['ok', 'Update “Writing” — café, naïve, 日本語, emoji 🙂, a ? b, x?.y ?? z, `${a ? b : c}`']]), []);
assert.equal(findings([['bad', 'Update ?{active.name}?']]).length, 1);
assert.equal(findings([['bad', '`Delete ?${active.name}?? Click again`']]).length, 1);
assert.equal(findings([['bad', 'He said â€œhiâ€\u009d']]).length, 1);
assert.equal(findings([['bad', 'cafÃ©']]).length, 1);
assert.equal(findings([['bad', 'a � b']]).length, 1);

const files = [];
for (const top of ['src', 'docs', 'examples']) {
  try { if (!statSync(join(root, top)).isDirectory()) continue; } catch { continue; }
  for (const path of walk(join(root, top))) files.push([relative(root, path).replace(/\\/g, '/'), readFileSync(path, 'utf8')]);
}
assert.ok(files.length > 50, 'the scan found the source tree');
const problems = findings(files);
assert.deepEqual(problems, [], 'mis-decoded text:\n' + problems.join('\n'));
console.log(`text encoding: ${files.length} files clean`);
