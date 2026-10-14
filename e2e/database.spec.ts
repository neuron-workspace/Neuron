import { test, expect, openNote } from './fixtures';
import { readFileSync } from 'node:fs';
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
