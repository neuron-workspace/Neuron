import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { test, expect, openNote } from './fixtures';

// Module 11: search (11C: every text file), the command palette, wiki-link
// pills and the workspace graph (11A: Fit).

const filler = Array.from({ length: 40 }, (_, i) => `filler line ${i + 1}`).join('\n');
const FILES: Record<string, string> = {
  'alpha.md': '# Alpha\n\nfirst line\nthe zephyr word is here\n',
  // The match is far down, so opening at it has to scroll.
  'beta.md': `# Beta\n\n${filler}\n\nthe marmalade line\n`,
  'config/settings.json': '{\n  "name": "demo",\n  "quokkaKey": true\n}\n',
  'broken.md': '# Broken\n\nSee [[Nowhere At All]] here.\n',
  // n0 - n1 - ... - n6: a chain, so each step of depth shows two more notes.
  ...Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`chain/n${i}.md`, `# n${i}\n\n${i < 6 ? `[[n${i + 1}]]` : ''}\n`])),
};

test.use({ prepareWorkspace: async ({}, use) => use((dir: string) => {
  for (const [path, content] of Object.entries(FILES)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  // Past the 5 MB text limit: a word at the top is found, one past 5 MB is not.
  const line = 'log line of no interest\n';
  writeFileSync(join(dir, 'big.log'), 'headword starts the log\n' + line.repeat(Math.ceil((5.5 * 1024 * 1024) / line.length)) + 'tailword ends it\n');
}) });

const search = (page: Page) => page.locator('section[aria-label="Search notes"]');

async function openSearch(page: Page) {
  await page.getByRole('button', { name: /Search & commands/ }).click();
  const dialog = page.locator('[role="dialog"]');
  await dialog.locator('input').first().fill('Search in notes');
  await dialog.getByText('Search in notes', { exact: true }).first().click();
  await expect(dialog).toBeHidden();
  await expect(search(page)).toBeVisible();
}

const query = (page: Page, text: string) => search(page).getByRole('textbox').first().fill(text);
const hit = (page: Page, path: string) => search(page).locator(`[data-search-hit="${path}"]`);

test.describe('search', () => {
  test('finds a note by name and by its text, shows the line, and opens with the cursor on it', async ({ page }) => {
    // Split, so there is a source editor for the cursor to be in.
    await openNote(page, 'alpha.md');
    await page.getByRole('button', { name: 'Split', exact: true }).first().click();
    await openSearch(page);

    await query(page, 'alpha');
    await expect(hit(page, 'alpha.md')).toBeVisible();

    await query(page, 'zephyr');
    const found = hit(page, 'alpha.md');
    await expect(found).toBeVisible();
    const line = found.locator('[data-hit-line="4"]');
    await expect(line).toContainText('4');
    await expect(line).toContainText('the zephyr word is here');
    await line.click();
    await expect(page.locator('.cm-activeLine').first()).toHaveText('the zephyr word is here');
    await expect(page.locator('.cm-activeLineGutter').first()).toHaveText('4');
  });

  test('in reading view the hit scrolls to its line and marks it', async ({ page }) => {
    await openSearch(page);
    await query(page, 'marmalade');
    await hit(page, 'beta.md').click();
    const marked = page.locator('article.preview-prose [data-revealed]');
    await expect(marked).toHaveText('the marmalade line');
    await expect(marked).toBeInViewport();
  });

  test('a JSON file is found by its text and opens in the text view at that line', async ({ page }) => {
    await openSearch(page);
    await query(page, 'quokkakey');
    const found = hit(page, 'config/settings.json');
    await expect(found.locator('[data-hit-line="3"]')).toContainText('"quokkaKey": true');
    await found.click();
    await expect(page.locator('[data-text-surface]')).toBeVisible();
    await expect(page.locator('[data-text-surface] .cm-activeLine')).toHaveText('  "quokkaKey": true');
  });

  test('a text file over 5 MB is searched by its first 5 MB, and says so', async ({ page }) => {
    await openSearch(page);
    await query(page, 'headword');
    await expect(hit(page, 'big.log')).toBeVisible();
    await expect(hit(page, 'big.log').locator('[data-search-truncated]')).toHaveText('Only the first 5 MB of this file was searched.');
    await query(page, 'tailword');
    await expect(search(page).getByText('No notes match your search.')).toBeVisible();
    await expect(hit(page, 'big.log')).toHaveCount(0);
  });

  test('a text file changed on disk is searched as it is now', async ({ page, workspace }) => {
    await openSearch(page);
    await query(page, 'quokkakey');
    await expect(hit(page, 'config/settings.json')).toBeVisible();
    writeFileSync(join(workspace, 'config/settings.json'), '{\n  "pelicanWord": 1\n}\n');
    await query(page, 'pelicanword');
    await expect(hit(page, 'config/settings.json')).toBeVisible({ timeout: 15_000 });
    await query(page, 'quokkakey');
    await expect(hit(page, 'config/settings.json')).toHaveCount(0);
  });
});

test.describe('palette', () => {
  test('opens a note, runs a command, and switches workspace', async ({ app, page, workspace }) => {
    // Two workspaces of one name in different folders.
    const one = join(workspace, '..', 'one', 'notes');
    const two = join(workspace, '..', 'two', 'notes');
    for (const dir of [one, two]) { mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, 'elsewhere.md'), '# Elsewhere\n'); }
    await expect(page.locator('.note-row').first()).toBeVisible();
    // `repositories` is main's own key (P0-2): written from inside main, not through the renderer.
    await app.evaluate(({ app: electronApp }, repositories) => {
      const fs = process.mainModule!.require('node:fs') as typeof import('node:fs');
      const file = `${electronApp.getPath('userData')}/neuron-settings.json`;
      const settings = JSON.parse(fs.readFileSync(file, 'utf-8'));
      settings.repositories = repositories;
      fs.writeFileSync(file, JSON.stringify(settings, null, 2));
    }, { current: workspace, recent: [workspace, one, two] });
    await page.reload();
    await expect(page.locator('.note-row').first()).toBeVisible();

    const palette = page.locator('[role="dialog"]');
    const run = async (text: string, option: RegExp | string) => {
      await page.getByRole('button', { name: /Search & commands/ }).click();
      await expect(palette).toBeVisible();
      await palette.locator('input').first().fill(text);
      await palette.getByRole('option', { name: option }).first().click();
      await expect(palette).toBeHidden();
    };

    await run('alpha', 'alpha.md');
    await expect(page.getByLabel('Note path')).toHaveAttribute('title', 'alpha.md');

    await run('Show workspace graph', /Show workspace graph/);
    await expect(page.getByRole('complementary', { name: 'Workspace graph' })).toBeVisible();

    // Each "notes" says which folder it is in.
    await page.getByRole('button', { name: /Search & commands/ }).click();
    await palette.locator('input').first().fill('Switch workspace');
    const switches = palette.getByRole('option', { name: /Switch workspace: notes/ });
    await expect(switches).toHaveCount(2);
    await expect(switches.filter({ hasText: 'one' })).toHaveCount(1);
    await expect(switches.filter({ hasText: 'two' })).toHaveCount(1);
    // A window that has a workspace keeps it: the other one opens in a window of its own.
    const [other] = await Promise.all([app.waitForEvent('window'), switches.filter({ hasText: 'two' }).click()]);
    await other.waitForLoadState('domcontentloaded');
    await expect(other.locator('.note-row', { hasText: 'elsewhere' }).first()).toBeVisible({ timeout: 30_000 });
    await expect(other.locator('.note-row', { hasText: 'alpha' })).toHaveCount(0);
    await expect(page.locator('.note-row', { hasText: 'alpha' }).first()).toBeVisible();
  });
});

