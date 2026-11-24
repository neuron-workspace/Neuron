import { test, expect } from './fixtures';

// Snake is a plain HTML view with no manifest. Like every view it asks first
// (7B), with no access to list; trusted, it draws its game on a canvas.

test('Snake.html opens as a view and draws its canvas', async ({ app, page }) => {
  await page.locator('.note-row', { hasText: 'Snake' }).first().click();
  const prompt = page.locator('[data-view-approval]');
  await expect(prompt).toBeVisible();
  await expect(prompt).toContainText('Snake.html');
  await expect(prompt).toContainText('no access to your workspace');
  await expect(page.locator('webview')).toHaveCount(0);
  await prompt.getByRole('button', { name: 'Trust this version' }).click();
  await expect(page.locator('webview')).toHaveCount(1);

  const drawn = await app.evaluate(async ({ webContents }) => {
    const wc = webContents.getAllWebContents().find((w) => w.getType() === 'webview');
    if (!wc) return null;
    for (let i = 0; i < 40; i++) {
      // The board is filled with its grid colour, then food and the snake are drawn
      // on top, so a drawn canvas has more than one distinct colour.
      const colours = await wc.executeJavaScript(`(() => {
        const c = document.getElementById('board');
        if (!c) return 0;
        const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        const seen = new Set();
        for (let p = 0; p < d.length; p += 4) seen.add(d[p] + ',' + d[p + 1] + ',' + d[p + 2]);
        return seen.size;
      })()`);
      if (colours > 1) return colours;
      await new Promise((r) => setTimeout(r, 250));
    }
    return 0;
  });

  expect(drawn, 'no webview attached').not.toBeNull();
  expect(drawn).toBeGreaterThan(1);
});
