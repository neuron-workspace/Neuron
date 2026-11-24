import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ElectronApplication, Page } from '@playwright/test';
import { test, expect, openNote, openSettings } from '../fixtures';

// Integration: workspace windows and the welcome page. The main flows only;
// workspace-windows.spec.ts, workspace-explorer.spec.ts and app.spec.ts hold
// the detail.

type Api = { electronAPI: any };
const current = (page: Page) => page.evaluate(() => (window as unknown as Api).electronAPI.repository.getCurrent().then((r: any) => r?.path ?? null));

/** A second workspace beside the test's own, with one note that exists nowhere else. */
function otherWorkspace(workspace: string): string {
  const dir = join(workspace, '..', 'other-workspace');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'only-here.md'), '# Only here\n');
  return dir;
}

/** The workspaces Neuron knows, written from inside main as the settings file holds them. */
async function knowWorkspaces(app: ElectronApplication, page: Page, recent: string[]) {
  await expect(page.locator('.note-row').first()).toBeVisible();
  await app.evaluate(({ app: electronApp }, dirs) => {
    const fs = process.mainModule!.require('node:fs') as typeof import('node:fs');
    const file = `${electronApp.getPath('userData')}/neuron-settings.json`;
    const settings = JSON.parse(fs.readFileSync(file, 'utf-8'));
    settings.repositories.recent = dirs;
    fs.writeFileSync(file, JSON.stringify(settings, null, 2));
  }, recent);
}

test('the app opens one window on its workspace; the explorer and the palette open a note', async ({ app, page }) => {
  expect(app.windows()).toHaveLength(1);
  await expect(page.locator('.note-row').first()).toBeVisible();
  // With nothing open, the editor area is the workspace explorer.
  const explorer = page.locator('[data-workspace-explorer]');
  await expect(explorer).toBeVisible();
  await page.getByRole('listbox', { name: 'Workspace contents' }).getByRole('option', { name: 'getting-started.mdx', exact: true }).dblclick();
  await expect(explorer).toHaveCount(0);
  await expect(page.getByLabel('Note path')).toContainText('getting-started.mdx');

  await openNote(page, 'guides/markdown-basics.mdx');
  await expect(page.getByLabel('Note path')).toContainText('markdown-basics.mdx');
  await expect(page.locator('article.preview-prose h1').first()).toBeVisible();
});

test('opening another workspace gives it its own window and leaves this one alone', async ({ app, page, workspace }) => {
  const other = otherWorkspace(workspace);
  const [second] = await Promise.all([
    app.waitForEvent('window'),
    page.evaluate((dir) => (window as unknown as Api).electronAPI.repository.switch(dir), other),
  ]);
  await second.waitForLoadState('domcontentloaded');
  await expect(second.locator('.note-row', { hasText: 'only-here' }).first()).toBeVisible({ timeout: 30_000 });
  expect(await current(second)).toBe(other);
  expect(await current(page)).toBe(workspace);
  await expect(page.locator('.note-row', { hasText: 'only-here' })).toHaveCount(0);
});

test('the welcome page lists the known workspaces and opens one', async ({ app, page, workspace }) => {
  const other = otherWorkspace(workspace);
  await knowWorkspaces(app, page, [workspace, other]);
  // Forgetting this window's own workspace leaves it on the welcome page.
  await page.evaluate((dir) => (window as unknown as Api).electronAPI.repository.remove(dir), workspace);
  const welcome = page.locator('[data-welcome-page]');
  await expect(welcome).toBeVisible();
  const row = page.getByRole('navigation', { name: 'Workspaces' }).locator('[data-workspace-row]').filter({ hasText: 'other-workspace' });
  await expect(row).toBeVisible();
  await row.getByRole('button').first().click();
  await expect.poll(() => current(page)).toBe(other);
  await expect(welcome).toHaveCount(0);
  await expect(page.locator('.note-row', { hasText: 'only-here' }).first()).toBeVisible();
  expect(app.windows()).toHaveLength(1);
});

test('Settings opens in its own window, and a theme chosen there reaches the workspace', async ({ app, page }) => {
  await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('light');
  const sidebar = page.getByRole('complementary', { name: 'Workspace sidebar' });
  const settings = await openSettings(app, page, 'appearance', () => sidebar.getByRole('button', { name: 'Settings', exact: true }).click());
  await expect(settings.locator('[data-utility-window="settings"]')).toBeVisible();
  await settings.getByRole('button', { name: /^Graphite$/ }).first().click();
  await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('dark');
  expect(app.windows()).toHaveLength(2);
});
