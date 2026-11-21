import { test, expect, openNote } from './fixtures';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ElectronApplication, Page } from '@playwright/test';

// "Open to the side" is now a split to the right: the note opens in a second
// editor group. Groups are `[data-editor-group="<index>"]`, each with its own
// tab strip and note header.
const groups = (page: Page) => page.locator('[data-editor-group]');
const group = (page: Page, index: number) => page.locator(`[data-editor-group="${index}"]`);
// macOS has no End key behaviour in a text field: Cmd+Right is the end of the line there.
const end = process.platform === 'darwin' ? 'Meta+ArrowRight' : 'End';

async function runCommand(page: Page, name: string) {
  await page.getByRole('button', { name: /Search & commands/ }).click();
  const dialog = page.locator('[role="dialog"]');
  await dialog.getByRole('combobox').or(dialog.locator('input')).first().fill(name);
  // By role and prefix: a command with a shortcut has its chord in the same row.
  await dialog.getByRole('option', { name: new RegExp('^' + name) }).first().click();
  await expect(dialog).toBeHidden();
}

/** The tabs of each stored group, as the app remembers them for this workspace. */
function storedGroups(page: Page) {
  return page.evaluate(async () => {
    const api = (window as unknown as { electronAPI: any }).electronAPI;
    const repo = await api.repository.getCurrent();
    const stored = await api.settings.get('editorGroups:' + repo.path);
    return stored?.groups?.map((g: { tabs: string[] }) => g.tabs) ?? null;
  });
}