test('a broken wiki link shows the missing pill', async ({ page }) => {
  await openNote(page, 'broken.md');
  const pill = page.locator('article.preview-prose').getByTitle('No note found for "Nowhere At All"');
  await expect(pill).toBeVisible();
  await expect(pill).toContainText('Nowhere At All');
  await expect(pill).toContainText('(missing note)');
});

// --- The graph ------------------------------------------------------------

const showGraph = async (page: Page) => {
  await page.getByRole('button', { name: 'Show graph', exact: true }).click();
  const graph = page.getByRole('complementary', { name: 'Workspace graph' });
  const canvas = graph.locator('[data-graph-canvas]');
  await expect(canvas.locator('canvas.sigma-nodes')).toBeVisible();
  await expect.poll(() => canvas.evaluate((el: any) => el.sigma?.getGraph().order ?? 0)).toBeGreaterThan(5);
  await expect(graph.locator('[data-graph-root]')).toHaveAttribute('data-layout-running', 'false');
  return { graph, canvas };
};

/** Every shown node's centre on screen, relative to the canvas, and the canvas size. */
const onScreen = (canvas: Locator) => canvas.evaluate((el: any) => {
  const s = el.sigma, g = s.getGraph();
  const shown = g.nodes().filter((id: string) => !s.getNodeDisplayData(id)?.hidden);
  return { ids: shown, points: shown.map((id: string) => s.graphToViewport(g.getNodeAttributes(id))), width: el.clientWidth, height: el.clientHeight };
});

