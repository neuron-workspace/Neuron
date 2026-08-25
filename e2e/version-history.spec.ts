import { test, expect, openNote } from './fixtures';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// T-016. The journal (T-015) records a pre-image before every save; this proves
// the recovery surface can actually reach one and put it back on disk.

test('an earlier version can be restored from the side peek', async ({ page, workspace }) => {
  const file = join(workspace, 'guides', 'markdown-basics.mdx');
  const original = readFileSync(file, 'utf-8');

  await openNote(page, 'guides/markdown-basics.mdx');
  const prose = page.locator('.preview-prose').first();
  await expect(prose).toBeVisible();
  await prose.dblclick();

  const editor = page.locator('.cm-content').first();
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.type('CLOBBERED');
  await expect
    .poll(() => readFileSync(file, 'utf-8').includes('CLOBBERED'), { timeout: 15_000 })
    .toBe(true);

  // The side peek is closed by default (layout.rightPanel === false); Ctrl+J is
  // its binding. Click the shell first so the global dispatcher has focus.
  // Click the panel toggle rather than pressing Ctrl+J. Clicking the shell
  // first to "make the shortcut work" is a test papering over a real defect:
  // the dispatcher is one global keydown with no focus scopes, so the shortcut
  // genuinely does nothing while the terminal or a webview holds focus. A test
  // must not arrange conditions the user cannot. Tracked as T-035; the fix is
  // the scoped dispatcher in T-006.
  await page.getByRole('button', { name: 'Show panel' }).first().click();
  await expect(page.getByText('Version history').first()).toBeVisible();

  // Restore is two-step: the row asks before it replaces the file.
  const restore = page.getByRole('button', { name: 'Restore' }).first();
  await expect(restore).toBeVisible();
  // Retry the INPUT, not the assertion. On macOS the first synthetic click
  // after the side peek opens is dropped before it reaches the page, and an
  // identical second click on the same element lands immediately.
  //
  // This is not a slow app being papered over. At the moment of the lost click
  // the button is inside the viewport (measured at 1004x657, rect y=196) and
  // document.elementFromPoint at the button's own centre returns the button
  // itself -- yet no pointerdown, mousedown or click event reaches the
  // document at all. Nothing the app could do differently would receive it.
  const confirm = page.getByText('Replace the file on disk', { exact: false });
  for (let attempt = 1; attempt <= 3 && !(await confirm.isVisible()); attempt += 1) {
    await restore.click().catch(() => { /* the row swaps once a click lands */ });
    await confirm.waitFor({ state: 'visible', timeout: 3000 }).catch(() => { /* try again */ });
  }
  await expect(confirm).toBeVisible();
  await page.getByRole('button', { name: 'Replace file' }).click();

  await expect
    .poll(() => readFileSync(file, 'utf-8'), { timeout: 15_000 })
    .toBe(original);
});

test('a note with no history explains when history starts', async ({ page }) => {
  await openNote(page, 'getting-started.mdx');
  // Click the panel toggle rather than pressing Ctrl+J. Clicking the shell
  // first to "make the shortcut work" is a test papering over a real defect:
  // the dispatcher is one global keydown with no focus scopes, so the shortcut
  // genuinely does nothing while the terminal or a webview holds focus. A test
  // must not arrange conditions the user cannot. Tracked as T-035; the fix is
  // the scoped dispatcher in T-006.
  await page.getByRole('button', { name: 'Show panel' }).first().click();
  await expect(page.getByText('Version history').first()).toBeVisible();
  await expect(page.getByText('History starts at your next edit.')).toBeVisible();
});
