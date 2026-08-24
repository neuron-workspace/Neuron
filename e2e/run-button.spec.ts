import { test, expect } from './fixtures';

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
