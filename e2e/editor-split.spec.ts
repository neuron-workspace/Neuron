import { test, expect, openNote } from './fixtures';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';

const side = (page: Page) => page.locator('[data-side-note]');
// macOS has no End key behaviour in a text field: Cmd+Right is the end of the line there.
const end = process.platform === 'darwin' ? 'Meta+ArrowRight' : 'End';

async function runCommand(page: Page, name: string) {
  await page.getByRole('button', { name: /Search & commands/ }).click();
  const dialog = page.locator('[role="dialog"]');
  await dialog.getByRole('combobox').or(dialog.locator('input')).first().fill(name);
  await dialog.getByText(name, { exact: true }).first().click();
  await expect(dialog).toBeHidden();
}

test('a note opens beside the editor, edits there reach the file, and the split survives reload', async ({ page, workspace }) => {
  await openNote(page, 'projects/Website refresh');
  await runCommand(page, 'Open current note to the side');
  await expect(side(page)).toHaveAttribute('data-side-note', 'projects/Website refresh.mdx');

  // A different note in the main pane: two notes, side by side.
  await openNote(page, 'projects/Mobile app');
  await expect(page.getByLabel('Note path', { exact: true })).toContainText('Mobile app.mdx');
  await expect(side(page).getByLabel('Side note path')).toContainText('Website refresh.mdx');

  // Editing in the side pane writes its own file, not the main pane's.
  await side(page).getByRole('button', { name: 'Live', exact: true }).click();
  await side(page).locator('article.preview-prose h1').first().click();
  await page.keyboard.press(end);
  await page.keyboard.insertText(' v2');
  // Live commits a line when focus leaves it.
  await side(page).getByRole('button', { name: 'Swap panes', exact: true }).focus();
  await expect.poll(() => readFileSync(join(workspace, 'projects', 'Website refresh.mdx'), 'utf-8')).toMatch(/^# .* v2$/m);
  expect(readFileSync(join(workspace, 'projects', 'Mobile app.mdx'), 'utf-8')).not.toContain(' v2');

  await page.reload();
  await expect(side(page)).toHaveAttribute('data-side-note', 'projects/Website refresh.mdx');
  await expect(side(page).locator('h1').first()).toContainText('v2');

  await side(page).getByRole('button', { name: 'Close side pane', exact: true }).click();
  await expect(side(page)).toHaveCount(0);
});

test('the same note in both panes stays in step, and a tab opens to the side from its menu', async ({ page }) => {
  await openNote(page, 'projects/Website refresh');
  await page.getByRole('navigation', { name: 'Open notes' }).getByRole('button', { name: 'Website refresh', exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Open to the side', exact: true }).click();
  await expect(side(page)).toBeVisible();

  await page.locator('main').getByRole('button', { name: 'Live', exact: true }).click();
  await page.locator('main article.preview-prose h1').first().click();
  await page.keyboard.press(end);
  await page.keyboard.insertText(' shared');
  await page.locator('main').getByRole('button', { name: 'Live', exact: true }).focus();
  await expect(side(page).locator('h1').first()).toContainText('shared');
});
