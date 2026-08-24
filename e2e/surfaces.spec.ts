import { test, expect } from './fixtures';

// Each workspace file type routes to its own surface (src/renderer/surfaces).
// These assert the surface actually mounts -- a registry regression shows up
// here as a note editor rendering raw JSON instead of a board.

test('canvas opens as a board, fitted to its content', async ({ page }) => {
  await page.locator('.note-row', { hasText: 'Idea board' }).first().click();
  await expect(page.locator('svg').first()).toBeVisible();
  await expect(page.locator('.cm-content')).toHaveCount(0);

  // It used to open at pan (80,80) zoom 1 -- the top-left of an infinite plane,
  // so a board whose content sits elsewhere showed empty space with cards
  // sliced off at the edges. Every node must be inside the viewport on open,
  // without anyone pressing "Zoom to fit".
  const view = (await page.locator('[data-canvas-surface]').boundingBox())!;
  const cards = page.locator('[data-canvas-node]');
  // count() takes one sample and does not retry, so it raced the file read and
  // saw an empty board on a slower runner.
  await expect(cards.first()).toBeVisible();
  const count = await cards.count();
  expect(count).toBeGreaterThan(0);

  for (let i = 0; i < count; i++) {
    const b = await cards.nth(i).boundingBox();
    if (!b) continue;
    expect(b.x).toBeGreaterThanOrEqual(view.x - 2);
    expect(b.y).toBeGreaterThanOrEqual(view.y - 2);
    expect(b.x + b.width).toBeLessThanOrEqual(view.x + view.width + 2);
  }
});

test('a multi-table database opens its schema overview, then drills into a table', async ({ page }) => {
  await page.locator('.note-row', { hasText: 'Planner.db' }).first().click();

  // Planner.db holds two tables, so it opens the overview rather than guessing
  // which one you meant (D28). A single-table file opens straight into it.
  await expect(page.getByText('Tasks', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Projects', { exact: true }).first()).toBeVisible();

  await page.getByText('Tasks', { exact: true }).first().click();
  await expect(page.locator('.vw-content, table').first()).toBeVisible();
});

test('an HTML view names the file and asks for its declared permissions before it renders', async ({ page }) => {
  await page.locator('.note-row', { hasText: 'Custom dashboard' }).first().click();

  // A view does not run until its manifest permissions are granted -- the
  // prompt is the security boundary, so assert it appears BEFORE the webview.
  // Scope to the prompt: the filename also appears in the title bar, the sidebar
  // row and the tab, so a bare getByText matches four elements. What matters
  // here is that the PROMPT names the real file -- the manifest's self-declared
  // name is attacker-controlled, so identifying the view by path is the control.
  const prompt = page.getByText('requests workspace access');
  await expect(prompt).toBeVisible();
  await expect(prompt).toContainText('Custom dashboard.html');
  await expect(page.locator('webview')).toHaveCount(0);

  await page.getByRole('button', { name: 'Allow for this view' }).click();
  await expect(page.getByText('HTML view', { exact: false })).toBeVisible();
  await expect(page.locator('webview')).toHaveCount(1);
});

test('a view that writes has to say so in the prompt, not only in its manifest', async ({ page }) => {
  await page.locator('.note-row', { hasText: 'Custom dashboard' }).first().click();

  // This view appends captured tasks to Planner.db. Write access is the grant a
  // user would most want to refuse, so it must be legible in the prompt rather
  // than buried in a manifest they never open.
  const card = page.locator('[data-view-approval]');
  await expect(card).toBeVisible();
  await expect(card).toContainText('Planner.db');
  await expect(card).toContainText(/write/i);
  await expect(card).toContainText('Can change');

  await page.getByRole('button', { name: 'Allow for this view' }).click();
  await expect(page.getByText('HTML view', { exact: false })).toBeVisible();
});

test('the dashboard view actually loads its data, not just its markup', async ({ app, page }) => {
  await page.locator('.note-row', { hasText: 'Custom dashboard' }).first().click();
  await page.getByRole('button', { name: 'Allow for this view' }).click();
  await expect(page.locator('webview')).toHaveCount(1);

  // Asserting the webview mounted is what the other tests do, and it is not
  // enough: this dashboard shipped with every fetch 404ing and still mounted a
  // perfectly good empty poster. The document is served at
  // /views/{sid}/document, so its relative "./api/v1/db" resolved under the
  // view prefix and never reached the route. Nothing in the suite noticed.
  const view = await app.evaluate(async ({ webContents }) => {
    const wc = webContents.getAllWebContents().find((w) => w.getType() === 'webview');
    if (!wc) return null;
    const read = () => wc.executeJavaScript(`(() => {
      const t = (id) => (document.getElementById(id)?.textContent ?? '').trim();
      const clay = document.querySelector('.pb-clay');
      return {
        open: t('open'),
        overdue: t('overdue'),
        label: t('overdue-label'),
        columns: document.querySelectorAll('#kanban .pb-col').length,
        cards: document.querySelectorAll('#kanban .pb-chip').length,
        projects: document.querySelectorAll('#workload .pb-track').length,
        clayBg: clay ? getComputedStyle(clay).backgroundColor : null,
      };
    })()`);
    // The fetch resolves after load; poll rather than race it.
    for (let i = 0; i < 40; i++) {
      const snap = await read();
      if (snap.open && snap.open !== '—') return snap;
      await new Promise((r) => setTimeout(r, 250));
    }
    return read();
  });

  expect(view, 'no webview attached').not.toBeNull();
  // A real count, not the em-dash placeholder and not an error string.
  expect(view!.label).not.toContain('Planner.db:');
  expect(Number(view!.open)).toBeGreaterThan(0);
  expect(Number(view!.overdue)).toBeGreaterThan(0);
  // The board and workload panels render from the same rows.
  expect(view!.columns).toBe(4);
  expect(view!.cards).toBeGreaterThan(5);
  expect(view!.projects).toBeGreaterThan(2);

  // The view's own styling has to survive the served kit. The kit styles bare
  // <section> as a card at a specificity no author class beats, so this poster
  // rendered as grey boxes with every one of its flat colours overridden. #b8503c
  // is its clay; the kit's card is white or near-black depending on scheme, so
  // this fails loudly either way if the defaults start winning again.
  expect(view!.clayBg).toBe('rgb(184, 80, 60)');
});

test('a folder mini-app collapses to one explorer entry', async ({ page }) => {
  await expect(page.locator('.note-row', { hasText: 'Snake' }).first()).toBeVisible();
  // The folder's internals (index.html, neuron.app.json) must not be listed as
  // notes. Scoped to explorer rows -- the strings appear in demo note prose too.
  await expect(page.locator('.note-row', { hasText: 'index.html' })).toHaveCount(0);
  await expect(page.locator('.note-row', { hasText: 'neuron.app.json' })).toHaveCount(0);
});
