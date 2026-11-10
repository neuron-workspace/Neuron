import { test, expect } from './fixtures';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// A workspace can declare its own shell layout (.neuron/layout.json). A panel
// you cannot dismiss makes that file the only way to change your own screen.
// A graph panel stands in for "some panel": a terminal in this file is ignored,
// because the terminal is a dock panel now.
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

test('a shell panel can be closed, and closing is not one-way', async ({ page }) => {
  const panel = page.locator('[data-graph-root]').first();
  await expect(panel).toBeVisible();

  // Revealed on hover, so the chrome is not permanent.
  await panel.hover();
  const close = page.getByRole('button', { name: 'Close graph panel' });
  await expect(close).toBeVisible();
  await close.click();
  await expect(page.locator('[data-graph-root]')).toHaveCount(0);

  // Getting it back must not require editing .neuron/layout.json by hand.
  const restore = page.getByRole('button', { name: /Restore 1 panel/ });
  await expect(restore).toBeVisible();
  await restore.click();
  await expect(page.locator('[data-graph-root]').first()).toBeVisible();
});

test('a terminal declared in the layout file is ignored, so there is never a second one', async ({ page }) => {
  await expect(page.locator('[data-graph-root]').first()).toBeVisible();
  await expect(page.locator('.xterm')).toHaveCount(0);
});
