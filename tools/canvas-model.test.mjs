// Runnable checks for the JSON Canvas model layer (src/renderer/canvas/*):
// parsing diagnostics, unknown-field preservation, round-trips, fragments,
// z-order, alignment, history, and Markdown-rendering safety.
// Run: node tools/canvas-model.test.mjs
import { build } from 'esbuild';
import { rmSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outfile = join(root, 'tools', '.canvas-model.tmp.mjs');

await build({
  stdin: {
    contents: `
      export * from './src/renderer/canvas/model';
      export * from './src/renderer/canvas/history';
      export { renderMarkdown } from './src/renderer/canvas/markdown';
    `,
    resolveDir: root,
    loader: 'ts',
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  jsx: 'automatic',
  alias: { '@': join(root, 'src', 'renderer') },
  external: ['react', 'react-dom', 'react/jsx-runtime'],
  outfile,
});

const m = await import(pathToFileURL(outfile));
rmSync(outfile);
const { renderToStaticMarkup } = await import('react-dom/server');

// --- parsing: diagnostics ------------------------------------------------------
{
  const empty = m.parseCanvas('');
  assert.equal(empty.error, null);
  assert.deepEqual(empty.doc.nodes, []);

  assert.match(m.parseCanvas('{nope').error, /Not valid JSON/);
  assert.match(m.parseCanvas('[1,2]').error, /JSON object/);
  assert.match(m.parseCanvas('x'.repeat(m.MAX_CANVAS_BYTES + 1)).error, /2 MB/);
}

// Recoverable problems: warnings, never silent loss.
{
  const r = m.parseCanvas(JSON.stringify({
    nodes: [
      { id: 'a', type: 'text', x: 0, y: 0, width: 100, height: 50, text: 'ok' },
      { id: 'a', type: 'text', x: 10, y: 10, width: 100, height: 50, text: 'dupe' }, // duplicate id
      { type: 'text', x: 'NaNish', y: 0, width: -5, height: 50 },                    // missing id, bad geometry
      'not-an-object',
    ],
    edges: [
      { id: 'e1', fromNode: 'a', toNode: 'ghost' }, // dangling: kept + warned
      { id: 'e2', fromNode: 'a' },                  // missing endpoint: dropped
    ],
  }));
  assert.equal(r.error, null);
  assert.equal(r.doc.nodes.length, 3, 'both duplicate-id nodes and the repaired node survive');
  assert.equal(new Set(r.doc.nodes.map((n) => n.id)).size, 3, 'ids deduplicated');
  assert.equal(r.doc.edges.length, 1, 'endpoint-less edge dropped, dangling edge kept');
  assert.ok(r.warnings.length >= 5, `expected several warnings, got: ${r.warnings.join(' | ')}`);
  assert.ok(r.doc.nodes[2].width > 0, 'geometry repaired');
}

// --- round-trips: unknown data survives -------------------------------------------
{
  const original = {
    metadata: { generator: 'other-tool', schemaVersion: 3 }, // unknown top-level
    nodes: [
      { id: 'n1', type: 'text', x: 0, y: 0, width: 100, height: 50, text: 'hi', customProp: { deep: [1, 2] }, neuron: { version: 99, future: true } },
      { id: 'n2', type: 'hologram', x: 10, y: 10, width: 80, height: 40, beam: 'blue' }, // unknown type
    ],
    edges: [
      { id: 'e1', fromNode: 'n1', toNode: 'n2', fromEnd: 'arrow', toEnd: 'none', routing: 'orthogonal' },
    ],
  };
  const r = m.parseCanvas(JSON.stringify(original));
  assert.equal(r.error, null);
  // Simulate an edit that touches n1 only (spread patch, as the surface does).
  const edited = { ...r.doc, nodes: r.doc.nodes.map((n) => (n.id === 'n1' ? { ...n, x: 500 } : n)) };
  const out = JSON.parse(m.serializeCanvas(edited));
  assert.deepEqual(out.metadata, original.metadata, 'unknown top-level keys survive');
  assert.deepEqual(out.nodes[0].customProp, original.nodes[0].customProp, 'unknown node props survive');
  assert.deepEqual(out.nodes[0].neuron, original.nodes[0].neuron, 'unrecognized-version neuron extension preserved');
  assert.equal(out.nodes[0].x, 500, 'edit applied');
  assert.equal(out.nodes[1].type, 'hologram', 'unknown node type survives');
  assert.equal(out.nodes[1].beam, 'blue');
  assert.equal(out.edges[0].routing, 'orthogonal', 'unknown edge props survive');
  assert.equal(out.edges[0].fromEnd, 'arrow');
  assert.ok(m.serializeCanvas(edited).endsWith('\n'), 'trailing newline');
  assert.ok(m.serializeCanvas(edited).includes('\t'), 'tab indentation (Obsidian convention)');
}

// No default-value injection: a minimal standard file stays minimal.
{
  const minimal = { nodes: [{ id: 'a', type: 'text', x: 0, y: 0, width: 100, height: 50, text: 't' }], edges: [] };
  const out = JSON.parse(m.serializeCanvas(m.parseCanvas(JSON.stringify(minimal)).doc));
  assert.deepEqual(Object.keys(out.nodes[0]).sort(), ['height', 'id', 'text', 'type', 'width', 'x', 'y'], 'no extra fields written');
}

// --- fragments ------------------------------------------------------------------------
{
  const doc = m.parseCanvas(JSON.stringify({
    nodes: [
      { id: 'a', type: 'text', x: 0, y: 0, width: 100, height: 50, text: 'A' },
      { id: 'b', type: 'text', x: 200, y: 0, width: 100, height: 50, text: 'B' },
      { id: 'c', type: 'text', x: 400, y: 0, width: 100, height: 50, text: 'C' },
    ],
    edges: [
      { id: 'ab', fromNode: 'a', toNode: 'b' },
      { id: 'bc', fromNode: 'b', toNode: 'c' },
    ],
  })).doc;
  const text = m.copyFragment(doc, new Set(['a', 'b']));
  const frag = JSON.parse(text);
  assert.equal(frag.nodes.length, 2);
  assert.equal(frag.edges.length, 1, 'only edges with both endpoints selected');

  const pasted = m.pasteFragment(text);
  assert.equal(pasted.nodes.length, 2);
  assert.ok(!pasted.nodes.some((n) => n.id === 'a' || n.id === 'b'), 'ids regenerated');
  assert.equal(pasted.nodes[0].x, 24, 'offset by +24 when no target point');
  assert.equal(pasted.edges[0].fromNode, pasted.nodes[0].id, 'edges remapped to new ids');

  const placed = m.pasteFragment(text, { x: 1000, y: 1000 });
  assert.equal(Math.min(...placed.nodes.map((n) => n.x)), 1000, 'fragment top-left lands at target');
  assert.equal(placed.nodes[1].x - placed.nodes[0].x, 200, 'relative geometry preserved');

  assert.equal(m.pasteFragment('just some plain text'), null);
  assert.equal(m.pasteFragment('{"nodes":[]}'), null);
}

// --- z-order, alignment, distribution ---------------------------------------------------
{
  const doc = m.parseCanvas(JSON.stringify({
    nodes: [
      { id: 'a', type: 'text', x: 0, y: 0, width: 100, height: 50 },
      { id: 'b', type: 'text', x: 10, y: 80, width: 60, height: 40 },
      { id: 'c', type: 'text', x: 500, y: 160, width: 80, height: 30 },
    ],
    edges: [],
  })).doc;

  assert.deepEqual(m.bringToFront(doc, new Set(['a'])).nodes.map((n) => n.id), ['b', 'c', 'a']);
  assert.deepEqual(m.sendToBack(doc, new Set(['c'])).nodes.map((n) => n.id), ['c', 'a', 'b']);

  const left = m.alignNodes(doc, new Set(['a', 'b', 'c']), 'left');
  assert.ok(left.nodes.every((n) => n.x === 0), 'align left');
  const right = m.alignNodes(doc, new Set(['a', 'b', 'c']), 'right');
  assert.ok(right.nodes.every((n) => n.x + n.width === 580), 'align right');

  const dist = m.distributeNodes(doc, new Set(['a', 'b', 'c']), 'y');
  const ys = dist.nodes.map((n) => n.y);
  assert.equal(ys[0], 0);
  assert.equal(ys[2] + 30, 190, 'outer nodes keep the span');
  const gap1 = ys[1] - (ys[0] + 50), gap2 = ys[2] - (ys[1] + 40);
  assert.ok(Math.abs(gap1 - gap2) <= 1, 'equal gaps');

  assert.equal(m.alignNodes(doc, new Set(['a']), 'left'), doc, 'no-op below 2 nodes');
  assert.equal(m.distributeNodes(doc, new Set(['a', 'b']), 'x'), doc, 'no-op below 3 nodes');
}

// --- deleteSelection cascades edges ------------------------------------------------------
{
  const doc = m.parseCanvas(JSON.stringify({
    nodes: [
      { id: 'a', type: 'text', x: 0, y: 0, width: 10, height: 10 },
      { id: 'b', type: 'text', x: 0, y: 0, width: 10, height: 10 },
    ],
    edges: [{ id: 'ab', fromNode: 'a', toNode: 'b' }],
  })).doc;
  const after = m.deleteSelection(doc, new Set(['a']), new Set());
  assert.equal(after.nodes.length, 1);
  assert.equal(after.edges.length, 0, 'edges touching a deleted node go with it');
}

// --- history --------------------------------------------------------------------------------
{
  const h = new m.CanvasHistory();
  const v = (n) => ({ nodes: [], edges: [], extra: { v: n } });
  assert.equal(h.undo(v(0)), null);
  h.push(v(0));
  h.push(v(1));
  assert.ok(h.canUndo);
  const back = h.undo(v(2));
  assert.equal(back.extra.v, 1);
  assert.ok(h.canRedo);
  const fwd = h.redo(back);
  assert.equal(fwd.extra.v, 2);
  h.undo(v(2));
  h.push(v(9)); // new change clears redo
  assert.ok(!h.canRedo);
  for (let i = 0; i < 150; i++) h.push(v(i));
  let count = 0;
  let cur = v(999);
  for (;;) { const prev = h.undo(cur); if (!prev) break; cur = prev; count++; }
  assert.ok(count <= 100, `history capped (got ${count})`);
  h.reset();
  assert.ok(!h.canUndo && !h.canRedo);
}

// --- neuron.style extension (v1) --------------------------------------------------------------
{
  const node = (extra = {}) => ({ id: 'a', type: 'text', x: 0, y: 0, width: 100, height: 50, text: 't', ...extra });

  // Validation: partial objects work field-by-field; junk fields are ignored.
  const partial = m.getNodeStyle(node({ neuron: { version: 1, style: { shape: 'pill', borderWidth: 99, fontSize: 'huge', opacity: 0.5, textAlign: 'justify' } } }));
  assert.deepEqual(partial, { shape: 'pill', opacity: 0.5 }, 'valid fields kept, out-of-range/unknown values dropped');

  // Malformed and future extensions render as standard fallback ({}).
  assert.deepEqual(m.getNodeStyle(node({ neuron: 'garbage' })), {});
  assert.deepEqual(m.getNodeStyle(node({ neuron: { version: 1, style: [1, 2] } })), {});
  assert.deepEqual(m.getNodeStyle(node({ neuron: { version: 2, style: { shape: 'pill' } } })), {}, 'future version not interpreted');

  // Lazy creation: no neuron object until a nonstandard property changes…
  const styled = m.setNodeStyle(node(), { shape: 'rounded' });
  assert.deepEqual(styled.neuron, { version: 1, style: { shape: 'rounded' } });
  // …and full removal when the last style is cleared.
  const cleared = m.setNodeStyle(styled, { shape: undefined });
  assert.ok(!('neuron' in cleared), 'neuron removed when empty');

  // Unknown sibling keys inside neuron survive style edits.
  const withSibling = m.setNodeStyle(node({ neuron: { version: 1, behavior: { locked: true }, style: { shape: 'pill' } } }), { textAlign: 'center' });
  assert.deepEqual(withSibling.neuron.behavior, { locked: true }, 'sibling extension data preserved');
  assert.deepEqual(withSibling.neuron.style, { shape: 'pill', textAlign: 'center' });
  const siblingKept = m.setNodeStyle(withSibling, { shape: undefined, textAlign: undefined });
  assert.deepEqual(siblingKept.neuron, { version: 1, behavior: { locked: true } }, 'neuron kept while siblings remain');

  // A future-version extension is never edited — the node comes back unchanged.
  const future = node({ neuron: { version: 7, style: { holo: true } } });
  assert.equal(m.setNodeStyle(future, { shape: 'pill' }), future, 'future versions are read-only');

  // Exact round-trip: styled node survives serialize→parse byte-identically in structure.
  const doc = m.parseCanvas(m.serializeCanvas({ nodes: [styled], edges: [], extra: {} })).doc;
  assert.deepEqual(doc.nodes[0].neuron, { version: 1, style: { shape: 'rounded' } });
  // Future-version neuron survives a round-trip untouched too.
  const futDoc = m.parseCanvas(m.serializeCanvas({ nodes: [future], edges: [], extra: {} })).doc;
  assert.deepEqual(futDoc.nodes[0].neuron, { version: 7, style: { holo: true } });

  // Multi-selection: one call → one new doc (→ one undo entry); groups untouched via caller filter.
  const multi = m.parseCanvas(JSON.stringify({
    nodes: [node(), { ...node(), id: 'b' }, { ...node(), id: 'c' }],
    edges: [],
  })).doc;
  const styledAll = m.applyStyleToNodes(multi, new Set(['a', 'b']), { borderStyle: 'dashed' });
  assert.equal(styledAll.nodes.filter((n) => n.neuron).length, 2);
  assert.ok(!styledAll.nodes[2].neuron, 'unselected node untouched');

  // Presets write concrete props + provenance + standard color (fallback-friendly).
  const preset = m.applyStylePreset(multi, new Set(['a']), 'question');
  assert.equal(preset.nodes[0].neuron.style.preset, 'question');
  assert.equal(preset.nodes[0].neuron.style.shape, 'pill', 'concrete props written, not just the name');
  assert.equal(preset.nodes[0].color, '5', 'standard color stays authoritative for interop');
  assert.equal(m.applyStylePreset(multi, new Set(['a']), 'nonsense'), multi, 'unknown preset is a no-op');

  // Standard color is never duplicated into neuron.style.
  assert.ok(!('color' in (preset.nodes[0].neuron.style ?? {})), 'no color inside the extension');
}

// --- markdown safety ---------------------------------------------------------------------------
{
  const html = (src) => renderToStaticMarkup(m.renderMarkdown(src));

  // Raw HTML in card text is inert literal text, never markup.
  const evil = html('<img src=x onerror=alert(1)> <script>alert(2)</script>');
  assert.ok(!evil.includes('<img'), 'no raw HTML elements');
  assert.ok(!evil.includes('<script'), 'no script elements');
  assert.ok(evil.includes('&lt;script&gt;'), 'rendered as escaped text');

  // javascript: links degrade to plain text.
  const badLink = html('[click](javascript:alert(1))');
  assert.ok(!badLink.includes('<a'), 'unsafe scheme produces no anchor');
  const goodLink = html('[docs](https://example.com)');
  assert.ok(goodLink.includes('href="https://example.com"'));
  assert.ok(goodLink.includes('rel="noreferrer"'));

  // Feature sanity.
  assert.ok(html('# Title').includes('<h1'), 'headings');
  assert.ok(html('**bold**').includes('<strong>'), 'bold');
  assert.ok(html('`code`').includes('<code'), 'inline code');
  assert.ok(html('- [x] done').includes('checked'), 'task checkbox');
  assert.ok(html('- a\n- b').includes('<ul'), 'lists');
  assert.ok(html('> quoted').includes('<blockquote'), 'quotes');
  assert.ok(html('```\nlet x = "<b>";\n```').includes('&lt;b&gt;'), 'code blocks escape content');
}

// --- Module 7: round trip keeps unknown node types and extra fields, file-wide ---------
{
  const original = {
    version: '1.0-other', future: { anything: [1, { deep: true }] },
    nodes: [
      { id: 't', type: 'text', x: 1, y: 2, width: 30, height: 40, text: 'x', z: 3, tags: ['a'] },
      { id: 'u', type: 'sticker', x: 5, y: 6, width: 70, height: 80, emoji: '★', nested: { a: { b: null } } },
      { id: 'f', type: 'file', x: 0, y: 0, width: 10, height: 10, file: 'a.md', subpath: '#h' },
      { id: 'l', type: 'link', x: 0, y: 0, width: 10, height: 10, url: 'https://example.com' },
      { id: 'g', type: 'group', x: -9, y: -9, width: 99, height: 99, label: 'G', background: 'bg.png', backgroundStyle: 'cover' },
    ],
    edges: [{ id: 'e', fromNode: 't', toNode: 'u', fromSide: 'right', toSide: 'left', label: 'L', color: '#123456', weight: 7 }],
  };
  const once = m.serializeCanvas(m.parseCanvas(JSON.stringify(original)).doc);
  const parsed = JSON.parse(once);
  assert.deepEqual({ ...parsed, nodes: undefined, edges: undefined }, { ...original, nodes: undefined, edges: undefined }, 'unknown top-level fields kept');
  assert.deepEqual(parsed.nodes, original.nodes, 'every node, known type or not, keeps every field');
  assert.deepEqual(parsed.edges, original.edges, 'edges keep every field');
  assert.equal(m.serializeCanvas(m.parseCanvas(once).doc), once, 'a second round trip is byte-identical');
}

// --- Module 7: undo/redo across add, move, edge and delete -----------------------------
{
  // As the surface does: commit() pushes the state before, then adopts the next.
  const h = new m.CanvasHistory();
  let current = m.parseCanvas(JSON.stringify({ nodes: [{ id: 'a', type: 'text', x: 0, y: 0, width: 100, height: 50, text: 'A' }], edges: [] })).doc;
  const states = [current];
  const commit = (next) => { h.push(current); current = next; states.push(next); };
  commit({ ...current, nodes: [...current.nodes, { id: 'b', type: 'text', x: 300, y: 0, width: 100, height: 50, text: 'B' }] }); // add
  commit({ ...current, nodes: current.nodes.map((n) => (n.id === 'b' ? { ...n, x: 400, y: 120 } : n)) });                        // move
  commit({ ...current, edges: [...current.edges, { id: 'ab', fromNode: 'a', toNode: 'b' }] });                                      // edge
  commit(m.deleteSelection(current, new Set(['a']), new Set()));                                                                    // delete (cascades the edge)
  assert.deepEqual(current.nodes.map((n) => n.id), ['b']);
  assert.equal(current.edges.length, 0, 'deleting a node takes its edge');

  for (let i = states.length - 2; i >= 0; i--) {
    current = h.undo(current);
    assert.deepEqual(current, states[i], `undo step back to state ${i}`);
  }
  assert.equal(h.undo(current), null, 'nothing before the first state');
  assert.equal(current.nodes.length, 1, 'back to the single original node');
  for (let i = 1; i < states.length; i++) {
    current = h.redo(current);
    assert.deepEqual(current, states[i], `redo step forward to state ${i}`);
  }
  assert.equal(h.redo(current), null, 'nothing after the last state');
  // Undo the delete restores the node and its edge together.
  current = h.undo(current);
  assert.deepEqual(current.nodes.map((n) => n.id), ['a', 'b']);
  assert.deepEqual(current.edges.map((e) => e.id), ['ab'], 'the edge comes back with its node');
}

// --- Module 7: edge routing for every side pair ------------------------------------------
{
  const a = { id: 'a', type: 'text', x: 0, y: 0, width: 200, height: 100 };
  const b = { id: 'b', type: 'text', x: 500, y: 300, width: 120, height: 80 };
  const numbers = (d) => d.match(/-?\d+(\.\d+)?(e-?\d+)?/g).map(Number);
  // Each anchor is the middle of its side, on the node's edge.
  assert.deepEqual(m.anchor(a, 'top'), { x: 100, y: 0 });
  assert.deepEqual(m.anchor(a, 'bottom'), { x: 100, y: 100 });
  assert.deepEqual(m.anchor(a, 'left'), { x: 0, y: 50 });
  assert.deepEqual(m.anchor(a, 'right'), { x: 200, y: 50 });
  let pairs = 0;
  for (const fromSide of m.SIDES) {
    for (const toSide of m.SIDES) {
      const from = m.anchor(a, fromSide);
      const to = m.anchor(b, toSide);
      const d = m.edgePath(from, fromSide, to, toSide);
      assert.match(d, /^M [-\d.e]+ [-\d.e]+ C [-\d.e]+ [-\d.e]+, [-\d.e]+ [-\d.e]+, [-\d.e]+ [-\d.e]+$/, `${fromSide}->${toSide}: one cubic curve`);
      const [mx, my, c1x, c1y, c2x, c2y, ex, ey] = numbers(d);
      assert.ok([mx, my, c1x, c1y, c2x, c2y, ex, ey].every(Number.isFinite), `${fromSide}->${toSide}: finite`);
      assert.deepEqual({ x: mx, y: my }, from, `${fromSide}->${toSide}: starts at the from anchor`);
      assert.deepEqual({ x: ex, y: ey }, to, `${fromSide}->${toSide}: ends at the to anchor`);
      // The curve leaves and enters along each side's outward normal, at least 40 px out.
      const out1 = { x: c1x - from.x, y: c1y - from.y };
      const out2 = { x: c2x - to.x, y: c2y - to.y };
      const n1 = m.SIDE_NORMAL[fromSide], n2 = m.SIDE_NORMAL[toSide];
      assert.ok(out1.x * n1.x + out1.y * n1.y >= 40 && out1.x * n1.y - out1.y * n1.x === 0, `${fromSide}->${toSide}: leaves outward from ${fromSide}`);
      assert.ok(out2.x * n2.x + out2.y * n2.y >= 40 && out2.x * n2.y - out2.y * n2.x === 0, `${fromSide}->${toSide}: arrives from outside ${toSide}`);
      pairs++;
    }
  }
  assert.equal(pairs, 16, 'every side pair');
  // Unstored sides face each other.
  const at = (x, y) => ({ id: 'n', type: 'text', x, y, width: 100, height: 100 });
  assert.deepEqual(m.autoSides(at(0, 0), at(500, 0)), ['right', 'left']);
  assert.deepEqual(m.autoSides(at(500, 0), at(0, 0)), ['left', 'right']);
  assert.deepEqual(m.autoSides(at(0, 0), at(0, 500)), ['bottom', 'top']);
  assert.deepEqual(m.autoSides(at(0, 500), at(0, 0)), ['top', 'bottom']);
  for (const side of m.SIDES) assert.equal(m.sideForPoint(a, m.anchor(a, side)), side, `a point on ${side} picks ${side}`);
  // Coincident anchors still give a curve with real control points.
  assert.ok(numbers(m.edgePath({ x: 5, y: 5 }, 'top', { x: 5, y: 5 }, 'top')).every(Number.isFinite));
}

// --- Module 7: canvas Markdown links go through safeUrl; raw HTML stays text -------------
{
  const html = (src) => renderToStaticMarkup(m.renderMarkdown(src));
  for (const bad of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,hi', 'vbscript:msgbox(1)', 'file:///etc/passwd']) {
    const out = html(`[x](${bad})`);
    assert.ok(!out.includes('<a'), `${bad} produces no link`);
    assert.ok(!out.toLowerCase().includes('href'), `${bad} produces no href`);
  }
  assert.ok(html('[mail](mailto:me@example.com)').includes('href="mailto:me@example.com"'), 'a safe scheme still links');
  for (const raw of ['<a href="javascript:alert(1)">x</a>', '<iframe src="https://evil.example"></iframe>', '<svg onload=alert(1)>', '**<b>bold</b>**']) {
    const out = html(raw);
    assert.ok(!/<(a|iframe|svg|b)[\s>]/.test(out), `raw HTML stays text: ${raw}`);
    assert.ok(out.includes('&lt;'), `escaped: ${raw}`);
  }
}

console.log('canvas-model: all checks passed');
