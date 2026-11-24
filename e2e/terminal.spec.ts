import { test, expect, setPluginEnabled } from './fixtures';
import type { ElectronApplication, Locator, Page } from '@playwright/test';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

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
test('the prompt path is never split, on first open and after a drag of resizes', async ({ app, page, workspace: given }) => {
  test.skip(!win, 'Only the PowerShell prompt carries the path');
  test.setTimeout(120_000);
  // CI's temp directory is an 8.3 short path (RUNNER~1); the prompt prints the
  // long one, so compare against what the shell will actually show.
  const workspace = realpathSync.native(given);
  await setPluginEnabled(app, page, 'Workspace Terminal');
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
  // The terminal is a dock panel, closed until asked for.
  await page.getByRole('button', { name: 'Show bottom peek', exact: true }).click();
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

// --- shells, windows and automations -----------------------------------------
//
// `x''-y` prints `x-y` in PowerShell, bash, zsh and fish alike, so an output
// never matches the command line that produced it: finding it means it ran.

const terminalButton = (page: Page) => page.getByRole('button', { name: /^(Show|Hide) terminal$/ });

/** Show the terminal panel (if it is not already) and wait for its shell's first output. */
async function showTerminal(page: Page) {
  const button = terminalButton(page);
  await expect(button).toBeVisible();
  if ((await button.getAttribute('aria-pressed')) !== 'true') await button.click();
  await expect(page.locator('.xterm-rows').first()).not.toBeEmpty({ timeout: 60_000 });
}

const seen = (page: Page, text: string) => expect.poll(() => screenText(page), { timeout: 60_000 }).toContain(text);

/** The pid of the shell on screen, as the shell itself reports it. */
async function shellPid(page: Page): Promise<number> {
  await run(page, win ? 'echo "PID=$PID"' : 'echo "PID=$$"');
  let pid = 0;
  await expect.poll(async () => {
    pid = Number((await screenText(page)).match(/PID=(\d+)/)?.[1] ?? 0);
    return pid;
  }, { timeout: 30_000 }).toBeGreaterThan(0);
  return pid;
}

const alive = (pid: number) => {
  try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
};

function folder(workspace: string, name: string): string {
  const dir = join(workspace, '..', name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'elsewhere.md'), '# Elsewhere\n');
  return dir;
}

test('two terminals keep separate output', async ({ page }) => {
  test.setTimeout(150_000);
  await showTerminal(page);
  await run(page, "echo first''-shell");
  await seen(page, 'first-shell');

  await page.getByRole('button', { name: 'New terminal', exact: true }).first().click();
  const list = page.getByRole('navigation', { name: 'Terminals' });
  await expect(list.getByRole('button', { name: 'Terminal 2', exact: true })).toHaveAttribute('aria-current', 'true');
  await expect(page.locator('.xterm-rows').first()).not.toBeEmpty({ timeout: 60_000 });
  await run(page, "echo second''-shell");
  await seen(page, 'second-shell');
  expect(await screenText(page)).not.toContain('first-shell');

  // Back to the first: its own output, replayed, and none of the second's.
  await list.getByRole('button', { name: 'Terminal 1', exact: true }).click();
  await seen(page, 'first-shell');
  expect(await screenText(page)).not.toContain('second-shell');
});

test('switching workspace ends the old shells, and a new one starts in the new folder', async ({ app, page, workspace }) => {
  test.setTimeout(150_000);
  await showTerminal(page);
  const before = await shellPid(page);
  expect(alive(before)).toBe(true);

  // This window leaves its workspace (removed from the list) and opens another
  // in its place -- the one way a window changes folder rather than a new
  // window opening beside it.
  const other = folder(workspace, 'second-folder-neuron');
  await page.evaluate(async ({ from, to }) => {
    const api = (window as unknown as { electronAPI: any }).electronAPI;
    await api.repository.remove(from);
    const opened = await api.repository.switch(to);
    if (!opened.success) throw new Error(opened.error);
  }, { from: workspace, to: other });
  await expect.poll(() => page.evaluate(() => (window as unknown as { electronAPI: any }).electronAPI.repository.getCurrent().then((r: any) => r?.path))).toBe(other);
  expect(app.windows()).toHaveLength(1);

  await expect.poll(() => alive(before), { timeout: 30_000 }).toBe(false);
  await showTerminal(page);
  await run(page, win ? '(Get-Location).Path' : 'pwd');
  await seen(page, 'second-folder-neuron');
  const after = await shellPid(page);
  expect(after).not.toBe(before);
  expect(alive(after)).toBe(true);
});

test('closing a window ends its shells, and only its own', async ({ app, page, workspace }) => {
  test.setTimeout(150_000);
  const other = folder(workspace, 'closing-folder-neuron');
  const [second] = await Promise.all([
    app.waitForEvent('window'),
    page.evaluate((dir) => (window as unknown as { electronAPI: any }).electronAPI.repository.switch(dir), other),
  ]);
  await second.waitForLoadState('domcontentloaded');
  await showTerminal(second);
  const theirs = await shellPid(second);
  await showTerminal(page);
  const mine = await shellPid(page);
  expect(alive(theirs) && alive(mine)).toBe(true);

  await second.close();
  await expect.poll(() => app.windows().length).toBe(1);
  await expect.poll(() => alive(theirs), { timeout: 30_000 }).toBe(false);
  expect(alive(mine)).toBe(true);
});

/** The Automations panel, switched on and selected in the bottom dock. */
async function openAutomations(app: ElectronApplication, page: Page) {
  await setPluginEnabled(app, page, 'Automations');
  await page.getByRole('button', { name: 'Show bottom peek', exact: true }).click();
  const dock = page.getByRole('complementary', { name: 'Bottom plugin peek' });
  await dock.getByRole('button', { name: 'Automations', exact: true }).click();
  await expect(dock.getByPlaceholder('Automation name')).toBeVisible();
  return dock;
}

async function addAutomation(dock: Locator, name: string, commands: string[]) {
  await dock.getByPlaceholder('Automation name').fill(name);
  await dock.getByPlaceholder(/One command per line/).fill(commands.join('\n'));
  await dock.getByRole('button', { name: 'Add automation' }).click();
}

const REFUSAL = "This command contains hidden characters and won't run.";

test('an automation with three commands runs them in order', async ({ app, page }) => {
  test.setTimeout(150_000);
  const dock = await openAutomations(app, page);
  await addAutomation(dock, 'Three', ["echo auto''-a", "echo auto''-b", "echo auto''-c"]);
  await dock.getByRole('button', { name: 'Run Three', exact: true }).click();

  // The terminal tab is selected in place of Automations, and its new shell
  // runs all three once it is ready, in order, each once.
  await expect(dock.getByRole('button', { name: 'Terminal', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await seen(page, 'auto-c');
  const text = await screenText(page);
  const at = ['auto-a', 'auto-b', 'auto-c'].map((word) => text.indexOf(word));
  expect(at.every((index) => index >= 0)).toBe(true);
  expect(at).toEqual([...at].sort((a, b) => a - b));
  for (const word of ['auto-a', 'auto-b', 'auto-c']) expect(text.split(word).length - 1, word).toBe(1);
});

test('an automation with a bad line runs none of it', async ({ app, page }) => {
  test.setTimeout(150_000);
  const dock = await openAutomations(app, page);
  const commands = ["echo auto''-x", 'echo ​auto-y', "echo auto''-z"];

  // Typed in: refused, and not saved.
  await addAutomation(dock, 'Typed', commands);
  await expect(dock.getByRole('status')).toHaveText(`Line 2: ${REFUSAL}`);
  await expect(dock.getByRole('button', { name: 'Run Typed', exact: true })).toHaveCount(0);

  // Saved anyway (settings synced or edited by hand): marked, and refused as a
  // whole when run -- the good lines around the bad one do not run either.
  await page.evaluate((list) => (window as unknown as { electronAPI: any }).electronAPI.settings.set('automations', [{ id: '1', name: 'Synced', commands: list }]), commands);
  await dock.getByRole('button', { name: 'Terminal', exact: true }).click();
  await expect(page.locator('.xterm-rows').first()).not.toBeEmpty({ timeout: 60_000 });
  await dock.getByRole('button', { name: 'Automations', exact: true }).click();
  const runSynced = dock.getByRole('button', { name: 'Run Synced', exact: true });
  await expect(runSynced).toBeVisible();
  await expect(dock.getByText(REFUSAL)).toBeVisible();
  await runSynced.click();
  await expect(dock.getByRole('status')).toHaveText(`Synced: ${REFUSAL} Nothing was sent.`);
  // Nothing to run, so the terminal is not brought forward.
  await expect(dock.getByRole('button', { name: 'Automations', exact: true })).toHaveAttribute('aria-pressed', 'true');

  // The shell got none of it, even once its panel is back and ready to drain a queue.
  await dock.getByRole('button', { name: 'Terminal', exact: true }).click();
  await expect(page.locator('.xterm-rows').first()).not.toBeEmpty({ timeout: 60_000 });
  await page.waitForTimeout(2_000);
  const text = await screenText(page);
  for (const word of ['auto-x', 'auto-y', 'auto-z']) expect(text).not.toContain(word);
});
