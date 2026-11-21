import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ElectronApplication, Page } from '@playwright/test';
import { test, expect, closeMenuByClickingOutside, openWorkspaceSettings } from './fixtures';

// HTML views are trusted by content (7B): every view asks before anything
// loads, trust holds for that exact version, and any change to the HTML or to
// the code it is served asks again. The view server refuses changed code even
// while the view is still open.

test.use({
  prepareWorkspace: async ({}, use) => use((dir: string) => {
    writeFileSync(join(dir, 'note.md'), '# Note\n');
    writeFileSync(join(dir, 'Plain.html'), '<h1 id="marker">version one</h1>\n');
    // A fragment view: htmx loads the fragment and runs its script on swap.
    writeFileSync(join(dir, 'Loader view.html'), '<div id="slot" hx-get="/api/v1/fragments/probe" hx-trigger="load" hx-swap="innerHTML">…</div>\n');
    mkdirSync(join(dir, '.neuron', 'fragments'), { recursive: true });
    writeFileSync(join(dir, '.neuron', 'fragments', 'probe.html'), '<p id="probe">fragment one</p><script>window.__probe = "one";</script>\n');
  }),
});

const prompt = (page: Page) => page.locator('[data-view-approval]');

async function webviewEval<T>(app: ElectronApplication, script: string): Promise<T | null> {
  return app.evaluate(async ({ webContents }, source) => {
    const wc = webContents.getAllWebContents().find((w) => w.getType() === 'webview');
    if (!wc) return null;
    return wc.executeJavaScript(source).catch(() => null);
  }, script) as Promise<T | null>;
}

/** Poll the view's document for a value, as its fetches resolve after load. */
async function pollView<T>(app: ElectronApplication, script: string, done: (value: T | null) => boolean): Promise<T | null> {
  let value: T | null = null;
  for (let i = 0; i < 40; i++) {
    value = await webviewEval<T>(app, script);
    if (done(value)) return value;
    await new Promise((r) => setTimeout(r, 250));
  }
  return value;
}

async function openAndTrust(page: Page, name: string) {
  await page.locator('.note-row', { hasText: name }).first().click();
  await expect(prompt(page)).toBeVisible();
  await prompt(page).getByRole('button', { name: 'Trust this version' }).click();
  await expect(page.locator('webview')).toHaveCount(1);
}

test('a view with no capabilities asks first; an edit on disk stops it and asks again; Don\'t run keeps it stopped', async ({ app, page, workspace }) => {
  await page.locator('.note-row', { hasText: 'Plain' }).first().click();

  // Nothing loads before the answer, capabilities or not.
  const card = prompt(page);
  await expect(card).toBeVisible();
  await expect(card).toContainText('Plain.html');
  await expect(card).toContainText('no access to your workspace');
  await expect(card).toContainText('Only trust views you wrote or got from someone you trust.');
  await expect(card.locator('[data-view-changed]')).toHaveCount(0);
  await expect(page.locator('webview')).toHaveCount(0);

  await card.getByRole('button', { name: 'Trust this version' }).click();
  await expect(page.locator('webview')).toHaveCount(1);
  expect(await pollView<string>(app, `document.getElementById('marker')?.textContent ?? ''`, (v) => v === 'version one')).toBe('version one');

  // Editing the HTML on disk stops the view and asks again, saying why.
  writeFileSync(join(workspace, 'Plain.html'), '<h1 id="marker">version two</h1>\n');
  await expect(card).toBeVisible();
  await expect(card.locator('[data-view-changed]')).toHaveText('This view changed since you trusted it.');
  await expect(page.locator('webview')).toHaveCount(0);

  // Don't run: a quiet stopped state, and further edits do not bring it back.
  await card.getByRole('button', { name: "Don't run" }).click();
  await expect(page.getByText("This view isn't running.")).toBeVisible();
  await expect(page.locator('webview')).toHaveCount(0);
  writeFileSync(join(workspace, 'Plain.html'), '<h1 id="marker">version three</h1>\n');
  await page.waitForTimeout(1500);
  await expect(page.getByText("This view isn't running.")).toBeVisible();
  await expect(prompt(page)).toHaveCount(0);
  await expect(page.locator('webview')).toHaveCount(0);

  // Trust… asks about the version on disk now, and trusting runs exactly that.
  await page.getByRole('button', { name: 'Trust…' }).click();
  await expect(card.locator('[data-view-changed]')).toBeVisible();
  await card.getByRole('button', { name: 'Trust this version' }).click();
  await expect(page.locator('webview')).toHaveCount(1);
  expect(await pollView<string>(app, `document.getElementById('marker')?.textContent ?? ''`, (v) => v === 'version three')).toBe('version three');
});

