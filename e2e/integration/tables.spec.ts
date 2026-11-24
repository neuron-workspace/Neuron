import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect, openNote } from '../fixtures';

// Integration: tables, .db and CSV. A database edit and its view settings reach
// the file, a CSV stays untouched until it is converted, and a new table is
// ready to type in. database.spec.ts, database-views.spec.ts,
// db-virtualization.spec.ts and csv-tables.spec.ts hold the detail.

const demo = resolve(__dirname, '..', '..', 'examples', 'demo-repo');
const PEOPLE = 'name,age\nAnn,34\nBob,9\n';

test.use({ prepareWorkspace: async ({}, use) => use((dir: string) => {
  writeFileSync(join(dir, 'welcome.md'), '# Welcome\n');
  copyFileSync(join(demo, 'Planner.db'), join(dir, 'Planner.db'));
  writeFileSync(join(dir, 'people.csv'), PEOPLE);
}) });

const table = (page: Page) => page.locator('[data-csv-table]');
// Text cells are inputs; the first <td> of a row is the delete-row gutter.
const firstTitle = (page: Page) => page.locator('table tbody tr').first().locator('td').nth(1).locator('input.vw-cell');

test('a database cell edit and its sort and filter reach the file and come back on reopen', async ({ page, workspace }) => {
  const file = join(workspace, 'Planner.db');
  await openNote(page, 'Planner.db');
  await page.getByRole('button', { name: 'Open Tasks table' }).click();
  await expect(firstTitle(page)).toBeVisible();

  await firstTitle(page).fill('Edited in Neuron');
  await firstTitle(page).blur();
  await expect.poll(() => readFileSync(file, 'utf8')).toContain('Edited in Neuron');

  await page.getByRole('button', { name: 'Sort by Task' }).click();
  await page.getByLabel('Filter property').selectOption('status');
  await page.getByLabel('Filter value').selectOption('todo');
  await expect.poll(() => {
    const raw = readFileSync(file, 'utf8');
    return /"sortBy"\s*:\s*"title"/.test(raw) && /"filterProp"\s*:\s*"status"/.test(raw) && /"filterValue"\s*:\s*"todo"/.test(raw);
  }, { timeout: 15_000 }).toBe(true);

  await page.getByRole('button', { name: 'Close Planner.db' }).click();
  await openNote(page, 'Planner.db');
  await page.getByRole('button', { name: 'Open Tasks table' }).click();
  await expect(page.getByLabel('Filter property')).toHaveValue('status');
  await expect(page.getByLabel('Filter value')).toHaveValue('todo');
});

test('a CSV opens read-only and untouched; after Convert an edit writes that cell', async ({ page, workspace }) => {
  const file = join(workspace, 'people.csv');
  await openNote(page, 'people.csv');
  await expect(table(page)).toHaveAttribute('data-csv-table', 'read-only');
  const names = page.getByRole('textbox', { name: 'name', exact: true });
  // Sorting is a view: ascending, then descending, which is the file's own order here.
  await page.getByRole('button', { name: 'Sort by age' }).click();
  await expect(names.first()).toHaveValue('Bob');
  await page.getByRole('button', { name: 'Sort by age' }).click();
  await expect(names.first()).toHaveValue('Ann');
  await page.waitForTimeout(500);
  expect(readFileSync(file, 'utf8')).toBe(PEOPLE);
  expect(existsSync(join(workspace, '.neuron', 'tables'))).toBe(false);

  await page.getByRole('button', { name: 'Convert', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Convert to a Neuron table?' });
  await dialog.getByRole('button', { name: 'Convert' }).click();
  await expect(dialog).toBeHidden();
  await expect(table(page)).toHaveAttribute('data-csv-table', 'managed');
  await expect.poll(() => existsSync(join(workspace, '.neuron', 'tables', 'people.csv.json'))).toBe(true);
  expect(readFileSync(file, 'utf8')).toBe(PEOPLE);

  const ann = names.first();
  await expect(ann).toHaveValue('Ann');
  await ann.fill('Ada');
  await ann.blur();
  await expect.poll(() => readFileSync(file, 'utf8'), { timeout: 15_000 }).toBe('name,age\nAda,34\nBob,9\n');
});

test('New table from the sidebar creates a managed CSV ready to type in', async ({ page, workspace }) => {
  await page.getByRole('complementary', { name: 'Workspace sidebar' }).getByRole('button', { name: 'New…' }).click();
  await page.getByRole('menuitem', { name: 'Table', exact: true }).click();
  const file = join(workspace, 'Untitled.csv');
  await expect.poll(() => existsSync(file)).toBe(true);
  await expect(table(page)).toHaveAttribute('data-csv-table', 'managed');
  const cell = page.getByRole('textbox', { name: 'Name', exact: true }).first();
  await expect(cell).toBeFocused();
  await page.keyboard.type('First row');
  await page.keyboard.press('Tab');
  await expect.poll(() => readFileSync(file, 'utf8'), { timeout: 15_000 }).toBe('Name\nFirst row\n');
});
