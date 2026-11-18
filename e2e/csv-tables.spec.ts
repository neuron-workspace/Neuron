import { test, expect, openNote } from './fixtures';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';

// A CSV is someone's data file. Opening, viewing and sorting one Neuron does
// not manage must leave it byte for byte as it was; only an edit after the
// person agrees to convert it may write it, and then only the edited cell.

const PEOPLE = Buffer.from('name,age,city\nAnn,34,"Paris, France"\nBob,9,Oslo\nCy,120,Lima\n', 'utf8');
const SEMI = Buffer.concat([
  Buffer.from([0xef, 0xbb, 0xbf]),
  Buffer.from('name;note;amount\r\nAnn;"two\r\nlines";1,5\r\nBob;plain;2\r\n', 'utf8'),
]);

test.use({ prepareWorkspace: async ({}, use) => use((dir: string) => {
  writeFileSync(join(dir, 'welcome.md'), '# Welcome\n');
  writeFileSync(join(dir, 'people.csv'), PEOPLE);
  mkdirSync(join(dir, 'data'));
  writeFileSync(join(dir, 'data', 'semi.csv'), SEMI);
  writeFileSync(join(dir, 'live.csv'), Buffer.from('item,count\nApples,3\n', 'utf8'));
}) });

const table = (page: Page) => page.locator('[data-csv-table]');
const convertDialog = (page: Page) => page.getByRole('dialog', { name: 'Convert to a Neuron table?' });

test('an existing CSV opens as a read-only table and is not written by viewing, sorting or closing', async ({ page, workspace }) => {
  const file = join(workspace, 'people.csv');
  await openNote(page, 'people.csv');
  await expect(table(page)).toHaveAttribute('data-csv-table', 'read-only');
  await expect(page.getByText('This CSV is read-only. Convert it to a Neuron table to edit it.')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'city', exact: true }).first()).toHaveValue('Paris, France');

  await page.getByRole('button', { name: 'Sort by age' }).click();
  await expect(page.getByRole('textbox', { name: 'name', exact: true }).first()).toHaveValue('Bob');
  await page.getByRole('button', { name: 'Sort by age' }).click();
  await expect(page.getByRole('textbox', { name: 'name', exact: true }).first()).toHaveValue('Cy');
  // Still descending: "Paris, France" first.
  await page.getByLabel('Sort column').selectOption('city');
  await expect(page.getByRole('textbox', { name: 'name', exact: true }).first()).toHaveValue('Ann');
  await page.getByLabel('Search rows').fill('oslo');
  await expect(page.getByText('1 / 3 rows')).toBeVisible();

  await page.getByRole('button', { name: 'Close people.csv' }).click();
  await expect(table(page)).toHaveCount(0);
  await page.waitForTimeout(1000);
  expect(readFileSync(file).equals(PEOPLE)).toBe(true);
  expect(existsSync(join(workspace, '.neuron', 'tables'))).toBe(false);
});

test('typing in a cell asks to convert, and Cancel leaves everything untouched', async ({ page, workspace }) => {
  const file = join(workspace, 'people.csv');
  await openNote(page, 'people.csv');
  const cell = page.getByRole('textbox', { name: 'name', exact: true }).first();
  await cell.click();
  await page.keyboard.type('x');
  await expect(convertDialog(page)).toBeVisible();
  await expect(convertDialog(page)).toContainText('Neuron will manage this file.');
  await expect(convertDialog(page)).not.toContainText('made consistent');
  await convertDialog(page).getByRole('button', { name: 'Cancel' }).click();
  await expect(convertDialog(page)).toBeHidden();
  await expect(cell).toHaveValue('Ann');

  await expect(cell).toBeFocused();
  await page.keyboard.press('Delete');
  await expect(convertDialog(page)).toBeVisible();
  await convertDialog(page).getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('button', { name: 'Add row' }).click();
  await expect(convertDialog(page)).toBeVisible();
  await convertDialog(page).getByRole('button', { name: 'Cancel' }).click();

  await page.waitForTimeout(1000);
  expect(readFileSync(file).equals(PEOPLE)).toBe(true);
  expect(existsSync(join(workspace, '.neuron', 'tables'))).toBe(false);
  await expect(table(page)).toHaveAttribute('data-csv-table', 'read-only');
});