test('Stop trusting from the view menu asks again; Workspace settings lists the view and Remove works', async ({ page }) => {
  await openAndTrust(page, 'Plain');

  // Stop trusting confirms in place, then stops the view and shows the prompt.
  await page.getByRole('button', { name: 'View options' }).click();
  await page.getByRole('menuitem', { name: 'Stop trusting this view' }).click();
  const armed = page.getByRole('menuitem', { name: 'Click again to stop trusting' });
  await expect(armed).toBeVisible();
  await expect(page.locator('webview')).toHaveCount(1);
  await armed.click();
  await expect(prompt(page)).toBeVisible();
  await expect(page.locator('webview')).toHaveCount(0);

  // An armed item that is not confirmed does nothing.
  await prompt(page).getByRole('button', { name: 'Trust this version' }).click();
  await expect(page.locator('webview')).toHaveCount(1);
  await page.getByRole('button', { name: 'View options' }).click();
  await page.getByRole('menuitem', { name: 'Stop trusting this view' }).click();
  await closeMenuByClickingOutside(page);
  await expect(page.locator('webview')).toHaveCount(1);

  // The workspace's trusted views are listed, with a Remove for each.
  const dialog = await openWorkspaceSettings(page, 'general');
  const list = dialog.locator('[data-trusted-views]');
  await expect(list).toContainText('Trusted HTML views');
  const row = list.locator('[data-trusted-view="Plain.html"]');
  await expect(row).toBeVisible();
  await expect(row).toContainText('Plain');
  await expect(row).toContainText('Trusted');
  await row.getByRole('button', { name: 'Remove Plain.html' }).click();
  await expect(row).toHaveCount(0);
  await expect(list).toContainText('No views are trusted yet.');
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dialog).toHaveCount(0);

  // The open view stopped and asks again.
  await expect(prompt(page)).toBeVisible();
  await expect(page.locator('webview')).toHaveCount(0);
});

test('a script changed under an open view is refused by the server and does not run', async ({ app, page, workspace }) => {
  await openAndTrust(page, 'Loader view');
  expect(await pollView<string>(app, 'window.__probe ?? null', (v) => v === 'one')).toBe('one');

  // Change the fragment and ask for it from inside the view in one step in the
  // main process -- well inside the watcher's 120 ms debounce, so the view is
  // still open when it asks, and the answer is the server's alone.
  const fragment = join(workspace, '.neuron', 'fragments', 'probe.html');
  const result = await app.evaluate(async ({ webContents }, file) => {
    const wc = webContents.getAllWebContents().find((w) => w.getType() === 'webview');
    if (!wc) return null;
    const fs = (process as unknown as { mainModule: { require: (id: string) => typeof import('node:fs') } }).mainModule.require('fs');
    fs.writeFileSync(file, '<p id="probe">fragment two</p><script>window.__probe = "two";</script>\n');
    const run = wc.executeJavaScript(`(async () => {
      const r = await fetch('/api/v1/fragments/probe', { headers: { 'HX-Request': 'true' } });
      const body = await r.text();
      // htmx asks too; a refused response is never swapped in, so its script never runs.
      await htmx.ajax('GET', '/api/v1/fragments/probe', '#slot').catch(() => {});
      return { status: r.status, body, probe: window.__probe };
    })()`);
    // The view stops soon after; never wait on a page that is gone.
    return Promise.race([run, new Promise((resolve) => setTimeout(() => resolve(null), 5000))]);
  }, fragment) as { status: number; body: string; probe: string } | null;
  expect(result, 'the view was still open').not.toBeNull();
  expect(result!.status).toBe(403);
  expect(result!.body).not.toContain('fragment two');
  expect(result!.probe).toBe('one');

  // And the change stops the view and asks again.
  await expect(prompt(page).locator('[data-view-changed]')).toBeVisible();
  await expect(page.locator('webview')).toHaveCount(0);
});

test('a crashed view shows Reload, and Reload brings it back', async ({ app, page }) => {
  await openAndTrust(page, 'Plain');
  expect(await pollView<string>(app, `document.getElementById('marker')?.textContent ?? ''`, (v) => v === 'version one')).toBe('version one');

  await app.evaluate(({ webContents }) => {
    webContents.getAllWebContents().find((w) => w.getType() === 'webview')?.forcefullyCrashRenderer();
  });
  await expect(page.getByText('This view crashed. Neuron itself is unaffected.')).toBeVisible();
  await page.getByRole('button', { name: 'Reload view' }).click();
  await expect(page.locator('webview')).toHaveCount(1);
  expect(await pollView<string>(app, `document.getElementById('marker')?.textContent ?? ''`, (v) => v === 'version one')).toBe('version one');
});
