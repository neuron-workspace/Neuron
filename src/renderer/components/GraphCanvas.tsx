import { Component, lazy, Suspense, type ReactNode } from 'react';
import type { NoteData } from '../lib/knowledge-graph';
export type { NoteData } from '../lib/knowledge-graph';
export interface GraphCanvasProps {
  notesData: NoteData[];
  onSelectNote: (note: string) => void;
  selectedNote: string | null;
  searchQuery?: string;
  emptyHint?: string;
  compact?: boolean;
  scope?: 'repo' | 'active' | 'folder';
  folder?: string;
}
const SigmaGraph = lazy(() => import('./SigmaGraph'));

/**
 * A graph that throws stays a graph-sized message. The graph floats over the
 * editor and sits in panels beside it, and an error with no boundary of its own
 * unmounts everything up to the nearest one -- an editor, a Split preview, or
 * the whole window -- for a picture that is never essential.
 */
class GraphBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (!this.state.failed) return this.props.children;
    return <p role="alert" className="p-3 text-xs text-[var(--ink-muted)]">The graph could not start.</p>;
  }
}

export default function GraphCanvas(props: GraphCanvasProps) {
  return <GraphBoundary><Suspense fallback={<div role="status" className="p-3 text-xs text-[var(--ink-muted)]">Loading connections…</div>}><SigmaGraph {...props} /></Suspense></GraphBoundary>;
}
