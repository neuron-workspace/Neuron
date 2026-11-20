import { test, expect, keychain, openSettings, openWorkspaceSettings, setPluginEnabled } from './fixtures';
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join, sep } from 'node:path';
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

/** The settings key a workspace's plugins are kept under, normalised as the app does. */
const pluginsKey = (dir: string) => `plugins:${process.platform === 'win32' || process.platform === 'darwin' ? dir.toLowerCase() : dir}`;

test('Plugins opens Workspace settings in this window, and the notes and graph stay', async ({ app, page }) => {
  await expect(page.locator('.note-row').first()).toBeVisible();
  await sidebarButton(page, 'Plugins & integrations').click();
  const dialog = page.locator('[data-workspace-settings="plugins"]');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Plugins' })).toBeVisible();
  // No Settings window: plugins are this workspace's business.
  expect(app.windows()).toHaveLength(1);
  // The dialog's Close button, not Escape: Escape does not reach it under xvfb on the Linux runner.
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.note-row').first()).toBeVisible();

  await sidebarButton(page, 'Graph').click();
  await expect(page.getByRole('complementary', { name: 'Workspace graph' })).toBeVisible();
});

test('a plugin switched on and off in Workspace settings adds and removes its panel', async ({ page, workspace }) => {
  await page.getByRole('button', { name: 'Show panel', exact: true }).click();
  const daily = page.locator('[data-dock-group^="right:"]').getByRole('button', { name: 'Daily', exact: true });
  await expect(page.locator('[data-dock-group^="right:"]').getByRole('button', { name: 'Graph', exact: true })).toBeVisible();
  await expect(daily).toHaveCount(0);

  const dialog = await openWorkspaceSettings(page, 'plugins');
  await dialog.getByPlaceholder('Search plugins').fill('Daily Notes');
  const toggle = dialog.getByRole('switch', { name: 'Enable Daily Notes' });
  await toggle.check();
  await expect.poll(() => api(page, `api.settings.get(${JSON.stringify(pluginsKey(workspace))})`).then((s: any) => s?.enabled?.['daily-calendar'])).toBe(true);
  await page.keyboard.press('Escape');
  await expect(daily).toBeVisible();
  const again = await openWorkspaceSettings(page, 'plugins');
  await again.getByPlaceholder('Search plugins').fill('Daily Notes');
  await again.getByRole('switch', { name: 'Enable Daily Notes' }).uncheck();
  await page.keyboard.press('Escape');
  await expect(daily).toHaveCount(0);
  // Kept per workspace, and the old global record is not written.
  await expect.poll(() => api(page, `api.settings.get(${JSON.stringify(pluginsKey(workspace))})`).then((s: any) => s?.enabled?.['daily-calendar'])).toBe(false);
  expect(await api(page, 'api.settings.get("plugins")')).toBeNull();
});

test('the Terminal switched on in one workspace stays off in another', async ({ app, page, workspace }) => {
  const other = otherWorkspace(workspace);
  const second = await nextWindow(app, () => page.evaluate((dir) => (window as unknown as Api).electronAPI.repository.switch(dir), other));
  const offIn = (p: Page) => p.getByRole('button', { name: 'Enable the Terminal plugin' });
  const onIn = (p: Page) => p.getByRole('button', { name: /^(Show|Hide) terminal$/ });

  // Terminal is on by default; switch it off in both, then back on in the first only.
  await setPluginEnabled(app, second, 'Workspace Terminal', false);
  await expect(offIn(second)).toBeVisible();
  await setPluginEnabled(app, page, 'Workspace Terminal', false);
  await expect(offIn(page)).toBeVisible();
  await setPluginEnabled(app, page, 'Workspace Terminal', true);
  await expect(onIn(page)).toBeVisible();
  await page.getByRole('button', { name: 'Show bottom peek', exact: true }).click();
  await expect(page.getByRole('complementary', { name: 'Bottom plugin peek' }).getByRole('button', { name: 'Terminal', exact: true })).toBeVisible();
  // The other workspace's window did not follow.
  await expect(offIn(second)).toBeVisible();
  expect(await api(second, `api.settings.get(${JSON.stringify(pluginsKey(other))})`).then((s: any) => s?.enabled?.terminal)).toBe(false);
});

