// Workspace search: what matches, what ranks first, and what it shows you.
//
// Search was `notes.filter((n) => n.includes(query))` over paths alone, so a
// word you knew you had written was unfindable unless it was in the filename.
// These cases are the behaviour that replaced it.
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

// Same approach as tools/wikilinks.test.mjs: bundle the one module under test
// rather than standing up Vite or shipping a second build output.
const out = mkdtempSync(join(tmpdir(), 'neuron-search-'));
const file = join(out, 'search.mjs');
await build({
  entryPoints: ['src/renderer/lib/search.ts'],
  outfile: file,
  format: 'esm',
  bundle: true,
});
const { searchNotes, searchPaths } = await import('file://' + file.replace(/\\/g, '/'));

const NOTES = [
  { path: 'guides/markdown-basics.mdx', content: '# Markdown basics\n\nUse **bold** and _italic_.\nTables are supported.\n' },
  { path: 'projects/Website refresh.mdx', content: '# Website refresh\n\nThe website needs a new palette.\nwebsite website website website website website website\n' },
  { path: 'daily/2026-08-01.md', content: '# Monday\n\nSpoke to Priya about the website.\nReviewed the markdown guide.\n' },
  { path: 'README.md', content: '# Neuron\n\nA local-first workspace.\n' },
  { path: 'archive/old notes.md', content: 'Nothing of interest here.\n' },
];

let checks = 0;
const check = (what, fn) => { fn(); checks += 1; console.log(`  ok  ${what}`); };

check('an empty query matches nothing, so the caller can show everything', () => {
  assert.deepEqual(searchNotes(NOTES, ''), []);
  assert.deepEqual(searchNotes(NOTES, '   '), []);
});

check('it searches note bodies, not only filenames', () => {
  const paths = searchPaths(NOTES, 'priya');
  assert.deepEqual(paths, ['daily/2026-08-01.md'],
    'the word appears only inside a note, and that note has an unrelated name');
});

check('it still matches filenames', () => {
  assert.ok(searchPaths(NOTES, 'readme').includes('README.md'));
});

check('matching is case-insensitive on both sides', () => {
  assert.deepEqual(searchPaths(NOTES, 'PRIYA'), searchPaths(NOTES, 'priya'));
  assert.ok(searchPaths(NOTES, 'monday').includes('daily/2026-08-01.md'));
});

check('several terms narrow the result rather than widening it', () => {
  const one = searchPaths(NOTES, 'website');
  const two = searchPaths(NOTES, 'website priya');
  assert.ok(one.length > two.length, 'adding a word must not return more');
  assert.deepEqual(two, ['daily/2026-08-01.md'], 'only the note containing both');
});

check('a term may match the name while another matches the body', () => {
  // "refresh" is in the filename, "palette" only in the text.
  assert.deepEqual(searchPaths(NOTES, 'refresh palette'), ['projects/Website refresh.mdx']);
});

check('a name match outranks a body match', () => {
  const hits = searchNotes(NOTES, 'website');
  assert.equal(hits[0].path, 'projects/Website refresh.mdx');
  assert.ok(hits[0].titleMatch, 'and it says the name matched');
  const daily = hits.find((h) => h.path === 'daily/2026-08-01.md');
  assert.equal(daily.titleMatch, false, 'a body-only hit is not a title match');
  assert.ok(hits[0].score > daily.score);
});

check('repeating a word does not let a note outrank a real title match', () => {
  // "Website refresh" says website seven times; the cap is what stops sheer
  // repetition beating relevance.
  const hits = searchNotes(NOTES, 'markdown');
  assert.equal(hits[0].path, 'guides/markdown-basics.mdx',
    'the note named for it should come first');
});

check('a folder name is searchable', () => {
  assert.ok(searchPaths(NOTES, 'daily').includes('daily/2026-08-01.md'));
});

check('no match returns nothing rather than everything', () => {
  assert.deepEqual(searchNotes(NOTES, 'kubernetes'), []);
});

check('snippets carry the line number and the text', () => {
  const [hit] = searchNotes(NOTES, 'priya');
  assert.equal(hit.matches.length, 1);
  assert.equal(hit.matches[0].line, 3, '1-based, as a person would count');
  assert.equal(hit.matches[0].text, 'Spoke to Priya about the website.');
});

check('snippets are capped', () => {
  const [hit] = searchNotes(NOTES, 'website', { snippets: 2 });
  assert.ok(hit.matches.length <= 2);
});

check('the result count is capped', () => {
  assert.equal(searchNotes(NOTES, 'e', { limit: 2 }).length, 2);
});

check('ordering is stable when scores tie', () => {
  const tied = [
    { path: 'b.md', content: 'alpha\n' },
    { path: 'a.md', content: 'alpha\n' },
  ];
  assert.deepEqual(searchPaths(tied, 'alpha'), ['a.md', 'b.md'],
    'ties break on path, so results do not reshuffle between renders');
});

check('regular-expression characters are treated as text', () => {
  const notes = [{ path: 'code.md', content: 'call foo(bar) and a[0] then .*\n' }];
  assert.deepEqual(searchPaths(notes, 'foo(bar)'), ['code.md']);
  assert.deepEqual(searchPaths(notes, '.*'), ['code.md']);
  assert.deepEqual(searchPaths(notes, 'a[0]'), ['code.md']);
});

