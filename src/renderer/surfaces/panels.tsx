import { useState } from 'react';
import Editor from '../components/Editor';
import LiveEditor from '../components/LiveEditor';
import GraphCanvas from '../components/GraphCanvas';
import MDXPreview from '../components/MDXPreview';
import XtermTerminal from '../components/XtermTerminal';
import type { NoteData, SurfaceProps } from './index';
import type { PanelSpec } from './layout';

/**
 * Tick or untick the task on one source line.
 *
 * The shell layout renders its own previews, so a workspace with a
 * .neuron/layout.json never reaches App's copy of this. That split is exactly
 * how reading-mode checkboxes stayed dead here after being fixed there.
 */
function toggleTaskLine(content: string, lineIndex: number, checked: boolean): string | null {
  const lines = content.split('\n');
  const line = lines[lineIndex];
  if (line === undefined) return null;
  const next = checked ? line.replace(/\[ \]/, '[x]') : line.replace(/\[[xX]\]/, '[ ]');
  if (next === line) return null;
  lines[lineIndex] = next;
  return lines.join('\n');
}

export interface PanelContext {
  spec: PanelSpec;
  surface: SurfaceProps;
}

export type PanelRenderer = (context: PanelContext) => JSX.Element;

const registry = new Map<string, PanelRenderer>();

export function registerPanel(kind: string, renderer: PanelRenderer): void {
  registry.set(kind, renderer);
}

export function getPanel(kind: string): PanelRenderer | undefined {
  return registry.get(kind);
}

function folderOf(path: string): string {
  const i = path.lastIndexOf('/');
  return i >= 0 ? path.slice(0, i + 1) : '';
}

function scopeNotes(surface: SurfaceProps, spec: PanelSpec): NoteData[] {
  const scope = typeof spec.scope === 'string' ? spec.scope : 'repo';
  if (scope === 'active' && surface.selectedNote) {
    const active = surface.notesData.find((note) => note.path === surface.selectedNote);
    if (!active) return [];
    const links = new Set<string>();
    const re = /\[\[(.*?)\]\]/g;
    let match;
    while ((match = re.exec(active.content)) !== null) {
      const target = match[1].trim().toLowerCase();
      for (const note of surface.notesData) {
        const label = note.path.replace(/\.(md|mdx)$/, '').toLowerCase();
        const base = label.split('/').pop();
        if (label === target || base === target) links.add(note.path);
      }
    }
    return surface.notesData.filter((note) => note.path === active.path || links.has(note.path));
  }
  if (scope === 'folder') {
    const root = typeof spec.root === 'string' ? spec.root : folderOf(surface.selectedNote ?? surface.path);
    return surface.notesData.filter((note) => note.path.startsWith(root));
  }
  return surface.notesData;
}

function GraphPanel({ spec, surface }: PanelContext) {
  // Default to the whole workspace. scope:'active' filtered to the current note
  // and its links, which in practice drew one node in a full-height column --
  // the shape of the workspace is the information, and a graph of one is none.
  // A layout can still ask for a narrower scope explicitly.
  return (
    <div className="h-full">
      <GraphCanvas
        notesData={spec.scope ? scopeNotes(surface, spec) : surface.notesData}
        onSelectNote={surface.onSelectNote}
        selectedNote={surface.selectedNote}
        emptyHint="Links between notes appear here."
      />
    </div>
  );
}

type EditMode = 'reading' | 'live' | 'split';

