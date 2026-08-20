import { test, expect } from './fixtures';

// The security boundary, asserted against the running app rather than by
// reading main.ts. Every check here maps to a control in
// src/main/main.ts's web-contents-created block or to a risk in
// docs/roadmap/production-readiness-plan.md.

test('the renderer has no Node reachable through context isolation', async ({ page }) => {
  const exposed = await page.evaluate(() => ({
    require: typeof (window as unknown as Record<string, unknown>).require,
    process: typeof (window as unknown as Record<string, unknown>).process,
    module: typeof (window as unknown as Record<string, unknown>).module,
  }));
  expect(exposed).toEqual({ require: 'undefined', process: 'undefined', module: 'undefined' });
});

test('the preload bridge exposes an allowlist, not ipcRenderer', async ({ page }) => {
  const bridge = await page.evaluate(() => ({
    hasApi: typeof (window as unknown as Record<string, unknown>).electronAPI,
    hasIpc: typeof (window as unknown as Record<string, unknown>).ipcRenderer,
  }));
  expect(bridge.hasApi).toBe('object');
  expect(bridge.hasIpc).toBe('undefined');
});

// T-009 regression, end to end. These URLs all pass a startsWith() prefix test
// against the dev origin while pointing somewhere else; the guard must parse
// the URL and compare origins. A pass here means the privileged app frame --
// the one carrying the preload bridge -- cannot be navigated off-origin.
for (const hostile of [
  'http://localhost:5174@example.com/',
  'http://localhost:51740/',
  'http://example.com/',
]) {
  test(`the app frame refuses to navigate to ${hostile}`, async ({ page }) => {
    const before = page.url();
    await page.evaluate((url) => { window.location.href = url; }, hostile);
    // Give the navigation a chance to happen before asserting it did not.
    await page.waitForTimeout(1500);
    expect(page.url()).toBe(before);
  });
}

test('an htmx view runs in a sandboxed webview with no Node and its own partition', async ({ app, page }) => {
  await page.locator('.note-row', { hasText: 'Team dashboard' }).first().click();
  await page.getByRole('button', { name: 'Allow for this view' }).click();
  await expect(page.locator('webview')).toHaveCount(1);

  const probe = await app.evaluate(async ({ webContents }) => {
    const view = webContents.getAllWebContents().find((wc) => wc.getType() === 'webview');
    if (!view) return null;
    const types = await view.executeJavaScript(
      '[typeof require, typeof process, typeof module, typeof window.electronAPI]',
    );
    return { types, url: view.getURL() };
  });

  expect(probe, 'no webview attached -- the view did not open').not.toBeNull();
  expect(probe!.types).toEqual(['undefined', 'undefined', 'undefined', 'undefined']);
  // Served by the loopback view server on a session URL, never file:// or a
  // workspace path.
  expect(probe!.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/views\//);
});

test('a view webview cannot open a popup window', async ({ app, page }) => {
  await page.locator('.note-row', { hasText: 'Team dashboard' }).first().click();
  await page.getByRole('button', { name: 'Allow for this view' }).click();
  await expect(page.locator('webview')).toHaveCount(1);

  // Count real BrowserWindows in the main process, not app.windows():
  // Playwright also surfaces the webview's page once it settles, which made
  // this assertion pass alone and fail in a full run for the wrong reason.
  const countWindows = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);

  const before = await countWindows();
  await app.evaluate(async ({ webContents }) => {
    const view = webContents.getAllWebContents().find((wc) => wc.getType() === 'webview');
    await view?.executeJavaScript('window.open("https://example.com"), 0');
  });
  await page.waitForTimeout(1500);
  expect(await countWindows()).toBe(before);
});
