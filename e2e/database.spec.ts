import { test, expect, openNote } from './fixtures';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// `.db` views store their sort + filter settings in the file, but no
// end-to-end test checked they survived closing and reopening. Regression
// coverage landed as part of #61: this spec walks the user's path (open,
// sort, filter, close tab, reopen) and asserts the same view comes back.
//
// Sort is a per-column button (`aria-label="Sort by <prop name>"`). Filter
// is two selects (`Filter property` then `Filter value`). Both call
// `write(...)` into the .db file, so the file is the source of truth.

test('database sort and filter settings survive closing and reopening the file', async ({ page, workspace }) => {
  // Planner.db ships in examples/demo-repo with 26 rows in the tasks
  // table and 7 in projects -- the demo fixture for the surfaces spec
  // already exercises the overview drill-down, so we follow the same
  // path.
  await page.locator('.note-row', { hasText: 'Planner.db' }).first().click();
  await expect(page.getByText('Tasks', { exact: true }).first()).toBeVisible();
  await page.getByText('Tasks', { exact: true }).first().click();

  const firstCellBefore = await firstRowCellText(page);
  expect(firstCellBefore.length).toBeGreaterThan(0);

  // Sort by title. The button is `opacity-0` until hover, but Playwright
  // clicks regardless of opacity, so the locator is just the labelled
  // role.
  await page.getByRole('button', { name: 'Sort by title' }).click();

  // Filter by status = "todo". The filter value control is only a
  // <select> when the chosen property is a select type; status is, so
  // this is the right branch.
  await page.getByLabel('Filter property').selectOption('status');
  await page.getByLabel('Filter value').selectOption('todo');

  // Both writes are immediate (`write(...)` not `stage(...)`), but the
  // file is touched by a debounced write loop. Poll the file rather
  // than guessing the interval.
  const dbFile = join(workspace, 'Planner.db');
  await expect
    .poll(() => {
      const raw = readFileSync(dbFile, 'utf-8');
      // The view state is serialised alongside rows; we only need to
      // know it landed, not parse the schema here.
      return /"sortBy"\s*:\s*"title"/.test(raw)
        && /"filterProp"\s*:\s*"status"/.test(raw)
        && /"filterValue"\s*:\s*"todo"/.test(raw);
    }, { timeout: 15_000 })
    .toBe(true);

  // Close the tab. The tab strip's Close button is named after the open
  // note (`Close Planner.db`); using the role keeps the test honest if
  // the CSS class changes.
  await page.getByRole('button', { name: 'Close Planner.db' }).click();
  await expect(page.getByText('Tasks', { exact: true })).toHaveCount(0);

  // Reopen through the palette. Each test owns a throwaway workspace, so
  // the persisted state really came from the previous close, not from
  // another test's leftover.
  await openNote(page, 'Planner.db');
  await expect(page.getByText('Tasks', { exact: true }).first()).toBeVisible();
  await page.getByText('Tasks', { exact: true }).first().click();

  // Filter selects must come back with their previous values. That is
  // the most direct way to assert the filter persisted: the controls are
  // bound to the document's view state and re-render with those values
  // once the file is loaded.
  await expect(page.getByLabel('Filter property')).toHaveValue('status');
  await expect(page.getByLabel('Filter value')).toHaveValue('todo');

  // Sort: the row order is the visible evidence the sort persisted. We
  // capture the first cell of the first row before sorting, and assert
  // the row we see after reopen is different. The exact title would be
  // brittle against future edits to the demo data, but "different from
  // the unsorted position" is what "sort persisted" actually means.
  const firstCellAfter = await firstRowCellText(page);
  expect(firstCellAfter).not.toBe(firstCellBefore);
});

// Helper: the first cell of the first body row. The DbSurface renders
// each column as a <td> with an editable widget (text input, checkbox,
// date input, ...) -- we read the textContent so we get the visible
// displayed value, not the widget.
async function firstRowCellText(page: import('@playwright/test').Page): Promise<string> {
  const cell = page.locator('table tbody tr').first().locator('td').nth(1);
  await expect(cell).toBeVisible();
  return ((await cell.textContent()) ?? '').trim();
}
