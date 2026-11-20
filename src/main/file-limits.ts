// How large a file Neuron reads whole. Shared by main, which refuses to read or
// write past it, and the renderer, which leaves such notes out of what it
// reads when a workspace opens. No Node APIs, so it bundles into the renderer.

/** Notes, tables, canvases, databases and views are read whole up to this size. */
export const NOTE_READ_LIMIT = 25 * 1024 * 1024;

/** What notes:read answers for a file over the limit, without reading it. */
export const TOO_LARGE_TO_OPEN = 'Error: This file is too large to open in Neuron (over 25 MB).';

/** What notes:write answers for content over the limit. */
export const TOO_LARGE_TO_SAVE = 'This file is too large to save in Neuron (over 25 MB).';

/** Whether a file of this size is past the limit. An unknown size is not: the read itself decides. */
export function tooLargeToOpen(size: number | undefined | null): boolean {
  return typeof size === 'number' && size > NOTE_READ_LIMIT;
}
