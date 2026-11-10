import { test, expect } from './fixtures';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// A workspace can declare its own shell layout (.neuron/layout.json). A panel
// you cannot dismiss makes that file the only way to change your own screen.
// The demo workspace no longer declares a terminal, so this one does.
test.use({
  // A function-valued option has to be handed over as a fixture, or Playwright runs it as one.
  prepareWorkspace: async ({}, use) => use((dir: string) => {
    mkdirSync(join(dir, '.neuron'), { recursive: true });
    writeFileSync(join(dir, '.neuron', 'layout.json'), JSON.stringify({
      direction: 'vertical',
      children: [{ size: 72, panel: { type: 'editor' } }, { size: 28, panel: { type: 'terminal' } }],
    }));
    writeFileSync(join(dir, 'note.md'), '# Note\n');
  }),
});

test('a shell panel can be closed, and closing is not one-way', async ({ page }) => {
  const terminal = page.locator('.xterm, [class*="xterm"]').first();
  await expect(terminal).toBeVisible();

  // Revealed on hover, so the chrome is not permanent.
  await terminal.hover();
  const close = page.getByRole('button', { name: 'Close terminal panel' });
  await expect(close).toBeVisible();
  await close.click();
  await expect(terminal).toHaveCount(0);

  // Getting it back must not require editing .neuron/layout.json by hand.
  const restore = page.getByRole('button', { name: /Restore 1 panel/ });
  await expect(restore).toBeVisible();
  await restore.click();
  await expect(page.locator('.xterm, [class*="xterm"]').first()).toBeVisible();
});