test('Settings shows Connectors and no plugin switches; a saved key is never shown again', async ({ app, page }) => {
  // Saving needs a real keychain, and Neuron refuses without one (that refusal
  // is tested in secrets.spec.ts). Only Linux can lack one; anywhere else an
  // unusable keychain is a bug, so the test runs and fails.
  const store = await keychain(app);
  test.skip(process.platform === 'linux' && !store.usable,
    `No usable system keychain on this Linux machine (${store.backend}, encryption ${store.available ? 'available' : 'unavailable'}), so Neuron rightly will not save a key.`);
  const settings = await openSettings(app, page, 'connectors');
  await expect(settings.getByRole('heading', { name: 'Connectors', level: 1 })).toBeVisible();
  await expect(settings.getByRole('switch')).toHaveCount(0);
  await expect(settings.getByPlaceholder('Search plugins')).toHaveCount(0);
  for (const name of ['Claude', 'OpenAI', 'Gemini', 'OpenRouter', 'Local model']) {
    await expect(settings.getByRole('heading', { name, exact: true, level: 3 })).toBeVisible();
  }

  const claude = settings.locator('[data-connector="anthropic"]');
  await expect(claude).toContainText('Not set up');
  await claude.getByRole('button', { name: 'Set up Claude' }).click();
  await claude.getByLabel('Anthropic API key').fill('sk-ant-e2e-WRITE-ONLY');
  await claude.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(claude).toContainText('Connected');
  // Write-only: the key is nowhere in the page, not even in a field's value.
  const leaked = () => settings.evaluate(() => document.documentElement.outerHTML.includes('WRITE-ONLY')
    || [...document.querySelectorAll('input')].some((i) => i.value.includes('WRITE-ONLY')));
  expect(await leaked()).toBe(false);
  await claude.getByRole('button', { name: 'Change Claude' }).click();
  await expect(claude.getByText('Saved', { exact: true })).toBeVisible();
  await expect(claude.getByRole('button', { name: 'Replace' })).toBeVisible();
  expect(await leaked()).toBe(false);
  await claude.getByRole('button', { name: 'Cancel' }).click();

  // Global: the workspace window sees it as set up too, without a reload.
  const dialog = await openWorkspaceSettings(page, 'plugins');
  await expect(dialog.locator('[data-plugin-row="ai-claude"] [data-connector-line="anthropic"]')).toContainText('Uses Claude');

  await claude.getByRole('button', { name: 'Disconnect Claude' }).click();
  await expect(claude).toContainText('Not set up');
  await expect(dialog.locator('[data-plugin-row="ai-claude"]')).toContainText('Set up Claude in Settings');
});

test('a plugin whose connector is not set up offers to set it up, in Settings at Connectors', async ({ app, page }) => {
  const dialog = await openWorkspaceSettings(page, 'plugins');
  const row = dialog.locator('[data-plugin-row="ai-openai"]');
  await expect(row).toContainText('Set up OpenAI in Settings');
  const [settings] = await Promise.all([app.waitForEvent('window'), row.getByRole('button', { name: 'Set up', exact: true }).click()]);
  await settings.waitForLoadState('domcontentloaded');
  await expect(settings.locator('[data-settings-section="connectors"]')).toBeVisible();
});

test('the AI bridge refuses a provider with no connector set up, and never takes a key from the request', async ({ page }) => {
  const result = await api(page, 'api.ai.complete({ provider: "openai", messages: [{ role: "user", content: "hi" }], config: { apiKey: "sk-from-renderer" } })') as { success: boolean; error: string };
  expect(result.success).toBe(false);
  expect(result.error).toContain('not set up');
  for (const junk of ['"toString"', '"__proto__"', '42', 'null']) {
    expect((await api(page, `api.ai.complete({ provider: ${junk}, messages: [{ role: "user", content: "hi" }] })`) as { success: boolean }).success).toBe(false);
  }
});

test('Settings sections switch, and asking again brings the same window forward at the new section', async ({ app, page }) => {
  const settings = await openSettings(app, page, 'appearance');
  const sections = settings.getByRole('navigation', { name: 'Settings sections' });
  const title = settings.getByRole('heading', { level: 1 });
  await expect(sections.getByRole('button').first()).toHaveText('Workspaces');
  for (const [row, heading] of [['Keyboard', 'Keyboard'], ['Editor', 'Editor'], ['Connectors', 'Connectors'], ['Workspaces', 'Workspaces'], ['About', 'About'], ['Appearance', 'Appearance']]) {
    await sections.getByRole('button', { name: row, exact: true }).click();
    await expect(title).toHaveText(heading);
    await expect(sections.getByRole('button', { name: row, exact: true })).toHaveAttribute('aria-current', 'page');
  }
  await expect(settings.getByRole('group', { name: 'Application theme' })).toBeVisible();

  const again = await openSettings(app, page, 'workspaces', () => sidebarButton(page, 'Workspaces').click());
  expect(again).toBe(settings);
  await expect(title).toHaveText('Workspaces');
  expect(app.windows()).toHaveLength(2);
  // The old ids still open something sensible.
  await openSettings(app, page, 'connectors', () => api(page, 'api.windowControls.openPage("plugins")'));
  await expect(title).toHaveText('Connectors');
  await openSettings(app, page, 'appearance', () => api(page, 'api.windowControls.openPage("workspace")'));
  await expect(title).toHaveText('Appearance');
  expect(app.windows()).toHaveLength(2);
});

