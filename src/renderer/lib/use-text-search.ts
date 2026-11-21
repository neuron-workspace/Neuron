import { useEffect, useMemo, useRef, useState } from 'react';
import type { SearchableFile } from './search';

/** What main reads of a text file (TEXT_READ_LIMIT): a larger one is searched by its start. */
export const TEXT_SEARCH_LIMIT = 5 * 1024 * 1024;
/** Files read at once. */
const BATCH = 16;

/**
 * The text files outside the notes (JSON, YAML, logs, code, unknown names that
 * start as text), read for the search when it runs rather than held with the
 * notes: notesData is what the graph, tags and links are built from, and none
 * of these belong there.
 *
 * Read once while `active` (the search panel is open) and dropped when it
 * closes. Nothing is read until `wanted` (a query has been typed). A file the
 * watcher reports changed is read again; one it reports gone is dropped.
 */
export function useTextSearch(active: boolean, wanted: boolean, paths: readonly string[], sizeOf: (path: string) => number | undefined): SearchableFile[] {
  const cache = useRef(new Map<string, string>());
  const reading = useRef(new Set<string>());
  // Changed on disk while being read: the answer is dropped and read again.
  const stale = useRef(new Set<string>());
  // Bumped when the panel closes, so reads still in flight land nowhere.
  const generation = useRef(0);
  const [version, setVersion] = useState(0);
  const sizeRef = useRef(sizeOf);
  sizeRef.current = sizeOf;

  useEffect(() => {
    if (active) return;
    generation.current += 1;
    cache.current = new Map();
    reading.current = new Set();
    stale.current = new Set();
  }, [active]);

  const key = paths.join('\n');
  useEffect(() => {
    if (!active || !wanted || !window.electronAPI) return;
    const missing = paths.filter((path) => !cache.current.has(path) && !reading.current.has(path));
    if (!missing.length) return;
    const run = generation.current;
    for (const path of missing) reading.current.add(path);
    void (async () => {
      for (let i = 0; i < missing.length; i += BATCH) {
        const batch = missing.slice(i, i + BATCH);
        const read = await Promise.all(batch.map((path) => window.electronAPI.readNote(path).catch(() => 'Error:')));
        if (run !== generation.current) return;
        batch.forEach((path, index) => {
          reading.current.delete(path);
          if (stale.current.delete(path)) return;
          // Not text after all, or gone: found by its name only.
          cache.current.set(path, read[index].startsWith('Error:') ? '' : read[index]);
        });
        setVersion((v) => v + 1);
      }
    })();
  }, [active, wanted, key, version]);

  useEffect(() => {
    if (!active || !window.electronAPI?.onNotesChanged) return;
    return window.electronAPI.onNotesChanged((event, path) => {
      const touched = (candidate: string) => candidate === path || (event === 'unlink' && candidate.startsWith(path + '/'));
      let changed = false;
      for (const cached of [...cache.current.keys()]) if (touched(cached)) { cache.current.delete(cached); changed = true; }
      for (const pending of reading.current) if (touched(pending)) stale.current.add(pending);
      if (changed) setVersion((v) => v + 1);
    });
  }, [active]);

  return useMemo(() => {
    if (!active) return [];
    return paths.map((path) => {
      const content = cache.current.get(path) ?? '';
      const size = sizeRef.current(path);
      return size !== undefined && size > TEXT_SEARCH_LIMIT ? { path, content, truncated: true } : { path, content };
    });
    // `version` is how a change to the cache shows here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, key, version]);
}
