// What kind of file a workspace path is, by its name alone.
//
// One table for both processes: main uses it to decide what it will read,
// write and serve, and the renderer imports it (as it does workspace-windows)
// to decide what opens and how it is drawn. No Node APIs here, so it bundles
// into the renderer as it is.

export type FileKind = 'note' | 'view' | 'db' | 'canvas' | 'diagram' | 'table' | 'image' | 'video' | 'audio' | 'text' | 'blocked' | 'other';

const byKind: Record<FileKind, string[]> = {
  note: ['md', 'mdx'],
  view: ['html'],
  db: ['db'],
  canvas: ['canvas'],
  diagram: ['mmd', 'mermaid'],
  table: ['csv'],
  image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'bmp', 'ico'],
  video: ['mp4', 'webm', 'ogv', 'mov', 'm4v'],
  // .ogg is nearly always Vorbis audio; Ogg video is .ogv.
  audio: ['mp3', 'wav', 'ogg', 'oga', 'm4a', 'aac', 'flac'],
  text: ['json', 'txt', 'log', 'yaml', 'yml', 'toml', 'ini', 'xml', 'js', 'ts', 'tsx', 'jsx', 'py', 'rb', 'go', 'rs', 'java', 'c', 'h', 'cpp', 'cs', 'css', 'scss', 'sql'],
  // Programs and scripts. Never opened, rendered or served; listed only.
  blocked: ['exe', 'msi', 'dll', 'bat', 'cmd', 'com', 'ps1', 'psm1', 'vbs', 'sh', 'bash', 'zsh', 'app', 'dmg', 'pkg', 'deb', 'rpm', 'jar', 'apk', 'scr', 'lnk', 'reg'],
  // Known binaries: listed as other files without reading a byte of them.
  other: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp', 'rtf', 'zip', '7z', 'rar', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'heic', 'psd', 'ttf', 'otf', 'woff', 'woff2', 'iso', 'bin', 'sqlite'],
};

const EXTENSIONS = new Map<string, FileKind>();
for (const [kind, extensions] of Object.entries(byKind)) for (const ext of extensions) EXTENSIONS.set(ext, kind as FileKind);

/** Whole names that decide the kind regardless of extension. */
const NAMES = new Map<string, FileKind>([['.env.example', 'text']]);

const nameOf = (path: string) => path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1).toLowerCase();

/** Lowercase, no dot; '' for none. A leading dot is an extension only for blocked files. */
export function extensionOf(path: string): string {
  const name = nameOf(path);
  const dot = name.lastIndexOf('.');
  if (dot === 0 && EXTENSIONS.get(name.slice(1)) === 'blocked') return name.slice(1);
  return dot > 0 ? name.slice(dot + 1) : '';
}

/** The kind of a path by its name. Anything not in the table is 'other'. */
export function fileKind(path: string): FileKind {
  return NAMES.get(nameOf(path)) ?? EXTENSIONS.get(extensionOf(path)) ?? 'other';
}

/**
 * True for a name the table does not know: such a file opens as text only if
 * its first bytes say it is text (see looksLikeText).
 */
export function needsSniff(path: string): boolean {
  return !NAMES.has(nameOf(path)) && !EXTENSIONS.has(extensionOf(path));
}

/** Kinds Neuron opens as a file of its own, outside the note listing. */
export const OPENS_AS_FILE: readonly FileKind[] = ['image', 'video', 'audio', 'text'];
/** Kinds served to `<img>`, `<video>` and `<audio>` through neuron-file://. */
export const MEDIA_KINDS: readonly FileKind[] = ['image', 'video', 'audio'];

/** How many leading bytes decide whether an unknown file is text. */
export const SNIFF_BYTES = 8192;

/**
 * Whether these leading bytes are UTF-8 text: no NUL byte and valid UTF-8.
 * A multi-byte character cut off at the end of the sample is allowed.
 */
export function looksLikeText(bytes: Uint8Array): boolean {
  if (bytes.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes, { stream: true });
    return true;
  } catch {
    return false;
  }
}
