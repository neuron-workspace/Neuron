// Run: node tools/wikilinks.test.mjs
//
// Wiki-link resolution is pure logic behind a feature that used to do nothing
// at all, and it decides whether a link opens a note, opens the wrong note, or
// is shown as broken. Testing it directly costs a second; testing it only
// through Electron costs two minutes and cannot easily reach the awkward cases.
//
// Module 11D replaced "a shared name resolves to nothing" with Obsidian's
// rules: same folder, then fewest folders, then by path. The old assertion
// that an ambiguous basename stays unresolved is superseded on purpose.
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const out = mkdtempSync(join(tmpdir(), 'neuron-wiki-'));
const file = join(out, 'wikilinks.mjs');
await build({
  stdin: { contents: "export * from './src/renderer/lib/wikilinks'; export * from './src/renderer/lib/link-rewrite';", resolveDir: process.cwd(), loader: 'ts' },
  outfile: file,
  format: 'esm',
  bundle: true,
});
const {
  buildWikiIndex, resolveWikiLink, parseWikiLink, noteAliases, aliasesOf, wikiLinkText, resolveMarkdownLink,
  findLinks, planLinkRewrites, movedPath, linkNotice, relativeHref,
} = await import('file://' + file.replace(/\\/g, '/'));

const NOTES = [
  'Dashboard.mdx',
  'getting-started.mdx',
  'guides/markdown-basics.mdx',
  'projects/Website refresh.mdx',
  'projects/Help centre.mdx',
  'daily/2026-06-19.mdx',
  // Two notes sharing a basename at the same depth.
  'properties/basics.md',
  'guides/basics.md',
];
const index = buildWikiIndex(NOTES);
const at = (target, from) => resolveWikiLink(index, target, from);

// --- exact path, which is what the demo notes document ----------------------
assert.equal(at('guides/markdown-basics'), 'guides/markdown-basics.mdx');
assert.equal(at('Dashboard'), 'Dashboard.mdx');
assert.equal(at('projects/Website refresh'), 'projects/Website refresh.mdx', 'spaces in a path are ordinary');
assert.equal(at('daily/2026-06-19'), 'daily/2026-06-19.mdx');
assert.equal(at('guides/basics.md'), 'guides/basics.md', 'a path with its extension');
assert.equal(at('Dashboard.mdx'), 'Dashboard.mdx', 'a name with its extension');

// --- unique basename --------------------------------------------------------
assert.equal(at('Website refresh'), 'projects/Website refresh.mdx');
assert.equal(at('markdown-basics'), 'guides/markdown-basics.mdx');

// --- several notes of one name: Obsidian's three rules (11D) -----------------
assert.equal(at('basics'), 'guides/basics.md', 'same depth, none here: first by path');
assert.equal(at('basics', 'properties/index.md'), 'properties/basics.md', 'a note in the linking note\'s folder wins');
assert.equal(at('basics', 'guides/other.md'), 'guides/basics.md');
// The full path still names exactly one.
assert.equal(at('guides/basics', 'properties/x.md'), 'guides/basics.md');
assert.equal(at('properties/basics', 'guides/x.md'), 'properties/basics.md');
{
  const meeting = buildWikiIndex(['Meeting Notes.md', 'work/Meeting Notes.md', 'work/deep/Meeting Notes.md', 'b/Plan.md', 'a/Plan.md']);
  assert.equal(resolveWikiLink(meeting, 'Meeting Notes', 'Home.md'), 'Meeting Notes.md', 'from the root: the shortest path');
  assert.equal(resolveWikiLink(meeting, 'Meeting Notes', 'work/Agenda.md'), 'work/Meeting Notes.md', 'same folder');
  assert.equal(resolveWikiLink(meeting, 'Meeting Notes', 'other/x.md'), 'Meeting Notes.md', 'elsewhere: fewest folders');
  assert.equal(resolveWikiLink(meeting, 'Meeting Notes', 'work/deep/x.md'), 'work/deep/Meeting Notes.md');
  assert.equal(resolveWikiLink(meeting, 'Plan', 'c/x.md'), 'a/Plan.md', 'tie: alphabetical by path');
  // Path links resolve only to that path, never by the bare name.
  assert.equal(resolveWikiLink(meeting, 'work/Meeting Notes', 'Home.md'), 'work/Meeting Notes.md');
  assert.equal(resolveWikiLink(meeting, 'deep/Meeting Notes', 'Home.md'), 'work/deep/Meeting Notes.md', 'a unique path suffix');
  assert.equal(resolveWikiLink(meeting, 'nowhere/Meeting Notes', 'Home.md'), null, 'a path that is not there is missing');
  assert.equal(resolveWikiLink(meeting, '/Meeting Notes', 'work/x.md'), 'Meeting Notes.md', 'a leading slash is the root');
  assert.equal(resolveWikiLink(meeting, '/deep/Meeting Notes', 'Home.md'), null, 'from the root only');

  // --- autocomplete: the shortest form that reaches the note from here ------
  assert.equal(wikiLinkText(meeting, 'b/Plan.md', 'b/x.md'), 'Plan', 'resolves here: bare name');
  assert.equal(wikiLinkText(meeting, 'b/Plan.md', 'x.md'), 'b/Plan|Plan', 'a duplicate: shortest unique path, reading as the name');
  assert.equal(wikiLinkText(meeting, 'work/deep/Meeting Notes.md', 'x.md'), 'deep/Meeting Notes|Meeting Notes', 'nested: the shortest suffix');
  assert.equal(wikiLinkText(meeting, 'Meeting Notes.md', 'work/x.md'), '/Meeting Notes|Meeting Notes', 'a root note from a folder that has its own');
  assert.equal(wikiLinkText(meeting, 'Meeting Notes.md', 'x.md'), 'Meeting Notes');
  const unique = buildWikiIndex(['a/b/Only.md']);
  assert.equal(wikiLinkText(unique, 'a/b/Only.md', 'z/q.md'), 'Only', 'unique anywhere: bare');
  for (const [note, from] of [['b/Plan.md', 'x.md'], ['work/deep/Meeting Notes.md', 'x.md'], ['Meeting Notes.md', 'work/x.md'], ['work/Meeting Notes.md', 'work/deep/x.md']]) {
    const text = wikiLinkText(meeting, note, from);
    assert.equal(resolveWikiLink(meeting, parseWikiLink(text).target, from), note, `${text} reaches ${note}`);
  }
}

