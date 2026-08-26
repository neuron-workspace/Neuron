// Run: node tools/platform-chrome.test.mjs
//
// macOS gets native window chrome; the other platforms keep the custom frame.
// These checks are deliberately static so they run on every host platform.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (...parts) => readFileSync(join(root, ...parts), 'utf-8');

const main = read('src', 'main', 'main.ts');
const css = read('src', 'renderer', 'index.css');
const preload = read('src', 'main', 'preload.ts');
const declarations = read('src', 'renderer', 'electron.d.ts');

/** Return a balanced source fragment, ignoring delimiters in strings/comments. */
function balanced(source, start, open, close) {
  let depth = 0;
  let quote = null;
  let lineComment = false;
  let blockComment = false;

  for (let i = start; i < source.length; i++) {
    const char = source[i];
    const next = source[i + 1];
    if (lineComment) {
      if (char === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === '*' && next === '/') { blockComment = false; i++; }
      continue;
    }
    if (quote) {
      if (char === '\\') i++;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '/' && next === '/') { lineComment = true; i++; continue; }
    if (char === '/' && next === '*') { blockComment = true; i++; continue; }
    if (char === "'" || char === '"' || char === '`') { quote = char; continue; }
    if (char === open) depth++;
    if (char === close && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`Unbalanced ${open}${close} fragment`);
}

function browserWindowOptions(source) {
  const call = source.indexOf('new BrowserWindow');
  assert.notEqual(call, -1, 'src/main/main.ts must construct a BrowserWindow');
  const paren = source.indexOf('(', call);
  const argument = balanced(source, paren, '(', ')').slice(1, -1).trim();
  if (argument.startsWith('{')) return balanced(argument, 0, '{', '}');

  const name = argument.match(/^[$A-Z_a-z][$\w]*/)?.[0];
  assert.ok(name, 'BrowserWindow options must be statically traceable');
  const declaration = new RegExp(`(?:const|let)\\s+${name}(?:\\s*:[^=]+)?\\s*=\\s*\\{`).exec(source);
  assert.ok(declaration, `Could not find the ${name} BrowserWindow options object`);
  return balanced(source, source.indexOf('{', declaration.index), '{', '}');
}

/** Split an object literal at its top-level commas. */
/**
 * Strip `//` comments before splitting.
 *
 * Without this, a property explained by a comment above it arrives with the
 * comment glued to its front, so a spread reads as starting with `//` rather
 * than `...` and the guard check fails on correct code. The comments are where
 * the reasoning lives, so the parser accommodates them rather than the source
 * being rearranged to suit the parser.
 */
function stripComments(text) {
  return text.replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
}

function properties(object) {
  const body = stripComments(object.slice(1, -1));
  const result = [];
  let start = 0;
  let round = 0;
  let square = 0;
  let curly = 0;
  let quote = null;

  for (let i = 0; i < body.length; i++) {
    const char = body[i];
    if (quote) {
      if (char === '\\') i++;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') { quote = char; continue; }
    if (char === '(') round++;
    else if (char === ')') round--;
    else if (char === '[') square++;
    else if (char === ']') square--;
    else if (char === '{') curly++;
    else if (char === '}') curly--;
    else if (char === ',' && round === 0 && square === 0 && curly === 0) {
      result.push(body.slice(start, i).trim());
      start = i + 1;
    }
  }
  result.push(body.slice(start).trim());
  return result.filter(Boolean);
}

const options = browserWindowOptions(main);
const optionProperties = properties(options);
const macAliases = [...main.matchAll(/\b(?:const|let)\s+([$A-Z_a-z][$\w]*)\s*=\s*process\.platform\s*===\s*['"]darwin['"]/g)]
  .map((match) => match[1]);
const macGuard = new RegExp([
  "process\\.platform\\s*(?:===?|!==?)\\s*['\"]darwin['\"]",
  ...macAliases.map((name) => `\\b${name}\\b`),
].join('|'));

const tests = [
  ['BrowserWindow frame is platform-conditional', () => {
    const frameProperties = optionProperties.filter((property) => /^(?:readonly\s+)?frame\s*:/.test(property));
    assert.match(options, /\bframe\s*:/, 'BrowserWindow options must configure frame for non-macOS platforms');
    assert.ok(
      frameProperties.every((property) => !/^frame\s*:\s*false\s*$/.test(property)),
      'frame: false must not be an unconditional BrowserWindow option',
    );
    assert.ok(
      frameProperties.some((property) => macGuard.test(property))
        || optionProperties.some((property) => property.startsWith('...') && /\bframe\s*:\s*false\b/.test(property) && macGuard.test(property)),
      'the BrowserWindow frame choice must be guarded by the darwin platform',
    );
  }],
  ['hiddenInset is on the macOS BrowserWindow path', () => {
    const chromeProperty = optionProperties.find((property) => /\btitleBarStyle\s*:/.test(property));
    assert.ok(chromeProperty, "macOS BrowserWindow options must include titleBarStyle: 'hiddenInset'");
    assert.match(chromeProperty, /\btitleBarStyle\s*:\s*['"]hiddenInset['"]|['"]hiddenInset['"]/, "titleBarStyle must use 'hiddenInset'");
    assert.match(chromeProperty, macGuard, "titleBarStyle: 'hiddenInset' must be guarded by the darwin platform");
  }],
  ['maximized-window CSS cannot apply on macOS', () => {
    const source = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const selectors = [...source.matchAll(/([^{}]+)\{[^{}]*\}/g)]
      .flatMap((match) => match[1].split(','))
      .map((selector) => selector.trim())
      .filter((selector) => /\bbody\b[^{}]*\.window-maximized\b/.test(selector));
    assert.ok(selectors.length > 0, 'Expected body.window-maximized rules to check');
    const scoped = (selector) => (
      /(?:\.|data-platform\s*=\s*['"]?)(?:platform-)?(?:win32|windows)\b/i.test(selector)
      || /:not\([^)]*(?:darwin|mac(?:os)?)[^)]*\)/i.test(selector)
    );
    const unscoped = selectors.filter((selector) => !scoped(selector));
    assert.deepEqual(unscoped, [], `These maximized selectors can still apply on macOS: ${unscoped.join(', ')}`);
  }],
  ['preload exposes process.platform', () => {
    assert.match(
      preload,
      /\bplatform\s*:\s*process\.platform\b/,
      'electronAPI must expose process.platform as a value',
    );
  }],
  ['renderer ElectronAPI declares platform', () => {
    const interfaceStart = declarations.search(/\binterface\s+ElectronAPI\s*\{/);
    assert.notEqual(interfaceStart, -1, 'electron.d.ts must declare ElectronAPI');
    const bodyStart = declarations.indexOf('{', interfaceStart);
    const electronApi = balanced(declarations, bodyStart, '{', '}');
    assert.match(electronApi, /\bplatform\s*:\s*[^;{}]+;/, 'ElectronAPI must declare its platform value');
  }],
];

let failures = 0;
for (const [name, test] of tests) {
  try {
    test();
    console.log(`ok - ${name}`);
  } catch (error) {
    failures++;
    console.error(`not ok - ${name}\n  ${error.message}`);
  }
}

if (failures) {
  console.error(`platform chrome: ${failures} of ${tests.length} checks failed`);
  process.exitCode = 1;
} else {
  console.log(`platform chrome: all ${tests.length} checks passed`);
}
