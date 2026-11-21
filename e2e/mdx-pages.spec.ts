import { test, expect, openNote } from './fixtures';
import type { Page } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Pages built in MDX: full width, columns, and the data blocks (Stat, Chart,
// Form, editable DbView) that read and write a workspace's tables.

const status = [{ id: 'todo', name: 'Todo', color: '#8b8b8b' }, { id: 'doing', name: 'Doing', color: '#528fd1' }, { id: 'done', name: 'Done', color: '#5aa06c' }];
const priority = [{ id: 'low', name: 'Low', color: '#8b8b8b' }, { id: 'high', name: 'High', color: '#c0705f' }];
function database(rows: { id: string; values: Record<string, unknown> }[]) {
  return JSON.stringify({
    version: 2,
    tables: {
      tasks: {
        name: 'Tasks',
        schema: {
          order: ['title', 'status', 'priority', 'done', 'hours'],
          properties: {
            title: { name: 'Task', type: 'text' }, status: { name: 'Status', type: 'select', options: status },
            priority: { name: 'Priority', type: 'select', options: priority }, done: { name: 'Done', type: 'checkbox' },
            hours: { name: 'Hours', type: 'number' },
          },
        },
        rows,
      },
    },
  }, null, 2) + '\n';
}
const ROWS = [
  { id: 'r1', values: { title: 'Write', status: 'todo', priority: 'low', done: false, hours: 2 } },
  { id: 'r2', values: { title: 'Review', status: 'doing', priority: 'high', done: false, hours: 3 } },
  { id: 'r3', values: { title: 'Ship', status: 'done', priority: 'high', done: true, hours: 5 } },
];

async function open(page: Page, workspace: string, name: string, lines: string[]) {
  writeFileSync(join(workspace, 'pages.db'), database(ROWS));
  writeFileSync(join(workspace, name), lines.join('\n') + '\n');
  await page.getByRole('button', { name: 'Refresh explorer' }).click();
  await openNote(page, name);
}
const read = (workspace: string, name: string) => readFileSync(join(workspace, name), 'utf8');
const db = (workspace: string) => JSON.parse(read(workspace, 'pages.db')).tables.tasks.rows as { id: string; values: Record<string, unknown> }[];

test.beforeEach(async ({ app }) => {
  // Wide enough that full width is wider than the reading measure.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1500, 1000));
});

test('the full width toggle writes the property and widens the page', async ({ page, workspace }) => {
  await open(page, workspace, 'pages-width.mdx', ['---', 'title: Width', '---', '# Width', '', 'Some text.']);
  const article = page.locator('article.preview-prose');
  const narrow = (await article.boundingBox())!.width;
  const toggle = page.getByRole('button', { name: 'Full width', exact: true });
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await toggle.click();
  await expect.poll(() => read(workspace, 'pages-width.mdx')).toContain('fullWidth: true');
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-full-width]')).toHaveCount(1);
  // Full width fills the scroll container's content box (its client width minus
  // horizontal padding), whatever the window size.
  const container = page.locator('[data-full-width]');
  const content = () => container.evaluate((el) => {
    const style = getComputedStyle(el);
    return el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  });
  await expect.poll(async () => Math.abs((await article.boundingBox())!.width - (await content()))).toBeLessThan(4);
  expect((await article.boundingBox())!.width).toBeGreaterThan(narrow);
  expect(read(workspace, 'pages-width.mdx')).toContain('title: Width');

  await toggle.click();
  await expect.poll(() => read(workspace, 'pages-width.mdx')).not.toContain('fullWidth');
  await expect(page.locator('[data-full-width]')).toHaveCount(0);
});

