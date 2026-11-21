import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { test, expect, openNote, closeMenuByClickingOutside } from './fixtures';

// Module 11D and 11E: wiki-links resolve the way Obsidian's do, and renaming
// or moving a file in the app keeps its tabs, its table settings and every
// link to it.

const FILES: Record<string, string> = {
  'welcome.md': '# Welcome\n',
  'Meeting Notes.md': '# Root meeting\n',
  'team/Plan.md': '# Plan\n\n[[Meeting Notes]]\n',
  'Links Home.md': '# Links home\n\n[[Meeting Notes]]\n',
  'Draft.md': '# Draft\n\n',
  'people/Ada Lovelace.md': '---\naliases: [Countess]\n---\n# Ada Lovelace\n',
  'Alias Home.md': '# Alias home\n\n[[Countess]]\n',
  'Rename Me.md': '# Rename me\n\nfirst line\n',
  'Points.md': '# Points\n\n[[Rename Me]]\n',
  'Drag Me.md': '# Drag me\n',
  'archive/Kept.md': '# Kept\n',
  'scores.csv': 'item,done\nApples,true\n',
  '.neuron/tables/scores.csv.json': JSON.stringify({ version: 1, columns: { item: { type: 'text' }, done: { type: 'checkbox' } } }),
  'Keep A.md': '# Keep A\n',
  'Keep B.md': '# Keep B\n',
};

const write = (dir: string, path: string, content: string) => {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), content);
};

test.use({ prepareWorkspace: async ({}, use) => use((dir: string) => {
  for (const [path, content] of Object.entries(FILES)) write(dir, path, content);
}) });

const heading = (page: Page) => page.locator('article.preview-prose h1');
const sidebar = (page: Page) => page.getByRole('complementary', { name: 'Workspace sidebar' });
const read = (workspace: string, path: string) => (existsSync(join(workspace, path)) ? readFileSync(join(workspace, path), 'utf8') : null);

/** Write a file after launch and wait until the app lists it. */
async function addFile(page: Page, workspace: string, path: string, content: string) {
  write(workspace, path, content);
  await page.getByRole('button', { name: 'Refresh explorer' }).click();
  await openNote(page, path);
  await expect(heading(page)).toBeVisible();
}

/** Focus a root-level row in the sidebar tree and press F2. */
async function renameFromSidebar(page: Page, path: string): Promise<Locator> {
  const row = sidebar(page).locator(`[data-tree-file="${path}"] button`).first();
  await expect(row).toBeVisible();
  await row.focus();
  await page.keyboard.press('F2');
  const dialog = page.locator('[data-file-action="rename"]');
  await expect(dialog).toBeVisible();
  return dialog;
}

test('two notes of one name: a link from inside one folder opens that one, from the root the shorter path', async ({ page, workspace }) => {
  await addFile(page, workspace, 'team/Meeting Notes.md', '# Team meeting\n');
  await openNote(page, 'team/Plan.md');
  await page.getByRole('button', { name: 'Open note team/Meeting Notes.md' }).click();
  await expect(heading(page)).toHaveText('Team meeting');

  await openNote(page, 'Links Home.md');
  await page.getByRole('button', { name: 'Open note Meeting Notes.md' }).click();
  await expect(heading(page)).toHaveText('Root meeting');
});

test('creating a duplicate rewrites links that would move, says so, and version history undoes it', async ({ page, workspace }) => {
  const explorer = page.locator('[data-workspace-explorer]');
  const folder = explorer.getByRole('option', { name: 'team', exact: true });
  await expect(folder).toBeVisible({ timeout: 15_000 });
  await folder.dblclick();
  await explorer.getByRole('button', { name: 'New file', exact: true }).first().click();
  const name = page.getByRole('textbox', { name: 'File name', exact: true });
  await name.fill('Meeting Notes');
  await name.press('Enter');

  await expect(page.locator('[data-link-notice]')).toContainText('Updated 1 link so they still point to Meeting Notes.');
  await expect.poll(() => read(workspace, 'team/Plan.md')).toBe('# Plan\n\n[[/Meeting Notes|Meeting Notes]]\n');
  // Only the link the new file would have taken: the root's link still reaches the root note as it was.
  expect(read(workspace, 'Links Home.md')).toBe(FILES['Links Home.md']);

  // It still reads as the name and still opens the original.
  await openNote(page, 'team/Plan.md');
  const link = page.getByRole('button', { name: 'Open note Meeting Notes.md' });
  await expect(link).toHaveText('Meeting Notes');

  // Undo through version history: the rewrite is an entry of its own.
  await page.getByRole('button', { name: 'Show panel' }).first().click();
  await expect(page.getByText('Version history').first()).toBeVisible();
  const restore = page.getByRole('button', { name: 'Restore' }).first();
  await expect(restore).toBeVisible();
  const confirm = page.getByText('Replace the file on disk', { exact: false });
  for (let attempt = 1; attempt <= 3 && !(await confirm.isVisible()); attempt += 1) {
    await restore.click().catch(() => { /* the row swaps once a click lands */ });
    await confirm.waitFor({ state: 'visible', timeout: 3000 }).catch(() => { /* try again */ });
  }
  await page.getByRole('button', { name: 'Replace file' }).click();
  await expect.poll(() => read(workspace, 'team/Plan.md'), { timeout: 15_000 }).toBe(FILES['team/Plan.md']);
});