test('Workspace settings… in the switcher opens General, and a rename there reaches the switcher', async ({ app, page, workspace }) => {
  await expect(page.locator('.note-row').first()).toBeVisible();
  const dialog = await openWorkspaceSettings(page, 'general');
  await expect(dialog.getByRole('heading', { name: 'General' })).toBeVisible();
  await expect(dialog.getByLabel('Folder')).toHaveText(workspace);

  const name = dialog.getByLabel('Name', { exact: true });
  await expect(name).toHaveValue('workspace');
  await name.fill('Field notes');
  await dialog.getByRole('button', { name: 'Save name' }).click();
  await expect(dialog.getByRole('navigation', { name: 'Workspace settings sections' })).toContainText('Field notes');
  // The dialog is modal, so the switcher behind it is reachable once it closes.
  await page.keyboard.press('Escape');
  await expect(page.locator('.titlebar').getByRole('button', { name: /Field notes/ })).toBeVisible();

  // The Settings window no longer has a section for one workspace.
  const settings = await openSettings(app, page, 'appearance');
  await expect(settings.getByRole('group', { name: 'This workspace' })).toHaveCount(0);
  await expect(settings.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'General' })).toHaveCount(0);
});

test('Settings opened from a window with no workspace still opens, with no opener', async ({ app, page }) => {
  // Forget the open workspace in its own window, which leaves that window empty.
  await page.evaluate((dir) => (window as unknown as Api).electronAPI.repository.remove(dir),
    (await api(page, 'api.repository.getCurrent()') as { path: string }).path);
  const settings = await openSettings(app, page, 'appearance');
  await expect(settings.getByRole('heading', { name: 'Appearance', level: 1 })).toBeVisible();
  expect(await api(settings, 'api.windowControls.openerWorkspace()')).toBeNull();
});

test('removing the current workspace from Settings shows welcome without reloading', async ({ app, page, workspace }) => {
  // Only this workspace is known (startup adds the checkout's demo in development).
  await knowWorkspaces(app, [workspace]);
  const settings = await openSettings(app, page, 'workspaces');
  const row = settings.locator('[data-workspace-row]').filter({ hasText: workspace });
  await row.getByRole('button', { name: /More actions for/ }).click();
  await settings.getByRole('menuitem', { name: 'Remove from list' }).click();
  await row.getByRole('button', { name: 'Remove', exact: true }).click();
  expect(await api(page, 'api.repository.getCurrent()')).toBeNull();
  const welcome = page.locator('[data-welcome-page]');
  await expect(welcome.getByRole('heading', { name: 'Neuron', exact: true, level: 1 })).toBeVisible();
  // Nothing known: no workspace column, and the start stays centred with focus on Create.
  await expect(welcome.getByRole('navigation', { name: 'Workspaces' })).toHaveCount(0);
  await expect(welcome.getByRole('button')).toHaveCount(3);
  await expect(actionButton(page, 'Create')).toBeFocused();
  await expect(actionButton(page, 'Open')).toBeVisible();
  await expect(actionButton(page, 'Browse')).toBeVisible();
});

/**
 * Set the workspaces Neuron knows, most recent first, as the settings file
 * holds them; main reads it on every request. Written from inside the main
 * process, in one synchronous step: written from here, it raced the app's own
 * settings writes and was lost now and then.
 */
async function knowWorkspaces(app: ElectronApplication, recent: string[]) {
  // After the first window has read its own list, so nothing read before this
  // write lands after it.
  await expect(app.windows()[0].locator('.note-row').first()).toBeVisible();
  await app.evaluate(({ app: electronApp }, dirs) => {
    const fs = process.mainModule!.require('node:fs') as typeof import('node:fs');
    const file = `${electronApp.getPath('userData')}/neuron-settings.json`;
    const settings = JSON.parse(fs.readFileSync(file, 'utf-8'));
    settings.repositories.recent = dirs;
    fs.writeFileSync(file, JSON.stringify(settings, null, 2));
  }, recent);
}

