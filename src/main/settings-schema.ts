// What the renderer may write through settings:set, key by key (Sync Phase 0, P0-2).
//
// Renderer code is not sandboxed: plugins run in it (risk R3). Before this, any
// renderer code could write any value under any key that was not reserved, so a
// plugin could repoint the workspace to reopen, or -- once sync exists -- its
// configuration. Now every key the app writes has a rule here, an unknown key is
// refused, and a value that does not fit its key is refused before anything is
// written. Keys main alone writes are refused outright.
//
// Pure: no Electron, no file system, so the table is unit-tested on its own
// (tools/settings-schema.test.mjs).

export type SettingsVerdict = { ok: true } | { ok: false; error: string };

/**
 * Keys only main writes. The renderer may read some of them (settings:get), but
 * never write them:
 * - `__secrets`: the encrypted key store (settings:set-secret writes it).
 * - `htmxViewApprovals`: which HTML views are trusted (the trust prompt in main).
 * - `sync`: sync configuration (D41). Nothing writes it yet; reserved now so a
 *   renderer write can never get there first.
 * - `repositories`, `seededDemo`, `connectorSecretsMigrated`: main's own state.
 *   A renderer that could write `repositories.current` could choose the folder
 *   the next launch opens.
 */
export const MAIN_ONLY_SETTINGS_KEYS: readonly string[] = [
  '__secrets', 'htmxViewApprovals', 'sync', 'repositories', 'seededDemo', 'connectorSecretsMigrated',
];

export const UNKNOWN_SETTINGS_KEY = 'Unknown settings key.';
export const RESERVED_SETTINGS_KEY = 'Reserved key.';

const KB = 1024;
/** The cap for a value whose contents a plugin chooses: its own storage, its options. */
export const PLUGIN_VALUE_LIMIT = 64 * KB;
/** Object names that would reach a prototype, refused at any depth. */
const FORBIDDEN_NAMES = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_DEPTH = 32;
/** A folder path as a key suffix: long Windows paths included. */
const MAX_PATH = 4096;

/** null when the value fits, otherwise what is wrong with it. */
type Check = (value: unknown) => string | null;

const isPlainObject = (value: unknown): value is Record<string, unknown> => value !== null
  && typeof value === 'object' && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

/**
 * Plain JSON data only: no class instances, no cycles, no symbol keys, nothing
 * deeper than MAX_DEPTH, and no object member named like a prototype link.
 */
function jsonShapeError(value: unknown, ancestors: object[] = []): string | null {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') return null;
  if (typeof value !== 'object') return `${typeof value} is not a settings value`;
  if (ancestors.includes(value)) return 'it refers to itself';
  if (ancestors.length >= MAX_DEPTH) return 'it is nested too deeply';
  if (!Array.isArray(value) && !isPlainObject(value)) return 'only plain objects, arrays, text, numbers and true/false can be saved';
  if (Object.getOwnPropertySymbols(value).length) return 'symbol keys cannot be saved';
  const next = [...ancestors, value];
  if (Array.isArray(value)) {
    for (const item of value) {
      const error = jsonShapeError(item, next);
      if (error) return error;
    }
    return null;
  }
  for (const name of Object.getOwnPropertyNames(value)) {
    if (FORBIDDEN_NAMES.has(name)) return `"${name}" cannot be used as a name`;
    const error = jsonShapeError((value as Record<string, unknown>)[name], next);
    if (error) return error;
  }
  return null;
}

// --- Building blocks ---------------------------------------------------------

const text = (max: number, { empty = true } = {}): Check => (value) => {
  if (typeof value !== 'string') return 'expected text';
  if (!empty && !value.trim()) return 'expected non-empty text';
  return value.length > max ? `text longer than ${max} characters` : null;
};
const bool: Check = (value) => (typeof value === 'boolean' ? null : 'expected true or false');
const finite: Check = (value) => (typeof value === 'number' && Number.isFinite(value) ? null : 'expected a number');
/** Any number: a NaN that slips through is written as null, which every reader already tolerates. */
const anyNumber: Check = (value) => (typeof value === 'number' ? null : 'expected a number');
const integer = (min: number, max: number): Check => (value) =>
  (Number.isInteger(value) && (value as number) >= min && (value as number) <= max ? null : `expected a whole number from ${min} to ${max}`);
const oneOf = (...allowed: unknown[]): Check => (value) =>
  (allowed.includes(value) ? null : `expected one of ${allowed.map((a) => JSON.stringify(a)).join(', ')}`);
