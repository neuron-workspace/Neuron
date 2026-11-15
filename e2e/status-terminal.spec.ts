import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

// The terminal is a dock panel, closed until asked for. The status bar button
// and Ctrl+Shift+` both show and hide it.
const terminalShortcut = process.platform === 'darwin' ? 'Meta+Shift+Backquote' : 'Control+Shift+Backquote';
const paletteShortcut = process.platform === 'darwin' ? 'Meta+k' : 'Control+k';

// Shortcuts run through a keydown handler attached on mount; a press while the
// renderer is still hydrating lands nowhere. The palette shortcut toggles, so
// once it closes the palette the handler is attached (see window-chrome.spec.ts).
async function waitForShortcuts(page: Page) {
  await page.getByRole('button', { name: /Search & commands/ }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect.poll(async () => {
    if (await dialog.isVisible()) await page.keyboard.press(paletteShortcut);
    await page.waitForTimeout(200);
    return dialog.isVisible();
  }, { timeout: 15_000 }).toBe(false);
}

test('the status bar button shows and hides the terminal', async ({ page }) => {
  test.setTimeout(120_000);
  const button = page.getByRole('button', { name: /^(Show|Hide) terminal$/ });
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.xterm')).toHaveCount(0);

  await button.click();
  await expect(page.locator('.xterm').first()).toBeVisible({ timeout: 60_000 });
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await expect(button).toHaveAccessibleName('Hide terminal');

  await button.click();
  await expect(page.locator('.xterm').first()).toBeHidden();
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  await expect(button).toHaveAccessibleName('Show terminal');
});

test('the keyboard shortcut shows and hides the terminal', async ({ page }) => {
  test.setTimeout(120_000);
  await waitForShortcuts(page);
  const button = page.getByRole('button', { name: /^(Show|Hide) terminal$/ });

  await page.keyboard.press(terminalShortcut);
  await expect(page.locator('.xterm').first()).toBeVisible({ timeout: 60_000 });
  await expect(button).toHaveAttribute('aria-pressed', 'true');

  await page.keyboard.press(terminalShortcut);
  await expect(page.locator('.xterm').first()).toBeHidden();
  await expect(button).toHaveAttribute('aria-pressed', 'false');
});
