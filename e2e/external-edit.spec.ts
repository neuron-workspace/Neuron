import { test, expect, openNote } from './fixtures';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// An open note used to keep showing the text it was opened with. A change made
// on disk -- a sync client, git, another editor -- never appeared, and the next
// edit in Neuron saved over it.

for (const mode of ['Reading', 'Live']) {
  test(`an open note shows a change made on disk (${mode})`, async ({ page, workspace }) => {
    const file = join(workspace, 'external.mdx');
    writeFileSync(file, '# External\n\nFirst version.\n');
    await expect(page.locator('.note-row').first()).toBeVisible();
    await page.getByRole('button', { name: 'Refresh explorer' }).click();
    await openNote(page, 'external.mdx');
    await page.getByRole('button', { name: mode, exact: true }).first().click();
    await expect(page.getByText('First version.')).toBeVisible();

    writeFileSync(file, '# External\n\nSecond version.\n');
    await expect(page.getByText('Second version.')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('First version.')).toHaveCount(0);
  });
}

test('an edit made after an outside change keeps the outside change', async ({ page, workspace }) => {
  const file = join(workspace, 'external.mdx');
  writeFileSync(file, '# External\n\nFirst version.\n');
  await expect(page.locator('.note-row').first()).toBeVisible();
  await page.getByRole('button', { name: 'Refresh explorer' }).click();
  await openNote(page, 'external.mdx');
  await page.getByRole('button', { name: 'Live', exact: true }).first().click();
  writeFileSync(file, '# External\n\nFrom outside.\n');
  const line = page.locator('p[data-live-line]').filter({ hasText: 'From outside.' });
  await expect(line).toBeVisible({ timeout: 10_000 });
  await line.click();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End');
  await page.keyboard.insertText(' Then here.');
  await page.getByRole('button', { name: 'Live', exact: true }).first().focus();
  await expect.poll(() => readFileSync(file, 'utf8')).toBe('# External\n\nFrom outside. Then here.\n');
});