// The main slot in a neuron.config shell. Three views like the standalone editor:
// reading (default), live editor (double-click to enter), and split source+preview.
function EditorPanel({ surface }: PanelContext) {
  const { selectedNote, noteContent, onChangeNote, colorScheme } = surface;
  const [modes, setModes] = useState<Record<string, EditMode>>({});

  const isNote = !!selectedNote && /\.(md|mdx)$/.test(selectedNote);
  // Plain-text workspace files -- .neuron/layout.json above all -- are editable
  // too. They have no Markdown to preview, so they open straight in the source
  // editor rather than being turned away as "not a note".
  const isText = !!selectedNote && /\.(json|css|txt|ya?ml)$/i.test(selectedNote);

  if (!selectedNote || (!isNote && !isText) || noteContent === undefined || !onChangeNote) {
    return <div className="grid h-full place-items-center px-6 text-center text-xs text-[var(--ink-muted)]">Select a note from the sidebar or graph to edit it here.</div>;
  }

  if (isText) {
    return (
      <div className="flex h-full flex-col">
        <div className="border-b border-[var(--divider)] px-3 py-1 font-mono text-[11px] text-[var(--ink-muted)]">
          {selectedNote}
        </div>
        <div className="min-h-0 flex-1">
          <Editor value={noteContent} onChange={onChangeNote} colorScheme={colorScheme ?? 'dark'} />
        </div>
      </div>
    );
  }

  const mode = modes[selectedNote] ?? 'reading';
  const setMode = (next: EditMode) => setModes((prev) => ({ ...prev, [selectedNote]: next }));
  const scheme = colorScheme ?? 'dark';
  // Wiki-links need the note list and a way to open one. Both already arrive
  // on the surface props; nothing new has to be plumbed.
  const notePaths = surface.notesData.map((note) => note.path);
  const openNote = surface.onSelectNote;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-0.5 border-b border-[var(--divider)] px-2 py-1">
        {(['reading', 'live', 'split'] as EditMode[]).map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={mode === m}
            onClick={() => setMode(m)}
            className={`interactive rounded px-2 py-0.5 text-[11px] font-medium capitalize ${mode === m ? 'bg-[var(--surface-hover)] text-[var(--ink)]' : 'text-[var(--ink-muted)] hover:text-[var(--ink)]'}`}
          >
            {m}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1">
        {mode === 'reading' && (
          <div className="h-full overflow-auto" onDoubleClick={() => setMode('live')}>
            <MDXPreview mdxContent={noteContent} onToggleTask={(line, checked) => { const next = toggleTaskLine(noteContent, line, checked); if (next !== null) onChangeNote(next); }} onLineClick={() => undefined} notes={notePaths} onWikiLinkClick={openNote} />
          </div>
        )}
        {mode === 'live' && <LiveEditor value={noteContent} onChange={onChangeNote} colorScheme={scheme} notes={notePaths} onWikiLinkClick={openNote} />}
        {mode === 'split' && (
          <div className="flex h-full divide-x divide-[var(--divider)]">
            <div className="min-w-0 flex-1"><Editor value={noteContent} onChange={onChangeNote} colorScheme={scheme} /></div>
            <div className="min-w-0 flex-1 overflow-auto"><MDXPreview mdxContent={noteContent} onToggleTask={(line, checked) => { const next = toggleTaskLine(noteContent, line, checked); if (next !== null) onChangeNote(next); }} onLineClick={() => undefined} notes={notePaths} onWikiLinkClick={openNote} /></div>
          </div>
        )}
      </div>
    </div>
  );
}

function TreePanel({ surface }: PanelContext) {
  return (
    <div className="h-full overflow-auto border-r border-[var(--divider)] bg-[var(--surface)] p-2">
      {surface.notesData.map((note) => (
        <button
          key={note.path}
          type="button"
          className="interactive block w-full truncate rounded px-2 py-1.5 text-left font-mono text-xs text-[var(--ink-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--ink)]"
          onClick={() => surface.onSelectNote(note.path)}
        >
          {note.path}
        </button>
      ))}
    </div>
  );
}

function TerminalPanel({ spec }: PanelContext) {
  // A terminal declared by the workspace layout is its own terminal, separate
  // from the one in the panel rail. Keying it by the layout's own id keeps a
  // layout with two terminal panes honest -- two panes, two shells -- and stops
  // it sharing a shell with the plugin panel, which made both echo each other.
  const id = typeof spec.id === 'string' ? spec.id : 'layout';
  return <XtermTerminal sessionKey={`layout:${id}`} />;
}

function PreviewPanel({ spec, surface }: PanelContext) {
  const path = typeof spec.path === 'string' ? spec.path : surface.selectedNote;
  const note = surface.notesData.find((item) => item.path === path);
  return <MDXPreview mdxContent={note?.content ?? ''} onLineClick={() => undefined} notes={surface.notesData.map((item) => item.path)} onWikiLinkClick={surface.onSelectNote} />;
}

registerPanel('editor', EditorPanel);
registerPanel('tree', TreePanel);
registerPanel('graph', GraphPanel);
registerPanel('terminal', TerminalPanel);
registerPanel('preview', PreviewPanel);
registerPanel('note', PreviewPanel);
