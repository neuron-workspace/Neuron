// The workspace explorer, and the transitions in and out of it.
//
// The data model is covered by tools/workspace-explorer.test.mjs. What can only
// be checked with the app running is when the view appears and disappears --
// specifically that going home does not close anyone's tabs, which is the whole
// reason "at home" is separate state from "nothing selected".
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures';

const explorer = '[data-workspace-explorer]';

test('with nothing open, the editor area is the explorer rather than a blank panel', async ({ page }) => {
  await expect(page.locator(explorer)).toBeVisible();
  await expect(page.locator(`${explorer} h2`).first()).toBeVisible();
});

test('opening a file from the explorer dismisses it', async ({ page }) => {
  const file = page.locator(`${explorer} [data-file]`).first();
  await expect(file).toBeVisible();
  await file.click();

  await expect(page.locator(explorer)).toHaveCount(0);
});

test('entering a folder shows its contents, and Up goes back', async ({ page, workspace }) => {
  // The seeded workspace is flat apart from .neuron, which the explorer
  // deliberately does not show, so the folder to navigate has to be made here.
  mkdirSync(join(workspace, 'field-notes'), { recursive: true });
  writeFileSync(join(workspace, 'field-notes', 'first.md'), '# First\n');

  const folder = page.locator(`${explorer} [data-folder="field-notes"]`);
  await expect(folder).toBeVisible({ timeout: 15_000 });
  await folder.click();

  await expect(page.locator(`${explorer} h1`)).toHaveText('field-notes');
  await expect(page.locator(`${explorer} [data-file="field-notes/first.md"]`)).toBeVisible();

  await page.getByRole('button', { name: 'Up' }).click();
  // Back at the root there is nowhere further up to go.
  await expect(page.getByRole('button', { name: 'Up' })).toHaveCount(0);
});

test('the workspace configuration folder is not offered', async ({ page }) => {
  // .neuron holds the workspace's own layout.json. The sidebar and graph hide
  // it; an explorer that listed it would invite someone to edit configuration
  // the rest of the app treats as internal — and the app rewrites that file as
  // you use it, so the row churned under the cursor too.
  await expect(page.locator(`${explorer} [data-folder=".neuron"]`)).toHaveCount(0);
});

test('the workspace title returns home WITHOUT closing open tabs', async ({ page }) => {
  // The requirement this feature is most likely to get wrong: home has to be
  // somewhere you can go while a note is open, and the note has to still be
  // there afterwards.
  // A plain note, not a surface file: this is about tabs surviving, and a
  // .html view renders through a different path with its own chrome.
  const file = page.locator(`${explorer} [data-file$=".md"]`).first();
  const opened = (await file.getAttribute('data-file'))!;
  await file.click();
  await expect(page.locator(explorer)).toHaveCount(0);

  // Tabs are buttons carrying the full path as their title.
  const tab = page.locator(`button[title="${opened}"]`).first();
  await expect(tab).toBeVisible();

  await page.locator('[data-workspace-home]').click();
  await expect(page.locator(explorer)).toBeVisible();

  // The whole point: going home did not close it.
  await expect(tab).toBeVisible();
  await tab.click();
  await expect(page.locator(explorer)).toHaveCount(0);
});

test('an opened file shows up under Recent when you come back', async ({ page }) => {
  const file = page.locator(`${explorer} [data-file]`).first();
  const opened = (await file.getAttribute('data-file'))!;
  await file.click();
  await page.locator('[data-workspace-home]').click();

  await expect(page.locator(`${explorer} [data-recent="${opened}"]`)).toBeVisible();
});

test('Clear empties the Recent section', async ({ page }) => {
  await page.locator(`${explorer} [data-file]`).first().click();
  await page.locator('[data-workspace-home]').click();
  await expect(page.getByRole('heading', { name: 'Recent' })).toBeVisible();

  await page.getByRole('button', { name: 'Clear' }).click();
  await expect(page.getByRole('heading', { name: 'Recent' })).toHaveCount(0);
});

test('a surface file opens in its surface, not a text editor', async ({ page, workspace }) => {
  // The explorer must open files through the same path the sidebar uses, or a
  // .canvas would land in a Markdown editor showing raw JSON. Created here
  // rather than skipped when the seeded workspace happens not to have one at
  // the root -- a test that skips is a test that is not run.
  writeFileSync(join(workspace, 'board.canvas'), JSON.stringify({ nodes: [], edges: [] }));

  const canvas = page.locator(`${explorer} [data-file="board.canvas"]`);
  await expect(canvas).toBeVisible({ timeout: 15_000 });
  await canvas.click();

  // Whatever the canvas renders, it is not the Markdown editor's raw JSON.
  await expect(page.locator(explorer)).toHaveCount(0);
  await expect(page.locator('.cm-content')).toHaveCount(0);
});
