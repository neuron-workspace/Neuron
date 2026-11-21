import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

// A file that cannot be shown says so in its own pane, and nothing in it runs
// or takes the rest of the app down with it (Module 7).

test.use({
  prepareWorkspace: async ({}, use) => use((dir: string) => {
    writeFileSync(join(dir, 'note.md'), '# Plain note\n\nStill here.\n');
    // Valid JSON whose card text is not text: parsing keeps it, rendering throws.
    writeFileSync(join(dir, 'Broken board.canvas'), JSON.stringify({
      nodes: [{ id: 'a', type: 'text', x: 0, y: 0, width: 200, height: 100, text: { not: 'a string' } }],
      edges: [],
    }));
    writeFileSync(join(dir, 'evil.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20" viewBox="0 0 40 20">'
      + '<rect width="40" height="20" fill="red"/>'
      + '<script>try { window.top.__svgRan = true; } catch (e) {} try { parent.__svgRan = true; } catch (e) {}</script>'
      + '</svg>');
    writeFileSync(join(dir, 'broken.png'), Buffer.from('this is not a PNG at all, just bytes'));
    writeFileSync(join(dir, 'clip.mp4'), Buffer.from('not a video either'));
  }),
});

const contents = (page: Page) => page.getByRole('listbox', { name: 'Workspace contents' });
const openFromExplorer = async (page: Page, name: string) => {
  const option = contents(page).getByRole('option', { name, exact: true });
  await option.dblclick({ timeout: 15_000 });
};
const backToExplorer = (page: Page) => page.getByRole('button', { name: 'New tab', exact: true }).click();

test('a malformed canvas shows the surface error and the rest of the app keeps working', async ({ page }) => {
  await page.locator('.note-row', { hasText: 'Broken board' }).first().click();
  await expect(page.getByText('This view crashed while rendering. Switch to Source mode to inspect and fix the file.')).toBeVisible();

  // The shell is intact: another file opens and renders as usual.
  await page.locator('.note-row', { hasText: 'note' }).first().click();
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { name: 'Plain note', level: 1 })).toBeVisible();
  await expect(main.getByText('Still here.')).toBeVisible();
  await expect(main.getByText('This view crashed while rendering.', { exact: false })).toHaveCount(0);
  await expect(page.getByRole('complementary', { name: 'Workspace sidebar' })).toBeVisible();
});

test('an SVG with a script opens as an image and its script never runs', async ({ page }) => {
  await openFromExplorer(page, 'evil.svg');
  const surface = page.locator('[data-image-surface]');
  await expect(surface.locator('[data-image-size]')).toHaveText('40 × 20 px');
  // Drawn through <img>, where SVG scripts do not run; never inlined into the app.
  await expect(surface.locator('img')).toHaveCount(1);
  await expect(page.locator('[data-image-surface] svg script, [data-image-surface] object, [data-image-surface] iframe')).toHaveCount(0);
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => (window as unknown as { __svgRan?: boolean }).__svgRan ?? false)).toBe(false);
});

test('a corrupt image says it cannot be shown', async ({ page }) => {
  await openFromExplorer(page, 'broken.png');
  await expect(page.locator('[data-image-surface]')).toContainText("This image can't be shown here.");
  await expect(page.locator('[data-image-surface] img')).toHaveCount(0);
});

test('a video that cannot play says so and offers Show in folder', async ({ app, page }) => {
  // Showing the folder would open the real file manager; record the call instead.
  await app.evaluate(({ shell }) => {
    const store = globalThis as unknown as { __revealed?: string[] };
    store.__revealed = [];
    shell.showItemInFolder = (fullPath: string) => { store.__revealed!.push(fullPath); };
  });
  await openFromExplorer(page, 'clip.mp4');
  const status = page.locator('[data-media-surface]').getByRole('status');
  await expect(status).toContainText("This file can't be played here.", { timeout: 15_000 });
  await status.getByRole('button', { name: 'Show in folder' }).click();
  await expect.poll(() => app.evaluate(() => (globalThis as unknown as { __revealed?: string[] }).__revealed ?? []))
    .toEqual([expect.stringMatching(/clip\.mp4$/)]);

  // The app is still usable afterwards.
  await backToExplorer(page);
  await expect(contents(page)).toBeVisible();
});