// --- 11B: names split on either slash ---------------------------------------
{
  const slashed = buildWikiIndex(['folder\\Back Slash.md']);
  assert.equal(resolveWikiLink(slashed, 'Back Slash'), 'folder\\Back Slash.md', 'a backslash separates a name too');
  assert.equal(resolveWikiLink(slashed, 'folder/Back Slash'), 'folder\\Back Slash.md');
  assert.equal(resolveWikiLink(slashed, 'folder\\Back Slash'), 'folder\\Back Slash.md');
}

// --- aliases ------------------------------------------------------------------
assert.deepEqual(noteAliases('---\naliases: [Standup, "Daily sync"]\n---\n# x'), ['Standup', 'Daily sync']);
assert.deepEqual(noteAliases('---\ntitle: x\naliases:\n  - Standup\n  - \'Daily sync\'\ntags: [a]\n---\n'), ['Standup', 'Daily sync']);
assert.deepEqual(noteAliases('---\naliases: Standup\n---\n'), ['Standup'], 'a single string');
assert.deepEqual(noteAliases('---\r\nalias: Single\r\n---\r\n'), ['Single'], 'alias: and CRLF');
assert.deepEqual(noteAliases('aliases: [No frontmatter]\n'), []);
assert.deepEqual(noteAliases('---\ntitle: x\n---\naliases: [Body]\n'), [], 'only inside the frontmatter');
{
  const notes = [
    { path: 'people/Ada Lovelace.md', content: '---\naliases: [Ada, Countess]\n---\n' },
    { path: 'Ada.md', content: '# the real Ada' },
    { path: 'z/Countess.md', content: '---\naliases: Countess\n---\n' },
    { path: 'b/Two.md', content: '---\naliases: [Shared]\n---\n' },
    { path: 'a/One.md', content: '---\naliases: [Shared]\n---\n' },
  ];
  const aliased = buildWikiIndex(notes.map((n) => n.path), aliasesOf(notes));
  assert.equal(resolveWikiLink(aliased, 'Countess'), 'z/Countess.md', 'a real file name beats an alias');
  assert.equal(resolveWikiLink(aliased, 'Ada'), 'Ada.md', 'a file name beats an alias');
  assert.equal(resolveWikiLink(aliased, 'ada lovelace'), 'people/Ada Lovelace.md');
  assert.equal(resolveWikiLink(aliased, 'Shared'), 'a/One.md', 'aliases follow the same tie rules');
  assert.equal(resolveWikiLink(aliased, 'Shared', 'b/x.md'), 'b/Two.md');
  const onlyAlias = buildWikiIndex(['people/Ada Lovelace.md'], aliasesOf(notes));
  assert.equal(resolveWikiLink(onlyAlias, 'Countess'), 'people/Ada Lovelace.md', 'an alias resolves to its note');
}