test('a note opens to the side, edits there reach the file, and the split survives reload', async ({ page, workspace }) => {
  await openNote(page, 'projects/Website refresh');
  await runCommand(page, 'Open current note to the side');
  await expect(groups(page)).toHaveCount(2);
  await expect(group(page, 1).getByLabel('Note path')).toContainText('Website refresh.mdx');

  // The new group has focus, so the next note opens there: two notes, side by side.
  await openNote(page, 'projects/Mobile app');
  await expect(group(page, 1).getByLabel('Note path')).toContainText('Mobile app.mdx');
  await expect(group(page, 0).getByLabel('Note path')).toContainText('Website refresh.mdx');

  // Editing in the first group writes its own file, not the other group's.
  await group(page, 0).getByRole('button', { name: 'Live', exact: true }).click();
  await group(page, 0).locator('article.preview-prose h1').first().click();
  await page.keyboard.press(end);
  await page.keyboard.insertText(' v2');
  // Live commits a line when focus leaves it.
  await group(page, 0).getByRole('button', { name: 'Live', exact: true }).focus();
  await expect.poll(() => readFileSync(join(workspace, 'projects', 'Website refresh.mdx'), 'utf-8')).toMatch(/^# .* v2$/m);
  expect(readFileSync(join(workspace, 'projects', 'Mobile app.mdx'), 'utf-8')).not.toContain(' v2');

  // Mobile app is a preview, which is not remembered; both groups keep Website refresh.
  await expect.poll(() => storedGroups(page)).toEqual([['projects/Website refresh.mdx'], ['projects/Website refresh.mdx']]);
  await page.reload();
  await expect(groups(page)).toHaveCount(2);
  await expect(group(page, 0).getByLabel('Note path')).toContainText('Website refresh.mdx');
  await expect(group(page, 0).locator('h1').first()).toContainText('v2');

  // Closing a group's last tab closes the group.
  await group(page, 1).getByRole('button', { name: 'Close Website refresh', exact: true }).click();
  await expect(groups(page)).toHaveCount(1);
});

test('the same note in two groups stays in step, and a tab splits right from its menu', async ({ page, workspace }) => {
  await openNote(page, 'projects/Website refresh');
  await page.getByRole('navigation', { name: 'Open notes' }).getByRole('button', { name: 'Website refresh', exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Split right', exact: true }).click();
  await expect(groups(page)).toHaveCount(2);
  await expect(group(page, 1).getByLabel('Note path')).toContainText('Website refresh.mdx');

  await group(page, 0).getByRole('button', { name: 'Live', exact: true }).click();
  await group(page, 0).locator('article.preview-prose h1').first().click();
  await page.keyboard.press(end);
  await page.keyboard.insertText(' shared');
  await group(page, 0).getByRole('button', { name: 'Live', exact: true }).focus();
  // The other group shows the edit from the shared document, and the file gets it once.
  await expect(group(page, 1).locator('article.preview-prose h1').first()).toContainText('shared');
  await expect.poll(() => readFileSync(join(workspace, 'projects', 'Website refresh.mdx'), 'utf-8').split(' shared').length - 1).toBe(1);
});

// Split shows source and preview side by side from 1100 CSS pixels (App.tsx `wide`).
// Set in window pixels, so the CSS width is checked against that line, not for equality.
async function setWindowWidth(app: ElectronApplication, page: Page, width: number) {
  await app.evaluate(({ BrowserWindow }, w) => {
    const win = BrowserWindow.getAllWindows().find((candidate) => !candidate.webContents.getURL().includes('window=settings'));
    win?.setContentSize(w, 820);
  }, width);
  await expect.poll(() => page.evaluate(() => window.innerWidth >= 1100)).toBe(width >= 1100);
}

const TASKS = [
  '# Tasks',
  '',
  'Brackets [ ] and [x] in a paragraph are not tasks.',
  '',
  '- [ ] Write [x] the draft',
  '- [x] Review [ ] the notes',
  '- [ ] Ship it',
  '',
].join('\n');

test.describe('split, line clicks and tasks', () => {
  test.use({ prepareWorkspace: async ({}, use) => use((dir: string) => {
    mkdirSync(join(dir, 'notes'), { recursive: true });
    writeFileSync(join(dir, 'notes', 'split.md'), '# Split\n\nFirst paragraph.\n\nThird paragraph here.\n');
    writeFileSync(join(dir, 'notes', 'tasks.md'), TASKS);
  }) });
  const mode = (page: Page, name: string) => group(page, 0).getByRole('button', { name, exact: true });

  test('Split shows source and preview side by side, and a Source/Preview switch when the window is narrow', async ({ app, page }) => {
    await setWindowWidth(app, page, 1320);
    await openNote(page, 'notes/split.md');
    await mode(page, 'Split').click();
    const editor = group(page, 0).locator('.cm-content');
    await expect(editor).toBeVisible();
    await expect(group(page, 0).locator('article.preview-prose')).toBeVisible();
    await expect(group(page, 0).getByRole('tab', { name: 'Source' })).toHaveCount(0);

    await setWindowWidth(app, page, 900);
    const source = group(page, 0).getByRole('tab', { name: 'Source', exact: true });
    const preview = group(page, 0).getByRole('tab', { name: 'Preview', exact: true });
    await expect(source).toHaveAttribute('aria-selected', 'true');
    await expect(editor).toBeVisible();
    await preview.click();
    await expect(preview).toHaveAttribute('aria-selected', 'true');
    await expect(group(page, 0).locator('article.preview-prose h1')).toHaveText('Split');
    await expect(editor).toBeHidden();

    await setWindowWidth(app, page, 1320);
    await expect(source).toHaveCount(0);
  });

  test('clicking a block in Split\'s preview puts the source cursor on its line', async ({ app, page }) => {
    await setWindowWidth(app, page, 1320);
    await openNote(page, 'notes/split.md');
    await mode(page, 'Split').click();
    const active = group(page, 0).locator('.cm-lineNumbers .cm-activeLineGutter');
    await group(page, 0).locator('article.preview-prose p').filter({ hasText: 'Third paragraph here.' }).click();
    await expect(active).toHaveText('5');
    await expect(group(page, 0).locator('.cm-activeLine')).toHaveText('Third paragraph here.');
    await group(page, 0).locator('article.preview-prose p').filter({ hasText: 'First paragraph.' }).click();
    await expect(active).toHaveText('3');
  });

  test('ticking a task in Reading and in Live writes that task\'s box and nothing else (4A)', async ({ page, workspace }) => {
    const file = join(workspace, 'notes', 'tasks.md');
    const lines = () => readFileSync(file, 'utf8').split('\n');
    await openNote(page, 'notes/tasks.md');
    await expect(mode(page, 'Reading')).toHaveAttribute('aria-pressed', 'true');
    const box = (text: string) => group(page, 0).locator('li').filter({ hasText: text }).locator('input.task-checkbox');

    // Reading: the third task.
    await box('Ship it').check();
    await expect.poll(() => lines()[6]).toBe('- [x] Ship it');
    expect(lines()).toEqual([...TASKS.split('\n').slice(0, 6), '- [x] Ship it', '']);

    // Live: untick the second, whose text holds an empty box of its own; tick the first, whose text holds a ticked one.
    await mode(page, 'Live').click();
    await expect(group(page, 0).locator('[data-live-preview]')).toBeVisible();
    await box('Review').uncheck();
    await expect.poll(() => lines()[5]).toBe('- [ ] Review [ ] the notes');
    await box('Write').check();
    await expect.poll(() => lines()[4]).toBe('- [x] Write [x] the draft');
    expect(lines()[2]).toBe('Brackets [ ] and [x] in a paragraph are not tasks.');
    expect(lines()).toEqual(['# Tasks', '', 'Brackets [ ] and [x] in a paragraph are not tasks.', '', '- [x] Write [x] the draft', '- [ ] Review [ ] the notes', '- [x] Ship it', '']);
  });
});
