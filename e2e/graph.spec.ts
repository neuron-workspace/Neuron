import { test, expect } from './fixtures';

// T-026. The graph is a floating square over the editor, on by default, drawing
// the whole workspace -- not a full-height column showing the active note alone.

test('the graph is visible without touching a shortcut', async ({ page }) => {
  // No keypress, no focus juggling. It is on by default because it replaced a
  // panel that was always on; a graph you must discover a shortcut for is a
  // graph nobody sees. This also sidesteps the real problem that a global
  // keydown handler does nothing while the terminal or a webview holds focus.
  const graph = page.getByRole('complementary', { name: 'Workspace graph' });
  await expect(graph).toBeVisible();

  const box = await graph.boundingBox();
  expect(box).not.toBeNull();
  expect(Math.abs(box!.width - box!.height)).toBeLessThan(2);
  expect(box!.width).toBeLessThan(320);

  // It must clear the tab strip rather than sit on top of it.
  const tabs = await page.locator('nav[aria-label="Open notes"]').boundingBox();
  if (tabs) expect(box!.y).toBeGreaterThanOrEqual(tabs.y + tabs.height - 1);

  // No title bar: the square is all graph, with only the close control on it.
  await expect(graph).not.toContainText('Graph');
  await expect(graph.getByRole('button', { name: 'Hide graph' })).toBeVisible();
});

test('the graph draws every note, not only the active one', async ({ page }) => {
  const graph = page.getByRole('complementary', { name: 'Workspace graph' });
  await expect(graph).toBeVisible();

  const nodes = graph.locator('.graph-node');
  await expect(nodes.first()).toBeVisible();
  // The demo workspace has well over a dozen notes. The old panel scoped to the
  // active note and drew one.
  expect(await nodes.count()).toBeGreaterThan(5);

  const faded = await nodes.evaluateAll(
    (els) => els.filter((el) => Number((el as HTMLElement).style.opacity || '1') < 0.85).length,
  );
  expect(faded).toBe(0);
});

test('the graph sits over the editor and can be dismissed', async ({ page }) => {
  const graph = page.getByRole('complementary', { name: 'Workspace graph' });
  await expect(graph).toBeVisible();
  await graph.getByRole('button', { name: 'Hide graph' }).click();
  await expect(graph).toHaveCount(0);
});

test('no full-height graph column remains in the shell layout', async ({ page, workspace }) => {
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const layout = JSON.parse(readFileSync(join(workspace, '.neuron', 'layout.json'), 'utf-8'));
  const panels = JSON.stringify(layout);
  expect(panels).not.toContain('"graph"');
  // The editor gets the width back: it is the only panel besides the terminal.
  expect(panels).toContain('"editor"');
  expect(panels).toContain('"terminal"');
  // And the floating graph is what shows the workspace instead.
  await expect(page.getByRole('complementary', { name: 'Workspace graph' })).toBeVisible();
});

test('the graph recentres on the open note, zooms, and pans', async ({ page }) => {
  const graph = page.getByRole('complementary', { name: 'Workspace graph' });
  // The panel holds two svgs -- the graph and the close icon.
  const svg = graph.locator('svg[data-graph-canvas]');
  const box = async () => (await svg.getAttribute('viewBox'))!.split(' ').map(Number);

  const open = async (name: string) => {
    await page.getByRole('button', { name: /Search & commands/ }).click();
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible();
    await dialog.locator('input').first().fill(name);
    await dialog.getByText(name, { exact: false }).first().click();
    await expect(dialog).toBeHidden();
  };

  // The open note sits at the centre of the panel. Under the BFS layout it is
  // always placed at the spiral origin and the camera centres there, so
  // comparing viewBox origins between two notes proves nothing -- they are
  // identical by construction. What matters is that the note you opened is the
  // one in the middle.
  await open('guides/markdown-basics');
  const svgBox = (await svg.boundingBox())!;
  // Nodes are labelled by path, not basename, so two notes with the same name
  // in different folders stay distinguishable.
  const active = graph.locator('.graph-node[aria-label="Open guides/markdown-basics"]');
  await expect(active).toBeVisible();
  const nodeBox = (await active.boundingBox())!;
  const offCentre = Math.hypot(
    (nodeBox.x + nodeBox.width / 2) - (svgBox.x + svgBox.width / 2),
    (nodeBox.y + nodeBox.height / 2) - (svgBox.y + svgBox.height / 2),
  );
  expect(offCentre).toBeLessThan(24);

  // Wheel zooms in: a narrower viewport shows less of the graph, larger.
  const [, , beforeW] = await box();
  const rect = (await svg.boundingBox())!;
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await page.mouse.wheel(0, -240);
  await expect.poll(async () => (await box())[2], { timeout: 10_000 }).toBeLessThan(beforeW);

  // Dragging the background pans, and does not snap back to the selected node.
  const [zx, zy] = await box();
  // Grab empty space, not the centre: after zooming to a note the centre IS
  // that node, and beginPan deliberately ignores a press on one so a click
  // still opens it.
  await page.mouse.move(rect.x + 12, rect.y + rect.height - 12);
  await page.mouse.down();
  await page.mouse.move(rect.x + 72, rect.y + rect.height - 52, { steps: 8 });
  await page.mouse.up();
  const [px, py] = await box();
  expect(Math.abs(px - zx) + Math.abs(py - zy)).toBeGreaterThan(1);
});

