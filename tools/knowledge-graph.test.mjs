import { build } from 'esbuild';
import { rmSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const tmp = resolve('.knowledge-graph.tmp.cjs');
await build({ entryPoints: ['src/renderer/lib/knowledge-graph.ts'], bundle: true, format: 'cjs', platform: 'node', outfile: tmp, logLevel: 'silent' });
const { KnowledgeGraph, seedPositions, graphPreferences, GRAPH_DEFAULTS } = await import(pathToFileURL(tmp));
rmSync(tmp);
const notes = [
  { path: 'a.md', content: '[[folder/b|Alias]] [[Missing]] [[same]] [B](folder/b.md#heading) ![[image.png]]\n```md\n[[not-a-link]]\n```' },
  { path: 'folder/b.md', content: '[[a]] [[c]]' },
  { path: 'c.md', content: '[[a]]' },
  { path: 'one/same.md', content: '' },
  { path: 'two/same.md', content: '' },
  { path: 'image.png', content: '' },
  { path: 'board.canvas', content: JSON.stringify({ nodes: [{ type: 'file', file: 'folder/b.md' }] }) },
];
const m = new KnowledgeGraph();
assert.equal(m.sync(notes), true);
assert.equal(m.graph.order, 8);
// Two notes named `same` at one depth: the first by path, as a click opens it
// (11D; this used to be an unresolved node).
assert.equal(m.graph.hasNode('unresolved:same'), false);
assert.equal(m.graph.hasNode('unresolved:not-a-link'), false);
assert.equal(m.graph.getNodeAttribute('image.png', 'kind'), 'attachment');
assert.equal(m.graph.getNodeAttribute('board.canvas', 'kind'), 'canvas');
assert.deepEqual(new Set(m.graph.outNeighbors('a.md')), new Set(['folder/b.md', 'unresolved:missing', 'one/same.md', 'image.png']));
assert.equal(m.graph.outEdges('a.md', 'folder/b.md').length, 2);
assert.deepEqual(m.local('c.md', 1), new Set(['c.md', 'a.md', 'folder/b.md']));
const parsed = m.parsed;
assert.equal(m.sync(notes), false);
assert.equal(m.parsed, parsed);
const positions = Object.create(null);
seedPositions(m, positions);
const saved = structuredClone(positions);
m.sync([...notes, { path: 'new.md', content: '[[a]]' }]);
assert.deepEqual(seedPositions(m, positions), ['new.md']);
for (const id of Object.keys(saved)) assert.deepEqual({ x: m.graph.getNodeAttribute(id, 'x'), y: m.graph.getNodeAttribute(id, 'y') }, saved[id]);
assert.ok(Math.hypot(positions['new.md'].x - positions['a.md'].x, positions['new.md'].y - positions['a.md'].y) < 2.01);
m.sync(notes.map(n => n.path === 'c.md' ? { ...n, content: '[[folder/b]]' } : n));
assert.equal(m.parsed, parsed + 2);
m.sync(notes.filter(n => n.path !== 'two/same.md'));
assert.equal(m.graph.hasNode('unresolved:same'), false);
assert.ok(m.graph.hasDirectedEdge('a.md', 'one/same.md'));
// The linking note's own folder wins, and a new file there takes the link.
m.sync([...notes, { path: 'two/link.md', content: '[[same]]' }]);
assert.ok(m.graph.hasDirectedEdge('two/link.md', 'two/same.md'));
// An alias is an edge too, and a real file name beats it.
const aliased = new KnowledgeGraph();
aliased.sync([
  { path: 'people/Ada Lovelace.md', content: '---\naliases: [Ada, Countess]\n---\n' },
  { path: 'Countess.md', content: '' },
  { path: 'x.md', content: '[[Ada]] [[Countess]]' },
]);
assert.deepEqual(new Set(aliased.graph.outNeighbors('x.md')), new Set(['people/Ada Lovelace.md', 'Countess.md']));
// Changing only an alias re-resolves links elsewhere.
aliased.sync([
  { path: 'people/Ada Lovelace.md', content: '---\naliases: [Augusta]\n---\n' },
  { path: 'Countess.md', content: '' },
  { path: 'x.md', content: '[[Ada]] [[Countess]]' },
]);
assert.ok(aliased.graph.hasNode('unresolved:ada'));
m.sync([...notes, { path: 'Missing.md', content: '' }]);
assert.equal(m.graph.hasNode('unresolved:missing'), false);
assert.ok(m.graph.hasDirectedEdge('a.md', 'Missing.md'));
assert.deepEqual(graphPreferences(null), GRAPH_DEFAULTS);
assert.equal(graphPreferences({ depth: 99, repel: NaN, arrows: 'yes' }).depth, 5);
assert.equal(graphPreferences({ repel: NaN }).repel, GRAPH_DEFAULTS.repel);
// Links default thicker than before so they read on a light theme; what a person saved still wins.
assert.equal(GRAPH_DEFAULTS.linkThickness, 1.2);
assert.equal(graphPreferences({ linkThickness: 1 }).linkThickness, 1);
assert.equal(graphPreferences({ linkThickness: 9 }).linkThickness, 4);
assert.equal(graphPreferences({ local: true, depth: 3 }).local, true);

for (const [name, content] of [
  ["backtick fence", "```\n[[inside]]\n```"],
  ["tilde fence", "~~~\n[[inside]]\n~~~"],
  ["language tag", "```ts\n[[inside]]\n```"],
  ["longer closing fence", "```\n[[inside]]\n`````"],
  ["unclosed fence", "```\n[[inside]]"],
  ["prose after closing fence", "```\n[[inside]]\n```\n[[after]]"],
  ["tilde inside backtick fence", "```\n~~~\n[[inside]]\n```"],
]) {
  const fenced = new KnowledgeGraph();
  fenced.sync([
    { path: 'source.md', content },
    { path: 'inside.md', content: '' },
    { path: 'after.md', content: '' },
  ]);
  assert.deepEqual(fenced.graph.outNeighbors('source.md'), name === 'prose after closing fence' ? ['after.md'] : [], name);
}
console.log('knowledge graph: resolution, incremental updates, traversal, stability, validation passed');

// Module 11 tests: what makes an edge and what does not.
{
  const g = new KnowledgeGraph();
  g.sync([
    { path: 'src.md', content: 'Inline `[[code-inline]]` and ``[[double]]`` are code, and so is ``a `[[nested]]` span``.\n\n![[embedded]] [md](linked.md) [web](https://example.com/x.md)' },
    { path: 'code-inline.md', content: '' }, { path: 'double.md', content: '' }, { path: 'nested.md', content: '' },
    { path: 'embedded.md', content: '' }, { path: 'linked.md', content: '' },
    { path: 'board.canvas', content: JSON.stringify({ nodes: [{ type: 'file', file: 'linked.md' }, { type: 'text', text: '[[embedded]]' }] }) },
  ]);
  const out = (id) => new Set(g.graph.outNeighbors(id));
  assert.equal(out('src.md').has('code-inline.md'), false, 'inline code makes no edge');
  assert.equal(out('src.md').has('double.md'), false, 'double-backtick code makes no edge');
  assert.equal(out('src.md').has('nested.md'), false, 'a single backtick inside a double-backtick span does not end it');
  assert.ok(out('src.md').has('embedded.md'), '![[embed]] makes an edge');
  assert.equal(g.graph.getEdgeAttribute(g.graph.edges('src.md', 'embedded.md')[0], 'kind'), 'embed');
  assert.ok(out('src.md').has('linked.md'), 'a Markdown link makes an edge');
  assert.equal(g.graph.getEdgeAttribute(g.graph.edges('src.md', 'linked.md')[0], 'kind'), 'markdown-link');
  assert.equal([...out('src.md')].some((id) => /^[a-z][a-z0-9+.-]*:/i.test(id)), false, 'a web link is not a note');
  assert.deepEqual(out('board.canvas'), new Set(['linked.md']), 'a canvas file node is an edge; its text node is not parsed');
  assert.equal(g.graph.getEdgeAttribute(g.graph.edges('board.canvas', 'linked.md')[0], 'kind'), 'canvas-reference');

  // Incremental sync: only the note whose text changed is parsed again.
  const notes = [
    { path: 'a.md', content: '[[b]]' }, { path: 'b.md', content: '[[c]]' }, { path: 'c.md', content: '' },
  ];
  const inc = new KnowledgeGraph();
  inc.sync(notes);
  const before = inc.parsed;
  inc.sync([notes[0], { path: 'b.md', content: '[[a]]' }, notes[2]]);
  assert.equal(inc.parsed, before + 1, 'one changed note, one parse');
  assert.ok(inc.graph.hasDirectedEdge('b.md', 'a.md'));
  assert.equal(inc.graph.hasDirectedEdge('b.md', 'c.md'), false, 'the old edge went with the old text');

  // A deleted note takes its edges with it; a link to it becomes missing.
  inc.sync([notes[0], notes[2]]);
  assert.equal(inc.graph.hasNode('b.md'), false);
  assert.equal(inc.graph.hasDirectedEdge('b.md', 'a.md'), false);
  assert.ok(inc.graph.hasDirectedEdge('a.md', 'unresolved:b'), 'what linked to it now shows the missing note');
  assert.equal(inc.graph.getNodeAttribute('a.md', 'degree'), 1);

  // local(id, depth) for 1 to 5 hops along a chain n0 - n1 - ... - n6.
  const chain = new KnowledgeGraph();
  chain.sync(Array.from({ length: 7 }, (_, i) => ({ path: `n${i}.md`, content: i < 6 ? `[[n${i + 1}]]` : '' })));
  for (let depth = 1; depth <= 5; depth++) {
    assert.deepEqual(chain.local('n0.md', depth), new Set(Array.from({ length: depth + 1 }, (_, i) => `n${i}.md`)), `depth ${depth}`);
  }
  // Links count both ways: from the middle, 2 hops reach both sides.
  assert.deepEqual(chain.local('n3.md', 2), new Set(['n1.md', 'n2.md', 'n3.md', 'n4.md', 'n5.md']));
  assert.deepEqual(chain.local('missing.md', 3), new Set(), 'no such note, no neighbourhood');
  console.log('knowledge graph: code, embeds, links, canvases, incremental parse, deletion, local depth 1-5 passed');
}

// 11A: Fit frames every shown node, measured through Sigma's own camera matrix.
{
  const fitTmp = resolve('.graph-fit.tmp.cjs');
  await build({ stdin: { contents: "export * from './src/renderer/lib/graph-fit.ts'; export { matrixFromCamera, multiplyVec2, getCorrectionRatio } from 'sigma/utils';", resolveDir: resolve('.'), loader: 'ts' }, bundle: true, format: 'cjs', platform: 'node', outfile: fitTmp, logLevel: 'silent' });
  const { fitCamera, FIT_MARGIN, matrixFromCamera, multiplyVec2 } = await import(pathToFileURL(fitTmp));
  rmSync(fitTmp);
  // framedGraphToViewport, as Sigma 3 computes it, for a stage padding of 40.
  // Its matrix is single precision, hence the thousandth of a pixel allowed below.
  const projector = (viewport, graphDimensions) => (point, camera) => {
    const v = multiplyVec2(matrixFromCamera(camera, viewport, graphDimensions, 40), point);
    return { x: (1 + v.x) * viewport.width / 2, y: (1 - v.y) * viewport.height / 2 };
  };
  const inside = (points, camera, viewport, graphDimensions, margin = FIT_MARGIN) => {
    const project = projector(viewport, graphDimensions);
    return points.map((p) => project(p, { ...camera, angle: 0 })).every((q) =>
      q.x >= margin - 1e-3 && q.x <= viewport.width - margin + 1e-3 && q.y >= margin - 1e-3 && q.y <= viewport.height - margin + 1e-3);
  };
  const reach = (points, camera, viewport, graphDimensions) => {
    const project = projector(viewport, graphDimensions);
    return Math.max(...points.map((p) => project(p, { ...camera, angle: 0 })).map((q) =>
      Math.max(Math.abs(q.x - viewport.width / 2) / (viewport.width / 2 - FIT_MARGIN), Math.abs(q.y - viewport.height / 2) / (viewport.height / 2 - FIT_MARGIN))));
  };
  const square = { width: 246, height: 246 };
  const whole = [{ x: 0, y: 0.02 }, { x: 1, y: 0.5 }, { x: 0.4, y: 0.98 }, { x: 0.5, y: 0.5 }];
  const cases = [
    ['whole graph, square panel', whole, square, { width: 25, height: 24 }],
    ['whole graph, wide dock', whole, { width: 900, height: 220 }, { width: 25, height: 24 }],
    ['whole graph, tall dock', whole, { width: 220, height: 800 }, { width: 25, height: 24 }],
    // The case the extent-as-ratio Fit got wrong: a wide graph (Sigma's aspect
    // correction of 2) in a wide panel, showing a cluster that is tall.
    ['tall cluster of a wide graph, wide panel', [{ x: 0.5, y: 0.25 }, { x: 0.52, y: 0.75 }], { width: 600, height: 300 }, { width: 50, height: 25 }],
    ['a cluster in one corner', [{ x: 0.1, y: 0.1 }, { x: 0.35, y: 0.4 }, { x: 0.22, y: 0.24 }], square, { width: 25, height: 24 }],
  ];
  for (const [name, points, viewport, dims] of cases) {
    const camera = fitCamera(points, viewport, projector(viewport, dims));
    assert.ok(camera, name);
    assert.ok(inside(points, camera, viewport, dims), `${name}: every node inside the margin`);
    assert.ok(Math.abs(reach(points, camera, viewport, dims) - 1) < 1e-4, `${name}: the outermost node touches the margin, not the middle`);
  }
  // The old computation on that tall cluster: ratio = extent overflowed the panel.
  {
    const [, points, viewport, dims] = cases[3];
    const old = { x: 0.51, y: 0.5, ratio: Math.max(0.1, 0.02, 0.5) };
    assert.equal(inside(points, old, viewport, dims, 0), false, 'the extent-as-ratio camera cuts this cluster off');
  }
  // Two nodes almost on top of each other: inside, at the closest Fit goes.
  const tiny = [{ x: 0.2, y: 0.2 }, { x: 0.21, y: 0.22 }];
  const close = fitCamera(tiny, square, projector(square, { width: 1, height: 1 }));
  assert.equal(close.ratio, 0.1);
  assert.ok(inside(tiny, close, square, { width: 1, height: 1 }));
  // One node: centred, and not zoomed to the maximum.
  const one = fitCamera([{ x: 0.3, y: 0.7 }], square, projector(square, { width: 1, height: 1 }));
  assert.deepEqual(one, { x: 0.3, y: 0.7, ratio: 0.1 });
  // Nothing shown, or no panel to show it in: no camera move.
  assert.equal(fitCamera([], square, projector(square, { width: 1, height: 1 })), null);
  assert.equal(fitCamera(whole, { width: 0, height: 0 }, projector(square, { width: 1, height: 1 })), null);
  // Never further out than the camera allows.
  assert.equal(fitCamera([{ x: -40, y: 0 }, { x: 40, y: 0 }], square, projector(square, { width: 1, height: 1 }), { maxRatio: 8 }).ratio, 8);
  console.log('knowledge graph: Fit frames every node with a margin in square, wide and tall panels');
}

// Exercise the actual library worker in Node with only its messaging transport
// adapted to worker_threads. Physics and our settling controller are unchanged.
const { Worker: Thread } = await import('node:worker_threads');
const workerTmp = resolve('.graph-layout.tmp.cjs');
await build({ entryPoints: ['src/renderer/lib/graph-layout.ts'], bundle: true, format: 'cjs', platform: 'node', outfile: workerTmp, logLevel: 'silent' });
const { settleLayout, SETTLE } = await import(pathToFileURL(workerTmp));
rmSync(workerTmp);
const blobs = new Map();
globalThis.Blob = class { constructor(parts) { this.code = parts.join(''); } };
globalThis.window = { URL: { createObjectURL(blob) { const id = String(blobs.size); blobs.set(id, blob.code); return id; }, revokeObjectURL() {} } };
globalThis.Worker = class {
  constructor(url) {
    this.listeners = new Map();
    this.thread = new Thread(`const { parentPort } = require('node:worker_threads'); globalThis.self = { addEventListener: (_, fn) => parentPort.on('message', data => fn({ data })), postMessage: (data, transfers) => parentPort.postMessage(data, transfers) }; ${blobs.get(url)}`, { eval: true });
  }
  addEventListener(_event, listener) { const wrapped = data => listener({ data }); this.listeners.set(listener, wrapped); this.thread.on('message', wrapped); }
  removeEventListener(_event, listener) { this.thread.off('message', this.listeners.get(listener)); }
  postMessage(data, transfer) { this.thread.postMessage(data, transfer); }
  terminate() { void this.thread.terminate(); }
};
const moving = new KnowledgeGraph();
moving.sync([{ path: 'anchor.md', content: '[[new]]' }, { path: 'new.md', content: '' }]);
const points = { 'anchor.md': { x: 2.123456789, y: -3.987654321 } };
seedPositions(moving, points);
const beforeMoving = { ...points['new.md'] };
let updates = 0;
moving.graph.on('eachNodeAttributesUpdated', () => updates++);
await new Promise(resolve => settleLayout(moving, GRAPH_DEFAULTS, resolve, new Set(['new.md'])));
assert.deepEqual({ x: moving.graph.getNodeAttribute('anchor.md', 'x'), y: moving.graph.getNodeAttribute('anchor.md', 'y') }, points['anchor.md'], 'saved node survives worker float32 round-trip exactly');
assert.notDeepEqual({ x: moving.graph.getNodeAttribute('new.md', 'x'), y: moving.graph.getNodeAttribute('new.md', 'y') }, beforeMoving, 'new node settles using real ForceAtlas2');
assert.ok(updates > 0 && updates <= 120);
const stoppedAt = updates;
await new Promise(resolve => setTimeout(resolve, 100));
assert.equal(updates, stoppedAt, 'worker is terminated after settling');
console.log('knowledge graph: actual ForceAtlas2 worker preserves anchors and terminates');

// The three ways the layout stops, with a stand-in for the worker that moves
// every node by `step` on each tick it is given.
{
  assert.deepEqual(SETTLE, { quietTicks: 6, quietDistance: 0.02, maxTicks: 120, timeCapMs: 2500 }, 'the limits the app runs with');
  const fake = (step, tickEvery = 1) => (graph) => {
    let timer;
    return {
      start() { timer = setInterval(() => { if (step !== null) graph.updateEachNodeAttributes((_, a) => ({ ...a, x: a.x + step })); }, tickEvery); },
      kill() { clearInterval(timer); this.killed = true; },
    };
  };
  const run = async (step, limits) => {
    const g = new KnowledgeGraph();
    g.sync([{ path: 'a.md', content: '[[b]]' }, { path: 'b.md', content: '' }]);
    seedPositions(g, Object.create(null));
    let ticks = 0;
    g.graph.on('eachNodeAttributesUpdated', () => ticks++);
    let layout;
    const began = Date.now();
    await new Promise((resolve) => settleLayout(g, GRAPH_DEFAULTS, resolve, undefined, limits, (graph) => (layout = fake(step)(graph))));
    return { ticks, layout, elapsed: Date.now() - began };
  };
  const limits = { quietTicks: 6, quietDistance: 0.02, maxTicks: 120, timeCapMs: 5000 };
  const still = await run(0, limits);
  assert.equal(still.ticks, 6, 'six quiet ticks in a row stop it');
  assert.ok(still.layout.killed, 'and the worker is killed');
  const moving = await run(1, limits);
  assert.equal(moving.ticks, 120, 'a layout that never settles stops at the tick cap');
  const silent = await run(null, { ...limits, timeCapMs: 80 });
  assert.equal(silent.ticks, 0);
  assert.ok(silent.elapsed >= 70 && silent.layout.killed, 'a worker that never reports stops at the time cap');
  console.log('knowledge graph: layout stops on quiet ticks, the tick cap and the time cap');
}
