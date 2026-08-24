import { test, expect } from './fixtures';

// The demo workspace ships a shell layout (.neuron/layout.json) of editor +
// terminal. A panel you cannot dismiss makes the layout file the only way to
// change your own screen.

test('a shell panel can be closed, and closing is not one-way', async ({ page }) => {
  const terminal = page.locator('.xterm, [class*="xterm"]').first();
  await expect(terminal).toBeVisible();

  // Revealed on hover, so the chrome is not permanent.
  await terminal.hover();
  const close = page.getByRole('button', { name: 'Close terminal panel' });
  await expect(close).toBeVisible();
  await close.click();
  await expect(terminal).toHaveCount(0);

  // Getting it back must not require editing .neuron/layout.json by hand.
  const restore = page.getByRole('button', { name: /Restore 1 panel/ });
  await expect(restore).toBeVisible();
  await restore.click();
  await expect(page.locator('.xterm, [class*="xterm"]').first()).toBeVisible();
});