test('dragging a column divider writes widths that sum to 100', async ({ page, workspace }) => {
  await open(page, workspace, 'pages-columns.mdx', [
    '---', 'fullWidth: true', '---', '<Columns>', '<Column>', '', 'Left side', '', '</Column>', '<Column>', '', 'Right side', '', '</Column>', '</Columns>',
  ]);
  const columns = page.locator('[data-column]');
  await expect(columns).toHaveCount(2);
  const left = (await columns.nth(0).boundingBox())!.width;
  expect(Math.abs(left - (await columns.nth(1).boundingBox())!.width)).toBeLessThan(2);
  // Reading has no handle; Live does.
  await expect(page.getByRole('separator', { name: /Resize columns/ })).toHaveCount(0);

  await page.getByRole('button', { name: 'Live', exact: true }).first().click();
  const handle = page.getByRole('separator', { name: 'Resize columns 1 and 2' });
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();

  await expect.poll(() => [...read(workspace, 'pages-columns.mdx').matchAll(/width="(\d+)%"/g)].length).toBe(2);
  const widths = [...read(workspace, 'pages-columns.mdx').matchAll(/width="(\d+)%"/g)].map((m) => Number(m[1]));
  expect(widths[0] + widths[1]).toBe(100);
  expect(widths[0]).toBeGreaterThan(55);
  await expect.poll(async () => (await page.locator('[data-column]').nth(0).boundingBox())!.width).toBeGreaterThan(left + 60);
});

const movingColumns = [
  '<Column width="40%">\n### First\n<Callout title="Keep this">\n- Nested content\n</Callout>\n</Column>',
  '<Column>\n### Second\nMiddle content\n</Column>',
  '<Column width="20%">\n### Third\nLast content\n</Column>',
];
const movingPage = (columns: string[]) => ['---', 'fullWidth: true', '---', '<Columns>', ...columns, '</Columns>'];
const movedPage = () => movingPage([movingColumns[1], movingColumns[2], movingColumns[0]]).join('\n') + '\n';