// --- heading and label --------------------------------------------------------
assert.deepEqual(parseWikiLink('Note#Intro|Read this'), { target: 'Note', heading: '#Intro', label: 'Read this' });
assert.deepEqual(parseWikiLink('Folder/Note|Note'), { target: 'Folder/Note', heading: '', label: 'Note' });
assert.deepEqual(parseWikiLink(' Plain '), { target: 'Plain', heading: '', label: null });

// --- case and whitespace ----------------------------------------------------
assert.equal(at('DASHBOARD'), 'Dashboard.mdx', 'a link should not break on capitalisation');
assert.equal(at('  Dashboard  '), 'Dashboard.mdx', 'surrounding space is trimmed');
assert.equal(at('GUIDES/Markdown-Basics'), 'guides/markdown-basics.mdx');
{
  const unicode = buildWikiIndex(['Notizen/Über uns.md', 'Café.md']);
  assert.equal(resolveWikiLink(unicode, 'über uns'), 'Notizen/Über uns.md');
  assert.equal(resolveWikiLink(unicode, 'Café'), 'Café.md');
}

// --- no match ---------------------------------------------------------------
assert.equal(at('No Such Note'), null);
assert.equal(at(''), null);
assert.equal(at('   '), null);
assert.equal(at('guides/'), null);

// --- hostile targets resolve to nothing, and never to a note ----------------
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
assert.equal(at('toString'), null);
assert.equal(at('hasOwnProperty'), null);

// --- an empty workspace is not an error -------------------------------------
assert.equal(resolveWikiLink(buildWikiIndex([]), 'Anything'), null);

// --- Markdown links: relative to the note, then the root, then by name ------
assert.equal(resolveMarkdownLink(index, 'basics.md', 'guides/x.md'), 'guides/basics.md');
assert.equal(resolveMarkdownLink(index, '../properties/basics.md', 'guides/x.md'), 'properties/basics.md');
assert.equal(resolveMarkdownLink(index, 'projects/Website%20refresh.mdx', 'Dashboard.mdx'), 'projects/Website refresh.mdx');
assert.equal(resolveMarkdownLink(index, 'https://example.com/a.md', 'x.md'), null);

// --- links in code are not links ----------------------------------------------
assert.deepEqual(findLinks('`[[code]]` [[real]]\n```\n[[fenced]] [x](y.md)\n```\n~~~\n[[tilde]]\n~~~\n[a](b.md)').map((l) => l.text), ['real', 'b.md']);
{
  const [wiki, md] = findLinks('see ![[Pic.png]] and [x](<a b.md#top>)');
  assert.equal(wiki.embed, true);
  assert.equal(md.text, 'a b.md#top');
  assert.equal(md.angled, true);
}

// --- 11D.4: a new duplicate name keeps existing links where they were --------
{
  const notes = [
    { path: 'Meeting Notes.md', content: '# Root meeting' },
    { path: 'work/Plan.md', content: [
      '[[Meeting Notes]] and [[Meeting Notes#Agenda|the agenda]] and ![[Meeting Notes]]',
      '`[[Meeting Notes]]` stays in code',
      '```', '[[Meeting Notes]]', '```',
      '[[/Meeting Notes]] [[work/Other]] path links stay',
    ].join('\n') },
    { path: 'Home.md', content: '[[Meeting Notes]] from the root still reaches the root one' },
    { path: 'other/Elsewhere.md', content: '[[Meeting Notes]] fewest folders: still the root one' },
    { path: 'work/Other.md', content: 'no links' },
  ];
  const files = notes.map((n) => n.path);
  const before = buildWikiIndex(files);
  const after = buildWikiIndex([...files, 'work/Meeting Notes.md']);
  const plan = planLinkRewrites({ notes, before, after });
  assert.equal(plan.count, 3, 'exactly the links whose target would change');
  assert.deepEqual(plan.edits.map((e) => e.path), ['work/Plan.md'], 'other notes are left alone');
  assert.deepEqual(plan.targets, ['Meeting Notes.md']);
  assert.equal(plan.edits[0].content, [
    '[[/Meeting Notes|Meeting Notes]] and [[/Meeting Notes#Agenda|the agenda]] and ![[/Meeting Notes|Meeting Notes]]',
    '`[[Meeting Notes]]` stays in code',
    '```', '[[Meeting Notes]]', '```',
    '[[/Meeting Notes]] [[work/Other]] path links stay',
  ].join('\n'));
  for (const edit of plan.edits) {
    for (const link of findLinks(edit.content).filter((l) => l.kind === 'wiki')) {
      const target = resolveWikiLink(after, parseWikiLink(link.text).target, edit.path);
      if (target) assert.notEqual(target, 'work/Meeting Notes.md', `${link.text} still reaches the original`);
    }
  }
  assert.equal(linkNotice(plan.count, plan.targets[0]), 'Updated 3 links so they still point to Meeting Notes.');
  assert.equal(linkNotice(1, 'a/b.md'), 'Updated 1 link so they still point to a/b.');
  // A folder original: the path form names its folder.
  const nested = [{ path: 'archive/Spec.md', content: '' }, { path: 'team/Notes.md', content: 'see [[Spec]]' }];
  const nestedPlan = planLinkRewrites({ notes: nested, before: buildWikiIndex(nested.map((n) => n.path)), after: buildWikiIndex([...nested.map((n) => n.path), 'team/Spec.md']) });
  assert.equal(nestedPlan.edits[0].content, 'see [[archive/Spec|Spec]]');
  // No duplicate, nothing to do.
  assert.equal(planLinkRewrites({ notes, before, after: buildWikiIndex([...files, 'work/New.md']) }).count, 0);
}