check('an empty workspace is not an error', () => {
  assert.deepEqual(searchNotes([], 'anything'), []);
});

check('a note with no content is not an error', () => {
  const notes = [{ path: 'empty.md', content: '' }];
  assert.deepEqual(searchPaths(notes, 'empty'), ['empty.md'], 'the name still matches');
  assert.deepEqual(searchPaths(notes, 'nothing'), []);
});

// --- Module 11 ---------------------------------------------------------------

check('every term must match: one missing term drops the note', () => {
  const notes = [{ path: 'a.md', content: 'red green\n' }, { path: 'b.md', content: 'red\n' }, { path: 'c.md', content: 'green blue\n' }];
  assert.deepEqual(searchPaths(notes, 'red green'), ['a.md']);
  assert.deepEqual(searchPaths(notes, 'green red'), ['a.md'], 'in any order');
  assert.deepEqual(searchPaths(notes, 'red purple'), []);
});

check('scoring order: exact name, then name, then path, then a heading, then the text', () => {
  const notes = [
    { path: 'z/body.md', content: 'about the comet\n' },
    { path: 'z/heading.md', content: '# Comet\n' },
    { path: 'comet/notes.md', content: '' },
    { path: 'z/comet sightings.md', content: '' },
    { path: 'z/comet.md', content: '' },
  ];
  assert.deepEqual(searchPaths(notes, 'comet'), ['z/comet.md', 'z/comet sightings.md', 'comet/notes.md', 'z/heading.md', 'z/body.md']);
});

check('each tier beats the one below at its fullest: the text is capped and a heading counts once', () => {
  const many = 'comet '.repeat(50);
  const notes = [
    { path: 'z/body.md', content: `${many}\n${many}\n` },
    { path: 'z/heading.md', content: '# Comet\n' },
    { path: 'z/headings.md', content: `# Comet\n## Comet again\n${many}\n` },
    { path: 'comet/plain.md', content: '' },
    { path: 'z/comet sightings.md', content: '' },
  ];
  const order = searchPaths(notes, 'comet');
  assert.ok(order.indexOf('z/heading.md') < order.indexOf('z/body.md'), 'one heading beats any amount of text');
  assert.ok(order.indexOf('comet/plain.md') < order.indexOf('z/headings.md'), 'a folder match beats headings and text together');
  assert.equal(order[0], 'z/comet sightings.md', 'a name match beats all of them');
});

check('ties are broken by path', () => {
  const notes = [{ path: 'm/b.md', content: 'x\n' }, { path: 'a/z.md', content: 'x\n' }, { path: 'm/a.md', content: 'x\n' }];
  assert.deepEqual(searchPaths(notes, 'x'), ['a/z.md', 'm/a.md', 'm/b.md']);
});

check('snippets are the matching lines, 1-based, in order, three by default', () => {
  const [hit] = searchNotes([{ path: 'n.md', content: 'one\nkiwi two\nthree\nKIWI four\r\nkiwi five\nkiwi six\n' }], 'kiwi');
  assert.deepEqual(hit.matches, [{ line: 2, text: 'kiwi two' }, { line: 4, text: 'KIWI four' }, { line: 5, text: 'kiwi five' }]);
});

check('case: either side may be upper case, accented letters included (pinned)', () => {
  const notes = [{ path: 'n.md', content: 'Un café à Montréal\n' }];
  assert.deepEqual(searchPaths(notes, 'CAFÉ'), ['n.md']);
  assert.deepEqual(searchPaths(notes, 'montréal'), ['n.md']);
  assert.deepEqual(searchPaths([{ path: 'É.md', content: '' }], 'é'), ['É.md']);
});

check('accents: an unaccented letter does not match an accented one (pinned)', () => {
  const notes = [{ path: 'n.md', content: 'Un café à Montréal\n' }];
  assert.deepEqual(searchPaths(notes, 'cafe'), []);
  assert.deepEqual(searchPaths(notes, 'montreal'), []);
});

check('a note over 25 MB never appears, by its name or its text', () => {
  const tooLarge = 'Error: This file is too large to open in Neuron (over 25 MB).';
  const notes = [{ path: 'huge.md', content: tooLarge }, { path: 'small.md', content: 'large note\n' }];
  assert.deepEqual(searchPaths(notes, 'huge'), []);
  assert.deepEqual(searchPaths(notes, 'large'), ['small.md'], 'and the refusal is not searched as text');
});

check('text files are found by their text, with line numbers', () => {
  const files = [
    { path: 'config/settings.json', content: '{\n  "quokkaKey": true\n}\n' },
    { path: 'logs/run.log', content: 'started\nquokka seen\n' },
  ];
  const hits = searchNotes(files, 'quokka');
  assert.deepEqual(hits.map((h) => h.path), ['config/settings.json', 'logs/run.log']);
  assert.deepEqual(hits[0].matches, [{ line: 2, text: '"quokkaKey": true' }]);
  assert.equal(hits[0].truncated, undefined);
});

check('a text file read only in part says so in its hit', () => {
  const [hit] = searchNotes([{ path: 'big.log', content: 'headword\n', truncated: true }], 'headword');
  assert.equal(hit.truncated, true);
  assert.deepEqual(searchNotes([{ path: 'big.log', content: 'headword\n', truncated: true }], 'tailword'), []);
});

console.log(`\nsearch: ${checks} checks passed`);

rmSync(out, { recursive: true, force: true });