const nullable = (check: Check): Check => (value) => (value === null ? null : check(value));
const either = (...checks: Check[]): Check => (value) => {
  let first: string | null = null;
  for (const check of checks) {
    const error = check(value);
    if (!error) return null;
    first ??= error;
  }
  return first;
};
const arrayOf = (item: Check, maxItems: number): Check => (value) => {
  if (!Array.isArray(value)) return 'expected a list';
  if (value.length > maxItems) return `more than ${maxItems} items`;
  for (let i = 0; i < value.length; i++) {
    const error = item(value[i]);
    if (error) return `item ${i + 1}: ${error}`;
  }
  return null;
};
/** An object used as a map: every name must match `name`, every value `item`. */
const recordOf = (name: RegExp | number, item: Check): Check => (value) => {
  if (!isPlainObject(value)) return 'expected an object';
  for (const [key, child] of Object.entries(value)) {
    if (typeof name === 'number' ? key.length === 0 || key.length > name : !name.test(key)) return `"${key.slice(0, 80)}" is not an accepted name`;
    const error = item(child);
    if (error) return `${key.slice(0, 80)}: ${error}`;
  }
  return null;
};
/**
 * An object with known members: an unknown member is refused, a known one must
 * have its type. Members not in `required` may be left out.
 */
const shape = (members: Record<string, Check>, required: string[] = []): Check => (value) => {
  if (!isPlainObject(value)) return 'expected an object';
  for (const key of Object.keys(value)) if (!Object.hasOwn(members, key)) return `unknown member "${key.slice(0, 80)}"`;
  for (const key of required) if (!Object.hasOwn(value, key)) return `missing "${key}"`;
  for (const [key, check] of Object.entries(members)) {
    if (!Object.hasOwn(value, key) || value[key] === undefined) continue;
    const error = check(value[key]);
    if (error) return `${key}: ${error}`;
  }
  return null;
};

// --- Shapes of the values the app writes ---------------------------------------

/** src/renderer/lib/layout.ts WorkbenchLayout. */
const workbenchLayout = shape({
  activityBar: bool, sidebar: bool, sidebarCollapsed: bool, leftPanel: bool, rightPanel: bool,
  bottomPanel: bool, statusBar: bool, zen: bool, graphOverlay: bool,
  sidebarSide: oneOf('left', 'right'),
  panels: recordOf(512, shape({ dock: oneOf('left', 'right', 'bottom'), order: finite, group: integer(0, 63) }, ['dock', 'order'])),
  activePanels: recordOf(/^(left|right|bottom):\d{1,2}$/, text(512)),
});

/** Path-like key suffixes: a workspace folder. */
const folderSuffix = (suffix: string) => suffix.length > 0 && suffix.length <= MAX_PATH;

interface SettingRule {
  /** Where the app writes it, for the next reader of this table. */
  writer: string;
  maxBytes: number;
  check: Check;
}
interface PrefixRule extends SettingRule {
  /** The part after the prefix: a folder path, a plugin's own name... */
  suffix: (rest: string) => boolean;
}

/** Keys written whole. */
export const SETTINGS_RULES: Readonly<Record<string, SettingRule>> = {
  layout: { writer: 'App.tsx commitLayout', maxBytes: 64 * KB, check: workbenchLayout },
  properties: {
    writer: 'App.tsx updatePropsSettings', maxBytes: 1 * KB,
    check: shape({ removeEmpty: bool, showInReading: bool, collapsedByDefault: bool }),
  },
  savedLayouts: {
    writer: 'App.tsx storeLayouts (LayoutSwitcher)', maxBytes: 256 * KB,
    check: arrayOf(shape({ id: text(200, { empty: false }), name: text(40, { empty: false }), layout: workbenchLayout }, ['id', 'name', 'layout']), 20),
  },
  activeLayoutId: { writer: 'App.tsx storeLayouts', maxBytes: 1 * KB, check: nullable(text(200)) },
  appearance: {
    writer: 'App.tsx (Settings › Appearance)', maxBytes: 4 * KB,
    check: shape({ preset: text(64, { empty: false }), markdownOverrides: recordOf(/^[A-Za-z][A-Za-z0-9-]{0,31}$/, (v) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? null : 'expected a #rrggbb colour')) }, ['preset']),
  },
  keybindings: { writer: 'App.tsx updateBindings', maxBytes: 16 * KB, check: recordOf(/^[a-z0-9][a-z0-9.-]{0,63}$/i, text(128)) },
  // Legacy: the app only ever clears it (null); a string is the old one-note split.
  editorSplit: { writer: 'App.tsx (clears the legacy split)', maxBytes: 8 * KB, check: nullable(text(MAX_PATH)) },
  explorerView: { writer: 'views/WorkspaceExplorer.tsx', maxBytes: 64, check: oneOf('list', 'grid') },
  automations: {
    writer: 'components/Automations.tsx', maxBytes: 256 * KB,
    check: arrayOf(shape({ id: text(200, { empty: false }), name: text(200, { empty: false }), commands: arrayOf(text(8 * KB), 500) }, ['id', 'name', 'commands']), 500),
  },
  connectors: {
    writer: 'plugins/host.tsx saveConnector/disconnect (Settings › Connectors)', maxBytes: PLUGIN_VALUE_LIMIT,
    check: recordOf(/^[a-z0-9][a-z0-9._-]{0,63}$/i, recordOf(/^[A-Za-z0-9_.-]{1,64}$/, text(4 * KB))),
  },
  pluginsLegacyWorkspaces: { writer: 'plugins/host.tsx (once, migration)', maxBytes: PLUGIN_VALUE_LIMIT, check: arrayOf(text(MAX_PATH), 1000) },
};

