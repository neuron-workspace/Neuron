import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

// Paths are relative to src/renderer. Areas may overlap: take every match.
export const areas = [
  [/^(surfaces\/DbSurface\.tsx|components\/DbView\.tsx|lib\/(db|row-window)\.ts)$/, ['database', 'db-virtualization']],
  [/^(components\/(FloatingGraph|GraphCanvas|SigmaGraph)\.tsx|lib\/(graph-layout|knowledge-graph)\.ts)$/, ['graph']],
  [/^(components\/(Workbench|RightPanel|Sidebar)\.tsx|lib\/layout\.ts|surfaces\/(LayoutSurface\.tsx|layout\.ts|panels\.tsx))$/, ['layout', 'panels']],
  [/^(views\/WorkspaceExplorer\.tsx|lib\/(explorer-state\.tsx|workspace-explorer\.ts))$/, ['workspace-explorer']],
  [/^(surfaces\/MermaidSurface\.tsx|components\/MermaidDiagram\.tsx|lib\/mermaid\.ts)$/, ['mermaid']],
  [/^components\/(mdx-components|mdx-layout|MDXPreview|LiveEditor)\.tsx$/, ['flashcard', 'mdx-layout', 'rendering']],
  [/^(lib\/wikilinks\.ts|components\/(MDXPreview|LiveEditor)\.tsx)$/, ['wikilinks']],
  [/^plugins\/builtin\/version-history\.tsx$/, ['version-history']],
  [/^(surfaces\/(index\.ts|SurfaceBoundary\.tsx|CanvasSurface\.tsx|HtmxViewSurface\.tsx|DbSurface\.tsx)|canvas\/.*)$/, ['surfaces']],
  [/^(components\/(RunButton|XtermTerminal)\.tsx|lib\/terminal-bus\.ts|plugins\/builtin\/terminal\.tsx)$/, ['run-button']],
  [/^(plugins\/(host\.tsx|builtin\/ai-[^/]+\.tsx|builtin\/AssistantPanel\.tsx)|views\/PluginsPage\.tsx)$/, ['secrets']],
  [/^(lib\/(sanitize-html|view-security)\.ts|surfaces\/HtmxViewSurface\.tsx)$/, ['security']],
  // Snake is a workspace HTML app; its renderer host is the HTMX surface.
  [/^surfaces\/HtmxViewSurface\.tsx$/, ['snake']],
];

const benchmark = /(?:^|\/)(graph-benchmark|scale\.benchmark)\.spec\.ts$/;

export function selectSpecs(changedFiles, allSpecs) {
  const available = new Set(allSpecs.filter(p => !benchmark.test(p)));
  const selected = new Set();
  const add = p => { if (available.has(p)) selected.add(p); };
  for (const file of changedFiles) {
    const path = file.replaceAll('\\', '/');
    if (/^e2e\/[^/]+\.spec\.ts$/.test(path)) {
      add(path);
    // examples/demo-repo is the workspace every spec copies (e2e/fixtures.ts).
    } else if (/^(e2e|examples)\//.test(path) ||/(^|\/)(playwright\.config\.[^/]+|package(?:-lock)?\.json|tsconfig[^/]*\.json|vite\.config\.[^/]+)$/.test(path) || /^src\/(main|preload)\//.test(path)) {
      return 'all';
    } else if (path.startsWith('src/renderer/')) {
      const matches = areas.filter(([pattern]) => pattern.test(path.slice('src/renderer/'.length)));
      if (!matches.length) return 'all';
      for (const [, specs] of matches) for (const spec of specs) add('e2e/' + spec + '.spec.ts');
    }
  }
  if (selected.size) {
    add('e2e/app.spec.ts');
    add('e2e/workspace.spec.ts');
  }
  return [...selected].sort();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const specs = readdirSync(new URL('../e2e/', import.meta.url))
    .filter(p => p.endsWith('.spec.ts')).map(p => 'e2e/' + p);
  const selected = selectSpecs(readFileSync(0, 'utf8').split(/\r?\n/).filter(Boolean), specs);
  console.log(selected === 'all' ? 'all' : selected.join(' '));
}
