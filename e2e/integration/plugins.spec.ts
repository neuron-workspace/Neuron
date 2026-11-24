import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect, keychain, openSettings, openWorkspaceSettings, setPluginEnabled } from '../fixtures';

// Integration: connectors and plugins. A plugin switched on adds its panel,
// a connector keeps its key only in the keychain, and a plugin without its
// connector offers to set it up. workspace-windows.spec.ts and secrets.spec.ts
// hold the detail.

const rightDock = (page: Page) => page.locator('[data-dock-group^="right:"]');

test('a plugin switched on in Workspace settings adds its panel, and switched off removes it', async ({ app, page }) => {
  await page.getByRole('button', { name: 'Show panel', exact: true }).click();
  await expect(rightDock(page).getByRole('button', { name: 'Graph', exact: true })).toBeVisible();
  const daily = rightDock(page).getByRole('button', { name: 'Daily', exact: true });
  await expect(daily).toHaveCount(0);

  await setPluginEnabled(app, page, 'Daily Notes', true);
  await expect(daily).toBeVisible();
  await setPluginEnabled(app, page, 'Daily Notes', false);
  await expect(daily).toHaveCount(0);
});

test('a connector key is saved to the keychain only, shown as Configured, and disconnected', async ({ app, page }) => {
  // Saving needs a real keychain; only Linux can lack one (secrets.spec.ts tests the refusal).
  const store = await keychain(app);
  test.skip(process.platform === 'linux' && !store.usable, `No usable system keychain on this Linux machine (${store.backend}).`);
  const settings = await openSettings(app, page, 'connectors');
  const claude = settings.locator('[data-connector="anthropic"]');
  await expect(claude).toContainText('Not set up');
  await claude.getByRole('button', { name: 'Set up Claude' }).click();
  await claude.getByLabel('Anthropic API key').fill('sk-ant-e2e-WRITE-ONLY');
  await claude.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(claude).toContainText('Configured');

  const userData = await app.evaluate(({ app: electronApp }) => electronApp.getPath('userData'));
  const onDisk = () => readFileSync(join(userData, 'neuron-settings.json'), 'utf8');
  expect(onDisk()).not.toContain('WRITE-ONLY');
  expect(JSON.parse(onDisk()).__secrets.anthropic.apiKey).toEqual({ v: 1, enc: expect.any(String) });

  await claude.getByRole('button', { name: 'Disconnect Claude' }).click();
  await expect(claude).toContainText('Not set up');
  expect(JSON.parse(onDisk()).__secrets.anthropic).not.toHaveProperty('apiKey');
});

test('a plugin whose connector is not set up offers to set it up, in Settings at Connectors', async ({ app, page }) => {
  const dialog = await openWorkspaceSettings(page, 'plugins');
  const row = dialog.locator('[data-plugin-row="ai-openai"]');
  await expect(row).toContainText('Set up OpenAI in Settings');
  const [settings] = await Promise.all([app.waitForEvent('window'), row.getByRole('button', { name: 'Set up', exact: true }).click()]);
  await settings.waitForLoadState('domcontentloaded');
  await expect(settings.locator('[data-settings-section="connectors"]')).toBeVisible();
});
