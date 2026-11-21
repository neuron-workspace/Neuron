// Workspace templates: what is offered, and what gets copied.
//
// This guards a first-run path that is easy to get wrong and hard to notice.
// Neuron used to adopt the bundled demo folder as the active workspace, which
// meant the app wrote into its own installation directory — Program Files for a
// packaged build, the git checkout for a developer, where every note edit
// appeared as a change to the repository. Templates are copied out instead, so
// the bundled originals stay read-only and the user's notes are their own.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listTemplates, copyTemplate, hasNotes, templatesRoot } from '../dist/main/templates.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let checks = 0;
const check = (what, fn) => { fn(); checks += 1; console.log(`  ok  ${what}`); };

const scratch = mkdtempSync(join(tmpdir(), 'neuron-templates-'));
try {
  // --- a fixture that looks like the real examples directory ---------------
  const store = join(scratch, 'examples');
  mkdirSync(join(store, 'demo-repo', 'guides'), { recursive: true });
  writeFileSync(join(store, 'demo-repo', 'README.md'), '# Demo\n');
  writeFileSync(join(store, 'demo-repo', 'guides', 'one.mdx'), '# One\n');
  writeFileSync(join(store, 'demo-repo', 'template.json'),
    JSON.stringify({ name: 'Guided tour', description: 'A worked workspace' }));

  mkdirSync(join(store, 'research-vault'), { recursive: true });
  writeFileSync(join(store, 'research-vault', 'sources.md'), '# Sources\n');

  mkdirSync(join(store, '.hidden'), { recursive: true });

  check('every folder is a template, and nothing else has to be registered', () => {
    const found = listTemplates(store);
    assert.deepEqual(found.map((t) => t.id), ['demo-repo', 'research-vault']);
  });

  check('a template.json names and describes it', () => {
    const demo = listTemplates(store).find((t) => t.id === 'demo-repo');
    assert.equal(demo.name, 'Guided tour');
    assert.equal(demo.description, 'A worked workspace');
  });

  check('a template without one still works, titled from its folder', () => {
    const vault = listTemplates(store).find((t) => t.id === 'research-vault');
    assert.equal(vault.name, 'Research Vault');
    assert.equal(vault.description, '');
  });

  check('dot-folders are not offered as templates', () => {
    assert.ok(!listTemplates(store).some((t) => t.id === '.hidden'));
  });

  check('notes are counted, recursively', () => {
    const demo = listTemplates(store).find((t) => t.id === 'demo-repo');
    assert.equal(demo.noteCount, 2, 'README.md and guides/one.mdx');
  });

  check('a missing templates directory is empty, not an error', () => {
    assert.deepEqual(listTemplates(join(scratch, 'nope')), []);
  });

  // --- copying -------------------------------------------------------------
  const dest = join(scratch, 'my-notes');
  check('copying reproduces the tree', () => {
    copyTemplate(join(store, 'demo-repo'), dest);
    assert.ok(existsSync(join(dest, 'README.md')));
    assert.ok(existsSync(join(dest, 'guides', 'one.mdx')));
    assert.equal(readFileSync(join(dest, 'README.md'), 'utf-8'), '# Demo\n');
  });

  check('template.json is left behind', () => {
    assert.ok(!existsSync(join(dest, 'template.json')),
      'it describes the template, not the workspace made from it');
  });

  check('the original is untouched', () => {
    assert.ok(existsSync(join(store, 'demo-repo', 'template.json')));
    assert.equal(readdirSync(join(store, 'demo-repo')).length, 3);
  });

  // --- the guard that stops a template landing on someone's notes ----------
  check('a folder holding notes is refused', () => {
    assert.equal(hasNotes(dest), true, 'the copy we just made counts as notes');
  });

  check('an empty folder is not', () => {
    const empty = join(scratch, 'empty');
    mkdirSync(empty, { recursive: true });
    assert.equal(hasNotes(empty), false);
  });

  check('a folder of unrelated files is not', () => {
    const other = join(scratch, 'photos');
    mkdirSync(other, { recursive: true });
    writeFileSync(join(other, 'holiday.jpg'), 'x');
    assert.equal(hasNotes(other), false, 'only note-shaped files should block a template');
  });

  // --- where templates are looked for --------------------------------------
  check('packaged and unpackaged look in different places', () => {
    assert.match(templatesRoot(true, '/res'), /res[/\\]examples$/);
    assert.match(templatesRoot(false, '/res'), /examples$/);
    assert.notEqual(templatesRoot(true, '/res'), templatesRoot(false, '/res'));
  });

  // --- the shipped template really is one ----------------------------------
  check('the bundled demo workspace is a valid template', () => {
    const shipped = listTemplates(join(root, 'examples'));
    const demo = shipped.find((t) => t.id === 'demo-repo');
    assert.ok(demo, 'examples/demo-repo should be offered as a template');
    assert.ok(demo.name && demo.description, 'it should describe itself in template.json');
    assert.ok(demo.noteCount > 0, 'it should contain notes');
  });
  check('a newly copied demo shifts dates together, including dated note links and filenames', () => {
    const demo = join(store, 'demo-repo');
    const database = '{"schema":{"order":["due"],"properties":{"due":{"name":"Due","type":"date"}}},"rows":[{"id":"one","values":{"due":"2020-02-29"}}]}\n';
    const note = '# Dates\r\n2020-02-28 to 2020-02-29; [[guides/2020-02-28]]\r\nUntouched: café, 2020-02-31, v1.2.3\r\n';
    writeFileSync(join(demo, 'Planner.db'), database);
    writeFileSync(join(demo, 'dates.mdx'), note);
    writeFileSync(join(demo, 'guides', '2020-02-28.md'), '2020-02-28\n');
    writeFileSync(join(demo, 'asset.txt'), '2020-02-29 remains literal\n');
    const out = join(scratch, 'dated-demo');
    copyTemplate(demo, out, new Date(2026, 10, 21, 23, 59));
    assert.equal(JSON.parse(readFileSync(join(out, 'Planner.db'), 'utf8')).rows[0].values.due, '2026-11-28', 'latest due is seven local calendar days from creation');
    assert.equal(readFileSync(join(out, 'dates.mdx'), 'utf8'), note.replaceAll('2020-02-28', '2026-11-27').replaceAll('2020-02-29', '2026-11-28'));
    assert.equal(readFileSync(join(out, 'guides', '2026-11-27.md'), 'utf8'), '2026-11-27\n');
    assert.equal(readFileSync(join(out, 'asset.txt'), 'utf8'), '2020-02-29 remains literal\n');
    assert.equal(readFileSync(join(demo, 'Planner.db'), 'utf8'), database);
    assert.equal(readFileSync(join(demo, 'dates.mdx'), 'utf8'), note);
  });
  check('other templates keep their authored dates', () => {
    const source = join(store, 'research-vault');
    writeFileSync(join(source, 'sources.md'), '2020-02-29\n');
    const out = join(scratch, 'unchanged-dates');
    copyTemplate(source, out, new Date(2026, 10, 21));
    assert.equal(readFileSync(join(out, 'sources.md'), 'utf8'), '2020-02-29\n');
  });
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

console.log(`\ntemplates: ${checks} checks passed`);
