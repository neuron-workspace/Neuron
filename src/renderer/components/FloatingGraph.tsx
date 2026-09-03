import { useRef, useState } from 'react';
import { GripVertical, X } from 'lucide-react';
import GraphCanvas from './GraphCanvas';
import type { NoteData } from './GraphCanvas';

interface FloatingGraphProps {
  notesData: NoteData[];
  selectedNote: string | null;
  onSelectNote: (path: string) => void;
  onClose: () => void;
}

const SIZE = 248;
/** Clears the 42px .pane-header tab strip inside this same <main>. */
const DEFAULT_TOP = 52;
const EDGE = 12;

/**
 * A square map of the whole workspace, floating over the editor.
 *
 * Not a dock: a full-height sidebar spends a column of screen on a graph that is
 * mostly whitespace, and the graph's value is peripheral — you glance at where
 * you are, you do not read it.
 *
 * No title bar either. A 248px square labelled "Graph" spends a tenth of its own
 * area saying what you are plainly looking at, so the controls float over the
 * canvas and the whole square is graph.
 */
export default function FloatingGraph({ notesData, selectedNote, onSelectNote, onClose }: FloatingGraphProps) {
  // null means "parked top-right"; dragging switches to explicit coordinates so
  // the panel stays put when the window resizes until the user moves it again.
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);

  const startDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    const box = boxRef.current?.getBoundingClientRect();
    const parent = boxRef.current?.offsetParent?.getBoundingClientRect();
    if (!box || !parent) return;
    drag.current = { dx: event.clientX - box.left, dy: event.clientY - box.top };
    setPos({ x: box.left - parent.left, y: box.top - parent.top });
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const onDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    const parent = boxRef.current?.offsetParent?.getBoundingClientRect();
    if (!d || !parent) return;
    // Kept inside the editor region: a panel dragged off-screen cannot be
    // dragged back, and there is no "reset position" control to rescue it.
    const x = Math.min(Math.max(event.clientX - parent.left - d.dx, EDGE), parent.width - SIZE - EDGE);
    const y = Math.min(Math.max(event.clientY - parent.top - d.dy, EDGE), parent.height - SIZE - EDGE);
    setPos({ x, y });
  };

  const endDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    drag.current = null;
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* never captured */ }
  };

  return (
    <div
      ref={boxRef}
      // --z-overlay, not a raw z-20. index.css defines a semantic scale
      // (panel 30 < overlay 50 < modal 60) and this floated at 20, below the
      // hover-revealed close button of the panel it floats over -- so reaching
      // for the graph's own close button revealed that one on the way and
      // clicked it instead, if it landed at all.
      className="pointer-events-auto absolute z-[var(--z-overlay)] overflow-hidden rounded-lg border divider-color bg-[var(--surface)] shadow-lg"
      style={pos
        ? { left: pos.x, top: pos.y, width: SIZE, height: SIZE }
        : { right: EDGE, top: DEFAULT_TOP, width: SIZE, height: SIZE }}
      role="complementary"
      aria-label="Workspace graph"
    >
      <GraphCanvas
        notesData={notesData}
        onSelectNote={onSelectNote}
        selectedNote={selectedNote}
        emptyHint="Links between notes appear here."
        compact
      />

      {/* Two separate affordances on purpose. Dragging the canvas pans the
          graph; dragging the panel needs its own grip, or one gesture would
          have to mean both. */}
      <div className="absolute right-1.5 top-1.5 flex items-center gap-0.5">
        <button
          type="button"
          aria-label="Move graph"
          onPointerDown={startDrag}
          onPointerMove={onDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          className="tool-button interactive cursor-grab bg-[var(--surface)] active:cursor-grabbing"
        >
          <GripVertical className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="Hide graph"
          className="tool-button interactive bg-[var(--surface)]"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
