// Run: node tools/demo-data.test.mjs
//
// The demo workspace is the first thing anyone sees, and its two dashboards
// read the same Planner.db -- one computing from it, one quoting it by hand.
// Hand-typed numbers drift. This suite is what stops the demo quietly becoming
// wrong: it has already caught every open task being due in September, which
// made both dashboards render zero overdue and zero due-this-week, the two
// numbers they exist to show.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const repo = join(dirname(dirname(fileURLToPath(import.meta.url))), 'examples', 'demo-repo');
const db = JSON.parse(readFileSync(join(repo, 'Planner.db'), 'utf-8'));
const mdx = readFileSync(join(repo, 'Dashboard.mdx'), 'utf-8');

// --- the database is well formed --------------------------------------------
assert.equal(db.version, 2);
const tasks = db.tables.tasks;
const projects = db.tables.projects;

for (const [id, table] of Object.entries(db.tables)) {
  const ids = table.rows.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length, `${id}: row ids must be unique`);
  // Cells live under `values`. A row written at the root is valid JSON and
  // renders as a table of correct headers over entirely blank cells.
  for (const row of table.rows) {
    assert.ok(row.values && typeof row.values === 'object' && !Array.isArray(row.values),
      `${id}/${row.id}: cells must be nested under "values"`);
  }
  // A select value outside its own options list renders as a raw string.
  for (const [key, prop] of Object.entries(table.schema.properties)) {
    if (!prop.options) continue;
    const allowed = new Set(prop.options.map((o) => o.id));
    for (const row of table.rows) {
      const v = row.values[key];
      if (v === undefined || v === '') continue;
      assert.ok(allowed.has(v), `${id}/${row.id}: ${key}="${v}" is not one of its options`);
    }
  }
}

// --- the data says something ------------------------------------------------
// Dates are fixed rather than relative: this is a demo workspace on disk, not a
// generator. The point of the assertions is that the spread still straddles the
// date the numbers were written against, so the dashboards have work to show.
const TODAY = '2026-08-24';
const WEEK = '2026-08-31';
const rows = tasks.rows.map((r) => r.values);
const open = rows.filter((t) => t.status !== 'done');

const counts = {
  Open: open.length,
  Overdue: open.filter((t) => t.due && t.due < TODAY).length,
  'Due this week': open.filter((t) => t.due >= TODAY && t.due <= WEEK).length,
  Blocked: open.filter((t) => t.status === 'blocked').length,
  Done: rows.length - open.length,
};

assert.ok(counts.Overdue >= 2, 'the demo needs overdue work, or the overdue panel shows nothing');
assert.ok(counts['Due this week'] >= 3, 'the demo needs work due this week');
assert.ok(counts.Blocked >= 1, 'the demo needs a blocked task');
assert.ok(counts.Done >= 3, 'the demo needs a done column');
assert.ok(projects.rows.length >= 5, 'the workload panel needs several projects to rank');

// A completed task due in the future, or an open task on an archived project,
// is a data bug that reads as a rendering bug.
for (const t of rows) {
  if (t.status === 'done') assert.ok(!t.due || t.due <= TODAY, `"${t.title}" is done but due in the future`);
  if (t.status === 'blocked') assert.ok(t.blocker, `"${t.title}" is blocked with no reason given`);
}
const known = new Set(projects.rows.map((p) => p.values.name));
const archived = new Set(projects.rows.filter((p) => p.values.status === 'archived').map((p) => p.values.name));
for (const t of rows) {
  if (t.project) assert.ok(known.has(t.project), `"${t.title}" belongs to unknown project "${t.project}"`);
  if (t.status !== 'done') assert.ok(!archived.has(t.project), `"${t.title}" is open on an archived project`);
}

// --- the MDX dashboard tells the truth --------------------------------------
// Its <Stat> values are typed by hand, sitting inches above a live DbView of
// the same table. A number that contradicts the table below it is worse than
// no number at all.
let checked = 0;
for (const [label, expected] of Object.entries(counts)) {
  const found = mdx.match(new RegExp(`label="${label}"\\s+value="(\\d+)"`));
  assert.ok(found, `Dashboard.mdx has no <Stat label="${label}">`);
  assert.equal(Number(found[1]), expected,
    `Dashboard.mdx says ${label}=${found[1]}, Planner.db says ${expected}`);
  checked++;
}

console.log(`demo-data: ${rows.length} tasks, ${projects.rows.length} projects, ${checked} hand-typed stats match`);
