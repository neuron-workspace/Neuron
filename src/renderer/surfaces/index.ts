import type { ComponentType } from 'react';
import type { FileKind } from '../../main/file-kinds';

/** A note in memory: repo-relative path + raw file content. */
export interface NoteData {
  path: string;
  content: string;
}

/** How a save through the shared document ended; null when a newer save, or an outside change, speaks for it. */
export interface SaveResult {
  success: boolean;
  error?: string;
}

/**
 * Props every file-surface receives. A surface replaces the Markdown editor for
 * files whose extension is registered below — the file itself is a small JSON
 * *declaration*, never stored render output.
 */
export interface SurfaceProps {
  /** Repo-relative path of the opened special file. */
  path: string;
  /** Raw file content (JSON config). */
  content: string;
  /** All notes in the repo (for view blocks and previews). */
  notesData: NoteData[];
  /** Open a note by repo-relative path. */
  onSelectNote: (note: string) => void;
  selectedNote: string | null;
  /** Live content of the active note when rendering the internal neuron.config shell. */
  noteContent?: string;
  /**
   * Persist a change. In an editor group this is the file's shared document:
   * every group showing the file gets the text at once, and the one save path
   * writes it and says how that went.
   */
  onChangeNote?: (value: string) => void | Promise<SaveResult | null>;
  /** The shared document's save state, in an editor group. */
  saveState?: 'idle' | 'saving' | 'saved' | 'error';
  /** Editor color scheme for the internal shell editor panel. */
  colorScheme?: 'light' | 'dark';
  tagSuggestions?: string[];
  onTagClick?: (tag: string) => void;
  removeEmptyFrontmatter?: boolean;
  defaultPropertiesCollapsed?: boolean;
  /** Size on disk in bytes, from the workspace listing, when known. */
  fileSize?: number;
}

export type Surface = ComponentType<SurfaceProps>;

/** Extension (without dot) → surface component. Populated by registerSurface. */
const registry = new Map<string, Surface>();

export function registerSurface(extension: string, surface: Surface): void {
  registry.set(extension.toLowerCase().replace(/^\./, ''), surface);
}

/** Returns the surface for a path's extension, or undefined for normal notes. */
export function getSurface(path: string): Surface | undefined {
  const ext = path.split('.').pop()?.toLowerCase();
  return ext ? registry.get(ext) : undefined;
}

/**
 * Surfaces by file kind, for files outside the note listing (images, video,
 * audio, text). Not by extension: a .json in `.neuron/` is workspace
 * configuration and keeps opening the way it always has.
 */
const kindRegistry = new Map<FileKind, Surface>();

export function registerKindSurface(kind: FileKind, surface: Surface): void {
  kindRegistry.set(kind, surface);
}

export function getKindSurface(kind: FileKind): Surface | undefined {
  return kindRegistry.get(kind);
}

/** Extensions that are special surfaces (used to label/route in the UI). */
export const SURFACE_EXTENSIONS = ['html', 'db', 'canvas', 'mmd', 'mermaid', 'csv'] as const;

/** True if a path is any special surface file. */
export function isSurfaceFile(path: string): boolean {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return (SURFACE_EXTENSIONS as readonly string[]).includes(ext);
}
