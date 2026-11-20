import { test, expect, openedExternally } from './fixtures';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

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
    // Canvas images stream through neuron-file://; the base64 image read is gone.
    hasViewFile: typeof (window as unknown as { electronAPI: Record<string, unknown> }).electronAPI.views,
  }));
  expect(bridge.hasApi).toBe('object');
  expect(bridge.hasIpc).toBe('undefined');
  expect(bridge.hasViewFile).toBe('undefined');
});

test('wrong bridge argument types fail cleanly and the workspace stays usable', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const api = window.electronAPI;
    const bad = null as unknown as string;
    const before = await api.repository.getCurrent();
    const failures = await Promise.all([
      api.repository.setName(bad, 'Name'), api.repository.setName(before!.path, bad),
      api.repository.reveal(bad), api.repository.remove(bad), api.settings.set(bad, 'value'),
      api.writeNote('must-not-exist.md', bad), api.deleteNote(bad), api.readNote(bad).then((text) => ({ success: !text.startsWith('Error:') })),
      api.logError(null as never), api.htmxViews.approve('view.html', null as never),
    ]);
    let terminalError = '';
    try { await api.terminal.spawn(null as never); } catch (error) { terminalError = String(error); }
    const write = await api.writeNote('security-check.md', '# Still usable');
    return {
      failures, terminalError, before, after: await api.repository.getCurrent(), write,
      content: await api.readNote('security-check.md'), files: await api.listNotes(),
    };
  });
  expect(result.failures.every((failure) => failure.success === false)).toBe(true);
  expect(result.terminalError).toContain('Invalid terminal options.');
  expect(result.after).toEqual(result.before);
  expect(result.write.success).toBe(true);
  expect(result.content).toBe('# Still usable');
  expect(result.files).not.toContain('must-not-exist.md');
  await expect(page.locator('.note-row', { hasText: 'security-check' }).first()).toBeVisible();
});

// Canvas images stream through neuron-file:// (7A), so size is no limit any
// more (files-on-disk.spec.ts shows one over 10 MB); what is not an image
// still says so in its card rather than showing a broken one.
test.describe('canvas image errors', () => {
  test.use({ prepareWorkspace: async ({}, use) => use((directory: string) => {
    writeFileSync(join(directory, 'large.png'), Buffer.alloc(10 * 1024 * 1024 + 1));
    writeFileSync(join(directory, 'Image limit.canvas'), JSON.stringify({ nodes: [
      { id: 'large-image', type: 'file', file: 'large.png', x: 0, y: 0, width: 360, height: 220 },
    ], edges: [] }));
  }) });
  test('a canvas image that will not decode shows its error in the card', async ({ page }) => {
    await page.locator('.note-row', { hasText: 'Image limit' }).first().click();
    const card = page.locator('[data-canvas-node="large-image"]');
    await expect(card).toContainText('Could not load image.');
    await expect(card.locator('img')).toHaveCount(0);
  });
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
  test(`the app frame refuses to navigate to ${hostile}`, async ({ app, page }) => {
    const before = page.url();
    await page.evaluate((url) => { window.location.href = url; }, hostile);
    // Give the navigation a chance to happen before asserting it did not.
    await page.waitForTimeout(1500);
    expect(page.url()).toBe(before);

    // The guard's contract is two-sided: block the frame AND hand the URL to
    // the OS browser. Asserting only the first half missed that this test was
    // opening real tabs in the developer's real browser on every run --
    // shell.openExternal is stubbed in the fixture, and this reads the stub.
    expect(await openedExternally(app)).toEqual([hostile]);
  });
}

test('an htmx view runs in a sandboxed webview with no Node and its own partition', async ({ app, page }) => {
  await page.locator('.note-row', { hasText: 'Custom dashboard' }).first().click();
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
  await page.locator('.note-row', { hasText: 'Custom dashboard' }).first().click();
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
