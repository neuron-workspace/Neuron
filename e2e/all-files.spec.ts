import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures';

// A folder Neuron opens nothing in still shows everything in it.
test.use({
  prepareWorkspace: async ({}, use) => use((dir: string) => {
    writeFileSync(join(dir, 'a.txt'), 'hello');
    mkdirSync(join(dir, 'pics'));
    writeFileSync(join(dir, 'pics', 'photo.png'), 'not really a png');
    mkdirSync(join(dir, 'empty'));
    mkdirSync(join(dir, 'docs'));
    writeFileSync(join(dir, 'docs', 'report.pdf'), 'not really a pdf');
  }),
});

const explorer = '[data-workspace-explorer]';

test('every file and folder appears in the sidebar and the workspace home', async ({ app, page, workspace }) => {
  await app.evaluate(({ shell }) => {
    const store = globalThis as unknown as { __revealed?: string[] };
    store.__revealed = [];
    shell.showItemInFolder = (fullPath: string) => { store.__revealed!.push(fullPath); };
  });
  const sidebar = page.getByRole('complementary', { name: 'Workspace sidebar' });
  const tree = sidebar.locator('[data-sidebar-tree]');
  for (const name of ['pics', 'empty', 'docs']) await expect(tree.getByRole('button', { name, exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(tree.locator('[data-other-file="a.txt"]')).toBeVisible();
  await tree.getByRole('button', { name: 'pics', exact: true }).click();
  await tree.getByRole('button', { name: 'docs', exact: true }).click();
  await expect(tree.locator('[data-other-file="pics/photo.png"]')).toBeVisible();
  await expect(tree.locator('[data-other-file="docs/report.pdf"]')).toBeVisible();
  await expect(sidebar).not.toContainText('No notes yet');

  const list = page.getByRole('listbox', { name: 'Workspace contents' });
  for (const name of ['pics', 'empty', 'docs', 'a.txt']) await expect(list.getByRole('option', { name, exact: true })).toBeVisible();
  await expect(page.locator('.explorer-empty')).toHaveCount(0);
  await expect(list.getByRole('option', { name: 'pics', exact: true }).locator('.explorer-item-detail')).toHaveText('1 other file');
  await expect(list.getByRole('option', { name: 'empty', exact: true }).locator('.explorer-item-detail')).toHaveText('Empty');
  const preview = page.getByRole('complementary', { name: 'Preview', exact: true });
  await expect(preview).toContainText('3 folders, 3 other files');
  await page.getByRole('button', { name: 'Grid', exact: true }).click();
  await expect(list.getByRole('option', { name: 'pics', exact: true }).locator('.explorer-item-detail')).toHaveText('1 item');
  await expect(list.getByRole('option', { name: 'empty', exact: true }).locator('.explorer-item-detail')).toHaveText('Empty');
  await page.getByRole('button', { name: 'List', exact: true }).click();
  await expect(page.locator(explorer).locator('.explorer-notice')).toHaveCount(0);

  // Selecting or "opening" an other file opens nothing.
  const tabs = page.getByRole('navigation', { name: 'Open notes' });
  const file = list.getByRole('option', { name: 'a.txt', exact: true });
  await file.click();
  await expect(file).toHaveAttribute('aria-selected', 'true');
  await expect(preview.getByRole('heading', { name: 'a.txt', exact: true })).toBeVisible();
  await expect(preview).toContainText('5 bytes');
  await expect(preview.getByRole('button', { name: 'Open', exact: true })).toHaveCount(0);
  await file.dblclick();
  await file.press('Enter');
  await expect(page.locator(explorer)).toBeVisible();
  await expect(tabs.getByRole('button', { name: /^Close / })).toHaveCount(0);
  await tree.locator('[data-other-file="a.txt"] button').click();
  await expect(tree.locator('[data-other-file="a.txt"]')).toHaveAttribute('data-selected', 'true');
  await expect(page.locator(explorer)).toBeVisible();
  await expect(tabs.getByRole('button', { name: /^Close / })).toHaveCount(0);

  await preview.getByRole('button', { name: 'Show in folder', exact: true }).click();
  await tree.locator('[data-other-file="docs/report.pdf"]').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Show in folder', exact: true }).click();
  await expect.poll(() => app.evaluate(() => (globalThis as unknown as { __revealed?: string[] }).__revealed ?? []))
    .toEqual([join(workspace, 'a.txt'), join(workspace, 'docs', 'report.pdf')]);

  // Files added outside the app join the listing.
  writeFileSync(join(workspace, 'docs', 'later.txt'), 'a,b\n');
  await expect(tree.locator('[data-other-file="docs/later.txt"]')).toBeVisible({ timeout: 15_000 });
  await expect(list.getByRole('option', { name: 'docs', exact: true }).locator('.explorer-item-detail')).toHaveText('2 other files');

  // The watcher never reports a new empty folder; coming back to the window does.
  mkdirSync(join(workspace, 'fresh'));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(list.getByRole('option', { name: 'fresh', exact: true })).toBeVisible();
  await expect(tree.getByRole('button', { name: 'fresh', exact: true })).toBeVisible();
});

test('reveal refuses a path outside the workspace', async ({ app, page }) => {
  await app.evaluate(({ shell }) => {
    const store = globalThis as unknown as { __revealed?: string[] };
    store.__revealed = [];
    shell.showItemInFolder = (fullPath: string) => { store.__revealed!.push(fullPath); };
  });
  const results = await page.evaluate(async () => {
    const api = (window as unknown as { electronAPI: { revealInFolder(path: string): Promise<{ success: boolean }> } }).electronAPI;
    return Promise.all(['../userData/neuron-settings.json', 'C:\\Windows\\notepad.exe', '/etc/passwd', 'missing.txt'].map((path) => api.revealInFolder(path)));
  });
  expect(results.map((result) => result.success)).toEqual([false, false, false, false]);
  expect(await app.evaluate(() => (globalThis as unknown as { __revealed?: string[] }).__revealed ?? [])).toEqual([]);
});