test('Convert writes only the metadata; an edit then changes that one cell and keeps the dialect', async ({ page, workspace }) => {
  const file = join(workspace, 'data', 'semi.csv');
  const metaFile = join(workspace, '.neuron', 'tables', 'data', 'semi.csv.json');
  await openNote(page, 'data/semi.csv');
  await expect(page.getByRole('textbox', { name: 'note', exact: true }).first()).toHaveValue('two\nlines');
  await page.getByRole('button', { name: 'Convert', exact: true }).click();
  await convertDialog(page).getByRole('button', { name: 'Convert' }).click();
  await expect(convertDialog(page)).toBeHidden();
  await expect(table(page)).toHaveAttribute('data-csv-table', 'managed');

  await expect.poll(() => existsSync(metaFile)).toBe(true);
  const meta = JSON.parse(readFileSync(metaFile, 'utf8'));
  expect(meta.version).toBe(1);
  expect(Object.keys(meta.columns)).toEqual(['name', 'note', 'amount']);
  expect(readFileSync(file).equals(SEMI)).toBe(true);

  const cell = page.getByRole('textbox', { name: 'note', exact: true }).nth(1);
  await cell.fill('edited');
  await cell.blur();
  const expected = Buffer.concat([
    Buffer.from([0xef, 0xbb, 0xbf]),
    Buffer.from('name;note;amount\r\nAnn;"two\r\nlines";1,5\r\nBob;edited;2\r\n', 'utf8'),
  ]);
  await expect.poll(() => readFileSync(file).toString('hex'), { timeout: 15_000 }).toBe(expected.toString('hex'));
});

test('New table from the sidebar menu creates a managed Untitled.csv ready to type in', async ({ page, workspace }) => {
  const sidebar = page.getByRole('complementary', { name: 'Workspace sidebar' });
  await sidebar.getByRole('button', { name: 'New…' }).click();
  await page.getByRole('menuitem', { name: 'Table', exact: true }).click();

  const file = join(workspace, 'Untitled.csv');
  await expect.poll(() => existsSync(file)).toBe(true);
  expect(readFileSync(file, 'utf8')).toBe('Name\n');
  expect(existsSync(join(workspace, '.neuron', 'tables', 'Untitled.csv.json'))).toBe(true);
  await expect(table(page)).toHaveAttribute('data-csv-table', 'managed');

  await typeFirstRow(page, file);
});

test('New table from the command palette is ready to type in too', async ({ page, workspace }) => {
  await page.getByRole('button', { name: /Search & commands/ }).click();
  const palette = page.locator('[role="dialog"]');
  await palette.getByRole('combobox').fill('New table');
  await page.getByRole('option', { name: 'New table', exact: true }).click();
  const file = join(workspace, 'Untitled.csv');
  await expect.poll(() => existsSync(file)).toBe(true);
  await typeFirstRow(page, file);
});

/**
 * Types into the empty table's first cell at full speed. The first keystroke
 * turns the offered row into a real one; the input must be the same element
 * throughout, keep focus, and lose no character.
 */
async function typeFirstRow(page: Page, file: string) {
  const cell = () => page.getByRole('textbox', { name: 'Name', exact: true }).first();
  await expect(cell()).toBeFocused();
  await cell().evaluate((element) => { element.dataset.probe = 'first'; });
  await page.keyboard.type('First row, typed fast');
  await expect(cell()).toHaveValue('First row, typed fast');
  await expect(cell()).toBeFocused();
  expect(await page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.probe)).toBe('first');
  await page.keyboard.press('Tab');
  await expect.poll(() => readFileSync(file, 'utf8'), { timeout: 15_000 }).toBe('Name\n"First row, typed fast"\n');
}

test('a CSV changed on disk while open shows the new content', async ({ page, workspace }) => {
  await openNote(page, 'live.csv');
  await expect(page.getByRole('textbox', { name: 'count', exact: true }).first()).toHaveValue('3');
  writeFileSync(join(workspace, 'live.csv'), 'item,count\nApples,7\nPears,2\n');
  await expect(page.getByRole('textbox', { name: 'count', exact: true }).first()).toHaveValue('7', { timeout: 15_000 });
  await expect(page.getByRole('textbox', { name: 'item', exact: true }).nth(1)).toHaveValue('Pears');
});
