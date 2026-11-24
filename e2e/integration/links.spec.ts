import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect, openNote } from '../fixtures';

// Integration: links, rename and move. A wiki-link opens its note, a rename
// updates the links to it, and Move to… moves a file into a folder.
// wikilinks.spec.ts, links-and-rename.spec.ts and rendering.spec.ts hold the
// detail (duplicate names, aliases, autocomplete, drags, refusals).

const FILES: Record<string, string> = {
  'welcome.md': '# Welcome\n',
  'Home.md': '# Home\n\nSee [[Target]] and [[Nowhere At All]].\n',
  'Target.md': '# Target\n\nThe linked note.\n',
  'Points.md': '# Points\n\n[[Rename Me]]\n',
  'Rename Me.md': '# Rename me\n',
  'Move Me.md': '# Move me\n',
  'archive/Kept.md': '# Kept\n',
};

test.use({ prepareWorkspace: async ({}, use) => use((dir: string) => {
  for (const [path, content] of Object.entries(FILES)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
}) });

const sidebar = (page: Page) => page.getByRole('complementary', { name: 'Workspace sidebar' });
const read = (workspace: string, path: string) => (existsSync(join(workspace, path)) ? readFileSync(join(workspace, path), 'utf8') : null);

test('a wiki-link opens its note, and a link to no note says it is missing', async ({ page }) => {
  await openNote(page, 'Home.md');
  const missing = page.locator('article.preview-prose').getByTitle('No note found for "Nowhere At All"');
  await expect(missing).toContainText('(missing note)');
  await page.getByRole('button', { name: 'Open note Target.md' }).click();
  await expect(page.locator('article.preview-prose h1')).toHaveText('Target');
});

test('F2 renames a file, and a link to it in another note follows', async ({ page, workspace }) => {
  const row = sidebar(page).locator('[data-tree-file="Rename Me.md"] button').first();
  await expect(row).toBeVisible();
  await row.focus();
  await page.keyboard.press('F2');
  const dialog = page.locator('[data-file-action="rename"]');
  const name = dialog.getByRole('textbox', { name: 'File name' });
  await expect(name).toHaveValue('Rename Me');
  await name.fill('Renamed Note');
  await name.press('Enter');
  await expect(dialog).toHaveCount(0);

  await expect.poll(() => read(workspace, 'Renamed Note.md')).toBe(FILES['Rename Me.md']);
  expect(read(workspace, 'Rename Me.md')).toBeNull();
  await expect.poll(() => read(workspace, 'Points.md')).toBe('# Points\n\n[[Renamed Note]]\n');
  await expect(page.locator('[data-link-notice]')).toContainText('Updated 1 link so they still point to Renamed Note.');
});

test('Move to… puts a file in a folder', async ({ page, workspace }) => {
  await sidebar(page).locator('[data-tree-file="Move Me.md"]').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Move to…' }).click();
  const dialog = page.locator('[data-file-action="move"]');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('option', { name: 'archive' }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => read(workspace, 'archive/Move Me.md')).toBe(FILES['Move Me.md']);
  expect(read(workspace, 'Move Me.md')).toBeNull();
});
