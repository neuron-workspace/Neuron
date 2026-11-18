import { test, expect, openNote } from './fixtures';
import type { Page } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Board and gallery views of a .db file: the mode, card order and card
// properties live in the file, and every card edit is written straight back.

interface Row { id: string; values: Record<string, unknown> }
interface Tasks { view?: Record<string, unknown>; rows: Row[]; schema: { properties: Record<string, { options?: { id: string }[] }> } }

const tasksOf = (workspace: string): Tasks => JSON.parse(readFileSync(join(workspace, 'Planner.db'), 'utf-8')).tables.tasks;
const rowOf = (workspace: string, id: string) => tasksOf(workspace).rows.find((r) => r.id === id)!;
const card = (page: Page, id: string) => page.locator(`main [data-card-id="${id}"]`);
const column = (page: Page, id: string) => page.locator(`[data-board-column="${id}"]`);

async function openTasks(page: Page) {
  await openNote(page, 'Planner.db');
  await page.getByRole('button', { name: 'Open Tasks table' }).click();
}

test('the board has a column per status with the right counts, and stays a board after reopening', async ({ page, workspace }) => {
  await openTasks(page);
  await page.getByRole('button', { name: 'Board', exact: true }).click();

  const tasks = tasksOf(workspace);
  const options = tasks.schema.properties.status.options!.map((o) => o.id);
  await expect(page.locator('[data-board-column]')).toHaveCount(options.length);
  for (const id of options) {
    const expected = tasks.rows.filter((r) => r.values.status === id).length;
    await expect(column(page, id).locator('[data-card-id]')).toHaveCount(expected);
  }
  await expect.poll(() => tasksOf(workspace).view?.mode).toBe('board');

  await page.getByRole('button', { name: 'Close Planner.db' }).click();
  await openTasks(page);
  await expect(page.getByRole('button', { name: 'Board', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-board-column]')).toHaveCount(options.length);
});

test('a card moves between columns and within one from its context menu', async ({ page, workspace }) => {
  await openTasks(page);
  await page.getByRole('button', { name: 'Board', exact: true }).click();

  // "Write the announcement post" is a Todo task.
  await card(page, 't3').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Move to Done' }).click();
  await expect.poll(() => rowOf(workspace, 't3').values.status).toBe('done');
  await expect(column(page, 'done').locator('[data-card-id="t3"]')).toHaveCount(1);
  await expect(page.locator('[aria-live="polite"]', { hasText: 'Moved to Done' })).toHaveCount(1);
  await expect(card(page, 't3')).toBeFocused();

  // With t3 gone, Todo starts t4, t15: moving t15 up puts it before t4 in the file.
  const before = tasksOf(workspace).rows.map((r) => r.id);
  expect(before.indexOf('t4')).toBeLessThan(before.indexOf('t15'));
  await card(page, 't15').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Move up' }).click();
  await expect.poll(() => {
    const ids = tasksOf(workspace).rows.map((r) => r.id);
    return ids.indexOf('t15') < ids.indexOf('t4');
  }).toBe(true);
  await expect(column(page, 'todo').locator('[data-card-id]').first()).toHaveAttribute('data-card-id', 't15');
  await expect(card(page, 't15')).toBeFocused();
});

test('a card dragged with the pointer lands in another column', async ({ page, workspace }) => {
  await openTasks(page);
  await page.getByRole('button', { name: 'Board', exact: true }).click();

  // "Profile the slow list screen" is In progress.
  const source = card(page, 't10');
  // Each column scrolls on its own, and t10 is third in a short one: bring it
  // into view, or the pointer presses on nothing.
  await source.scrollIntoViewIfNeeded();
  const box = (await source.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  try {
    await page.mouse.move(box.x + box.width / 2 + 15, box.y + box.height / 2 + 15, { steps: 5 });
    // The "No Status" column opens as a drop target once the drag starts and
    // shifts the others, so measure the target only now.
    await expect(column(page, '')).toBeVisible();
    const target = (await column(page, 'todo').boundingBox())!;
    const x = target.x + target.width / 2;
    const y = target.y + 40;
    await page.mouse.move(x, y, { steps: 10 });
    // A real pointer keeps sending dragover while it rests on a target; the
    // synthetic drag sends one per move, so move again inside the column.
    await page.mouse.move(x, y + 6, { steps: 3 });
  } finally {
    await page.mouse.up();
  }
  await expect.poll(() => rowOf(workspace, 't10').values.status).toBe('todo');
  await expect(column(page, 'todo').locator('[data-card-id="t10"]')).toHaveCount(1);
});

test('gallery cards show a title, a preview and chips, and card properties persist', async ({ page, workspace }) => {
  await openTasks(page);
  await page.getByRole('button', { name: 'Gallery', exact: true }).click();

  // "Draft the launch checklist": High priority, with notes.
  const first = card(page, 't1');
  await expect(first).toContainText('Draft the launch checklist');
  await expect(first).toContainText('Covers DNS, redirects, analytics');
  await expect(first.getByText('High', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Card properties' }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Priority' }).click();
  await page.keyboard.press('Escape');
  await expect(first.getByText('High', { exact: true })).toHaveCount(0);
  await expect.poll(() => tasksOf(workspace).view?.cardProps).toEqual(['due', 'project']);
  await expect.poll(() => tasksOf(workspace).view?.mode).toBe('gallery');
});

test('a card opens in the row editor, and an edited title reaches the card and the file', async ({ page, workspace }) => {
  await openTasks(page);
  await page.getByRole('button', { name: 'Gallery', exact: true }).click();

  await card(page, 't1').click();
  const dialog = page.getByRole('dialog', { name: 'Draft the launch checklist' });
  await expect(dialog).toBeVisible();
  const edited = 'Draft the launch checklist, round two';
  await dialog.getByLabel('Task', { exact: true }).fill(edited);
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dialog).toBeHidden();

  await expect(card(page, 't1')).toContainText(edited);
  await expect.poll(() => rowOf(workspace, 't1').values.title).toBe(edited);
  await expect(card(page, 't1')).toBeFocused();
});

test('an embedded database view with no view prop follows the mode saved in the file', async ({ page, workspace }) => {
  const dbFile = join(workspace, 'Planner.db');
  const setMode = (mode: string) => {
    const db = JSON.parse(readFileSync(dbFile, 'utf-8'));
    db.tables.tasks.view = { ...db.tables.tasks.view, mode };
    writeFileSync(dbFile, JSON.stringify(db, null, 2) + '\n');
  };
  setMode('board');
  writeFileSync(join(workspace, 'embed.mdx'), '# Embed\n\n<DbView path="@Planner.db" table="tasks" />\n');
  await page.getByRole('button', { name: 'Refresh explorer' }).click();
  await openNote(page, 'embed.mdx');

  const embed = page.locator('[data-db-embed-mode]');
  await expect(embed).toHaveAttribute('data-db-embed-mode', 'board');
  await expect(embed.locator('[data-card-id]').first()).toBeVisible();

  // The embed re-reads the file when it changes on disk.
  setMode('gallery');
  await expect(embed).toHaveAttribute('data-db-embed-mode', 'gallery');
});
