import { test, expect, openNote } from './fixtures';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';

// <Run /> is the only component in a note that causes something to happen
// outside the note, so the thing worth proving end to end is that a click
// reaches a real shell -- not that the string handling is right, which
// tools/terminal-bus.test.mjs covers directly and far faster.

test('a Run button shows its command and runs it in the terminal', async ({ page, workspace }) => {
  const { writeFileSync } = await import('node:fs');
  const { join } = await import('node:path');

  // Output distinctive enough that finding it in the terminal cannot be a
  // coincidence.
  writeFileSync(join(workspace, 'runner.mdx'),
    ['# Runner', '', '<Run label="Say hello" cmd="echo neuron-ran-this" />', ''].join('\n'));

  await page.locator('button[aria-label="Refresh explorer"]').click();
  await page.getByRole('button', { name: /Search & commands/ }).click();
  const dialog = page.locator('[role="dialog"]');
  await dialog.locator('input').first().fill('runner');
  await dialog.getByText('runner', { exact: false }).first().click();
  await expect(dialog).toBeHidden();

  const button = page.locator('.preview-prose button', { hasText: 'Say hello' }).first();
  await expect(button).toBeVisible();

  // The command is on the button, not hidden behind the label. This is the
  // control that stops a note claiming one thing and running another.
  await expect(button).toContainText('echo neuron-ran-this');

  await button.click();

  // A real shell echoed a real string, in the panel the user can see. Scoped to
  // the terminal so this cannot pass on the note's own copy of the command.
  const terminal = page.locator('.xterm');
  await expect(terminal).toBeVisible();
  // Generous: the command is held until the shell announces itself, and a cold
  // CI runner starting cmd.exe or bash for the first time is slow. 20s was not
  // enough there, and the failure looked like a broken feature rather than a
  // slow machine.
  await expect(terminal).toContainText('neuron-ran-this', { timeout: 60_000 });
});

// `neuron''-once` prints `neuron-once` in PowerShell, bash, zsh and fish alike,
// so the output text never appears in the echoed command line: finding it
// counts runs, not keystrokes. (Single quotes: a note's attributes are
// double-quoted and cannot hold a double quote.)
const occurrences = async (page: Page, text: string) =>
  ((await page.locator('.xterm-rows').first().innerText()).match(new RegExp(text, 'g')) ?? []).length;

async function openRunNote(page: Page, workspace: string, lines: string[]) {
  writeFileSync(join(workspace, 'runner.mdx'), ['# Runner', '', ...lines, ''].join('\n'));
  await page.locator('button[aria-label="Refresh explorer"]').click();
  await openNote(page, 'runner');
}

test('Run with the terminal closed opens it and runs the command once', async ({ page, workspace }) => {
  test.setTimeout(120_000);
  await openRunNote(page, workspace, [`<Run label="Once" cmd="echo neuron''-once" />`]);
  const button = page.locator('.preview-prose button', { hasText: 'Once' }).first();
  await expect(button).toBeVisible();
  await expect(page.locator('.xterm')).toHaveCount(0);

  await button.click();
  await expect(page.locator('.xterm').first()).toBeVisible({ timeout: 60_000 });
  await expect.poll(() => occurrences(page, 'neuron-once'), { timeout: 60_000 }).toBe(1);
  // Still once after the shell has had time to run a duplicate, had one been sent.
  await page.waitForTimeout(2_000);
  expect(await occurrences(page, 'neuron-once')).toBe(1);
});

test('a Run pill with a hidden character shows the refusal and sends nothing', async ({ page, workspace }) => {
  test.setTimeout(120_000);
  // A zero-width space and a right-to-left override: each makes the pill read
  // differently from what the shell would receive.
  await openRunNote(page, workspace, [
    '<Run label="Sneaky" cmd="echo​neuron-hidden" />',
    '',
    '<Run label="Reversed" cmd="echo ‮neuron-bidi" />',
    '',
    `<Run label="Fine" cmd="echo neuron''-fine" />`,
  ]);
  const prose = page.locator('.preview-prose');
  const refused = prose.locator('[data-run-refused]');
  await expect(refused).toHaveCount(2);
  for (const label of ['Sneaky', 'Reversed']) {
    await expect(refused.filter({ hasText: label })).toContainText("This command contains hidden characters and won't run.");
    await expect(prose.getByRole('button', { name: new RegExp(label) })).toHaveCount(0);
  }
  // Rendering a refused pill reaches for nothing: the terminal stays closed.
  await expect(page.locator('.xterm')).toHaveCount(0);

  // The good pill beside them still runs, and its shell never saw the others.
  await prose.locator('button', { hasText: 'Fine' }).click();
  await expect(page.locator('.xterm').first()).toContainText('neuron-fine', { timeout: 60_000 });
  await page.waitForTimeout(1_000);
  const screen = await page.locator('.xterm-rows').first().innerText();
  expect(screen).not.toContain('neuron-hidden');
  expect(screen).not.toContain('neuron-bidi');
});
