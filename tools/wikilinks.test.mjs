// Run: node tools/wikilinks.test.mjs
//
// Wiki-link resolution is pure logic behind a feature that used to do nothing
// at all, and it decides whether a link opens a note, opens the wrong note, or
// is shown as broken. Testing it directly costs a second; testing it only
// through Electron costs two minutes and cannot easily reach the awkward cases.
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const out = mkdtempSync(join(tmpdir(), 'neuron-wiki-'));
const file = join(out, 'wikilinks.mjs');
await build({
  entryPoints: ['src/renderer/lib/wikilinks.ts'],
  outfile: file,
  format: 'esm',
  bundle: true,
});
const { buildWikiIndex, resolveWikiLink } = await import('file://' + file.replace(/\\/g, '/'));

const NOTES = [
  'Dashboard.mdx',
  'getting-started.mdx',
  'guides/markdown-basics.mdx',
  'projects/Website refresh.mdx',
  'projects/Help centre.mdx',
  'daily/2026-06-19.mdx',
  // Two notes sharing a basename, on purpose: this is the ambiguous case.
  'properties/basics.md',
  'guides/basics.md',
];
const index = buildWikiIndex(NOTES);
const at = (target) => resolveWikiLink(index, target);

// --- exact path, which is what the demo notes document ----------------------
assert.equal(at('guides/markdown-basics'), 'guides/markdown-basics.mdx');
assert.equal(at('Dashboard'), 'Dashboard.mdx');
assert.equal(at('projects/Website refresh'), 'projects/Website refresh.mdx', 'spaces in a path are ordinary');
assert.equal(at('daily/2026-06-19'), 'daily/2026-06-19.mdx');

// --- unique basename --------------------------------------------------------
assert.equal(at('Website refresh'), 'projects/Website refresh.mdx');
assert.equal(at('markdown-basics'), 'guides/markdown-basics.mdx');

// --- ambiguity resolves to nothing, rather than to whichever came first -----
assert.equal(at('basics'), null, 'two notes share this basename');
// The full path still works, because it is not ambiguous.
assert.equal(at('guides/basics'), 'guides/basics.md');
assert.equal(at('properties/basics'), 'properties/basics.md');

// --- case and whitespace ----------------------------------------------------
assert.equal(at('DASHBOARD'), 'Dashboard.mdx', 'a link should not break on capitalisation');
assert.equal(at('  Dashboard  '), 'Dashboard.mdx', 'surrounding space is trimmed');
assert.equal(at('GUIDES/Markdown-Basics'), 'guides/markdown-basics.mdx');

// --- no match ---------------------------------------------------------------
assert.equal(at('No Such Note'), null);
assert.equal(at(''), null);
assert.equal(at('   '), null);
assert.equal(at('guides/'), null);

// --- hostile targets resolve to nothing, and never to a note ----------------
// A note is untrusted content. None of these name a real note, so each must
// come back null -- the renderer shows a missing link and nothing reaches the
// DOM as markup.
for (const nasty of [
  '<script>alert(1)</script>',
  '"><img src=x onerror=alert(1)>',
  '../../../../etc/passwd',
  'javascript:alert(1)',
  '__proto__',
  'constructor',
]) {
  assert.equal(at(nasty), null, `hostile target resolved: ${nasty}`);
}

// A prototype-polluting key must not resolve through Map's own prototype
// either, which is the reason the index is a Map and not a plain object.
assert.equal(at('toString'), null);
assert.equal(at('hasOwnProperty'), null);

// --- an empty workspace is not an error -------------------------------------
assert.equal(resolveWikiLink(buildWikiIndex([]), 'Anything'), null);

rmSync(out, { recursive: true, force: true });
console.log(`wikilinks: resolution verified over ${NOTES.length} notes`);
