import type { ElectronApplication } from '@playwright/test';
import { test, expect, openNote } from '../fixtures';

// Integration: window chrome. The title bar and tab strip around a note, and
// full screen hiding the title bar and bringing it back. window-chrome.spec.ts
// holds the detail (overlay geometry, shortcuts, theme colours).

async function setFullScreen(app: ElectronApplication, fullScreen: boolean) {
  await app.evaluate(({ BrowserWindow }, enabled) => new Promise<void>((resolve) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win.isFullScreen() === enabled) { resolve(); return; }
    win.once(enabled ? 'enter-full-screen' : 'leave-full-screen', () => resolve());
    win.setFullScreen(enabled);
  }), fullScreen);
}

test('the title bar draws no window controls of its own, and the tab strip holds an opened note', async ({ page }) => {
  await expect(page.locator('body')).toHaveClass(new RegExp('platform-' + process.platform));
  const bar = page.locator('.titlebar');
  await expect(bar).toBeVisible();
  // The operating system draws the window controls, not the page.
  await expect(bar.getByRole('button', { name: /^(Minimize|Maximize window|Restore window|Close)$/ })).toHaveCount(0);

  const tabs = page.getByRole('navigation', { name: 'Open notes' });
  await expect(tabs.getByRole('button', { name: 'New tab', exact: true })).toBeVisible();
  await expect.poll(() => tabs.locator('..').evaluate((node) => node.getBoundingClientRect().height)).toBe(32);
  await openNote(page, 'getting-started.mdx');
  const close = tabs.getByRole('button', { name: 'Close getting-started' });
  await expect(close).toBeVisible();
  await close.click();
  await expect(tabs.getByRole('button', { name: /^Close / })).toHaveCount(0);
});

test('full screen hides the title bar, and leaving it brings the bar back', async ({ app, page }) => {
  await expect(page.locator('.note-row').first()).toBeVisible();
  const bar = page.locator('.titlebar');
  await expect(bar).toBeVisible();
  try {
    await setFullScreen(app, true);
    await expect(page.locator('body')).toHaveClass(/window-fullscreen/);
    await expect(bar).toBeHidden();
    await expect(page.locator('main').first()).toBeVisible();
  } finally {
    await setFullScreen(app, false);
  }
  await expect(page.locator('body')).not.toHaveClass(/window-fullscreen/);
  await expect(bar).toBeVisible();
});
