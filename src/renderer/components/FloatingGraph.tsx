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
 * A square map of the whole workspace, floating over the top-right of the
 * editor.
 *
 * It is deliberately not a dock. A full-height sidebar spends a column of screen
 * on a graph that is mostly whitespace, and the graph's value is peripheral —
 * you glance at where you are, you do not read it. A fixed square you can
 * dismiss matches how it actually gets used.
 *
 * Every note is drawn, not just the current note's neighbours: the shape of the
 * workspace is the information. Which notes are near is carried by colour
 * (GraphCanvas tiers), not by fading the rest away.
 */
export default function FloatingGraph({ notesData, selectedNote, onSelectNote, onClose }: FloatingGraphProps) {
  return (
    <div
      className="pointer-events-auto absolute right-3 top-3 z-20 flex h-[248px] w-[248px] flex-col overflow-hidden rounded-lg border divider-color bg-[var(--surface)] shadow-lg"
      role="complementary"
      aria-label="Workspace graph"
    >
      <div className="flex shrink-0 items-center gap-2 border-b divider-color px-2.5 py-1.5">
        <span className="text-[11px] font-medium text-[var(--ink-secondary)]">Graph</span>
        <span className="text-[10px] tabular-nums text-[var(--ink-muted)]">
          {notesData.length} note{notesData.length === 1 ? '' : 's'}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Hide graph"
          className="interactive ml-auto grid h-5 w-5 place-items-center rounded text-[var(--ink-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--ink)]"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
      <div className="min-h-0 flex-1">
        <GraphCanvas
          notesData={notesData}
          onSelectNote={onSelectNote}
          selectedNote={selectedNote}
          emptyHint="Links between notes appear here."
        />
      </div>
    </div>
  );
}