/** Keys written per workspace or per plugin: a fixed prefix and a variable rest. */
export const SETTINGS_PREFIX_RULES: Readonly<Record<string, PrefixRule>> = {
  // Per-workspace plugin enablement and per-plugin options (plugin-owned contents).
  'plugins:': {
    writer: 'plugins/host.tsx persist', maxBytes: PLUGIN_VALUE_LIMIT, suffix: folderSuffix,
    check: shape({
      enabled: recordOf(/^[a-z0-9][a-z0-9._-]{0,63}$/i, bool),
      // Strings today; older saved records are carried over as they were, so any plain value is kept.
      config: recordOf(/^[a-z0-9][a-z0-9._-]{0,63}$/i, recordOf(256, either(text(4 * KB), bool, finite, (v) => (v === null ? null : 'expected text')))),
    }, ['enabled']),
  },
  // A plugin's own storage (HostRuntime.storage): `pluginstore:<plugin id>:<its key>`.
  'pluginstore:': {
    writer: 'plugins/host.tsx runtime storage', maxBytes: PLUGIN_VALUE_LIMIT,
    suffix: (rest) => /^[a-z0-9][a-z0-9._-]{0,63}:.{1,256}$/is.test(rest),
    check: () => null, // contents are the plugin's; the plain-JSON check and the cap still apply
  },
  'explorer.recents:': {
    writer: 'App.tsx (explorer recents)', maxBytes: 64 * KB, suffix: folderSuffix,
    check: arrayOf(shape({ path: text(MAX_PATH, { empty: false }), kind: oneOf('file', 'folder'), at: anyNumber }, ['path', 'kind']), 64),
  },
  'explorer.folders:': { writer: 'App.tsx (empty folders)', maxBytes: 1024 * KB, suffix: folderSuffix, check: arrayOf(text(MAX_PATH), 50_000) },
  'editorGroups:': {
    writer: 'App.tsx saveGroups', maxBytes: 1024 * KB, suffix: folderSuffix,
    check: shape({
      groups: arrayOf(shape({ tabs: arrayOf(text(MAX_PATH), 5_000), selected: nullable(text(MAX_PATH)) }, ['tabs']), 16),
      direction: oneOf('row', 'column'),
      focused: integer(0, 15),
      sizes: arrayOf(anyNumber, 16),
    }, ['groups']),
  },
  // A big workspace has a position per note (up to 20 000 listed files and more nodes).
  'graph:v1:': {
    writer: 'components/SigmaGraph.tsx', maxBytes: 8 * 1024 * KB,
    // An empty rest is what a window with no workspace would use.
    suffix: (rest) => rest.length <= MAX_PATH,
    check: shape({
      preferences: recordOf(/^[A-Za-z]{1,32}$/, either(anyNumber, bool)),
      positions: recordOf(MAX_PATH, shape({ x: anyNumber, y: anyNumber }, ['x', 'y'])),
    }),
  },
};

function ruleFor(key: string): SettingRule | null {
  if (Object.hasOwn(SETTINGS_RULES, key)) return SETTINGS_RULES[key];
  for (const [prefix, rule] of Object.entries(SETTINGS_PREFIX_RULES)) {
    if (key.startsWith(prefix)) return rule.suffix(key.slice(prefix.length)) ? rule : null;
  }
  return null;
}

/**
 * Whether the renderer may write `value` under `key`. Checked before anything
 * is written; a refusal writes nothing. The error names the key.
 */
export function checkRendererSetting(key: unknown, value: unknown): SettingsVerdict {
  if (typeof key !== 'string' || !key) return { ok: false, error: UNKNOWN_SETTINGS_KEY };
  if (MAIN_ONLY_SETTINGS_KEYS.includes(key)) return { ok: false, error: RESERVED_SETTINGS_KEY };
  const rule = ruleFor(key);
  if (!rule) return { ok: false, error: UNKNOWN_SETTINGS_KEY };
  const shown = key.length > 120 ? `${key.slice(0, 120)}…` : key;
  const refuse = (reason: string): SettingsVerdict => ({ ok: false, error: `Invalid value for settings key "${shown}": ${reason}.` });
  if (value === undefined) return refuse('no value');
  const shapeError = jsonShapeError(value);
  if (shapeError) return refuse(shapeError);
  const bytes = Buffer.byteLength(JSON.stringify(value), 'utf8');
  if (bytes > rule.maxBytes) return refuse(`${bytes} bytes is over the ${rule.maxBytes}-byte limit`);
  const error = rule.check(value);
  return error ? refuse(error) : { ok: true };
}
