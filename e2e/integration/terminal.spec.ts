import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect, openNote } from '../fixtures';

// Integration: the terminal and Run. The status bar shows and hides a real
// shell that runs what is typed, and a note's Run button sends its command to
// it. terminal.spec.ts, status-terminal.spec.ts and run-button.spec.ts hold the
// detail (widths, several shells, windows, automations, refusals).

// `x''-y` prints `x-y` in PowerShell, bash, zsh and fish alike, so finding the
// output means the command ran, not that its keystrokes were echoed.
const screen = (page: Page) => page.locator('.xterm-rows').first();
const seen = (page: Page, text: string) => expect.poll(() => screen(page).innerText(), { timeout: 60_000 }).toContain(text);

test('the status bar button shows a terminal that runs a command, and hides it', async ({ page }) => {
  test.setTimeout(120_000);
  const button = page.getByRole('button', { name: /^(Show|Hide) terminal$/ });
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  await button.click();
  await expect(screen(page)).not.toBeEmpty({ timeout: 60_000 });
  await expect(button).toHaveAccessibleName('Hide terminal');

  await page.locator('.xterm').first().click();
  await page.keyboard.type("echo neuron''-typed");
  await page.keyboard.press('Enter');
  await seen(page, 'neuron-typed');

  await button.click();
  await expect(page.locator('.xterm').first()).toBeHidden();
  await expect(button).toHaveAccessibleName('Show terminal');
});

test('a Run button shows its command and runs it in the terminal', async ({ page, workspace }) => {
  test.setTimeout(120_000);
  writeFileSync(join(workspace, 'runner.mdx'), ['# Runner', '', `<Run label="Say hello" cmd="echo neuron''-ran" />`, ''].join('\n'));
  await page.getByRole('button', { name: 'Refresh explorer' }).click();
  await openNote(page, 'runner.mdx');
  const run = page.locator('.preview-prose button', { hasText: 'Say hello' }).first();
  // The command is on the button, not hidden behind the label.
  await expect(run).toContainText("echo neuron''-ran");
  await expect(page.locator('.xterm')).toHaveCount(0);
  await run.click();
  await expect(page.locator('.xterm').first()).toBeVisible({ timeout: 60_000 });
  await seen(page, 'neuron-ran');
});
