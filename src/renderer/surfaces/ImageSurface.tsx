import * as React from 'react';
import { Minus, Plus } from 'lucide-react';
import { formatSize } from '../lib/workspace-explorer';
import { registerKindSurface, type SurfaceProps } from './index';

const STEP = 1.25;
const MIN_ZOOM = 0.05;
const MAX_ZOOM = 32;

/** A workspace image, fitted to the pane by default, streamed from neuron-file://. */
function ImageSurface({ path, fileSize }: SurfaceProps) {
  const src = window.electronAPI.fileUrl(path);
  const image = React.useRef<HTMLImageElement>(null);
  const [zoom, setZoom] = React.useState<'fit' | number>('fit');
  const [natural, setNatural] = React.useState<{ width: number; height: number } | null>(null);
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => { setZoom('fit'); setNatural(null); setFailed(false); }, [path]);

  // From fit, + and − start at the scale the image is actually drawn at.
  const current = () => zoom !== 'fit' ? zoom : image.current && natural?.width ? image.current.clientWidth / natural.width : 1;
  const step = (factor: number) => setZoom(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, current() * factor)));
  const name = path.slice(path.lastIndexOf('/') + 1);

  return (
    <div data-image-surface className="flex h-full w-full flex-col">
      <div className="pane-header flex items-center gap-3 border-b px-4 text-xs text-[var(--ink-muted)]">
        <span className="min-w-0 truncate text-[var(--ink-secondary)]">{name}</span>
        {fileSize !== undefined && <span>{formatSize(fileSize)}</span>}
        {natural && <span data-image-size>{natural.width} × {natural.height} px</span>}
        <div role="group" aria-label="Zoom" className="ml-auto flex items-center gap-1">
          <button type="button" className="tool-button interactive px-2" aria-pressed={zoom === 'fit'} onClick={() => setZoom('fit')}>Fit</button>
          <button type="button" className="tool-button interactive px-2" aria-pressed={zoom === 1} onClick={() => setZoom(1)}>100%</button>
          <button type="button" className="tool-button interactive" aria-label="Zoom out" onClick={() => step(1 / STEP)}><Minus className="h-3.5 w-3.5" /></button>
          <span className="w-12 text-center tabular-nums" aria-live="polite">{zoom === 'fit' ? 'Fit' : Math.round(zoom * 100) + '%'}</span>
          <button type="button" className="tool-button interactive" aria-label="Zoom in" onClick={() => step(STEP)}><Plus className="h-3.5 w-3.5" /></button>
        </div>
      </div>
      <div className="canvas-surface min-h-0 flex-1 overflow-auto">
        {failed ? (
          <p className="p-6 text-center text-xs text-[var(--ink-muted)]">This image can't be shown here.</p>
        ) : (
          <div className="flex min-h-full min-w-full items-center justify-center p-4" style={{ width: zoom === 'fit' ? '100%' : 'max-content', height: zoom === 'fit' ? '100%' : undefined }}>
            <img ref={image} src={src} alt={name} draggable={false} className="image-checker block"
              style={zoom === 'fit'
                ? { maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }
                : { width: natural ? natural.width * zoom : undefined, maxWidth: 'none' }}
              onLoad={(event) => setNatural({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
              onError={() => setFailed(true)} />
          </div>
        )}
      </div>
    </div>
  );
}

registerKindSurface('image', ImageSurface);

export default ImageSurface;
