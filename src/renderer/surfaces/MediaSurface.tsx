import * as React from 'react';
import { fileKind } from '../../main/file-kinds';
import { formatSize } from '../lib/workspace-explorer';
import { registerKindSurface, type SurfaceProps } from './index';

/**
 * A workspace video or audio file in the platform's own player, streamed from
 * neuron-file:// (which answers range requests, so seeking works). A codec
 * Chromium cannot play says so instead of showing a dead player.
 */
function MediaSurface({ path, fileSize }: SurfaceProps) {
  const src = window.electronAPI.fileUrl(path);
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => setFailed(false), [path]);
  const name = path.slice(path.lastIndexOf('/') + 1);
  const video = fileKind(path) === 'video';
  const onError = () => setFailed(true);

  return (
    <div data-media-surface className="flex h-full w-full flex-col">
      <div className="pane-header flex items-center gap-3 border-b px-4 text-xs text-[var(--ink-muted)]">
        <span className="min-w-0 truncate text-[var(--ink-secondary)]">{name}</span>
        {fileSize !== undefined && <span>{formatSize(fileSize)}</span>}
      </div>
      <div className="canvas-surface flex min-h-0 flex-1 items-center justify-center overflow-auto p-6">
        {failed ? (
          <div role="status" className="flex flex-col items-center gap-3 text-center text-xs text-[var(--ink-muted)]">
            <p>This file can't be played here.</p>
            <button type="button" className="explorer-action interactive" onClick={() => void window.electronAPI.revealInFolder(path)}>Show in folder</button>
          </div>
        ) : video ? (
          <video key={src} src={src} controls preload="metadata" className="max-h-full max-w-full" onError={onError} />
        ) : (
          <audio key={src} src={src} controls preload="metadata" className="w-full max-w-xl" onError={onError} />
        )}
      </div>
    </div>
  );
}

registerKindSurface('video', MediaSurface);
registerKindSurface('audio', MediaSurface);

export default MediaSurface;
