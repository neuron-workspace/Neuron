import { test, expect } from './fixtures';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// A workspace can declare its own shell layout (.neuron/layout.json). Its panels
// are the main area, so they are not closable. A graph panel stands in for
// "some panel": a terminal in this file is ignored, because the terminal is a
// dock panel now.
test.use({
  // A function-valued option has to be handed over as a fixture, or Playwright runs it as one.
  prepareWorkspace: async ({}, use) => use((dir: string) => {
    mkdirSync(join(dir, '.neuron'), { recursive: true });
    writeFileSync(join(dir, '.neuron', 'layout.json'), JSON.stringify({
      direction: 'vertical',
      children: [{ size: 60, panel: { type: 'editor' } }, { size: 20, panel: { type: 'graph' } }, { size: 20, panel: { type: 'terminal' } }],
    }));
    writeFileSync(join(dir, 'note.md'), '# Note\n\nSee [[other]].\n');
    writeFileSync(join(dir, 'other.md'), '# Other\n');
  }),
});

test('layout panels are always shown and cannot be closed', async ({ page }) => {
  const panel = page.locator('[data-graph-root]').first();
  await expect(panel).toBeVisible();
  await panel.hover();
  await expect(page.getByRole('button', { name: /Close .* panel/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Restore/ })).toHaveCount(0);
});

test('a terminal declared in the layout file is ignored, so there is never a second one', async ({ page }) => {
  await expect(page.locator('[data-graph-root]').first()).toBeVisible();
  await expect(page.locator('.xterm')).toHaveCount(0);
});
