import { test, expect } from './fixtures';

// The Snake mini-app is the least-privileged thing in the demo workspace: two
// variable capabilities and no file access whatsoever. That claim is the point
// of shipping it, so it is what these tests check -- along with the game
// actually running, since a folder app that renders an empty canvas looks
// identical to one that works.

test('a folder app renders as one app and asks only for what it declares', async ({ page }) => {
  await page.locator('.note-row', { hasText: 'Snake' }).first().click();

  const card = page.locator('[data-view-approval]');
  await expect(card).toBeVisible();
  await expect(card).toContainText('Snake');

  // The whole argument for this example: it can read and write workspace
  // variables, and it cannot touch a single file. A prompt that offered file
  // access here would mean the manifest had drifted from the description.
  await expect(card).toContainText('variables');
  await expect(card).not.toContainText(/Read files|Modify existing files|Create new files/);
  await expect(card).not.toContainText('Can read');
  await expect(card).not.toContainText('Can change');

  await page.getByRole('button', { name: 'Allow for this view' }).click();
  await expect(page.locator('webview')).toHaveCount(1);
});

test('the game runs and persists its high score to a workspace variable', async ({ app, page, workspace }) => {
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');

  await page.locator('.note-row', { hasText: 'Snake' }).first().click();
  await page.getByRole('button', { name: 'Allow for this view' }).click();
  await expect(page.locator('webview')).toHaveCount(1);

  const result = await app.evaluate(async ({ webContents }) => {
    const wc = webContents.getAllWebContents().find((w) => w.getType() === 'webview');
    if (!wc) return null;
    const run = (src: string) => wc.executeJavaScript(src);

    // Wait for the high score to arrive before touching the game: a failed
    // read leaves `best` null, and a null best never saves, which would make
    // this test pass for the wrong reason.
    let start: number | null = null;
    for (let i = 0; i < 40; i++) {
      const ready = await run("document.getElementById('best').textContent");
      if (ready && ready !== '—') { start = Number(ready); break; }
      await new Promise((r) => setTimeout(r, 250));
    }
    if (start === null) return null;

    // Beat whatever is already there rather than assuming the shipped value is
    // low. The demo workspace is editable, so a hardcoded target makes this
    // depend on nobody having played the game -- which is how it broke once the
    // shipped score had drifted upward.
    const target = start + 1;

    // Drive the game directly rather than pressing keys for a lucky apple.
    // What is under test is that a score persists, not that snake logic can be
    // beaten by a robot.
    await run("document.getElementById('start').click()");
    await run('score = ' + target + '; end();');

    return {
      target,
      best: await run("document.getElementById('best').textContent"),
      status: await run("document.getElementById('status').textContent"),
      overlay: await run("document.getElementById('overlay-title').textContent"),
    };
  });

  expect(result, 'no webview attached').not.toBeNull();
  expect(result!.status).toBe('Local · no network');
  expect(result!.overlay).toBe('New best');
  expect(result!.best).toBe(String(result!.target));

  // The write landed in the workspace file, through the same capability-checked
  // route every other view uses.
  await expect
    .poll(() => {
      const vars = JSON.parse(readFileSync(join(workspace, '.neuron', 'variables.json'), 'utf-8'));
      return vars.variables.snakeHighScore.value;
    }, { timeout: 15_000 })
    .toBe(result!.target);
});
