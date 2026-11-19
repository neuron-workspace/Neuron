export const NO_KEYCHAIN_ERROR = "No system keychain is available, so Neuron can't store keys safely on this computer.";
export interface SecretCodec {
  available: boolean;
  encrypt: (value: string) => Buffer;
  decrypt: (value: Buffer) => string;
}
export interface EncryptedSecret { v: 1; enc: string }

export function encodeSecret(value: string, codec: SecretCodec): EncryptedSecret {
  if (!codec.available) throw new Error(NO_KEYCHAIN_ERROR);
  return { v: 1, enc: codec.encrypt(value).toString('base64') };
}

export function decodeSecret(value: unknown, codec: SecretCodec): string | null {
  if (typeof value === 'string') return value || null; // Unmigrated keys remain usable without a keychain.
  if (!value || typeof value !== 'object' || !codec.available) return null;
  const stored = value as Partial<EncryptedSecret>;
  if (stored.v !== 1 || typeof stored.enc !== 'string' || !stored.enc) return null;
  try { return codec.decrypt(Buffer.from(stored.enc, 'base64')) || null; } catch { return null; }
}

const LEGACY_SCOPES: Record<string, string> = { 'ai-claude': 'anthropic', 'ai-openai': 'openai', 'ai-gemini': 'google', 'ai-openrouter': 'openrouter', 'ai-local': 'local' };
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

/** No mutation: a failed encryption leaves the entire original file untouched. */
export function migrateSecretSettings<T extends Record<string, unknown>>(settings: T, codec: SecretCodec): T {
  if (!codec.available) return settings;
  const next = structuredClone(settings);
  const store = record(next.__secrets);
  for (const [scope, fields] of Object.entries(store)) {
    store[scope] = Object.fromEntries(Object.entries(record(fields)).map(([field, value]) => [field, typeof value === 'string' ? encodeSecret(value, codec) : value]));
  }
  if (next.connectorSecretsMigrated !== true) {
    for (const [legacy, connector] of Object.entries(LEGACY_SCOPES)) {
      store[connector] = { ...record(store[legacy]), ...record(store[connector]) };
    }
  }
  // Older releases also kept API keys in renderer-readable plugin config.
  for (const [key, value] of Object.entries(next)) {
    const configs = key === 'connectors' ? record(value)
      : key === 'plugins' || key.startsWith('plugins:') ? record(record(value).config) : {};
    for (const [id, config] of Object.entries(configs)) {
      const fields = record(config);
      if (typeof fields.apiKey !== 'string') continue;
      const scope = LEGACY_SCOPES[id] ?? id;
      const scoped = record(store[scope]);
      if (fields.apiKey && scoped.apiKey === undefined) scoped.apiKey = encodeSecret(fields.apiKey, codec);
      store[scope] = scoped;
      delete fields.apiKey;
    }
  }
  return { ...next, __secrets: store, connectorSecretsMigrated: true };
}

/** Also hide legacy keys when migration cannot run because no keychain exists. */
export function rendererSettingsValue(key: string, value: unknown): unknown {
  if (key === '__secrets') return null;
  if (key !== 'connectors' && key !== 'plugins' && !key.startsWith('plugins:')) return value;
  const next = structuredClone(value);
  const configs = key === 'connectors' ? record(next) : record(record(next).config);
  for (const fields of Object.values(configs)) delete record(fields).apiKey;
  return next;
}