/** Forget this window's own workspace, which leaves it on the welcome page. */
async function toWelcome(page: Page, workspace: string) {
  await page.evaluate((dir) => (window as unknown as Api).electronAPI.repository.remove(dir), workspace);
  await expect(page.locator('[data-welcome-page]')).toBeVisible();
}

/** What a window does when it comes forward: ask for the list again. */
const refocus = (page: Page) => page.evaluate(() => window.dispatchEvent(new Event('focus')));

const welcomeRows = (page: Page) => page.getByRole('navigation', { name: 'Workspaces' }).locator('[data-workspace-row]');
const actionButton = (page: Page, action: 'Create' | 'Open' | 'Browse') =>
  page.locator(`[data-welcome-action="${action}"]`).getByRole('button', { name: new RegExp(`^${action}\\b`) });

/** Answer the next native folder pickers with `pick` (or cancel), and record their titles. */
async function stubFolderPicker(app: ElectronApplication, pick: string | null = null) {
  await app.evaluate(({ dialog }, chosen) => {
    const store = globalThis as unknown as { __pickerTitles: string[] };
    store.__pickerTitles = [];
    dialog.showOpenDialog = (async (...args: unknown[]) => {
      const options = (args.length > 1 ? args[1] : args[0]) as { title?: string };
      store.__pickerTitles.push(options.title ?? '');
      return chosen ? { canceled: false, filePaths: [chosen] } : { canceled: true, filePaths: [] };
    }) as typeof dialog.showOpenDialog;
  }, pick);
}
const pickerTitles = (app: ElectronApplication) => app.evaluate(() => (globalThis as unknown as { __pickerTitles: string[] }).__pickerTitles);

test('the welcome page lists every known workspace, most recent first, and opens one', async ({ app, page, workspace }) => {
  const other = otherWorkspace(workspace);
  const third = join(workspace, '..', 'third-workspace');
  mkdirSync(third);
  await knowWorkspaces(app, [workspace, other, third]);
  await toWelcome(page, workspace);

  const rows = welcomeRows(page);
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('other-workspace');
  await expect(rows.nth(1)).toContainText('third-workspace');
  // The full path is the row's tooltip; the visible one may be shortened in the middle.
  await expect(rows.nth(0).getByRole('button').first()).toHaveAttribute('title', other);
  await expect(rows.nth(0).getByRole('button', { name: 'Workspace actions' })).toHaveCount(1);

  // Focus starts on the first workspace; the arrow keys move through the list.
  const first = rows.nth(0).getByRole('button').first();
  const second = rows.nth(1).getByRole('button').first();
  await expect(first).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(second).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(first).toBeFocused();

  // Enter opens it, in this empty window.
  await page.keyboard.press('Enter');
  await expect.poll(() => api(page, 'api.repository.getCurrent()').then((r: any) => r?.path)).toBe(other);
  await expect(page.locator('[data-welcome-page]')).toHaveCount(0);
  expect(app.windows()).toHaveLength(1);
});

test('a workspace whose folder is gone stays listed as "Folder not found", says so when opened, and comes back', async ({ app, page, workspace }) => {
  const other = otherWorkspace(workspace);
  const away = `${other}-away`;
  await knowWorkspaces(app, [workspace, other]);
  await toWelcome(page, workspace);
  const row = welcomeRows(page).filter({ hasText: 'other-workspace' });
  await expect(row).toBeVisible();
  await expect(row).not.toContainText('Folder not found');

  // The drive is unplugged, say.
  renameSync(other, away);
  await refocus(page);
  await expect(row).toContainText('Folder not found');
  await row.getByRole('button').first().click();
  await expect(page.getByRole('alert')).toContainText('Folder not found');
  await expect(page.locator('[data-welcome-page]')).toBeVisible();
  await expect(row).toBeVisible();
  await page.getByRole('alert').getByRole('button', { name: 'Dismiss' }).click();

  // Settings › Workspaces marks it too, offers to remove it, and says so when it is opened.
  const settings = await openSettings(app, page, 'workspaces');
  const listed = settings.locator('[data-workspace-row]').filter({ hasText: other });
  await expect(listed).toContainText('Folder not found');
  await expect(listed.getByRole('button', { name: 'Remove from list' })).toBeVisible();
  await listed.getByRole('button', { name: 'other-workspace', exact: true }).click();
  await expect(settings.getByRole('alert')).toContainText('Folder not found');
  expect(app.windows()).toHaveLength(2);

  // Plugged back in: both lists show it as an ordinary workspace again.
  renameSync(away, other);
  await refocus(page);
  await refocus(settings);
  await expect(row).not.toContainText('Folder not found');
  await expect(listed).not.toContainText('Folder not found');
  await expect(listed.getByRole('button', { name: 'Open', exact: true })).toBeVisible();
  await row.getByRole('button').first().click();
  await expect.poll(() => api(page, 'api.repository.getCurrent()').then((r: any) => r?.path)).toBe(other);
});