test('the graph can be closed and reopened from the title bar', async ({ page }) => {
  const graph = page.getByRole('complementary', { name: 'Workspace graph' });
  await expect(graph).toBeVisible();

  await graph.getByRole('button', { name: 'Hide graph' }).click();
  await expect(graph).toHaveCount(0);

  // Closing must not be one-way. The palette entry and Ctrl+Shift+G both run
  // through a global keydown with no focus scopes, so neither fires while the
  // terminal or a webview holds focus -- a persistent control is the only way
  // back that always works.
  await page.getByRole('button', { name: 'Show graph' }).click();
  await expect(graph).toBeVisible();
});

test('the graph panel can be dragged to a new position', async ({ page }) => {
  const graph = page.getByRole('complementary', { name: 'Workspace graph' });
  const before = (await graph.boundingBox())!;

  // The grip, not the canvas: dragging the canvas pans the graph, so moving the
  // window needs its own affordance.
  const grip = graph.getByRole('button', { name: 'Move graph' });
  const g = (await grip.boundingBox())!;
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
  await page.mouse.down();
  await page.mouse.move(g.x + g.width / 2 - 180, g.y + g.height / 2 + 120, { steps: 10 });
  await page.mouse.up();

  const after = (await graph.boundingBox())!;
  expect(Math.abs(after.x - before.x) + Math.abs(after.y - before.y)).toBeGreaterThan(40);
  // Still fully inside the editor region -- a panel dragged off-screen cannot
  // be dragged back.
  expect(after.x).toBeGreaterThan(0);
  expect(after.y).toBeGreaterThan(0);
});

test('nodes glide to their new places instead of jumping', async ({ page }) => {
  const graph = page.getByRole('complementary', { name: 'Workspace graph' });
  const centreOf = async (label: string) => {
    const box = await graph.locator(`.graph-node[aria-label="Open ${label}"]`).boundingBox();
    return box ? { x: box.x + box.width / 2, y: box.y + box.height / 2 } : null;
  };

  // Select by clicking a node, not through the palette. Waiting for the palette
  // dialog to tear down takes longer than the 320ms tween, so the first sample
  // arrived after the animation had already finished -- the test missed it, the
  // feature was fine.
  const target = graph.locator('.graph-node').nth(3);
  const label = await target.getAttribute('aria-label');
  const name = label!.replace(/^Open /, '');

  const before = await centreOf(name);
  expect(before).not.toBeNull();

  // Sample from inside the page, on requestAnimationFrame.
  //
  // The previous version took one boundingBox 80ms after the click and required
  // the 320ms tween to still be running. That races the machine: on a loaded
  // runner the 80ms wait plus a driver round-trip lands after the animation has
  // finished, and the test fails on a feature that worked. It had already been
  // rewritten once for this and it failed again during a run that took two and
  // a half times as long as usual.
  //
  // Sampling in-page removes the race entirely, because the sampler and the
  // animation now share one clock. If the renderer is starved the tween is
  // starved with it, and the samples still land mid-flight.
  // Click a circle, not the group. The group's box spans the label above the
  // circle, so its centre lands in the gap between the two -- and the label is
  // pointer-events-none, so the click reaches the SVG behind it and pans the
  // canvas instead of selecting. Windows and macOS happened to place the centre
  // on the circle; Linux, with different font metrics, did not.
  await target.locator('circle').first().click();
  const points: [number, number][] = await page.evaluate(async (selector) => {
    const el = document.querySelector(selector);
    if (!el) return [];
    const seen: [number, number][] = [];
    const began = performance.now();
    await new Promise<void>((resolve) => {
      const tick = () => {
        const r = el.getBoundingClientRect();
        seen.push([r.x + r.width / 2, r.y + r.height / 2]);
        if (performance.now() - began > 600) resolve();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    return seen;
  }, `.graph-node[aria-label="Open ${name}"]`);

  expect(points.length).toBeGreaterThan(3);

  const arrived = points[points.length - 1];
  const travelled = Math.hypot(arrived[0] - before!.x, arrived[1] - before!.y);
  expect(travelled).toBeGreaterThan(20);

  // A tween passes through intermediate positions; a jump reports the
  // destination from the very first frame. Rounding to the half pixel keeps
  // sub-pixel jitter from counting as movement.
  const distinct = new Set(points.map(([x, y]) => `${Math.round(x * 2)},${Math.round(y * 2)}`));
  expect(distinct.size, 'the node teleported instead of gliding').toBeGreaterThan(2);
});
