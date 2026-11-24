import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, openedExternally } from '../fixtures';

// Integration: security. The renderer has no Node and only the bridge's
// allowlist, the app frame cannot be navigated off its origin, and an HTML
// view runs isolated from both. security.spec.ts, secrets.spec.ts and
// view-trust.spec.ts hold the detail.

test('the renderer has no Node, and the bridge is an allowlist rather than ipcRenderer', async ({ page, workspace }) => {
  const exposed = await page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>;
    return { require: typeof w.require, process: typeof w.process, module: typeof w.module, api: typeof w.electronAPI, ipc: typeof w.ipcRenderer };
  });
  expect(exposed).toEqual({ require: 'undefined', process: 'undefined', module: 'undefined', api: 'object', ipc: 'undefined' });
  // A file beside the workspace is out of the bridge's reach.
  writeFileSync(join(workspace, '..', 'outside.md'), 'outside-marker\n');
  const outside = await page.evaluate(() => (window as unknown as { electronAPI: any }).electronAPI.readNote('../outside.md'));
  expect(String(outside)).not.toContain('outside-marker');
});

test('the app frame refuses to navigate off its origin and hands the URL to the browser', async ({ app, page }) => {
  const hostile = 'http://localhost:5174@example.com/';
  const before = page.url();
  await page.evaluate((url) => { window.location.href = url; }, hostile);
  // Give the navigation a chance to happen before asserting it did not.
  await page.waitForTimeout(1500);
  expect(page.url()).toBe(before);
  expect(await openedExternally(app)).toEqual([hostile]);
});

test('an HTML view runs in a sandboxed webview with no Node, no bridge and its own server', async ({ app, page }) => {
  await page.locator('.note-row', { hasText: 'Custom dashboard' }).first().click();
  await page.getByRole('button', { name: 'Trust this version' }).click();
  await expect(page.locator('webview')).toHaveCount(1);
  const probe = await app.evaluate(async ({ webContents }) => {
    const view = webContents.getAllWebContents().find((wc) => wc.getType() === 'webview');
    if (!view) return null;
    const types = await view.executeJavaScript('[typeof require, typeof process, typeof module, typeof window.electronAPI]');
    return { types, url: view.getURL() };
  });
  expect(probe, 'no webview attached').not.toBeNull();
  expect(probe!.types).toEqual(['undefined', 'undefined', 'undefined', 'undefined']);
  expect(probe!.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/views\//);
});
