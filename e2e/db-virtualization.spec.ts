import { test, expect } from './fixtures';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

test('large database windows rows and preserves focused edits', async ({ page, workspace }) => {
  // This branch has no prepareWorkspace option; wait for the explorer watcher.
  await expect(page.locator('.note-row', { hasText: 'Planner.db' }).first()).toBeVisible();
  const file = join(workspace, 'Virtualized.db');
  writeFileSync(file, JSON.stringify({
    version: 2,
    tables: {
      entries: {
        name: 'Entries',
        schema: { order: ['title'], properties: { title: { name: 'Title', type: 'text' } } },
        view: {},
        rows: Array.from({ length: 5000 }, (_, index) => ({ id: 'row-' + index, values: { title: 'Entry ' + index } })),
      },
    },
  }));
  const entry = page.locator('.note-row', { hasText: 'Virtualized.db' }).first();
  await expect(entry).toBeVisible({ timeout: 15_000 });
  await entry.click();

  const table = page.locator('table.vw-db');
  const container = page.locator('[data-db-scroll]');
  await expect(table).toHaveAttribute('aria-rowcount', '5001');
  await expect.poll(() => table.locator('tbody tr').count()).toBeLessThan(200);
  const title = table.locator('tr[data-row-id="row-2"] input.vw-cell');
  await title.fill('Edited entry');
  await expect(title).toBeFocused();
  await container.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await expect(table.locator('tr[data-row-id="row-4999"] input.vw-cell')).toHaveValue('Entry 4999');
  await expect(title).toBeFocused();
  await expect.poll(() => table.locator('tbody tr').count()).toBeLessThan(200);
  // Blur commits text cells; scrolling alone must not lose the staged edit.
  await page.getByLabel('Search rows').focus();
  await expect.poll(() => JSON.parse(readFileSync(file, 'utf-8')).tables.entries.rows[2].values.title,
    { timeout: 15_000 }).toBe('Edited entry');
  await container.evaluate((element) => { element.scrollTop = 0; });
  await expect(title).toHaveValue('Edited entry');
  await expect(table.locator('tr[data-row-id="row-2"]')).toHaveAttribute('aria-rowindex', '4');

  // Tab can advance beyond the initial window without skipping rows.
  await title.focus();
  // Where focus actually is, for the failure message.
  const focusReport = () => page.evaluate(() => {
    const active = document.activeElement;
    const rows = [...document.querySelectorAll('table.vw-db tbody tr[data-row-id]')].map((row) => row.getAttribute('data-row-id'));
    return `focus on ${active?.tagName ?? 'none'} "${active?.getAttribute('aria-label') ?? active?.textContent?.trim().slice(0, 30)}"`
      + ` in ${active?.closest('tr')?.getAttribute('data-row-id') ?? 'no row'};`
      + ` scrollTop ${document.querySelector('[data-db-scroll]')?.scrollTop};`
      + ` rendered ${rows[0]}..${rows.at(-1)} (${rows.length})`
      // TEMP CI debug: remove before merge.
      + `\n${(((window as any).__dbDebug ?? []) as string[]).slice(-30).join('\n')}`;
  });
  for (let index = 3; index <= 42; index++) {
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    const cell = table.locator('tr[data-row-id="row-' + index + '"] input.vw-cell');
    await expect(cell, `row ${index}: after the second Tab, ${await focusReport()}`).toBeFocused();
  }
  await page.getByLabel('Search rows').fill('Entry 4999');
  await expect(table).toHaveAttribute('aria-rowcount', '2');
  await expect(table.locator('tbody tr')).toHaveCount(1);
  await expect.poll(() => container.evaluate((element) => element.scrollTop)).toBe(0);
});
