import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect, openNote } from '../fixtures';

// Integration: files on disk. An edit reaches the file, an outside change
// reaches the open note, and an outside change that meets an unsaved edit
// asks. files-on-disk.spec.ts and external-edit.spec.ts hold the detail.

test.use({ prepareWorkspace: async ({}, use) => use((dir: string) => {
  writeFileSync(join(dir, 'note.md'), '# Note\n\nFirst version.\n');
}) });

const end = process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End';
const liveButton = (page: Page) => page.getByRole('button', { name: 'Live', exact: true }).first();

/** Type at the end of the note in Live; Live hands an edit over when the line loses focus. */
async function appendInLive(page: Page, after: string, text: string) {
  await page.locator('p[data-live-line]').filter({ hasText: after }).click();
  await page.keyboard.press(end);
  await page.keyboard.insertText(text);
  await liveButton(page).focus();
}

test('an edit in Live reaches the file on disk', async ({ page, workspace }) => {
  const file = join(workspace, 'note.md');
  await openNote(page, 'note.md');
  await liveButton(page).click();
  await appendInLive(page, 'First version.', ' Edited.');
  await expect.poll(() => readFileSync(file, 'utf8')).toBe('# Note\n\nFirst version. Edited.\n');
  await expect(page.locator('footer.status-bar')).toContainText('Saved locally');
});

test('an open note shows a change made on disk', async ({ page, workspace }) => {
  await openNote(page, 'note.md');
  await expect(page.getByText('First version.')).toBeVisible();
  writeFileSync(join(workspace, 'note.md'), '# Note\n\nSecond version.\n');
  await expect(page.getByText('Second version.')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('First version.')).toHaveCount(0);
});

test('an outside change while an edit is not saved asks, and Keep my version writes ours', async ({ page, workspace }) => {
  const file = join(workspace, 'note.md');
  await openNote(page, 'note.md');
  await liveButton(page).click();
  await expect(page.locator('p[data-live-line]').filter({ hasText: 'First version.' })).toBeVisible();

  // Saves fail, as for a read-only file: on Windows the file, elsewhere its folder.
  const win = process.platform === 'win32';
  if (win) chmodSync(file, 0o444); else chmodSync(workspace, 0o555);
  const unblock = () => (win ? chmodSync(file, 0o644) : chmodSync(workspace, 0o755));
  // Let the watcher's report of the permission change come and go first.
  await page.waitForTimeout(600);
  try {
    await appendInLive(page, 'First version.', ' Mine.');
    await expect(page.getByRole('status').filter({ hasText: 'Save failed' }).first()).toBeVisible({ timeout: 10_000 });
  } finally {
    unblock();
  }

  writeFileSync(file, '# Note\n\nTheirs.\n');
  const bar = page.locator('[data-external-change="note.md"]');
  await expect(bar).toContainText('note.md changed outside Neuron.', { timeout: 10_000 });
  await bar.getByRole('button', { name: 'Keep my version' }).click();
  await expect(bar).toHaveCount(0);
  await expect.poll(() => readFileSync(file, 'utf8')).toBe('# Note\n\nFirst version. Mine.\n');
});
