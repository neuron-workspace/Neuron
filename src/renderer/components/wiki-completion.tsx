import { createContext } from 'react';
import type { EditorView } from '@codemirror/view';
import { folderOf, linkName, wikiLinkText, type WikiIndex } from '../lib/wikilinks';

/**
 * What `[[` autocomplete needs in a note's source editor: the link index and
 * the note being typed in, which decides the shortest link that reaches each
 * file from here. Provided around a note's editors; absent elsewhere (a JSON
 * file's editor offers no note links).
 */
export interface WikiCompletion { index: WikiIndex; from: string | null }
export const WikiCompletionContext = createContext<WikiCompletion | null>(null);

// The slice of @codemirror/autocomplete's types used here. That package comes
// with the editor's basic setup; the source reaches it through language data,
// so nothing imports it directly.
interface CompletionContext { pos: number; explicit: boolean; matchBefore(expr: RegExp): { from: number; to: number; text: string } | null }
interface Completion { label: string; detail?: string; type?: string; apply: (view: EditorView, completion: Completion, from: number, to: number) => void }

/** The completion source, reading the current context from `get` each time it runs. */
export function wikiCompletionSource(get: () => WikiCompletion | null) {
  return (context: CompletionContext) => {
    const value = get();
    if (!value) return null;
    const match = context.matchBefore(/\[\[[^\]\n|#]*$/);
    if (!match) return null;
    const notes = value.index.files.filter((path) => /\.mdx?$/i.test(path) && !path.startsWith('.neuron/') && path !== value.from);
    const options: Completion[] = notes.map((path) => ({
      label: linkName(path),
      detail: folderOf(path) || '/',
      type: 'text',
      apply: (view, _completion, from, to) => {
        const text = wikiLinkText(value.index, path, value.from);
        // Closing brackets may already be there (typed, or added by the editor).
        const closed = view.state.sliceDoc(to, to + 2) === ']]';
        view.dispatch({ changes: { from, to, insert: text + (closed ? '' : ']]') }, selection: { anchor: from + text.length + 2 } });
      },
    }));
    return { from: match.from + 2, options, validFor: /^[^\]\n|#]*$/ };
  };
}
