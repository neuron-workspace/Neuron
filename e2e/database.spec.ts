import { test, expect, openNote } from './fixtures';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

// A .db view stores its sort and filter in the file. This checks they come back
// after the tab is closed and the file reopened.

test('database sort and filter settings survive closing and reopening the file', async ({ page, workspace }) => {
  await page.locator('.note-row', { hasText: 'Planner.db' }).first().click();
  await page.getByText('Tasks', { exact: true }).first().click();

  // The sort button is labelled with the property's name ("Task"), not its id.
  await page.getByRole('button', { name: 'Sort by Task' }).click();
  await page.getByLabel('Filter property').selectOption('status');
  await page.getByLabel('Filter value').selectOption('todo');

  const dbFile = join(workspace, 'Planner.db');
  await expect
    .poll(() => {
      const raw = readFileSync(dbFile, 'utf-8');
      return /"sortBy"\s*:\s*"title"/.test(raw)
        && /"filterProp"\s*:\s*"status"/.test(raw)
        && /"filterValue"\s*:\s*"todo"/.test(raw);
    }, { timeout: 15_000 })
    .toBe(true);

  await page.getByRole('button', { name: 'Close Planner.db' }).click();
  await expect(page.getByText('Tasks', { exact: true })).toHaveCount(0);

  await openNote(page, 'Planner.db');
  await page.getByText('Tasks', { exact: true }).first().click();

  await expect(page.getByLabel('Filter property')).toHaveValue('status');
  await expect(page.getByLabel('Filter value')).toHaveValue('todo');
  // Filtering alone leaves "Write the announcement post" first; only the
  // restored title sort puts this row on top.
  await expect(firstTitleCell(page)).toHaveValue('Align desk labels across floors');
});

// Text cells are <input>s, so the title lives in the input's value, not its
// text. The first <td> of a row is the delete-row gutter.
function firstTitleCell(page: import('@playwright/test').Page) {
  return page.locator('table tbody tr').first().locator('td').nth(1).locator('input.vw-cell');
}

test('database keeps a failed edit and saves it when retried', async ({ page, workspace }) => {
  await openNote(page, 'Planner.db');
  await page.getByRole('button', { name: 'Open Tasks table' }).click();
  const cell = firstTitleCell(page);
  await expect(cell).toBeVisible();

  const dbFile = join(workspace, 'Planner.db');
  // Saves go through `<file>.tmp` and a rename. A directory in that spot makes
  // the save fail on every platform; a read-only file would not, because the
  // rename replaces it.
  const blocker = `${dbFile}.tmp`;
  const before = readFileSync(dbFile, 'utf-8');
  const edited = 'Save failure retry regression';
  try {
    mkdirSync(blocker);
    await cell.fill(edited);
    await cell.blur();

    const errorBar = page.getByRole('alert').filter({ hasText: "Couldn't save Planner.db:" });
    await expect(errorBar).toBeVisible();
    await expect(cell).toHaveValue(edited);
    expect(readFileSync(dbFile, 'utf-8')).toBe(before);

    rmSync(blocker, { recursive: true, force: true });
    await errorBar.getByRole('button', { name: 'Retry' }).click();
    await expect(errorBar).toBeHidden();
    await expect.poll(() => readFileSync(dbFile, 'utf-8')).toContain(edited);
  } finally {
    rmSync(blocker, { recursive: true, force: true });
  }
});
