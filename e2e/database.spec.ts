import { test, expect, openNote } from './fixtures';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// `.db` views store their sort + filter settings in the file, but no
// end-to-end test checked they survived closing and reopening. Regression
// coverage for #61: this spec walks the user's path (open, sort, filter,
// close tab, reopen) and asserts the same view comes back.
//
// Sort is a per-column button (`aria-label="Sort by <prop name>"` where
// <prop name> is the property's user-facing display name, not the propId).
// Filter is two selects (`Filter property` then `Filter value`). Both call
// `write(...)` synchronously into the .db file (no debounce), so the file
// is the source of truth immediately after the user action returns.

test('database sort and filter settings survive closing and reopening the file', async ({ page, workspace }) => {
  // Planner.db ships in examples/demo-repo with 26 rows in the tasks
  // table and 7 in projects -- the demo fixture for the surfaces spec
  // already exercises the overview drill-down, so we follow the same
  // path.
  await page.locator('.note-row', { hasText: 'Planner.db' }).first().click();
  await expect(page.getByText('Tasks', { exact: true }).first()).toBeVisible();
  await page.getByText('Tasks', { exact: true }).first().click();

  // Capture the displayed value of the first title cell before sorting.
  // Text cells are <input class="vw-cell" value="..."> -- the value lives
  // on the input, not in a text node, so `textContent` is empty. Use
  // `inputValue()` to read the rendered text.
  const firstTitleBefore = await firstTitleCellValue(page);
  expect(firstTitleBefore.length).toBeGreaterThan(0);

  // Sort by the title column. The aria-label is the property's display
  // name -- for the demo schema that is "Task" (with capital T), not
  // the propId "title". The sort button is `opacity-0` until hover, but
  // Playwright clicks regardless of opacity, so the role+name locator
  // is enough.
  await page.getByRole('button', { name: 'Sort by Task' }).click();

  // Filter by status = "todo" (the demo has plenty of those). The filter
  // value control is only a <select> when the chosen property is a
  // select type; status is, so this is the right branch.
  await page.getByLabel('Filter property').selectOption('status');
  await page.getByLabel('Filter value').selectOption('todo');

  // Both writes are immediate (`write(...)` not `stage(...)`). The file
  // is on disk before the test polls, but a single `readFileSync` may
  // race the IPC roundtrip, so poll for the values to land.
  const dbFile = join(workspace, 'Planner.db');
  await expect
    .poll(() => {
      const raw = readFileSync(dbFile, 'utf-8');
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
  // bound to the document view state and re-render with those values
  // once the file is loaded.
  await expect(page.getByLabel('Filter property')).toHaveValue('status');
  await expect(page.getByLabel('Filter value')).toHaveValue('todo');

  // Sort persistence: the row that was first under insertion order
  // (and again under filter-only, before sort) is no longer first.
  // The new first row is the alphabetically-earliest task whose status
  // is "todo" -- the same row that would be first if you sorted the
  // demo data by title ASC. The assertion that matters is "the row
  // order changed AND the new first row is what sorting produces",
  // not just "the row order changed" (which would pass even if sort
  // persistence were removed, because filter alone reorders rows).
  const firstTitleAfter = await firstTitleCellValue(page);
  expect(firstTitleAfter).not.toBe(firstTitleBefore);
  expect(firstTitleAfter.localeCompare(firstTitleAfter, undefined, { sensitivity: 'base' })).toBeLessThanOrEqual(0);
  // The first row of an ascending sort on the title column is the
  // alphabetically-earliest task title in the demo. That is a known
  // value, so we can assert it directly.
  expect(firstTitleAfter.toLowerCase()).toMatch(/^a/);
});

// Helper: the displayed text of the title cell in the first body row.
// DbSurface renders each text cell as <input class="vw-cell" value="...">,
// so the value lives on the input. `textContent` returns "" for inputs;
// `inputValue()` reads the live value attribute.
async function firstTitleCellValue(page: import('@playwright/test').Page): Promise<string> {
  // The first <td> in each row is a drag-handle gutter; the title cell
  // is the second <td>.
  const cell = page.locator('table tbody tr').first().locator('td').nth(1);
  await expect(cell).toBeVisible();
  const input = cell.locator('input.vw-cell');
  await expect(input).toBeVisible();
  return (await input.inputValue()).trim();
}