import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect, openNote } from '../fixtures';

// Integration: MDX pages and their data blocks. Components render with their
// children parsed, a Stat follows its table on disk, and a Form adds a row.
// mdx-layout.spec.ts, mdx-pages.spec.ts, rendering.spec.ts, flashcard.spec.ts
// and live-editing.spec.ts hold the detail.

const status = [{ id: 'todo', name: 'Todo', color: '#8b8b8b' }, { id: 'doing', name: 'Doing', color: '#528fd1' }, { id: 'done', name: 'Done', color: '#5aa06c' }];
const ROWS = [
  { id: 'r1', values: { title: 'Write', status: 'todo', hours: 2 } },
  { id: 'r2', values: { title: 'Review', status: 'doing', hours: 3 } },
  { id: 'r3', values: { title: 'Ship', status: 'done', hours: 5 } },
];
function database(rows: typeof ROWS) {
  return JSON.stringify({
    version: 2,
    tables: {
      tasks: {
        name: 'Tasks',
        schema: {
          order: ['title', 'status', 'hours'],
          properties: { title: { name: 'Task', type: 'text' }, status: { name: 'Status', type: 'select', options: status }, hours: { name: 'Hours', type: 'number' } },
        },
        rows,
      },
    },
  }, null, 2) + '\n';
}

async function openPage(page: Page, workspace: string, name: string, lines: string[]) {
  writeFileSync(join(workspace, 'pages.db'), database(ROWS));
  writeFileSync(join(workspace, name), lines.join('\n') + '\n');
  await page.getByRole('button', { name: 'Refresh explorer' }).click();
  await openNote(page, name);
}
const rows = (workspace: string) => JSON.parse(readFileSync(join(workspace, 'pages.db'), 'utf8')).tables.tasks.rows as typeof ROWS;
const stat = (page: Page, label: string) => page.locator('.mdx-stat', { hasText: label }).locator('[data-stat-value]');

test('a component page renders its layout and parses the children inside it', async ({ page }) => {
  await openNote(page, 'Dashboard.mdx');
  const doc = page.locator('.preview-prose');
  await expect(doc.locator('.grid').first()).toBeVisible();
  await expect(doc.getByText('Questions for Friday', { exact: true }).first()).toBeVisible();
  // Children were parsed: a task inside a Card is a real checkbox, a DbView a real table.
  expect(await doc.locator('input[type="checkbox"]').count()).toBeGreaterThan(0);
  expect(await doc.locator('table').count()).toBeGreaterThan(0);
  const text = (await doc.first().innerText()) + (await doc.last().innerText());
  expect(text).not.toContain('<Card');
  expect(text).not.toContain('<Grid');
});

test('a Stat and a Chart follow the database when it changes on disk', async ({ page, workspace }) => {
  await openPage(page, workspace, 'pages-stat.mdx', [
    '<Stat label="Done" source="pages.db" table="tasks" where="status = done" count />', '',
    '<Stat label="Hours" source="pages.db" table="tasks" sum="hours" />', '',
    '<Chart type="bar" source="pages.db" table="tasks" group="status" count />',
  ]);
  await expect(stat(page, 'Done')).toHaveText('1');
  await expect(stat(page, 'Hours')).toHaveText('10');
  await expect(page.locator('[data-chart="bar"]').getByRole('img')).toHaveAttribute('aria-label', /Todo 1, Doing 1, Done 1/);

  writeFileSync(join(workspace, 'pages.db'), database(ROWS.map((row) => (row.id === 'r1' ? { ...row, values: { ...row.values, status: 'done', hours: 4 } } : row))));
  await expect(stat(page, 'Done')).toHaveText('2');
  await expect(stat(page, 'Hours')).toHaveText('12');
  await expect(page.locator('[data-chart="bar"]').getByRole('img')).toHaveAttribute('aria-label', /Todo 0, Doing 1, Done 2/);
});

test('a Form adds a row to the database, and the page\'s Stat counts it', async ({ page, workspace }) => {
  await openPage(page, workspace, 'pages-form.mdx', [
    '<Form title="New task" source="pages.db" table="tasks" fields="title, status" submit="Add task" />', '',
    '<Stat label="Task count" source="pages.db" table="tasks" count />',
  ]);
  const form = page.locator('.mdx-form', { hasText: 'New task' });
  await expect(stat(page, 'Task count')).toHaveText('3');
  await form.getByLabel('Status').selectOption({ label: 'Doing' });
  await form.getByLabel('Task').fill('Plan the launch');
  await form.getByRole('button', { name: 'Add task' }).click();
  await expect(form.getByRole('status')).toHaveText('Added.');
  await expect.poll(() => rows(workspace).length).toBe(4);
  expect(rows(workspace).at(-1)!.values).toEqual({ title: 'Plan the launch', status: 'doing' });
  await expect(stat(page, 'Task count')).toHaveText('4');
});
