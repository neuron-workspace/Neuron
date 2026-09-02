import { useEffect, useId, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { formatMermaidError, renderMermaid, type MermaidColorScheme } from '../lib/mermaid';

interface MermaidDiagramProps {
  source: string;
  colorScheme?: MermaidColorScheme;
  debounceMs?: number;
}

export default function MermaidDiagram({ source, colorScheme = 'dark', debounceMs = 250 }: MermaidDiagramProps) {
  const baseId = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const renderKey = `${colorScheme}\0${source}`;
  const [result, setResult] = useState<{ key: string; svg?: string; error?: string }>();

  useEffect(() => {
    let current = true;

    const timer = window.setTimeout(() => {
      void renderMermaid(`mermaid-${baseId}-${Date.now()}`, source, colorScheme)
        .then((svg) => { if (current) setResult({ key: renderKey, svg }); })
        .catch((caught) => { if (current) setResult({ key: renderKey, error: formatMermaidError(caught) }); });
    }, debounceMs);

    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [baseId, colorScheme, debounceMs, renderKey, source]);

  if (result?.key === renderKey && result.error) {
    return (
      <div role="alert" className="surface-danger m-4 rounded-md border p-4 font-sans text-sm text-danger">
        <div className="mb-2 flex items-center gap-2 font-semibold"><AlertCircle className="h-4 w-4" />Mermaid render error</div>
        <pre className="whitespace-pre-wrap font-mono text-xs leading-5">{result.error}</pre>
      </div>
    );
  }

  if (result?.key !== renderKey || !result.svg) return <div role="status" className="p-6 text-center font-mono text-xs text-muted">Rendering diagram…</div>;

  return (
    <div
      data-mermaid-diagram
      className="flex min-h-full items-center justify-center overflow-auto p-6 [&>svg]:max-w-full"
      dangerouslySetInnerHTML={{ __html: result.svg }}
    />
  );
}
