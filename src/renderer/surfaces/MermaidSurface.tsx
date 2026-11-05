import Editor from '../components/Editor';
import MermaidDiagram from '../components/MermaidDiagram';
import { registerSurface, type SurfaceProps } from './index';

function MermaidSurface({ content, onChangeNote, colorScheme = 'dark' }: SurfaceProps) {
  return (
    <div data-mermaid-surface className="flex h-full w-full divide-x divider-color">
      <section className="flex min-w-0 flex-1 flex-col">
        <header className="pane-header flex items-center border-b px-4 text-[11px] font-medium text-[var(--ink-muted)]">Source</header>
        <div className="min-h-0 flex-1">
          <Editor value={content} onChange={(value) => onChangeNote?.(value)} colorScheme={colorScheme} />
        </div>
      </section>
      <section className="flex min-w-0 flex-1 flex-col">
        <header className="pane-header flex items-center border-b px-4 text-[11px] font-medium text-[var(--ink-muted)]">Diagram</header>
        <div className="canvas-surface min-h-0 flex-1 overflow-auto">
          <MermaidDiagram source={content} colorScheme={colorScheme} />
        </div>
      </section>
    </div>
  );
}

registerSurface('mmd', MermaidSurface);
registerSurface('mermaid', MermaidSurface);

export default MermaidSurface;
