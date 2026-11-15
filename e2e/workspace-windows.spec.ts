import { test, expect } from './fixtures';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ElectronApplication, Page } from '@playwright/test';

type Api = { electronAPI: any };
const api = (page: Page, run: string) => page.evaluate(`(async () => { const api = window.electronAPI; return ${run}; })()`);

/** A second workspace beside the test's own, with one note that exists nowhere else. */
function otherWorkspace(workspace: string): string {
  const dir = join(workspace, '..', 'other-workspace');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'only-here.md'), '# Only here\n');
  return dir;
}

async function nextWindow(app: ElectronApplication, action: () => Promise<unknown>): Promise<Page> {
  const [opened] = await Promise.all([app.waitForEvent('window'), action()]);
  await opened.waitForLoadState('domcontentloaded');
  return opened;
}

test('opening another workspace gives it its own window and leaves this one alone', async ({ app, page, workspace }) => {
  const other = otherWorkspace(workspace);
  const before = await api(page, 'api.listNotes()') as string[];
  expect(before).not.toContain('only-here.md');

  const second = await nextWindow(app, () => page.evaluate((dir) => (window as unknown as Api).electronAPI.repository.switch(dir), other));

  // The new window shows the other folder...
  await expect.poll(() => api(second, 'api.listNotes()')).toEqual(['only-here.md']);
  expect((await api(second, 'api.repository.getCurrent()') as { path: string }).path).toBe(other);
  // ...and the first still shows its own, files and all.
  expect((await api(page, 'api.repository.getCurrent()') as { path: string }).path).toBe(workspace);
  expect(await api(page, 'api.listNotes()')).toEqual(before);

  // Each window reads only inside its own workspace, even when asked to climb out.
  expect(await api(second, 'api.readNote("only-here.md")')).toContain('Only here');
  expect(String(await api(page, 'api.readNote("only-here.md")'))).not.toContain('Only here');
  expect(String(await api(page, 'api.readNote("../other-workspace/only-here.md")'))).not.toContain('Only here');

  // Opening the same folder again brings its window forward; no third window.
  await page.evaluate((dir) => (window as unknown as Api).electronAPI.repository.switch(dir), other);
  await expect.poll(() => app.windows().length).toBe(2);
});

test('a terminal belongs to the window that started it', async ({ app, page, workspace }) => {
  const other = otherWorkspace(workspace);
  const second = await nextWindow(app, () => page.evaluate((dir) => (window as unknown as Api).electronAPI.repository.switch(dir), other));

  const first = await api(page, 'api.terminal.spawn({ key: "probe" })') as number;
  const theirs = await api(second, 'api.terminal.spawn({ key: "probe" })') as number;
  expect(theirs).not.toBe(first);

  // The other window can neither read nor end a shell it did not start.
  await expect.poll(() => api(page, `api.terminal.history(${first})`), { timeout: 30_000 }).not.toBe('');
  expect(await api(second, `api.terminal.history(${first})`)).toBe('');
  await api(second, `api.terminal.kill(${first})`);
  await api(page, `api.terminal.write(${first}, "echo still-mine\\r")`);
  await expect.poll(() => api(page, `api.terminal.history(${first})`), { timeout: 30_000 }).toContain('still-mine');
});

test('Settings opens in its own window, and a theme change there reaches the workspace', async ({ app, page }) => {
  await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('light');

  const settings = await nextWindow(app, () => page.getByRole('button', { name: 'Settings', exact: true }).first().click());
  await expect(settings.locator('[data-utility-window="settings"]')).toBeVisible();
  // It is a page about the app: no workspace, no sidebar.
  await expect(settings.getByRole('complementary', { name: 'Workspace sidebar' })).toHaveCount(0);
  expect(await api(settings, 'api.repository.getCurrent()')).toBeNull();
  // The workspace window stayed on its notes.
  await expect(page.getByRole('complementary', { name: 'Workspace sidebar' })).toBeVisible();

  await settings.getByRole('button', { name: /^Graphite$/ }).first().click();
  await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('dark');

  // Asking again brings the same window forward.
  await page.getByRole('button', { name: 'Settings', exact: true }).first().click();
  await expect.poll(() => app.windows().length).toBe(2);
});

test('Workspaces opens the manager in its own window', async ({ app, page }) => {
  const manager = await nextWindow(app, () => page.getByRole('button', { name: 'Workspaces', exact: true }).first().click());
  await expect(manager.locator('[data-utility-window="workspaces"]')).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Workspace sidebar' })).toBeVisible();
});