// --- 11E: a rename or move rewrites wiki and Markdown links -----------------
assert.equal(movedPath('a/b.md', 'a/b.md', 'c/b.md'), 'c/b.md');
assert.equal(movedPath('a/b/c.md', 'a/b', 'x/b'), 'x/b/c.md');
assert.equal(movedPath('a/bc.md', 'a/b', 'x/b'), null, 'a name that only starts the same is not inside');
assert.equal(relativeHref('a/b/note.md', 'a/c/target.md'), '../c/target.md');
assert.equal(relativeHref('note.md', 'x/y.md'), 'x/y.md');
{
  const notes = [
    { path: 'Old Name.md', content: '# Old' },
    { path: 'Index.md', content: '[[Old Name]] [[Old Name|label kept]] [[Old Name#Part]] [t](Old%20Name.md#part) [u](<Old Name.md>) `[[Old Name]]`' },
    { path: 'docs/Guide.md', content: '[[Old Name]] [g](../Old%20Name.md) [[Unrelated]] [s](Sibling.md)' },
    { path: 'docs/Sibling.md', content: '[back](Guide.md) [[Index]] [root](../Index.md)' },
    { path: 'Unrelated.md', content: '' },
  ];
  const files = notes.map((n) => n.path);
  // A file rename.
  const rename = (path) => movedPath(path, 'Old Name.md', 'New Name.md');
  const plan = planLinkRewrites({ notes, before: buildWikiIndex(files), after: buildWikiIndex(files.map((p) => rename(p) ?? p)), move: rename });
  const byPath = Object.fromEntries(plan.edits.map((e) => [e.path, e.content]));
  assert.equal(byPath['Index.md'], '[[New Name]] [[New Name|label kept]] [[New Name#Part]] [t](New%20Name.md#part) [u](<New Name.md>) `[[Old Name]]`');
  assert.equal(byPath['docs/Guide.md'], '[[New Name]] [g](../New%20Name.md) [[Unrelated]] [s](Sibling.md)');
  assert.equal(plan.count, 7);
  assert.equal(byPath['docs/Sibling.md'], undefined, 'notes with no link to it are untouched');
  // A folder move: notes inside keep their links to each other, links out are fixed.
  const move = (path) => movedPath(path, 'docs', 'archive/docs');
  const folderPlan = planLinkRewrites({ notes, before: buildWikiIndex(files), after: buildWikiIndex(files.map((p) => move(p) ?? p)), move });
  const moved = Object.fromEntries(folderPlan.edits.map((e) => [e.path, e.content]));
  assert.equal(moved['archive/docs/Sibling.md'], '[back](Guide.md) [[Index]] [root](../../Index.md)');
  assert.equal(moved['archive/docs/Guide.md'], '[[Old Name]] [g](../../Old%20Name.md) [[Unrelated]] [s](Sibling.md)');
  assert.equal(moved['Index.md'], undefined);
  // Moving next to a same-named note: a bare link from there keeps its target.
  const clash = [{ path: 'Spec.md', content: '' }, { path: 'team/Notes.md', content: '[[Spec]]' }, { path: 'drafts/Spec.md', content: '' }];
  const toTeam = (path) => movedPath(path, 'drafts/Spec.md', 'team/Spec.md');
  const clashPlan = planLinkRewrites({ notes: clash, before: buildWikiIndex(clash.map((n) => n.path)), after: buildWikiIndex(clash.map((n) => toTeam(n.path) ?? n.path)), move: toTeam });
  assert.equal(clashPlan.edits[0].content, '[[/Spec|Spec]]');
}

rmSync(out, { recursive: true, force: true });
console.log(`wikilinks: resolution, aliases, autocomplete text and link rewrites verified`);
