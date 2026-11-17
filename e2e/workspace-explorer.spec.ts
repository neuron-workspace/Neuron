import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures';

const explorer = '[data-workspace-explorer]';

test('with nothing open, the editor area is the explorer', async ({ page }) => {
  await expect(page.locator(explorer)).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toBeVisible();
  await expect(page.getByRole('listbox', { name: 'Workspace contents' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'List', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('single click previews a file; double click opens it', async ({ page, workspace }) => {
  writeFileSync(join(workspace, 'preview-note.md'), '# Preview note\n\nSome words #sample\n');
  const item = page.getByRole('option', { name: 'preview-note.md', exact: true });
  await expect(item).toBeVisible({ timeout: 15_000 });
  await item.click();
  await expect(item).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator(explorer)).toBeVisible();
  const preview = page.getByRole('complementary', { name: 'Preview', exact: true });
  await expect(preview.getByRole('heading', { name: 'preview-note.md', exact: true })).toBeVisible();
  await expect(preview.getByLabel('Tags')).toContainText('#sample');
  await expect(preview.locator('.explorer-note-preview')).toContainText('Some words');
  await expect(preview.locator('[contenteditable="true"]')).toHaveCount(0);
  await item.dblclick();
  await expect(page.locator(explorer)).toHaveCount(0);
});

test('selecting a folder previews contents; Enter enters and Backspace goes back', async ({ page, workspace }) => {
  mkdirSync(join(workspace, 'field-notes'), { recursive: true });
  writeFileSync(join(workspace, 'field-notes', 'first.md'), '# First\n');
  const folder = page.getByRole('option', { name: 'field-notes', exact: true });
  await expect(folder).toBeVisible({ timeout: 15_000 });
  await folder.click();
  await expect(folder).toHaveAttribute('aria-selected', 'true');
  const preview = page.getByRole('complementary', { name: 'Preview', exact: true });
  await expect(preview.getByRole('heading', { name: 'field-notes', exact: true })).toBeVisible();
  await expect(preview).toContainText('first.md');
  await expect(page.getByRole('listbox', { name: 'Workspace contents' })).toBeVisible();
  await folder.press('Enter');
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText('field-notes');
  const file = page.getByRole('option', { name: 'first.md', exact: true });
  await expect(file).toBeVisible();
  await expect(preview.getByRole('heading', { name: 'field-notes', exact: true })).toBeVisible();
  await expect(file).toBeFocused();
  await page.keyboard.press('Backspace');
  await expect(page.getByRole('listbox', { name: 'Workspace contents' })).toBeVisible();
  await expect(folder).toBeVisible();
});

test('the workspace configuration folder is not offered', async ({ page }) => {
  await expect(page.locator(explorer).getByRole('option', { name: '.neuron', exact: true })).toHaveCount(0);
});

test('New tab returns to the root without closing the note tab', async ({ page }) => {
  const file = page.locator(explorer).locator('[data-file$=".md"]').first();
  const opened = (await file.getAttribute('data-file'))!;
  await file.dblclick();
  const tabs = page.getByRole('navigation', { name: 'Open notes' });
  // A preview tab's title adds a hint after the path.
  const tab = tabs.locator('button[title^="' + opened + '"]');
  await expect(tab).toBeVisible();
  await tabs.getByRole('button', { name: 'New tab', exact: true }).click();
  await expect(page.getByRole('listbox', { name: 'Workspace contents' })).toBeVisible();
  await expect(tab).toBeVisible();
  await tab.click();
  await expect(page.locator(explorer)).toHaveCount(0);
  await tabs.getByRole('button', { name: /^Close / }).click();
  await expect(page.locator(explorer)).toBeVisible();
});

test('an opened file is Recent and Clear empties Recent', async ({ page }) => {
  const file = page.locator(explorer).locator('[data-file$=".md"]').first();
  const opened = (await file.getAttribute('data-file'))!;
  await file.dblclick();
  await page.getByRole('button', { name: 'New tab', exact: true }).click();
  await expect(page.locator(explorer).locator('[data-recent="' + opened + '"]')).toBeVisible();
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Recent', exact: true })).toHaveCount(0);
});

test('a surface file opens in its surface', async ({ page, workspace }) => {
  writeFileSync(join(workspace, 'board.canvas'), JSON.stringify({ nodes: [], edges: [] }));
  const canvas = page.getByRole('option', { name: 'board.canvas', exact: true });
  await expect(canvas).toBeVisible({ timeout: 15_000 });
  await canvas.dblclick();
  await expect(page.locator(explorer)).toHaveCount(0);
  await expect(page.locator('.cm-content')).toHaveCount(0);
});

test('inline New file creates in the current folder and opens in Live', async ({ page, workspace }) => {
  mkdirSync(join(workspace, 'field-notes'), { recursive: true });
  writeFileSync(join(workspace, 'field-notes', 'existing.md'), '# Existing\n');
  const folder = page.getByRole('option', { name: 'field-notes', exact: true });
  await expect(folder).toBeVisible({ timeout: 15_000 });
  await folder.dblclick();
  await page.locator(explorer).getByRole('button', { name: 'New file', exact: true }).first().click();
  const name = page.getByRole('textbox', { name: 'File name', exact: true });
  await expect(name).toHaveValue('Untitled');
  await name.fill('Field report');
  await name.press('Enter');
  await expect.poll(() => existsSync(join(workspace, 'field-notes', 'Field report.md'))).toBe(true);
  expect(readFileSync(join(workspace, 'field-notes', 'Field report.md'), 'utf8')).toBe('# Field report\n\n');
  await expect(page.locator(explorer)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Live', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Close Field report', exact: true }).click();
  await expect(page.getByRole('listbox', { name: 'Workspace contents' })).toBeVisible();
});

test('inline names reject clashes and invalid characters; Escape cancels', async ({ page, workspace }) => {
  writeFileSync(join(workspace, 'Clash.md'), '# Keep this\n');
  await expect(page.getByRole('option', { name: 'Clash.md', exact: true })).toBeVisible({ timeout: 15_000 });
  await page.locator(explorer).getByRole('button', { name: 'New file', exact: true }).first().click();
  const name = page.getByRole('textbox', { name: 'File name', exact: true });
  await name.fill('clash');
  await name.press('Enter');
  await expect(page.locator(explorer).getByRole('alert')).toHaveText('That name already exists.');
  expect(readFileSync(join(workspace, 'Clash.md'), 'utf8')).toBe('# Keep this\n');
  await name.fill('bad/name');
  await name.press('Enter');
  await expect(name).toHaveAttribute('aria-invalid', 'true');
  await name.press('Escape');
  await expect(name).toHaveCount(0);
  await expect(page.getByRole('listbox', { name: 'Workspace contents' }).getByRole('option').first()).toBeFocused();
  expect(existsSync(join(workspace, 'bad'))).toBe(false);
});

test('New folder commits on blur, stays selected, and appears in the sidebar', async ({ page, workspace }) => {
  await page.locator(explorer).getByRole('button', { name: 'New folder', exact: true }).first().click();
  const name = page.getByRole('textbox', { name: 'Folder name', exact: true });
  await expect(name).toHaveValue('Untitled folder');
  await name.fill('Research');
  await name.press('Tab');
  await expect.poll(() => existsSync(join(workspace, 'Research'))).toBe(true);
  expect(statSync(join(workspace, 'Research')).isDirectory()).toBe(true);
  const item = page.getByRole('option', { name: 'Research', exact: true });
  await expect(item).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('complementary', { name: 'Workspace sidebar' }).getByRole('button', { name: 'Research', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(async () => {
    const api = (window as any).electronAPI;
    const repo = await api.repository.getCurrent();
    return api.settings.get('explorer.folders:' + repo.path);
  })).toContain('Research');
  await item.dblclick();
  await expect(page.locator('.explorer-empty')).toContainText('This folder is empty.');
  await expect(page.locator('.explorer-empty').getByRole('button', { name: 'New file', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('option', { name: 'Research', exact: true })).toBeVisible();
});

test('sidebar creates numbered root notes and folders without a dialog', async ({ page, workspace }) => {
  const sidebar = page.getByRole('complementary', { name: 'Workspace sidebar' });
  for (const filename of ['Untitled.md', 'Untitled 1.md']) {
    await sidebar.getByRole('button', { name: 'New note', exact: true }).click();
    await expect.poll(() => existsSync(join(workspace, filename))).toBe(true);
    expect(readFileSync(join(workspace, filename), 'utf8')).toBe('# Untitled\n\n');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Live', exact: true })).toHaveAttribute('aria-pressed', 'true');
  }
  for (const name of ['Untitled folder', 'Untitled folder 1']) {
    await sidebar.getByRole('button', { name: 'New section', exact: true }).click();
    await expect.poll(() => existsSync(join(workspace, name))).toBe(true);
    await expect(sidebar.getByRole('button', { name, exact: true })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  }
});

test('keyboard selection and Grid preference survive switching views', async ({ page }) => {
  const list = page.getByRole('listbox', { name: 'Workspace contents' });
  const options = list.getByRole('option');
  await options.first().click();
  await options.first().press('End');
  await expect(options.last()).toHaveAttribute('aria-selected', 'true');
  await options.last().press('Home');
  await expect(options.first()).toBeFocused();
  await page.getByRole('button', { name: 'Grid', exact: true }).click();
  await options.first().press('ArrowRight');
  await expect(options.nth(1)).toBeFocused();
  await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect.poll(() => page.evaluate(() => (window as any).electronAPI.settings.get('explorerView'))).toBe('grid');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Grid', exact: true })).toHaveAttribute('aria-pressed', 'true');
});


test('opening a browser tab leaves workspace home', async ({ page }) => {
  await page.getByRole('button', { name: 'New tab', exact: true }).click();
  await expect(page.locator(explorer)).toBeVisible();
  await page.getByRole('button', { name: 'Open website tab', exact: true }).click();
  await expect(page.locator(explorer)).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Open notes' }).getByRole('button', { name: 'duckduckgo.com', exact: true })).toBeVisible();
});
