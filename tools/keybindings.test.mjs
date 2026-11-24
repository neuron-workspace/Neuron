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

  // Option chords. On macOS Option+letter types a symbol, so the physical key
  // names the letter; elsewhere, and without Option, `key` still decides.
  const press = (key, code, mods = {}) => eventToChord({
    key, code, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods,
  });
  if (mac) {
    assert.equal(press('Ω', 'KeyZ', { altKey: true }), 'alt+z', 'macOS: Option+Z fires alt+z'); checks++;
    assert.equal(press('¸', 'KeyZ', { altKey: true, shiftKey: true }), 'alt+shift+z', 'macOS: Option+Shift+Z'); checks++;
    assert.equal(press('Dead', 'KeyE', { altKey: true }), 'alt+e', 'macOS: Option+E (a dead accent) still names its key'); checks++;
    assert.equal(press('ˆ', 'KeyI', { altKey: true, metaKey: true }), 'mod+alt+i', 'macOS: Cmd+Option+letter'); checks++;
    assert.equal(press('k', 'KeyK', { metaKey: true }), 'mod+k', 'macOS: Cmd chords unchanged'); checks++;
    assert.equal(press('K', 'KeyK', { metaKey: true, shiftKey: true }), 'mod+shift+k', 'macOS: Cmd+Shift unchanged'); checks++;
    assert.equal(press('Ω', 'KeyV'), 'ω', 'macOS: a layout that types Ω without Option is not alt+z'); checks++;
    assert.notEqual(press('Ω', 'KeyZ'), 'alt+z', 'macOS: no Option, no alt chord'); checks++;
    assert.equal(press('≤', 'Comma', { altKey: true }), 'alt+≤', 'macOS: Option on a non-letter key keeps its key'); checks++;
    assert.equal(press('F11', 'F11', { altKey: true }), 'alt+f11', 'macOS: Option on a named key keeps its key'); checks++;
    // Every alt+<letter> default fires from the symbol Option really types.
    for (const { id, default: chord } of KEY_ACTIONS.filter((a) => /^alt\+[a-z]$/.test(a.default))) {
      const letter = chord.slice(-1);
      assert.equal(press('∂', 'Key' + letter.toUpperCase(), { altKey: true }), chord, `macOS: ${id} (${chord}) fires with Option`); checks++;
    }
  } else {
    assert.equal(press('z', 'KeyZ', { altKey: true }), 'alt+z', `${where}: Alt+Z`); checks++;
    assert.equal(press('Ω', 'KeyZ', { altKey: true }), 'alt+ω', `${where}: Alt goes by key, not position`); checks++;
    assert.equal(press('Z', 'KeyZ', { altKey: true, shiftKey: true }), 'alt+shift+z', `${where}: Alt+Shift+Z`); checks++;
    assert.equal(press('k', 'KeyK', { ctrlKey: true }), 'mod+k', `${where}: Ctrl chords unchanged`); checks++;
  }
}

console.log(`keybindings: ${checks} checks passed`);
