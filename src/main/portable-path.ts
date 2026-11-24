// Can this workspace-relative path exist on every OS? (Sync Phase 0, P0-6)
//
// Neuron's own checks (repoPath.ts) apply Windows rules on Windows only, so a
// Linux or macOS device can create `notes/aux.md`, `a:b.md` or `Note.md` beside
// `note.md`, none of which a Windows device can write. Sync must notice that
// before it applies a remote path, and the app can later warn "this name won't
// sync to Windows". This module only answers the question: it changes nothing
// about what Neuron allows locally.
//
// Pure: strings in, reasons out. Paths are workspace-relative with `/` between
// segments, as the workspace walk reports them.

export type PortableReasonCode =
  | 'absolute' // starts with a separator or a drive
  | 'empty-segment' // `a//b`, a leading or trailing `/`
  | 'dot-segment' // `.` or `..`
  | 'illegal-character' // < > : " | ? * or a backslash
  | 'control-character' // U+0000-U+001F
  | 'trailing-dot-or-space' // Windows drops them, so `a.` and `a` are one name
  | 'reserved-name' // CON, PRN, AUX, NUL, COM1-9, LPT1-9, with any extension, any case
  | 'segment-too-long' // over 255 bytes of UTF-8
  | 'path-too-long' // over 260 characters: a warning, the full path depends on where the workspace is
  | 'not-nfc'; // the name changes under NFC normalisation: a warning, sync uses the NFC form

export interface PortableReason {
  code: PortableReasonCode;
  /** An error means some OS cannot hold the name; a warning means it may not. */
  severity: 'error' | 'warning';
  /** The segment it is about, when it is about one. */
  segment?: string;
  message: string;
}

export interface PortablePathCheck {
  path: string;
  /** The path in Unicode NFC, the form sync stores and compares. */
  nfc: string;
  /** True when no reason is an error (warnings allowed). */
  portable: boolean;
  reasons: PortableReason[];
}

/** Per segment: ext4, APFS and NTFS all stop at 255 (bytes on the first two). */
export const MAX_SEGMENT_BYTES = 255;
/** Windows' classic MAX_PATH. Only a warning: it counts the workspace's own folder too. */
export const MAX_PATH_CHARS = 260;

const ILLEGAL = /[<>:"|?*\\]/;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f]/;
/** Device names, with the superscript digits Windows also reserves. */
const RESERVED = /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])$/i;

const describe = (ch: string) => `U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`;

/** The part of a segment Windows matches against device names: before the first dot, trailing spaces dropped. */
const deviceStem = (segment: string) => segment.split('.')[0].replace(/ +$/, '');

function segmentReasons(segment: string): PortableReason[] {
  const reasons: PortableReason[] = [];
  const error = (code: PortableReasonCode, message: string) => reasons.push({ code, severity: 'error', segment, message });
  if (segment === '') { error('empty-segment', 'The path has an empty name in it (two slashes, or one at an end).'); return reasons; }
  if (segment === '.' || segment === '..') { error('dot-segment', `“${segment}” is not a file or folder name.`); return reasons; }
  const illegal = ILLEGAL.exec(segment);
  if (illegal) error('illegal-character', `“${segment}” contains “${illegal[0]}”, which Windows does not allow in names.`);
  const control = CONTROL.exec(segment);
  if (control) error('control-character', `“${segment}” contains the control character ${describe(control[0])}.`);
  if (/[. ]$/.test(segment)) error('trailing-dot-or-space', `“${segment}” ends with a dot or a space, which Windows removes.`);
  if (RESERVED.test(deviceStem(segment))) error('reserved-name', `“${segment}” is a device name on Windows.`);
  const bytes = Buffer.byteLength(segment, 'utf8');
  if (bytes > MAX_SEGMENT_BYTES) error('segment-too-long', `A name is ${bytes} bytes long; the limit is ${MAX_SEGMENT_BYTES}.`);
  return reasons;
}

/** Whether `relativePath` can be written, as named, on Windows, macOS and Linux. */
export function checkPortablePath(relativePath: string): PortablePathCheck {
  const nfc = relativePath.normalize('NFC');
  const reasons: PortableReason[] = [];
  if (relativePath.startsWith('/') || /^[A-Za-z]:/.test(relativePath)) {
    reasons.push({ code: 'absolute', severity: 'error', message: 'The path is not relative to the workspace.' });
  }
  const segments = relativePath.split('/');
  // A leading slash is already reported as absolute; do not report its empty segment twice.
  for (const [index, segment] of segments.entries()) {
    if (index === 0 && segment === '' && relativePath.startsWith('/')) continue;
    reasons.push(...segmentReasons(segment));
    const normal = segment.normalize('NFC');
    if (normal !== segment) {
      reasons.push({ code: 'not-nfc', severity: 'warning', segment, message: `“${segment}” is not in NFC form; it is stored as “${normal}”.` });
    }
  }
  if (relativePath.length > MAX_PATH_CHARS) {
    reasons.push({ code: 'path-too-long', severity: 'warning', message: `The path is ${relativePath.length} characters; older Windows programs stop at ${MAX_PATH_CHARS}.` });
  }
  return { path: relativePath, nfc, portable: !reasons.some((r) => r.severity === 'error'), reasons };
}

/**
 * The key two names share when a case-insensitive, normalisation-insensitive
 * file system (Windows, macOS by default) would see one file.
 */
export const portableFoldKey = (relativePath: string): string => relativePath.normalize('NFC').toLowerCase();

export interface CaseCollision {
  /** The folded spelling they share. */
  key: string;
  /** The distinct spellings, sorted. A folder collides as well as a file: `Docs/a.md` and `docs/b.md`. */
  spellings: string[];
}

/**
 * Names in `paths` that one device can hold apart and another cannot: `Note.md`
 * and `note.md`, an NFC and an NFD spelling of `café.md`, or `Docs/` and `docs/`
 * as folders. The same spelling twice is not a collision.
 */
export function findCaseCollisions(paths: Iterable<string>): CaseCollision[] {
  const byKey = new Map<string, Set<string>>();
  for (const full of paths) {
    const segments = full.split('/');
    // Every folder on the way, and the path itself.
    for (let i = 1; i <= segments.length; i++) {
      const spelled = segments.slice(0, i).join('/');
      const key = portableFoldKey(spelled);
      let spellings = byKey.get(key);
      if (!spellings) byKey.set(key, (spellings = new Set()));
      spellings.add(spelled);
    }
  }
  const collisions: CaseCollision[] = [];
  for (const [key, spellings] of byKey) {
    if (spellings.size > 1) collisions.push({ key, spellings: [...spellings].sort() });
  }
  return collisions.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}
