import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SCALE_DEFAULTS = { notes: 5000, avgBytes: 2048, linksPerNote: 4, tags: 20, dbRows: 2000, canvasNodes: 1000 };

/** Writes only into an empty directory; identical options produce identical bytes. */
export function generateWorkspace(dir, options = {}) {
  const config = { ...SCALE_DEFAULTS, ...options };
  for (const [key, value] of Object.entries(config)) {
    if (!(key in SCALE_DEFAULTS) || !Number.isSafeInteger(value) || value < 0) throw new Error('Invalid fixture option: ' + key);
  }
  const { notes, avgBytes, linksPerNote, tags, dbRows, canvasNodes } = config;
  if (avgBytes < 512 || (linksPerNote > 0 && notes < 2)) throw new Error('avgBytes must be >= 512; links require at least two notes');
  mkdirSync(dir, { recursive: true });
  if (readdirSync(dir).length) throw new Error('Fixture directory must be empty: ' + dir);
  let seed = 0x4e455552;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const name = i => 'Note-' + String(i).padStart(5, '0');
  const paths = Array.from({ length: notes }, (_, i) => 'Research/Batch-' + String(Math.floor(i / 25)).padStart(4, '0') + '/' + name(i) + '.md');
  const topics = ['architecture', 'research', 'planning', 'design', 'operations'];
  const records = [];
  for (let i = 0; i < notes; i++) {
    const topic = topics[Math.floor(random() * topics.length)];
    const noteTags = tags ? ['tag-' + Math.floor(random() * tags), 'tag-' + (i % tags)] : [];
    const props = ['title: ' + name(i), 'status: ' + (i % 3 ? 'draft' : 'review'), 'tags: [' + [...new Set(noteTags)].join(', ') + ']'];
    const optional = ['created: 2026-01-15', 'priority: ' + (i % 5), 'completed: ' + (i % 7 === 0)];
    props.push(...optional.slice(0, Math.floor(random() * 4)));
    let content = '---\n' + props.join('\n') + '\n---\n# ' + name(i) + ': ' + topic + '\n\n## Findings\n\n';
    content += 'The ' + topic + ' team reviewed the evidence and recorded the next steps for this project.\n\n';
    content += Array.from({ length: linksPerNote }, () => '[[' + name((i + 1 + Math.floor(random() * (notes - 1))) % notes) + ']]').join(' ') + '\n\n';
    content += noteTags.map(t => '#' + t).join(' ') + '\n\n';
    if (i % 5 === 0) content += '\x60\x60\x60js\nconst milestone = "review";\nconsole.log(milestone);\n\x60\x60\x60\n\n';
    const target = Math.round(avgBytes * (0.8 + random() * 0.4));
    const paragraph = 'We compared the implementation with earlier observations. The results clarify ownership, testing, and delivery. Follow-up work will document the remaining questions before the next review.\n\n';
    while (content.length < target) content += paragraph;
    const path = paths[i];
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
    records.push({ path, content });
  }
  const db = { version: 2, tables: { tasks: { name: 'Scale tasks', schema: {
    order: ['title', 'status', 'estimate', 'done'], properties: {
      title: { name: 'Task', type: 'text' },
      status: { name: 'Status', type: 'select', options: [{ id: 'todo', name: 'Todo', color: '#888888' }, { id: 'done', name: 'Done', color: '#5aa06c' }] },
      estimate: { name: 'Estimate', type: 'number' }, done: { name: 'Done', type: 'checkbox' },
    } }, view: { mode: 'table' }, rows: Array.from({ length: dbRows }, (_, i) => ({ id: 'row-' + i, values: { title: 'Review milestone ' + i, status: i % 4 ? 'todo' : 'done', estimate: i % 13, done: i % 4 === 0 } })) } }, relations: [] };
  // Compact JSON keeps 10k rows below the application's 2 MB parse ceiling.
  const dbText = JSON.stringify(db) + '\n';
  const canvasText = JSON.stringify({ nodes: Array.from({ length: canvasNodes }, (_, i) => ({ id: 'node-' + i, type: 'text', x: (i % 25) * 300, y: Math.floor(i / 25) * 180, width: 260, height: 140, text: '## Idea ' + i + '\nReview evidence and agree on next steps.' })), edges: [] }) + '\n';
  writeFileSync(join(dir, 'Scale.db'), dbText);
  writeFileSync(join(dir, 'Scale.canvas'), canvasText);
  return { notes: records, dbText, canvasText, config };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [dir, ...args] = process.argv.slice(2);
  if (!dir || args.length % 2) throw new Error('Usage: node tools/scale-fixture.mjs <empty-dir> [--notes 5000]');
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i].replace(/^--/, '');
    if (!args[i].startsWith('--') || !(key in SCALE_DEFAULTS)) throw new Error('Unknown option: ' + args[i]);
    options[key] = Number(args[i + 1]);
  }
  const result = generateWorkspace(resolve(dir), options);
  console.log(JSON.stringify({ directory: resolve(dir), ...result.config }));
}
