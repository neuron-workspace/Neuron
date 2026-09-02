export type MermaidColorScheme = 'light' | 'dark';

let mermaidModule: Promise<typeof import('mermaid')['default']> | undefined;

export function formatMermaidError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (typeof error === 'string' && error.trim()) return error.trim();
  return 'Mermaid could not render this diagram.';
}

export async function renderMermaid(id: string, source: string, colorScheme: MermaidColorScheme): Promise<string> {
  const mermaid = await (mermaidModule ??= import('mermaid').then((module) => module.default));
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: colorScheme === 'dark' ? 'dark' : 'default',
  });
  return (await mermaid.render(id, source)).svg;
}
