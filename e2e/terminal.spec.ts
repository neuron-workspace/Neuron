import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

// The shell and the terminal must agree on the width. When they did not -- the
// first fit ran before the panel and its font were ready, and every pixel of a
// resize made the shell redraw -- prompts came out split, half a path on one
// line and the rest on the next.

const win = process.platform === 'win32';
// Each prints "COLS=<n>": the width the shell itself believes it has.
const askWidth = win ? 'Write-Output "COLS=$($Host.UI.RawUI.WindowSize.Width)"' : 'echo "COLS=$(tput cols)"';
// 150 Zs, written so the command line itself holds only a single Z.
const longLine = win ? "Write-Output ('Z' * 150)" : "printf 'Z%.0s' $(seq 150); echo";

async function run(page: Page, command: string) {
  await page.locator('.xterm').first().click();
  await page.keyboard.type(command);
  await page.keyboard.press('Enter');
}

const screenText = (page: Page) => page.locator('.xterm-rows').first().innerText();

async function shellWidth(page: Page, previous: number): Promise<number> {
  const before = ((await screenText(page)).match(/COLS=\d+/g) ?? []).length;
  await run(page, askWidth);
  let width = 0;
  await expect.poll(async () => {
    const all = [...(await screenText(page)).matchAll(/COLS=(\d+)/g)];
    if (all.length <= before) return false;
    width = Number(all.at(-1)![1]);
    return true;
  }, { timeout: 30_000 }).toBe(true);
  expect(width, `shell width after ${previous ? 'resize' : 'first open'}`).toBeGreaterThan(0);
  return width;
}

// The reported glitch itself: a prompt drawn for the wrong width, its path
// split across two rows. PowerShell's prompt carries the working directory, so
// the workspace path must sit whole on one row -- after a cold first open in a
// panel that animates in from nothing, and after a drag of rapid resizes.
test('the prompt path is never split, on first open and after a drag of resizes', async ({ app, page, workspace }) => {
  test.skip(!win, 'Only the PowerShell prompt carries the path');
  test.setTimeout(120_000);
  await page.getByRole('button', { name: 'Plugins & integrations', exact: true }).first().click();
  await page.getByPlaceholder('Search plugins').fill('Workspace Terminal');
  await page.getByRole('switch', { name: 'Enable Workspace Terminal' }).check();
  await page.getByRole('button', { name: 'Show bottom peek', exact: true }).click();

  // The plugin's own terminal, not the layout's: it opens with the panel.
  const rows = page.locator('.xterm-rows').last();
  const promptRows = async () => (await rows.innerText()).split('\n').filter((row) => row.includes('PS '));
  await expect.poll(async () => (await promptRows()).length, { timeout: 60_000 }).toBeGreaterThan(0);
  expect((await promptRows()).at(-1)).toContain(workspace);

  for (let i = 0; i < 20; i++) {
    const width = 1320 - (i % 2 === 0 ? i * 15 : i * 8);
    await app.evaluate(({ BrowserWindow }, w) => BrowserWindow.getAllWindows()[0].setSize(w, 820), width);
  }
  await page.waitForTimeout(800);
  await page.locator('.xterm').last().click();
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await promptRows()).at(-1) ?? '', { timeout: 30_000 }).toContain(workspace);
  // And the path appears whole exactly once on that row, not doubled by a redraw.
  const last = (await promptRows()).at(-1)!;
  expect(last.split(workspace).length - 1).toBe(1);
});

test('the shell and the terminal agree on the width, on first open and after a resize', async ({ app, page }) => {
  test.setTimeout(120_000);
  const pane = page.locator('[data-cols]').first();
  await expect(pane).toBeVisible();
  // A fresh shell needs its prompt before it reads input; cold CI is slow.
  await expect(page.locator('.xterm-rows').first()).not.toBeEmpty({ timeout: 60_000 });

  const cols = Number(await pane.getAttribute('data-cols'));
  expect(cols).toBeGreaterThan(20);
  expect(await shellWidth(page, 0)).toBe(cols);

  // Narrow the window; the shell must follow the terminal to its new width.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 760));
  await expect.poll(async () => Number(await pane.getAttribute('data-cols'))).not.toBe(cols);
  const narrowed = Number(await pane.getAttribute('data-cols'));
  await page.waitForTimeout(300); // past the resize debounce
  expect(await shellWidth(page, cols)).toBe(narrowed);

  // A line longer than the terminal wraps once, cleanly: one unbroken run of
  // 150 Zs across consecutive rows, not fragments of it repeated.
  await run(page, longLine);
  await expect.poll(async () => {
    const flat = (await screenText(page)).replace(/\r?\n/g, '');
    return Math.max(0, ...[...flat.matchAll(/Z+/g)].map((m) => m[0].length));
  }, { timeout: 30_000 }).toBe(150);
});