test('keyboard moves the first column to the end and keeps focus on it', async ({ page, workspace }) => {
  const name = 'pages-column-keyboard.mdx';
  await open(page, workspace, name, movingPage(movingColumns));
  await expect(page.getByRole('button', { name: 'Move column', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Live', exact: true }).first().click();
  const handles = page.getByRole('button', { name: 'Move column', exact: true });
  await expect(handles).toHaveCount(3);
  await handles.first().focus();
  await expect(handles.first()).toHaveCSS('opacity', '1');
  await page.keyboard.press('ArrowRight');
  await expect(handles.nth(1)).toBeFocused();
  await expect(page.locator('.mdx-columns [aria-live="polite"]')).toHaveText('Moved to position 2 of 3');
  await page.keyboard.press('ArrowRight');
  await expect(handles.nth(2)).toBeFocused();
  await expect(page.locator('.mdx-columns [aria-live="polite"]')).toHaveText('Moved to position 3 of 3');
  await expect.poll(() => read(workspace, name)).toBe(movedPage());
  await expect(page.locator('[data-column]').last()).toContainText('Nested content');
  await page.keyboard.press('ArrowRight');
  await expect(handles.nth(2)).toBeFocused();
  expect(read(workspace, name)).toBe(movedPage());
  await page.getByRole('button', { name: 'Reading', exact: true }).first().click();
  await expect(handles).toHaveCount(0);
  await expect(page.getByRole('separator', { name: /Resize columns/ })).toHaveCount(0);
});

test('pointer moves the first column to the end with an insertion line', async ({ page, workspace }, testInfo) => {
  const name = 'pages-column-pointer.mdx';
  await open(page, workspace, name, movingPage(movingColumns));
  await page.getByRole('button', { name: 'Live', exact: true }).first().click();
  const handle = page.getByRole('button', { name: 'Move column', exact: true }).first();
  await handle.hover();
  await expect(handle).toHaveCSS('opacity', '1');
  const start = (await handle.boundingBox())!;
  const end = (await page.locator('[data-column]').last().boundingBox())!;
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(end.x + end.width - 4, end.y + 12, { steps: 8 });
  await expect(page.locator('[data-column-insertion][data-end]')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('column-insertion.png') });
  await page.mouse.up();
  await expect.poll(() => read(workspace, name)).toBe(movedPage());
  await expect(page.locator('[data-column-insertion]')).toHaveCount(0);
  await expect(page.locator('[data-column]').last()).toContainText('Nested content');

  // A drop within the same position leaves the complete file unchanged.
  const last = page.getByRole('button', { name: 'Move column', exact: true }).last();
  const same = (await last.boundingBox())!;
  await page.mouse.move(same.x + 12, same.y + 12);
  await page.mouse.down();
  await page.mouse.move(same.x + 20, same.y + 12, { steps: 3 });
  await page.mouse.up();
  expect(read(workspace, name)).toBe(movedPage());
});

test('a live Stat follows the database when it changes on disk', async ({ page, workspace }) => {
  await open(page, workspace, 'pages-stat.mdx', [
    '<Stat label="Done" source="pages.db" table="tasks" where="status = done" count />', '',
    '<Stat label="Hours" source="pages.db" table="tasks" sum="hours" />', '',
    '<Stat label="Broken" source="pages.db" table="tasks" where="owner = me" />', '',
    '<Stat label="Missing" source="nowhere.db" table="tasks" />',
    '<Chart type="bar" source="pages.db" table="tasks" group="status" count />',
  ]);
  const value = (label: string) => page.locator('.mdx-stat', { hasText: label });
  await expect(value('Done').locator('[data-stat-value]')).toHaveText('1');
  await expect(value('Hours').locator('[data-stat-value]')).toHaveText('10');
  await expect(page.locator('[data-chart="bar"]').getByRole('img')).toHaveAttribute('aria-label', /Todo 1, Doing 1, Done 1/);
  await expect(value('Broken').locator('[data-stat-error]')).toHaveText('No column named "owner".');
  await expect(value('Missing').locator('[data-stat-error]')).toHaveText('No file at nowhere.db.');

  writeFileSync(join(workspace, 'pages.db'), database(ROWS.map((row) => (row.id === 'r1' ? { ...row, values: { ...row.values, status: 'done', hours: 4 } } : row))));
  await expect(value('Done').locator('[data-stat-value]')).toHaveText('2');
  await expect(value('Hours').locator('[data-stat-value]')).toHaveText('12');
  await expect(page.locator('[data-chart="bar"]').getByRole('img')).toHaveAttribute('aria-label', /Todo 0, Doing 1, Done 2/);
});

test('a Stat and Chart follow an uppercase CSV changed on disk', async ({ page, workspace }) => {
  writeFileSync(join(workspace, 'metrics.CSV'), 'Team,Hours\nRed,2\nBlue,3\n');
  mkdirSync(join(workspace, '.neuron', 'tables'), { recursive: true });
  writeFileSync(join(workspace, '.neuron', 'tables', 'metrics.CSV.json'), JSON.stringify({ columns: { Hours: { type: 'number' } } }));
  await open(page, workspace, 'pages-csv-watch.mdx', [
    '<Stat label="Hours" source="metrics.CSV" sum="Hours" />',
    '<Chart type="bar" source="metrics.CSV" group="Team" sum="Hours" />',
  ]);
  await expect(page.locator('[data-stat-value]')).toHaveText('5');
  const chart = page.locator('[data-chart="bar"]');
  await expect(chart.getByRole('img')).toHaveAttribute('aria-label', /Blue 3, Red 2/);
  writeFileSync(join(workspace, 'metrics.CSV'), 'Team,Hours\nRed,8\nBlue,3\nGreen,4\n');
  await expect(page.locator('[data-stat-value]')).toHaveText('15', { timeout: 15_000 });
  await expect(chart.getByRole('img')).toHaveAttribute('aria-label', /Red 8, Green 4, Blue 3/);
  await expect(chart.locator('[data-bar]')).toHaveCount(3);
});

test('pie and bar charts draw one mark per group', async ({ page, workspace }) => {
  await open(page, workspace, 'pages-charts.mdx', [
    '<Chart type="pie" label="By status" source="pages.db" table="tasks" group="status" count />', '',
    '<Chart type="bar" label="By priority" source="pages.db" table="tasks" group="priority" sum="hours" />', '',
    '<Chart type="bar" source="pages.db" table="tasks" where="status = gone" group="status" />',
  ]);
  const pie = page.locator('[data-chart="pie"]');
  await expect(pie.locator('[data-slice]')).toHaveCount(3);
  await expect(pie.getByRole('img')).toHaveAttribute('aria-label', /Todo 1, Doing 1, Done 1/);
  const bar = page.locator('[data-chart="bar"]').first();
  await expect(bar.locator('[data-bar]')).toHaveCount(2);
  await expect(bar.getByRole('img')).toHaveAttribute('aria-label', /Low 2, High 8/);
  // The values are also a table for screen readers.
  await expect(bar.locator('table.sr-only tbody tr')).toHaveCount(2);
  await expect(page.locator('[data-chart="bar"]').nth(1)).toContainText('No data yet.');
});

test('a form adds a row to a database and to a managed CSV', async ({ page, workspace }) => {
  writeFileSync(join(workspace, 'people.csv'), 'name,age\nAda,36\n');
  mkdirSync(join(workspace, '.neuron', 'tables'), { recursive: true });
  writeFileSync(join(workspace, '.neuron', 'tables', 'people.csv.json'), JSON.stringify({
    version: 1, columns: { name: { type: 'text' }, age: { type: 'number' } },
    view: { sortBy: null, sortDir: 'asc', filterProp: null, filterValue: '', mode: 'table' },
  }));
  writeFileSync(join(workspace, 'loose.csv'), 'name,age\nAda,36\n');
  await open(page, workspace, 'pages-form.mdx', [
    '<Form title="New task" source="pages.db" table="tasks" fields="title, status, done" submit="Add task" />', '',
    '<Form title="New person" source="people.csv" submit="Add person" />', '',
    '<Form title="Loose" source="loose.csv" />',
    '<Stat label="Task count" source="pages.db" table="tasks" count />',
    '<Stat label="Person count" source="people.csv" count />',
  ]);

  const task = page.locator('.mdx-form', { hasText: 'New task' });
  const count = (label: string) => page.locator('.mdx-stat', { hasText: label }).locator('[data-stat-value]');
  await expect(count('Task count')).toHaveText('3');
  await expect(count('Person count')).toHaveText('1');
  // The title column is required: nothing is written without it.
  await task.getByRole('button', { name: 'Add task' }).click();
  await expect(task.getByRole('alert')).toHaveText('Task is required.');
  await task.getByLabel('Status').selectOption({ label: 'Doing' });
  await task.getByLabel('Task').fill('Plan the launch');
  await task.getByLabel('Task').press('Enter');
  await expect(task.getByRole('status')).toHaveText('Added.');
  await expect(task.getByLabel('Task')).toHaveValue('');
  const added = db(workspace).at(-1)!;
  expect(added.values).toEqual({ title: 'Plan the launch', status: 'doing', done: false });
  expect(db(workspace)).toHaveLength(4);
  await expect(count('Task count')).toHaveText('4');
  await expect(task.getByRole('status')).toHaveCount(0, { timeout: 6000 });

  const person = page.locator('.mdx-form', { hasText: 'New person' });
  await person.getByLabel('name').fill('Lin');
  await person.getByLabel('age').fill('41');
  await person.getByRole('button', { name: 'Add person' }).click();
  await expect(person.getByRole('status')).toHaveText('Added.');
  expect(read(workspace, 'people.csv')).toBe('name,age\nAda,36\nLin,41\n');
  await expect(count('Person count')).toHaveText('2');

  const loose = page.locator('.mdx-form', { hasText: 'Loose' });
  await expect(loose).toContainText('Convert this CSV to a Neuron table to add rows.');
  await expect(loose.getByRole('button')).toHaveCount(0);
  expect(read(workspace, 'loose.csv')).toBe('name,age\nAda,36\n');
});

test('an editable DbView ticks a task on disk; a plain one stays read-only', async ({ page, workspace }) => {
  await open(page, workspace, 'pages-dbview.mdx', [
    '<DbView source="pages.db" table="tasks" editable />', '',
    '<DbView path="@pages.db" table="tasks" />',
  ]);
  const editable = page.locator('[data-db-embed-editable]');
  await expect(editable).toHaveCount(1);
  await editable.getByRole('checkbox', { name: 'Done: Write' }).click();
  await expect.poll(() => db(workspace).find((row) => row.id === 'r1')!.values.done).toBe(true);
  await expect(editable.getByRole('checkbox', { name: 'Done: Write' })).toHaveAttribute('data-state', 'checked');
  await expect(page.locator('[data-db-embed-mode="table"]:not([data-db-embed-editable])').getByRole('checkbox').first()).toBeDisabled();
});

test('typing / on an empty line in Live inserts a Chart block', async ({ page, workspace }) => {
  // This path sorts before both the bundled Planner.db and pages.db.
  writeFileSync(join(workspace, '000-first.db'), database(ROWS));
  await open(page, workspace, 'pages-insert.mdx', ['# Insert', '', 'Some text.']);
  await page.getByRole('button', { name: 'Live', exact: true }).first().click();
  const line = page.locator('article.preview-prose p', { hasText: 'Some text.' });
  await line.click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('/');
  const menu = page.locator('[data-insert-menu]');
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('option')).toHaveCount(8);
  await page.keyboard.type('cha');
  await expect(menu.getByRole('option')).toHaveCount(1);
  await page.keyboard.press('Enter');
  await expect(menu).toHaveCount(0);
  await expect.poll(() => read(workspace, 'pages-insert.mdx')).toContain('<Chart type="bar" source="000-first.db" table="tasks" group="status" count />');
  // The new block opens for editing.
  await expect(page.locator('.live-block-editor')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-chart="bar"]')).toBeVisible();
});

test('Escape closes Insert and returns focus to its empty line', async ({ page, workspace }) => {
  await open(page, workspace, 'pages-insert-escape.mdx', ['# Insert', '', 'Some text.']);
  await page.getByRole('button', { name: 'Live', exact: true }).first().click();
  await page.locator('article.preview-prose p', { hasText: 'Some text.' }).click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('/');
  await expect(page.locator('[data-insert-menu]')).toBeVisible();
  await page.keyboard.type('cha');
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-insert-menu]')).toHaveCount(0);
  await expect(page.locator('[data-live-line]:focus')).toHaveCount(1);
  await page.keyboard.type('Still editing');
  await page.keyboard.press('Tab');
  await expect.poll(() => read(workspace, 'pages-insert-escape.mdx')).toContain('Still editing');
  expect(read(workspace, 'pages-insert-escape.mdx')).not.toContain('<Chart');
});

