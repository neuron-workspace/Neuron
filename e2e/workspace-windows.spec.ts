import { test, expect, openSettings } from './fixtures';
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

const sidebar = (page: Page) => page.getByRole('complementary', { name: 'Workspace sidebar' });
const sidebarButton = (page: Page, name: string) => sidebar(page).getByRole('button', { name, exact: true });

test('Settings opens in its own window, and a theme change there reaches the workspace', async ({ app, page }) => {
  await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('light');

  const settings = await openSettings(app, page, 'appearance', () => sidebarButton(page, 'Settings').click());
  await expect(settings.locator('[data-utility-window="settings"]')).toBeVisible();
  // It is a page about the app: no workspace, no workspace sidebar.
  await expect(settings.getByRole('complementary', { name: 'Workspace sidebar' })).toHaveCount(0);
  expect(await api(settings, 'api.repository.getCurrent()')).toBeNull();
  expect(await api(settings, 'api.listNotes()')).toEqual([]);
  // The workspace window stayed on its notes.
  await expect(sidebar(page)).toBeVisible();

  await settings.getByRole('button', { name: /^Graphite$/ }).first().click();
  await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('dark');
});

test('Plugins opens Settings at Plugins, and the workspace window keeps its notes and graph', async ({ app, page }) => {
  await expect(page.locator('.note-row').first()).toBeVisible();
  const settings = await openSettings(app, page, 'plugins', () => sidebarButton(page, 'Plugins & integrations').click());
  await expect(settings.getByRole('heading', { name: 'Plugins & integrations', level: 1 })).toBeVisible();
  // Nothing about plugins took over the workspace window's main area.
  await expect(page.getByPlaceholder('Search plugins')).toHaveCount(0);
  await expect(page.locator('.note-row').first()).toBeVisible();

  await sidebarButton(page, 'Graph').click();
  await expect(page.getByRole('complementary', { name: 'Workspace graph' })).toBeVisible();
});

test('a plugin switched on and off in Settings adds and removes its panel in the workspace window', async ({ app, page }) => {
  await page.getByRole('button', { name: 'Show panel', exact: true }).click();
  const daily = page.locator('[data-dock-group^="right:"]').getByRole('button', { name: 'Daily', exact: true });
  await expect(page.locator('[data-dock-group^="right:"]').getByRole('button', { name: 'Graph', exact: true })).toBeVisible();
  await expect(daily).toHaveCount(0);

  const settings = await openSettings(app, page, 'plugins');
  await settings.getByPlaceholder('Search plugins').fill('Daily Notes');
  const toggle = settings.getByRole('switch', { name: 'Enable Daily Notes' });
  await toggle.check();
  // No reload: the workspace window follows the setting.
  await expect(daily).toBeVisible();
  await toggle.uncheck();
  await expect(daily).toHaveCount(0);
  // Settings itself never echoed the value back over the newer one.
  await expect.poll(() => api(page, 'api.settings.get("plugins")').then((s: any) => s?.enabled?.['daily-calendar'])).toBe(false);
});

test('Settings sections switch, and asking again brings the same window forward at the new section', async ({ app, page }) => {
  const settings = await openSettings(app, page, 'appearance');
  const sections = settings.getByRole('navigation', { name: 'Settings sections' });
  const title = settings.getByRole('heading', { level: 1 });
  for (const [row, heading] of [['Keyboard', 'Keyboard'], ['Editor', 'Editor'], ['Plugins', 'Plugins & integrations'], ['Workspaces', 'Workspaces'], ['About', 'About'], ['Appearance', 'Appearance']]) {
    await sections.getByRole('button', { name: row, exact: true }).click();
    await expect(title).toHaveText(heading);
    await expect(sections.getByRole('button', { name: row, exact: true })).toHaveAttribute('aria-current', 'page');
  }
  await expect(settings.getByRole('group', { name: 'Application theme' })).toBeVisible();

  const again = await openSettings(app, page, 'workspaces', () => sidebarButton(page, 'Workspaces').click());
  expect(again).toBe(settings);
  await expect(title).toHaveText('Workspaces');
  expect(app.windows()).toHaveLength(2);
  await openSettings(app, page, 'plugins', () => sidebarButton(page, 'Plugins & integrations').click());
  await expect(title).toHaveText('Plugins & integrations');
  expect(app.windows()).toHaveLength(2);
});

test('This workspace › General shows the opener, and a rename there reaches its switcher', async ({ app, page, workspace }) => {
  await expect(page.locator('.note-row').first()).toBeVisible();
  const settings = await openSettings(app, page, 'workspace');
  const group = settings.getByRole('group', { name: 'This workspace' });
  await expect(group).toContainText('workspace');
  await expect(settings.getByRole('heading', { name: 'General', level: 1 })).toBeVisible();
  await expect(settings.getByLabel('Folder')).toHaveText(workspace);

  const name = settings.getByLabel('Name', { exact: true });
  await expect(name).toHaveValue('workspace');
  await name.fill('Field notes');
  await settings.getByRole('button', { name: 'Save name' }).click();
  await expect(page.locator('.titlebar').getByRole('button', { name: /Field notes/ })).toBeVisible();
  await expect(group).toContainText('Field notes');
});

test('Settings opened from a window with no workspace has no workspace section', async ({ app, page }) => {
  // Forget the open workspace in its own window, which leaves that window empty.
  await page.evaluate((dir) => (window as unknown as Api).electronAPI.repository.remove(dir),
    (await api(page, 'api.repository.getCurrent()') as { path: string }).path);
  const settings = await openSettings(app, page, 'appearance');
  await expect(settings.getByText('Open a workspace to change its settings.')).toBeVisible();
  expect(await api(settings, 'api.windowControls.openerWorkspace()')).toBeNull();
});

test('the Workspaces section lists the current workspace and offers the three ways in', async ({ app, page, workspace }) => {
  const settings = await openSettings(app, page, 'workspaces', () => sidebarButton(page, 'Workspaces').click());
  await expect(settings.getByRole('button', { name: 'Open folder…' })).toBeVisible();
  await expect(settings.getByRole('button', { name: 'Create workspace…' })).toBeVisible();
  await expect(settings.getByText('Start from a template')).toBeVisible();
  const row = settings.locator(`[data-workspace-row="${workspace.replace(/\\/g, '\\\\')}"]`);
  await expect(row).toContainText(workspace);
  // It is on screen already, so its button brings that window forward.
  await row.getByRole('button', { name: 'Show window' }).click();
  expect(app.windows()).toHaveLength(2);
  await row.getByRole('button', { name: /More actions for/ }).click();
  for (const item of ['Rename', 'Reveal in file manager', 'Remove from list']) {
    await expect(settings.getByRole('menuitem', { name: item })).toBeVisible();
  }
});

test('the bridge refuses Settings sections it does not know', async ({ app, page }) => {
  for (const junk of ['"settings"', '"repositories"', '"Plugins"', '"../plugins"', '42', 'null', '{}']) {
    expect(await api(page, `api.windowControls.openPage(${junk})`)).toEqual({ success: false });
  }
  expect(app.windows()).toHaveLength(1);
  // Only the Settings window is told who opened it.
  expect(await api(page, 'api.windowControls.openerWorkspace()')).toBeNull();
});
