import { X } from 'lucide-react';
import GraphCanvas from './GraphCanvas';
import type { NoteData } from './GraphCanvas';

interface FloatingGraphProps {
  notesData: NoteData[];
  selectedNote: string | null;
  onSelectNote: (path: string) => void;
  onClose: () => void;
}

/**
 * A square map of the whole workspace, floating over the editor.
 *
 * It is deliberately not a dock. A full-height sidebar spends a column of screen
 * on a graph that is mostly whitespace, and the graph's value is peripheral —
 * you glance at where you are, you do not read it.
 *
 * No title bar: a 248px square labelled "Graph" spends a tenth of its own area
 * telling you what you are plainly looking at. The close control floats over the
 * canvas instead, so the whole square is graph.
 *
 * Every note is drawn, not just the current note's neighbours: the shape of the
 * workspace is the information. Which notes are near is carried by colour
 * (GraphCanvas tiers), not by fading the rest away.
 */
export default function FloatingGraph({ notesData, selectedNote, onSelectNote, onClose }: FloatingGraphProps) {
  return (
    <div
      // top-[3.25rem] clears the tab strip, which is a 42px .pane-header inside
      // this same <main> — at top-3 the panel sat on top of the tabs.
      className="pointer-events-auto absolute right-3 top-[3.25rem] z-20 h-[248px] w-[248px] overflow-hidden rounded-lg border divider-color bg-[var(--surface)] shadow-lg"
      role="complementary"
      aria-label="Workspace graph"
    >
      <GraphCanvas
        notesData={notesData}
        onSelectNote={onSelectNote}
        selectedNote={selectedNote}
        emptyHint="Links between notes appear here."
      />

      {/* Over the canvas, not above it. Carries its own backdrop so it stays
          legible when a node sits underneath. */}
      <button
        type="button"
        onClick={onClose}
        aria-label="Hide graph"
        className="interactive absolute right-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-md bg-[var(--surface)]/85 text-[var(--ink-muted)] backdrop-blur-sm transition-colors duration-150 hover:bg-[var(--surface-hover)] hover:text-[var(--ink)]"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