test('the welcome page\'s three actions start their flows', async ({ app, page, workspace }) => {
  await knowWorkspaces(app, [workspace]);
  await toWelcome(page, workspace);
  for (const [title, line] of [
    ['Create new workspace', 'Start an empty folder for new notes.'],
    ['Open folder as workspace', 'Use a folder of notes you already have.'],
    ['New workspace from a template', 'Start from one of Neuron\'s templates.'],
  ]) {
    const row = page.locator('[data-welcome-action]').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
    await expect(row).toContainText(line);
  }

  await stubFolderPicker(app);
  await actionButton(page, 'Create').click();
  await expect.poll(() => pickerTitles(app)).toEqual(['Create or choose a workspace folder']);
  await actionButton(page, 'Open').click();
  await expect.poll(() => pickerTitles(app)).toEqual(['Create or choose a workspace folder', 'Open a workspace folder']);

  // Browse is the switcher's template picker.
  await actionButton(page, 'Browse').click();
  const templates = page.getByRole('dialog', { name: 'New workspace from template' });
  await expect(templates).toBeVisible();
  await templates.getByRole('button').filter({ hasNotText: /^Close$/ }).first().click();
  await expect.poll(() => pickerTitles(app).then((titles) => titles[2] ?? '')).toMatch(/^Where should the .+ workspace go\?$/);
  await expect(templates).toHaveCount(0);

  // Open with a folder chosen: this empty window shows it.
  const other = otherWorkspace(workspace);
  await stubFolderPicker(app, other);
  await actionButton(page, 'Open').click();
  await expect.poll(() => api(page, 'api.repository.getCurrent()').then((r: any) => r?.path)).toBe(other);
});

test('Settings › Workspaces shows one row for a folder known in two spellings', async ({ app, page, workspace }) => {
  test.skip(process.platform !== 'win32', 'Windows folders match case-insensitively; on Linux two spellings that differ in case are two folders.');
  const other = otherWorkspace(workspace);
  // Recent holds another spelling of the folder this window shows.
  await knowWorkspaces(app, [`${workspace.toUpperCase()}\\`, other]);
  const settings = await openSettings(app, page, 'workspaces');
  const rows = settings.locator('[data-workspace-row]');
  await expect(rows).toHaveCount(2);
  // That one row is the opener's: its window is on screen.
  await expect(rows.getByRole('button', { name: 'Show window' })).toHaveCount(1);
  await expect(rows.filter({ hasText: other }).getByRole('button', { name: 'Open', exact: true })).toBeVisible();
});

test('a workspace renamed under another spelling of its folder keeps the name', async ({ app, page, workspace }) => {
  const caseless = process.platform === 'win32' || process.platform === 'darwin';
  const spelling = `${caseless ? workspace.toUpperCase() : workspace}${sep}`;
  const settings = await openSettings(app, page, 'workspaces');
  expect((await settings.evaluate((dir) => (window as unknown as Api).electronAPI.repository.setName(dir, 'Field notes'), spelling)).success).toBe(true);
  // The window showing the folder hears of it, and asks by its own spelling.
  await expect(page.locator('.titlebar').getByRole('button', { name: /Field notes/ })).toBeVisible();
  expect((await api(page, 'api.repository.getCurrent()') as { name: string }).name).toBe('Field notes');
  await refocus(settings);
  await expect(settings.locator('[data-workspace-row]').filter({ hasText: workspace })).toContainText('Field notes');
});

test('the Workspaces section lists the current workspace and has no Open or Create buttons', async ({ app, page, workspace }) => {
  const settings = await openSettings(app, page, 'workspaces', () => sidebarButton(page, 'Workspaces').click());
  await expect(settings.getByRole('button', { name: 'Open folder…' })).toHaveCount(0);
  await expect(settings.getByRole('button', { name: 'Create workspace…' })).toHaveCount(0);
  await expect(settings.getByText('Start from a template')).toHaveCount(0);
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
