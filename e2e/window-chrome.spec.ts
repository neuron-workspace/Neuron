import { test, expect, openNote } from './fixtures';
import type { ElectronApplication, Page } from '@playwright/test';

const paletteShortcut = process.platform === 'darwin' ? 'Meta+k' : 'Control+k';

async function setFullScreen(app: ElectronApplication, fullScreen: boolean) {
  await app.evaluate(({ BrowserWindow }, enabled) => new Promise<void>((resolve) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win.isFullScreen() === enabled) { resolve(); return; }
    win.once(enabled ? 'enter-full-screen' : 'leave-full-screen', () => resolve());
    win.setFullScreen(enabled);
  }), fullScreen);
}

// Shortcuts run through a keydown handler attached on mount; a press while the
// renderer is still hydrating lands nowhere (see openNote in fixtures). Opening
// the palette by its button proves the app is ready for keys.
async function waitForShortcuts(page: Page) {
  await page.getByRole('button', { name: /Search & commands/ }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
}

async function paletteCommand(page: Page, command: string) {
  await page.keyboard.press(paletteShortcut);
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('combobox').fill(command);
  await expect(dialog.getByRole('option', { name: command })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(dialog).toBeHidden();
}

test('tab strip stays 28px on workspace home and when opening a note', async ({ page }) => {
  const tabs = page.getByRole('navigation', { name: 'Open notes' });
  const row = tabs.locator('..');
  await expect(tabs).toBeVisible();
  await expect(tabs.getByRole('button', { name: /^Close / })).toHaveCount(0);
  await expect(tabs.getByRole('button', { name: 'Create note', exact: true })).toBeVisible();
  await expect(tabs.getByRole('button', { name: 'Open website tab' })).toBeVisible();
  await expect.poll(() => row.evaluate((node) => node.getBoundingClientRect().height)).toBe(28);
  const homeHeight = await tabs.evaluate((node) => node.getBoundingClientRect().height);
  expect(homeHeight).toBeGreaterThan(0);
  expect(homeHeight).toBeLessThanOrEqual(28);

  await openNote(page, 'getting-started.mdx');
  await expect(tabs.getByRole('button', { name: 'Close getting-started' })).toBeVisible();
  await expect.poll(() => row.evaluate((node) => node.getBoundingClientRect().height)).toBe(28);
  await expect.poll(() => tabs.evaluate((node) => node.getBoundingClientRect().height)).toBe(homeHeight);

  await tabs.getByRole('button', { name: 'Close getting-started' }).click();
  await expect(tabs.getByRole('button', { name: /^Close / })).toHaveCount(0);
  await expect.poll(() => row.evaluate((node) => node.getBoundingClientRect().height)).toBe(28);
});

test('native overlay keeps toolbar actions clear of window controls', async ({ page }) => {
  await expect(page.locator('body')).toHaveClass(new RegExp('platform-' + process.platform));
  const bar = page.locator('.titlebar');
  await expect(bar).toBeVisible();
  await expect(bar.locator('.window-control, .neuron-logo, .neuron-logo-bg')).toHaveCount(0);
  await expect(bar.getByRole('button', { name: /^(Minimize|Maximize window|Restore window|Close)$/ })).toHaveCount(0);

  if (process.platform !== 'win32' && process.platform !== 'linux') return;
  await expect.poll(() => page.evaluate(() =>
    (navigator as Navigator & { windowControlsOverlay?: { visible: boolean } }).windowControlsOverlay?.visible,
  )).toBe(true);

  const geometry = await bar.evaluate((header) => {
    const probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;left:env(titlebar-area-x,0px);width:env(titlebar-area-width,calc(100% - 140px));height:1px;pointer-events:none';
    document.body.appendChild(probe);
    const safe = probe.getBoundingClientRect();
    const buttons = [...header.querySelectorAll('button')].map((button) => {
      const rect = button.getBoundingClientRect();
      return { left: rect.left, right: rect.right };
    });
    probe.remove();
    return { left: safe.left, right: safe.right, height: header.getBoundingClientRect().height, buttons };
  });
  expect(geometry.height).toBe(40);
  for (const button of geometry.buttons) {
    expect(button.left).toBeGreaterThanOrEqual(geometry.left);
    expect(button.right).toBeLessThanOrEqual(geometry.right);
  }
});

for (const maximized of [false, true]) {
  test(`full screen removes the top row from a ${maximized ? 'maximized' : 'restored'} window`, async ({ app, page }) => {
    await expect(page.locator('.note-row').first()).toBeVisible();
    await expect(page.locator('body')).toHaveClass(new RegExp('platform-' + process.platform));
    const bar = page.locator('.titlebar');
    const content = page.locator('.workspace-grid > :nth-child(2)');
    await expect(bar).toBeVisible();
    await waitForShortcuts(page);

    // Exercise both grid variants: with and without a status bar.
    if (maximized) {
      await paletteCommand(page, 'Hide status bar');
      await expect(page.locator('.workspace-grid')).toHaveClass(/no-status/);
      await app.evaluate(({ BrowserWindow }) => new Promise<void>((resolve) => {
        const win = BrowserWindow.getAllWindows()[0];
        if (win.isMaximized()) { resolve(); return; }
        win.once('maximize', () => resolve());
        win.maximize();
      }));
    }

    try {
      await setFullScreen(app, true);
      await expect(page.locator('body')).toHaveClass(/window-fullscreen/);
      await expect(bar).toBeHidden();
      await expect(content).toBeVisible();
      await expect.poll(() => content.evaluate((node) => node.getBoundingClientRect().top)).toBe(0);
      await expect.poll(() => page.locator('main').evaluate((node) => node.getBoundingClientRect().top)).toBe(0);

      // All toolbar actions, including the former menu-only ones, remain searchable.
      await page.keyboard.press(paletteShortcut);
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      for (const command of [
        'Open folder…', 'Create workspace…', 'Switch workspace: workspace', 'Plugins & integrations',
        'Hide sidebar', 'Show left dock', 'Show right dock', 'Show bottom dock', 'Hide workspace graph',
        'Hide activity bar', maximized ? 'Show status bar' : 'Hide status bar', 'Zen mode',
        'Move sidebar to the right', 'Reset layout',
      ]) {
        await dialog.getByRole('combobox').fill(command);
        await expect(dialog.getByRole('option', { name: command })).toBeVisible();
      }
      await page.keyboard.press('Escape');
      await paletteCommand(page, 'Hide activity bar');
      await paletteCommand(page, 'Show activity bar');
      await expect.poll(() => content.evaluate((node) => node.getBoundingClientRect().top)).toBe(0);
    } finally {
      await setFullScreen(app, false);
    }

    await expect(page.locator('body')).not.toHaveClass(/window-fullscreen/);
    await expect(bar).toBeVisible();
    await expect.poll(() => content.evaluate((node) => node.getBoundingClientRect().top)).toBe(40);
  });
}

test('the full-screen palette works while the terminal has focus', async ({ app, page }) => {
  await page.getByRole('button', { name: 'Plugins & integrations', exact: true }).first().click();
  await page.getByPlaceholder('Search plugins').fill('Workspace Terminal');
  await page.getByRole('switch', { name: 'Enable Workspace Terminal' }).check();
  await page.getByRole('button', { name: 'Show bottom peek', exact: true }).click();
  const terminal = page.locator('.xterm-helper-textarea');
  await expect(terminal).toBeVisible();
  await expect(terminal).toBeFocused();

  try {
    await setFullScreen(app, true);
    await expect(page.locator('.titlebar')).toBeHidden();
    await terminal.focus();
    await paletteCommand(page, 'Hide bottom dock');
    await expect(terminal).toBeHidden();
  } finally {
    await setFullScreen(app, false);
  }
});

test('F11 enters and leaves full screen', async ({ app, page }) => {
  // Windows and Linux have no application menu, so this is their only way in.
  const isFullScreen = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFullScreen());
  await expect(page.locator('.note-row').first()).toBeVisible();
  await waitForShortcuts(page);
  try {
    await page.keyboard.press('F11');
    await expect.poll(isFullScreen).toBe(true);
    await expect(page.locator('.titlebar')).toBeHidden();
    await page.keyboard.press('F11');
    await expect.poll(isFullScreen).toBe(false);
    await expect(page.locator('.titlebar')).toBeVisible();
  } finally {
    await setFullScreen(app, false);
  }
});

test('theme changes reach the native overlay and invalid colors are ignored', async ({ app, page }) => {
  test.skip(process.platform !== 'win32' && process.platform !== 'linux', 'Only Windows and Linux use an overlay');
  await expect(page.locator('.note-row').first()).toBeVisible();
  await waitForShortcuts(page);
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    const original = win.setTitleBarOverlay.bind(win);
    const state = globalThis as unknown as { overlayCalls: { color?: string; symbolColor?: string }[] };
    state.overlayCalls = [];
    win.setTitleBarOverlay = (options) => {
      state.overlayCalls.push(options);
      original(options);
    };
  });

  await paletteCommand(page, 'Open settings');
  for (const name of ['Light', 'Nord', 'Graphite']) {
    const button = page.getByRole('group', { name: 'Application theme' }).getByRole('button', { name: new RegExp('^' + name) });
    await button.click();
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    const colors = await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement);
      return { color: style.getPropertyValue('--nav').trim(), symbolColor: style.getPropertyValue('--ink').trim() };
    });
    await expect.poll(() => app.evaluate(() =>
      (globalThis as unknown as { overlayCalls: unknown[] }).overlayCalls.at(-1),
    )).toEqual(colors);
  }

  const calls = await app.evaluate(() => (globalThis as unknown as { overlayCalls: unknown[] }).overlayCalls.length);
  await page.evaluate(async () => {
    const api = (window as unknown as { electronAPI: any }).electronAPI;
    await api.windowControls.setOverlayColors({ color: 'invalid', symbolColor: '#ffffff' });
    await api.windowControls.setOverlayColors({ color: '#ffffff', symbolColor: null });
  });
  expect(await app.evaluate(() => (globalThis as unknown as { overlayCalls: unknown[] }).overlayCalls.length)).toBe(calls);
});
