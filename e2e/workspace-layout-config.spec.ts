import { test, expect } from './fixtures';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// A workspace's .neuron/layout.json can say how the sidebar and the terminal
// start. It is a starting arrangement: the person can change it afterwards.

const withLayout = (layout: string) => (dir: string) => {
  mkdirSync(join(dir, '.neuron'), { recursive: true });
  writeFileSync(join(dir, '.neuron', 'layout.json'), layout);
  writeFileSync(join(dir, 'note.md'), '# Note\n');
};

test.describe('sidebar closed', () => {
  // A function-valued option has to be handed over as a fixture, or Playwright runs it as one.
  test.use({ prepareWorkspace: async ({}, use) => use(withLayout(JSON.stringify({ sidebar: 'closed' }))) });

  test('opens with no sidebar, and the title bar button brings it back', async ({ page }) => {
    const sidebar = page.getByRole('complementary', { name: 'Workspace sidebar' });
    const show = page.getByRole('button', { name: 'Show sidebar', exact: true });
    await expect(show).toBeVisible({ timeout: 30_000 });
    await expect(sidebar).toHaveCount(0);
    await show.click();
    await expect(sidebar).toBeVisible();
  });
});

test.describe('sidebar on the right', () => {
  test.use({ prepareWorkspace: async ({}, use) => use(withLayout(JSON.stringify({ sidebar: { state: 'open', position: 'right' } }))) });

  test('puts the sidebar after the editor', async ({ page }) => {
    const sidebar = page.getByRole('complementary', { name: 'Workspace sidebar' });
    const editor = page.locator('main').first();
    await expect(sidebar).toBeVisible({ timeout: 30_000 });
    await expect.poll(async () => {
      const [side, main] = await Promise.all([sidebar.boundingBox(), editor.boundingBox()]);
      return !!side && !!main && side.x > main.x;
    }, { timeout: 15_000 }).toBe(true);
  });
});

test.describe('terminal on the right', () => {
  test.use({ prepareWorkspace: async ({}, use) => use(withLayout(JSON.stringify({ terminal: { state: 'open', position: 'right' } }))) });

  test('shows the terminal in the right dock', async ({ page }) => {
    test.setTimeout(120_000);
    await expect(page.locator('[data-dock-group="right:0"] .xterm').first()).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole('button', { name: 'Hide terminal', exact: true })).toHaveAttribute('aria-pressed', 'true');
  });
});

test.describe('the layout changed notice', () => {
  const original = { sidebar: 'open', terminal: { state: 'closed', position: 'bottom' } };
  test.use({ prepareWorkspace: async ({}, use) => use(withLayout(JSON.stringify(original))) });

  test('appears for a changed value, not for a reformatted file', async ({ page, workspace }) => {
    const file = join(workspace, '.neuron', 'layout.json');
    const notice = page.getByText('The workspace layout (.neuron/layout.json) changed.', { exact: false });
    const reformatted = '{\n    "terminal": {\n        "position": "bottom",\n        "state": "closed"\n    },\n    "sidebar": "open"\n}\n';
    await expect(page.getByRole('complementary', { name: 'Workspace sidebar' })).toBeVisible({ timeout: 30_000 });

    // Same meaning, different text: no notice once the watcher has had time.
    writeFileSync(file, reformatted);
    const stayedAway = async () => {
      for (let i = 0; i < 15; i++) {
        if (await notice.count() > 0) return false;
        await page.waitForTimeout(200);
      }
      return true;
    };
    expect(await stayedAway()).toBe(true);

    // A changed value: the notice appears.
    writeFileSync(file, JSON.stringify({ ...original, sidebar: 'closed' }));
    await expect(notice).toBeVisible({ timeout: 10_000 });

    // Changed back (formatted differently): the notice is withdrawn.
    writeFileSync(file, reformatted);
    await expect(notice).toHaveCount(0, { timeout: 10_000 });
  });
});
