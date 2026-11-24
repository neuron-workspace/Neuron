import { test, expect, openNote, setPluginEnabled } from './fixtures';
import type { Page } from '@playwright/test';
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

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

test('with the Terminal plugin off, the button asks to enable it and opens the plugins', async ({ app, page }) => {
  await setPluginEnabled(app, page, 'Workspace Terminal', false);
  const button = page.getByRole('button', { name: 'Enable the Terminal plugin', exact: true });
  await expect(button).toBeVisible();
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  await button.click();
  const dialog = page.locator('[data-workspace-settings]');
  await expect(dialog).toHaveAttribute('data-workspace-settings', 'plugins');
  await expect(page.locator('.xterm')).toHaveCount(0);
  // Back on, the button is a terminal toggle again.
  await dialog.getByPlaceholder('Search plugins').fill('Workspace Terminal');
  await dialog.getByRole('switch', { name: 'Enable Workspace Terminal' }).setChecked(true);
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Show terminal', exact: true })).toBeVisible();
});

test.describe('the status bar save state', () => {
  test.use({ prepareWorkspace: async ({}, use) => use((dir: string) => {
    writeFileSync(join(dir, 'note.md'), '# Note\n\nSome text.\n');
  }) });

  /** Type at the end of the note's paragraph in Live mode; Live hands the edit over when the line loses focus. */
  async function edit(page: Page, text: string) {
    await page.locator('p[data-live-line]').filter({ hasText: 'Some text.' }).click();
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowRight' : 'End');
    await page.keyboard.insertText(text);
    await page.getByRole('button', { name: 'Live', exact: true }).first().focus();
  }

  test('goes Saving… then Saved, and says Save failed when the write fails', async ({ page, workspace }) => {
    const file = join(workspace, 'note.md');
    await openNote(page, 'note.md');
    await page.getByRole('button', { name: 'Live', exact: true }).first().click();
    const status = page.locator('footer.status-bar');
    await expect(status).toContainText('Saved locally');

    // Every text the status bar shows, in order, however briefly.
    await page.evaluate(() => {
      const footer = document.querySelector('footer.status-bar')!;
      const seen: string[] = [];
      (window as unknown as { __saveStates: string[] }).__saveStates = seen;
      const record = () => {
        const text = footer.firstElementChild?.textContent ?? '';
        if (seen[seen.length - 1] !== text) seen.push(text);
      };
      new MutationObserver(record).observe(footer, { subtree: true, childList: true, characterData: true });
    });
    await edit(page, ' One.');
    await expect.poll(() => readFileSync(file, 'utf8')).toContain('Some text. One.');
    await expect(status).toContainText('Saved locally');
    const seen = await page.evaluate(() => (window as unknown as { __saveStates: string[] }).__saveStates);
    expect(seen).toContain('Saving…');
    expect(seen.indexOf('Saving…')).toBeLessThan(seen.lastIndexOf('Saved locally'));

    // A write that fails: Save failed, in the status bar and the note header.
    const win = process.platform === 'win32';
    const block = () => (win ? chmodSync(file, 0o444) : chmodSync(workspace, 0o555));
    const unblock = () => (win ? chmodSync(file, 0o644) : chmodSync(workspace, 0o755));
    block();
    try {
      await page.waitForTimeout(600);
      await edit(page, ' Two.');
      await expect(status).toContainText('Save failed', { timeout: 10_000 });
      await expect(page.getByRole('status').filter({ hasText: 'Save failed' }).first()).toBeVisible();
      expect(readFileSync(file, 'utf8')).not.toContain('Two.');
    } finally {
      unblock();
    }
  });
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
