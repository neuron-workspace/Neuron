import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect, openNote } from '../fixtures';

// Integration: the editor and its tabs. The three modes, a split into a second
// editor group, and preview tabs. editor-split.spec.ts, editor-groups.spec.ts,
// preview-tabs.spec.ts and live-editing.spec.ts hold the detail.

test.use({ prepareWorkspace: async ({}, use) => use((dir: string) => {
  for (const name of ['alpha', 'beta', 'gamma']) writeFileSync(join(dir, `${name}.md`), `# ${name}\n\nA paragraph in ${name}.\n`);
}) });

const group = (page: Page, index: number) => page.locator(`[data-editor-group="${index}"]`);
const mode = (page: Page, name: string) => group(page, 0).getByRole('button', { name, exact: true });
const end = process.platform === 'darwin' ? 'Meta+ArrowRight' : 'End';

test('Reading, Live and Split show the note, and an edit in Split\'s source reaches the file', async ({ page, workspace }) => {
  await openNote(page, 'alpha.md');
  await expect(mode(page, 'Reading')).toHaveAttribute('aria-pressed', 'true');
  await expect(group(page, 0).locator('article.preview-prose h1')).toHaveText('alpha');

  await mode(page, 'Live').click();
  await expect(group(page, 0).locator('[data-live-preview]')).toBeVisible();

  await mode(page, 'Split').click();
  const source = group(page, 0).locator('.cm-content');
  await expect(source).toBeVisible();
  await source.click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type('Typed in the source.');
  await expect.poll(() => readFileSync(join(workspace, 'alpha.md'), 'utf8')).toContain('Typed in the source.');
});

test('Split right from a tab\'s menu shows the note in two groups that stay in step', async ({ page, workspace }) => {
  await openNote(page, 'beta.md');
  await page.getByRole('navigation', { name: 'Open notes' }).getByRole('button', { name: 'beta', exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Split right', exact: true }).click();
  await expect(page.locator('[data-editor-group]')).toHaveCount(2);
  await expect(group(page, 1).getByLabel('Note path')).toContainText('beta.md');

  await mode(page, 'Live').click();
  await group(page, 0).locator('p[data-live-line]').filter({ hasText: 'A paragraph' }).click();
  await page.keyboard.press(end);
  await page.keyboard.insertText(' Shared.');
  await mode(page, 'Live').focus();
  await expect(group(page, 1).locator('article.preview-prose')).toContainText('Shared.');
  await expect.poll(() => readFileSync(join(workspace, 'beta.md'), 'utf8').split('Shared.').length - 1).toBe(1);

  // Closing a group's last tab closes the group.
  await group(page, 1).getByRole('button', { name: 'Close beta', exact: true }).click();
  await expect(page.locator('[data-editor-group]')).toHaveCount(1);
});

test('single clicks in the tree reuse one preview tab, and a double click keeps it', async ({ page }) => {
  const strip = page.getByRole('navigation', { name: 'Open notes' });
  const tabs = strip.locator('button:not([aria-label])');
  const row = (name: string) => page.locator('[data-sidebar-tree]').getByRole('button', { name, exact: true });

  await row('alpha').click();
  await row('beta').click();
  await expect(tabs).toHaveText(['beta']);
  await expect(strip.locator('[data-preview="true"]')).toContainText('beta');

  await row('beta').dblclick();
  await expect(strip.locator('[data-preview="true"]')).toHaveCount(0);
  await row('gamma').click();
  await expect(tabs).toHaveText(['beta', 'gamma']);
  await expect(page.getByLabel('Note path')).toHaveText('gamma.md');
});
