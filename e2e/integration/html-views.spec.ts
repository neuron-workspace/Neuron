import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ElectronApplication, Page } from '@playwright/test';
import { test, expect } from '../fixtures';

// Integration: HTML views. Every view asks before it runs, a trusted view runs
// and reads the workspace, and a change on disk asks again. surfaces.spec.ts,
// view-trust.spec.ts and snake.spec.ts hold the detail.

const prompt = (page: Page) => page.locator('[data-view-approval]');

/** Poll the view's document until `done` accepts what `script` returns. */
async function pollView<T>(app: ElectronApplication, script: string, done: (value: T | null) => boolean): Promise<T | null> {
  let value: T | null = null;
  for (let i = 0; i < 40; i++) {
    value = await app.evaluate(async ({ webContents }, source) => {
      const wc = webContents.getAllWebContents().find((w) => w.getType() === 'webview');
      return wc ? wc.executeJavaScript(source).catch(() => null) : null;
    }, script) as T | null;
    if (done(value)) return value;
    await new Promise((r) => setTimeout(r, 250));
  }
  return value;
}

test('a view with workspace access asks first, names what it can change, and once trusted loads its data', async ({ app, page }) => {
  await page.locator('.note-row', { hasText: 'Custom dashboard' }).first().click();
  await expect(prompt(page)).toBeVisible();
  await expect(prompt(page)).toContainText('Custom dashboard.html');
  await expect(prompt(page)).toContainText('Planner.db');
  await expect(prompt(page)).toContainText('Can change');
  await expect(page.locator('webview')).toHaveCount(0);

  await prompt(page).getByRole('button', { name: 'Trust this version' }).click();
  await expect(page.locator('webview')).toHaveCount(1);
  const open = await pollView<string>(app, `(document.getElementById('open')?.textContent ?? '').trim()`, (v) => !!v && v !== '—');
  expect(Number(open)).toBeGreaterThan(0);
});

test('a trusted view stops and asks again when its file changes on disk', async ({ app, page, workspace }) => {
  writeFileSync(join(workspace, 'Plain.html'), '<h1 id="marker">version one</h1>\n');
  await page.getByRole('button', { name: 'Refresh explorer' }).click();
  await page.locator('.note-row', { hasText: 'Plain' }).first().click();
  await expect(prompt(page)).toContainText('no access to your workspace');
  await prompt(page).getByRole('button', { name: 'Trust this version' }).click();
  await expect(page.locator('webview')).toHaveCount(1);
  const marker = `document.getElementById('marker')?.textContent ?? ''`;
  expect(await pollView<string>(app, marker, (v) => v === 'version one')).toBe('version one');

  writeFileSync(join(workspace, 'Plain.html'), '<h1 id="marker">version two</h1>\n');
  await expect(prompt(page).locator('[data-view-changed]')).toHaveText('This view changed since you trusted it.');
  await expect(page.locator('webview')).toHaveCount(0);
  await prompt(page).getByRole('button', { name: 'Trust this version' }).click();
  await expect(page.locator('webview')).toHaveCount(1);
  expect(await pollView<string>(app, marker, (v) => v === 'version two')).toBe('version two');
});

test('Snake opens as a view and draws its game', async ({ app, page }) => {
  await page.locator('.note-row', { hasText: 'Snake' }).first().click();
  await prompt(page).getByRole('button', { name: 'Trust this version' }).click();
  await expect(page.locator('webview')).toHaveCount(1);
  // A drawn board has more than its grid colour on it.
  const colours = await pollView<number>(app, `(() => {
    const c = document.getElementById('board');
    if (!c) return 0;
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    const seen = new Set();
    for (let p = 0; p < d.length; p += 4) seen.add(d[p] + ',' + d[p + 1] + ',' + d[p + 2]);
    return seen.size;
  })()`, (v) => (v ?? 0) > 1);
  expect(colours).toBeGreaterThan(1);
});