const settled = (canvas: Locator) => expect.poll(() => canvas.evaluate((el: any) => el.sigma.getCamera().isAnimated())).toBe(false);

/** Sigma hit-tests against what it has drawn; wait for a frame (see graph.spec.ts). */
const painted = (canvas: Locator) => canvas.evaluate((el: any) => new Promise<void>((resolve) => {
  el.sigma.once('afterRender', () => resolve());
  el.sigma.refresh();
}));

test.describe('graph', () => {
  test('after Fit every node is inside the graph panel, and the graph fills it', async ({ page }) => {
    const { graph, canvas } = await showGraph(page);
    const framed = async () => {
      await settled(canvas);
      const { points, width, height } = await onScreen(canvas);
      expect(points.length).toBeGreaterThan(5);
      for (const p of points) {
        expect(p.x).toBeGreaterThanOrEqual(0); expect(p.x).toBeLessThanOrEqual(width);
        expect(p.y).toBeGreaterThanOrEqual(0); expect(p.y).toBeLessThanOrEqual(height);
      }
      // Framed, not merely visible: the outermost node is near an edge, not lost in the middle.
      const reach = Math.max(...points.map((p: { x: number; y: number }) => Math.max(Math.abs(p.x - width / 2) / (width / 2), Math.abs(p.y - height / 2) / (height / 2))));
      // Before 11A the stage padding alone kept this near 0.67 in this panel.
      expect(reach).toBeGreaterThan(0.72);
      expect(reach).toBeLessThan(0.95);
    };
    // Somewhere else first: zoomed far out and off to one side.
    await canvas.evaluate((el: any) => el.sigma.getCamera().setState({ x: 3, y: -2, ratio: 6 }));
    await graph.getByRole('button', { name: 'Fit connections' }).click();
    await framed();

    // Reset to defaults lays the graph out again and frames it the same way.
    await canvas.evaluate((el: any) => el.sigma.getCamera().setState({ x: -2, y: 4, ratio: 0.2 }));
    await graph.getByRole('button', { name: 'Connection settings' }).click();
    const settings = page.getByRole('dialog', { name: 'Connection settings' });
    await settings.getByRole('button', { name: 'Reset to defaults', exact: true }).click();
    await settings.getByRole('button', { name: 'Close connection settings' }).click();
    await expect(graph.locator('[data-graph-root]')).toHaveAttribute('data-layout-running', 'false');
    await framed();
  });

  test('clicking a node opens its note', async ({ page }) => {
    const { canvas } = await showGraph(page);
    await painted(canvas);
    const rect = (await canvas.boundingBox())!;
    const target = await canvas.evaluate((el: any) => {
      const s = el.sigma, g = s.getGraph();
      const p = s.graphToViewport(g.getNodeAttributes('alpha.md'));
      return { x: p.x, y: p.y };
    });
    expect(target.x).toBeGreaterThan(0); expect(target.y).toBeGreaterThan(0);
    await page.mouse.click(rect.x + target.x, rect.y + target.y);
    await expect(page.getByLabel('Note path')).toHaveAttribute('title', 'alpha.md');
  });

  test('the local graph shows more notes as its depth grows', async ({ page }) => {
    const { graph, canvas } = await showGraph(page);
    await openNote(page, 'chain/n3.md');
    await graph.getByRole('button', { name: 'Connection settings' }).click();
    const settings = page.getByRole('dialog', { name: 'Connection settings' });
    await settings.getByRole('button', { name: 'Around this note', exact: true }).click();
    const shown = async () => (await onScreen(canvas)).ids.sort();
    await expect.poll(shown).toEqual(['chain/n2.md', 'chain/n3.md', 'chain/n4.md']);
    await settings.getByRole('slider', { name: 'Steps from this note' }).fill('2');
    await expect.poll(shown).toEqual(['chain/n1.md', 'chain/n2.md', 'chain/n3.md', 'chain/n4.md', 'chain/n5.md']);
    await settings.getByRole('slider', { name: 'Steps from this note' }).fill('3');
    await expect.poll(shown).toEqual(['chain/n0.md', 'chain/n1.md', 'chain/n2.md', 'chain/n3.md', 'chain/n4.md', 'chain/n5.md', 'chain/n6.md']);
  });
});
