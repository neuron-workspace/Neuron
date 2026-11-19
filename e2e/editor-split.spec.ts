import { test, expect, openNote } from './fixtures';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';

// "Open to the side" is now a split to the right: the note opens in a second
// editor group. Groups are `[data-editor-group="<index>"]`, each with its own
// tab strip and note header.
const groups = (page: Page) => page.locator('[data-editor-group]');
const group = (page: Page, index: number) => page.locator(`[data-editor-group="${index}"]`);
// macOS has no End key behaviour in a text field: Cmd+Right is the end of the line there.
const end = process.platform === 'darwin' ? 'Meta+ArrowRight' : 'End';

async function runCommand(page: Page, name: string) {
  await page.getByRole('button', { name: /Search & commands/ }).click();
  const dialog = page.locator('[role="dialog"]');
  await dialog.getByRole('combobox').or(dialog.locator('input')).first().fill(name);
  // By role and prefix: a command with a shortcut has its chord in the same row.
  await dialog.getByRole('option', { name: new RegExp('^' + name) }).first().click();
  await expect(dialog).toBeHidden();
}

/** The tabs of each stored group, as the app remembers them for this workspace. */
function storedGroups(page: Page) {
  return page.evaluate(async () => {
    const api = (window as unknown as { electronAPI: any }).electronAPI;
    const repo = await api.repository.getCurrent();
    const stored = await api.settings.get('editorGroups:' + repo.path);
    return stored?.groups?.map((g: { tabs: string[] }) => g.tabs) ?? null;
  });
}

test('a note opens to the side, edits there reach the file, and the split survives reload', async ({ page, workspace }) => {
  await openNote(page, 'projects/Website refresh');
  await runCommand(page, 'Open current note to the side');
  await expect(groups(page)).toHaveCount(2);
  await expect(group(page, 1).getByLabel('Note path')).toContainText('Website refresh.mdx');

  // The new group has focus, so the next note opens there: two notes, side by side.
  await openNote(page, 'projects/Mobile app');
  await expect(group(page, 1).getByLabel('Note path')).toContainText('Mobile app.mdx');
  await expect(group(page, 0).getByLabel('Note path')).toContainText('Website refresh.mdx');

  // Editing in the first group writes its own file, not the other group's.
  await group(page, 0).getByRole('button', { name: 'Live', exact: true }).click();
  await group(page, 0).locator('article.preview-prose h1').first().click();
  await page.keyboard.press(end);
  await page.keyboard.insertText(' v2');
  // Live commits a line when focus leaves it.
  await group(page, 0).getByRole('button', { name: 'Live', exact: true }).focus();
  await expect.poll(() => readFileSync(join(workspace, 'projects', 'Website refresh.mdx'), 'utf-8')).toMatch(/^# .* v2$/m);
  expect(readFileSync(join(workspace, 'projects', 'Mobile app.mdx'), 'utf-8')).not.toContain(' v2');

  // Mobile app is a preview, which is not remembered; both groups keep Website refresh.
  await expect.poll(() => storedGroups(page)).toEqual([['projects/Website refresh.mdx'], ['projects/Website refresh.mdx']]);
  await page.reload();
  await expect(groups(page)).toHaveCount(2);
  await expect(group(page, 0).getByLabel('Note path')).toContainText('Website refresh.mdx');
  await expect(group(page, 0).locator('h1').first()).toContainText('v2');

  // Closing a group's last tab closes the group.
  await group(page, 1).getByRole('button', { name: 'Close Website refresh', exact: true }).click();
  await expect(groups(page)).toHaveCount(1);
});

test('the same note in two groups stays in step, and a tab splits right from its menu', async ({ page, workspace }) => {
  await openNote(page, 'projects/Website refresh');
  await page.getByRole('navigation', { name: 'Open notes' }).getByRole('button', { name: 'Website refresh', exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Split right', exact: true }).click();
  await expect(groups(page)).toHaveCount(2);
  await expect(group(page, 1).getByLabel('Note path')).toContainText('Website refresh.mdx');

  await group(page, 0).getByRole('button', { name: 'Live', exact: true }).click();
  await group(page, 0).locator('article.preview-prose h1').first().click();
  await page.keyboard.press(end);
  await page.keyboard.insertText(' shared');
  await group(page, 0).getByRole('button', { name: 'Live', exact: true }).focus();
  // The other group shows the edit from the shared document, and the file gets it once.
  await expect(group(page, 1).locator('article.preview-prose h1').first()).toContainText('shared');
  await expect.poll(() => readFileSync(join(workspace, 'projects', 'Website refresh.mdx'), 'utf-8').split(' shared').length - 1).toBe(1);
});