test('[[ autocomplete writes the path form for a duplicate name', async ({ page, workspace }) => {
  await addFile(page, workspace, 'team/Meeting Notes.md', '# Team meeting\n');
  await openNote(page, 'Draft.md');
  await page.getByRole('button', { name: 'Split', exact: true }).first().click();
  const source = page.locator('.cm-content').first();
  await source.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('[[Meeting');
  const option = page.locator('.cm-tooltip-autocomplete li', { hasText: 'team' });
  await expect(option).toBeVisible();
  await option.click();
  await expect(source).toContainText('[[team/Meeting Notes|Meeting Notes]]');
  await expect.poll(() => read(workspace, 'Draft.md')).toContain('[[team/Meeting Notes|Meeting Notes]]');
  expect(read(workspace, 'Draft.md')).not.toContain(']]]]');
});

test('an alias link opens the note that declares it', async ({ page }) => {
  await openNote(page, 'Alias Home.md');
  await page.getByRole('button', { name: 'Open note people/Ada Lovelace.md' }).click();
  await expect(heading(page)).toHaveText('Ada Lovelace');
});

test('F2 renames the open file: the tab and its text stay, and a link in another note follows', async ({ page, workspace }) => {
  await openNote(page, 'Rename Me.md');
  await page.getByRole('button', { name: 'Split', exact: true }).first().click();
  await page.locator('.cm-content').first().click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('typed before the rename');

  const dialog = await renameFromSidebar(page, 'Rename Me.md');
  const name = dialog.getByRole('textbox', { name: 'File name' });
  await expect(name).toHaveValue('Rename Me');
  await name.fill('Renamed Note');
  await name.press('Enter');
  await expect(dialog).toHaveCount(0);

  await expect(page.getByLabel('Note path')).toHaveAttribute('title', 'Renamed Note.md');
  await expect(page.locator('.cm-content').first()).toContainText('typed before the rename');
  await expect.poll(() => read(workspace, 'Renamed Note.md')).toContain('typed before the rename');
  expect(read(workspace, 'Rename Me.md')).toBeNull();
  await expect.poll(() => read(workspace, 'Points.md')).toBe('# Points\n\n[[Renamed Note]]\n');
  await expect(page.locator('[data-link-notice]')).toContainText('Updated 1 link so they still point to Renamed Note.');
});

test('dragging a file onto a folder moves it', async ({ page, workspace }) => {
  const source = sidebar(page).locator('[data-tree-file="Drag Me.md"]');
  const target = sidebar(page).locator('[data-tree-folder="archive"]');
  await expect(source).toBeVisible();
  const data = await page.evaluateHandle(() => new DataTransfer());
  await source.dispatchEvent('dragstart', { dataTransfer: data });
  await target.dispatchEvent('dragover', { dataTransfer: data });
  await target.dispatchEvent('drop', { dataTransfer: data });
  await expect.poll(() => read(workspace, 'archive/Drag Me.md')).toBe(FILES['Drag Me.md']);
  expect(read(workspace, 'Drag Me.md')).toBeNull();
});

test('Move to… takes a managed CSV with its column types, and it stays editable', async ({ page, workspace }) => {
  await sidebar(page).locator('[data-tree-file="scores.csv"]').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Move to…' }).click();
  const dialog = page.locator('[data-file-action="move"]');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('option', { name: 'archive' }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => read(workspace, 'archive/scores.csv')).toBe(FILES['scores.csv']);
  expect(read(workspace, '.neuron/tables/archive/scores.csv.json')).toBe(FILES['.neuron/tables/scores.csv.json']);
  expect(read(workspace, '.neuron/tables/scores.csv.json')).toBeNull();

  await openNote(page, 'archive/scores.csv');
  await expect(page.locator('[data-csv-table]')).toHaveAttribute('data-csv-table', 'managed');
  const done = page.getByRole('checkbox', { name: 'done' }).first();
  await expect(done).toBeChecked();
  await done.click();
  await expect.poll(() => read(workspace, 'archive/scores.csv'), { timeout: 15_000 }).toBe('item,done\nApples,false\n');
});

test('renaming onto an existing name is refused with a message', async ({ page, workspace }) => {
  const dialog = await renameFromSidebar(page, 'Keep A.md');
  await dialog.getByRole('textbox', { name: 'File name' }).fill('Keep B');
  await dialog.getByRole('button', { name: 'Rename', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('“Keep B.md” already exists there.');
  expect(read(workspace, 'Keep A.md')).toBe(FILES['Keep A.md']);
  expect(read(workspace, 'Keep B.md')).toBe(FILES['Keep B.md']);
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
});

test('the sidebar context menu offers Rename and Move to… for folders too', async ({ page, workspace }) => {
  await sidebar(page).locator('[data-tree-folder="archive"]').click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: /Rename/ })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Move to…' })).toBeVisible();
  await closeMenuByClickingOutside(page);
  expect(existsSync(join(workspace, 'archive'))).toBe(true);
});
