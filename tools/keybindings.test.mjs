// Run: node tools/keybindings.test.mjs
// No two default shortcuts may collide, on any platform, and every command id is unique.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../src/renderer/lib/keybindings.ts', import.meta.url), 'utf8');
const app = readFileSync(new URL('../src/renderer/App.tsx', import.meta.url), 'utf8');

/** The module as one platform sees it: lib/platform asks main, so the answer is given here. */
async function load(mac) {
  assert.match(source, /import \{ isMac \} from '\.\/platform';/, 'keybindings.ts reads isMac from lib/platform');
  const patched = source.replace(/import \{ isMac \} from '\.\/platform';/, `const isMac = ${mac};`);
  const { outputText } = ts.transpileModule(patched, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } });
  return import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'));
}

let checks = 0;
for (const mac of [false, true]) {
  const { KEY_ACTIONS, DEFAULT_BINDINGS, eventToChord, formatChord, resolveBindings } = await load(mac);
  const where = mac ? 'macOS' : 'Windows/Linux';

  // Every command id once, and every label once (the palette and Settings list them by label).
  const ids = KEY_ACTIONS.map((action) => action.id);
  assert.equal(new Set(ids).size, ids.length, `duplicate command id: ${ids.filter((id, i) => ids.indexOf(id) !== i)}`); checks++;
  const labels = KEY_ACTIONS.map((action) => action.label);
  assert.equal(new Set(labels).size, labels.length, 'duplicate command label'); checks++;
  assert.deepEqual(Object.keys(DEFAULT_BINDINGS), ids); checks++;

  // Every default chord once, as stored and as the platform shows and presses it.
  const chords = KEY_ACTIONS.map((action) => action.default);
  const clash = chords.filter((chord, i) => chords.indexOf(chord) !== i);
  assert.deepEqual(clash, [], `${where}: two commands share ${clash.join(', ')}`); checks++;
  const shown = chords.map(formatChord);
  assert.equal(new Set(shown).size, shown.length, `${where}: two shortcuts look the same: ${shown.join(' ')}`); checks++;

  // Each default is in the form a key press produces, so it can be pressed at
  // all: modifiers in eventToChord's order, the key in lower case.
  for (const { id, default: chord } of KEY_ACTIONS) {
    const parts = chord.split('+');
    const key = parts[parts.length - 1];
    const shift = parts.includes('shift');
    const event = {
      key: key === '`' && shift ? '~' : key.length === 1 ? (shift ? key.toUpperCase() : key) : key.toUpperCase(),
      code: key === '`' ? 'Backquote' : '',
      ctrlKey: !mac && parts.includes('mod'), metaKey: mac && parts.includes('mod'),
      altKey: parts.includes('alt'), shiftKey: shift,
    };
    assert.equal(eventToChord(event), chord, `${where}: ${id} (${chord}) is not what its key press makes`); checks++;
  }

  // Stored overrides merge over the defaults; unknown ids are dropped.
  assert.deepEqual(resolveBindings({ nope: 'mod+q' }), DEFAULT_BINDINGS); checks++;
  assert.equal(resolveBindings({ palette: 'mod+p' }).palette, 'mod+p'); checks++;

  // And the dispatcher in App.tsx handles every command.
  for (const id of ids) { assert.ok(app.includes(`case '${id}':`), `App.tsx has no case for ${id}`); checks++; }
}

console.log(`keybindings: ${checks} checks passed`);