test.describe('Insert without a database', () => {
  test.use({ prepareWorkspace: async ({}, use) => use(dir => {
    writeFileSync(join(dir, 'blank.mdx'), '# Insert\n\nSome text.\n');
  }) });
  test('the inserted block puts the cursor inside source=""', async ({ page, workspace }) => {
    await openNote(page, 'blank.mdx');
    await page.getByRole('button', { name: 'Live', exact: true }).first().click();
    await page.locator('article.preview-prose p', { hasText: 'Some text.' }).click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('/');
    await expect(page.getByRole('combobox', { name: 'Insert a block' })).toBeFocused();
    await page.keyboard.type('stat');
    await page.keyboard.press('Enter');
    const editor = page.locator('.live-block-editor .cm-content');
    await expect(editor).toBeFocused();
    await expect(editor).toContainText('source=""');
    // Typing verifies both the caret position and focus.
    await page.keyboard.type('chosen.CSV');
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter');
    await expect.poll(() => read(workspace, 'blank.mdx')).toContain('<Stat label="Rows" source="chosen.CSV" count />');
  });
});

test('a Form keeps the required title even when fields omits it', async ({ page, workspace }) => {
  await open(page, workspace, 'pages-required-title.mdx', ['<Form source="pages.db" table="tasks" fields="status" />']);
  const form = page.locator('[data-form]');
  await expect(form.getByLabel('Task')).toHaveAttribute('aria-required', 'true');
  await form.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(form.getByRole('alert')).toHaveText('Task is required.');
  expect(db(workspace)).toHaveLength(3);
  await form.getByLabel('Task').fill('Title included');
  await form.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(form.getByRole('status')).toHaveText('Added.');
  expect(db(workspace).at(-1)!.values.title).toBe('Title included');
});
