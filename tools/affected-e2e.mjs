import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

// Which integration specs (e2e/integration/<feature>.spec.ts) a change on dev
// needs (D44). Changed files map to features; a feature is its integration
// spec. Shared or unmapped code selects every integration spec ('all'), never
// the detailed specs: those are the full suite, run for test and main only.
// Documentation, tools and workflow changes select nothing, except
// tools/procs.mjs, which the e2e fixtures import.

// Paths are relative to src/renderer. Areas may overlap: take every match.
export const areas = [
  [/^(views\/(WorkspaceExplorer|RepositoriesPage|SettingsPage|SettingsWindow|WorkspaceSettingsDialog)\.tsx|components\/(RepositoryOnboarding|WorkspaceTemplatesDialog|workspace-actions)\.tsx|lib\/(explorer-state\.tsx|(workspace-explorer|workspace-names|useWorkspaceTemplates)\.ts))$/, ['workspace']],
  [/^(components\/(FileNotices|StatusBar)\.tsx|lib\/(external-change|untitled|new-file)\.ts|plugins\/builtin\/version-history\.tsx)$/, ['files']],
  [/^(components\/(Editor|EditorGroup|NoteTabs|LiveEditing|MDXPreview|properties\/DocumentProperties)\.tsx|lib\/((tabs|task-line|live-edit|keybindings)\.ts|frontmatter\/.*))$/, ['editor']],
  [/^(components\/(Workbench|RightPanel|Sidebar|ActivityRail|LayoutSwitcher)\.tsx|lib\/layout\.ts|surfaces\/(LayoutSurface\.tsx|layout\.ts|panels\.tsx))$/, ['layout']],
  [/^(components\/(mdx-components|mdx-layout|mdx-data|MDXPreview|InsertMenu|FullWidthToggle|DbView)\.tsx|lib\/(data-query|columns|callout-kind)\.ts)$/, ['mdx']],
  [/^(surfaces\/(DbSurface|CsvSurface)\.tsx|components\/(DbView|db\/DbCards|db\/table-kit)\.tsx|lib\/(db|row-window|csv|csv-table)\.ts)$/, ['tables']],
  [/^(surfaces\/HtmxViewSurface\.tsx|lib\/(view-trust|view-security|sanitize-html)\.ts)$/, ['html-views', 'security']],
  [/^(surfaces\/(SurfaceBoundary|CanvasSurface|ImageSurface|MediaSurface|TextSurface|MermaidSurface)\.tsx|components\/(OtherFileIcon|MermaidDiagram|BrowserView)\.tsx|lib\/mermaid\.ts|canvas\/.*)$/, ['surfaces']],
  // The surface registry routes every file type, tables and views included.
  [/^surfaces\/index\.ts$/, ['surfaces', 'tables', 'html-views']],
  [/^(components\/(RunButton|XtermTerminal|Automations|TerminalPanel|StatusBar)\.tsx|lib\/(terminal-bus|terminal-resize|useTerminalToggle)\.ts|plugins\/builtin\/(terminal|automations)\.tsx)$/, ['terminal']],
  [/^(plugins\/(host\.tsx|connectors\.ts|types\.ts|activate\.ts|builtin\/(index\.ts|ai-[^/]+\.tsx|AssistantPanel\.tsx|ReplyMarkdown\.tsx|daily-calendar\.tsx))|views\/(PluginsPage|ConnectorsPage|SettingsPage)\.tsx|lib\/assistant-context\.ts)$/, ['plugins']],
  [/^(components\/(wiki-completion|FileActionDialog|MDXPreview|Sidebar)\.tsx|lib\/(wikilinks|link-rewrite)\.ts)$/, ['links']],
  [/^(components\/(CommandPalette|Sidebar)\.tsx|lib\/(search|use-text-search|reveal|palette-commands)\.ts|plugins\/activate\.ts)$/, ['search']],
  [/^(components\/(FloatingGraph|GraphCanvas|SigmaGraph)\.tsx|lib\/(graph-layout|graph-fit|knowledge-graph)\.ts|plugins\/builtin\/graph\.tsx)$/, ['graph']],
  [/^(components\/(TitleBar|NeuronMark)\.tsx|lib\/(platform|theme)\.ts)$/, ['window-chrome']],
  [/^lib\/theme\.ts$/, ['workspace']],
];

// Paths are relative to src/main. Main-process modules used by one area only;
// any other main or preload change runs every integration spec.
export const mainAreas = [
  [/^terminal-(shell|history)\.ts$/, ['terminal']],
  [/^htmx\/.*$/, ['html-views', 'security']],
  [/^navigation\.ts$/, ['security']],
  [/^secret-storage\.ts$/, ['plugins', 'security']],
  [/^file-protocol\.ts$/, ['surfaces', 'security']],
  [/^workspace-rename\.ts$/, ['links']],
  [/^(workspace-windows|recentRepos|templates)\.ts$/, ['workspace']],
  [/^menu\.ts$/, ['window-chrome']],
];

// A detailed spec (the full suite) belongs to a feature: a change to it on dev
// runs that feature's integration spec. Benchmarks are never selected.
export const detailedSpecs = {
  'all-files': ['surfaces'], app: ['workspace'], 'crash-reporter': ['workspace'],
  'csv-tables': ['tables'], 'database-views': ['tables'], database: ['tables'], 'db-virtualization': ['tables'],
  'dock-groups': ['layout'], layout: ['layout'], panels: ['layout'], 'saved-layouts': ['layout'], sidebar: ['layout'], 'workspace-layout-config': ['layout'],
  'editor-groups': ['editor'], 'editor-split': ['editor'], 'live-editing': ['editor'], 'preview-tabs': ['editor'],
  'external-edit': ['files'], 'files-on-disk': ['files'], 'version-history': ['files'],
  flashcard: ['mdx'], 'mdx-layout': ['mdx'], 'mdx-pages': ['mdx'], rendering: ['mdx'],
  graph: ['graph'], 'search-graph': ['search', 'graph'],
  'links-and-rename': ['links'], wikilinks: ['links'],
  mermaid: ['surfaces'], 'open-files': ['surfaces'], 'surface-errors': ['surfaces'], surfaces: ['surfaces'],
  'run-button': ['terminal'], 'status-terminal': ['terminal'], terminal: ['terminal'],
  secrets: ['plugins', 'security'], security: ['security', 'html-views'],
  snake: ['html-views'], 'view-trust': ['html-views'],
  'window-chrome': ['window-chrome'],
  'workspace-explorer': ['workspace'], 'workspace-switcher': ['workspace'], 'workspace-windows': ['workspace', 'plugins'],
  workspace: ['editor', 'search'],
};

const benchmark = /^e2e\/(graph-benchmark|scale\.benchmark)\.spec\.ts$/;
const spec = (feature) => 'e2e/integration/' + feature + '.spec.ts';
const shared = /(^|\/)(playwright\.config\.[^/]+|package(?:-lock)?\.json|tsconfig[^/]*\.json|vite\.config\.[^/]+)$/;

/**
 * The integration specs to run for `changedFiles`: a sorted list of paths
 * from `integrationSpecs`, or 'all' for every one of them.
 */
export function selectSpecs(changedFiles, integrationSpecs) {
  const available = new Set(integrationSpecs);
  const selected = new Set();
  const add = (feature) => { if (available.has(spec(feature))) selected.add(spec(feature)); };
  for (const file of changedFiles) {
    const path = file.replaceAll('\\', '/');
    if (/^e2e\/integration\/[^/]+\.spec\.ts$/.test(path)) {
      if (available.has(path)) selected.add(path);
    } else if (benchmark.test(path)) {
      continue;
    } else if (/^e2e\/[^/]+\.spec\.ts$/.test(path)) {
      // A detailed spec nobody has mapped yet is treated as shared.
      const features = detailedSpecs[path.slice('e2e/'.length, -'.spec.ts'.length)];
      if (!features) return 'all';
      features.forEach(add);
    // examples/demo-repo is the workspace every spec copies, and e2e/fixtures.ts
    // starts and stops every app through tools/procs.mjs.
    } else if (/^(e2e|examples)\//.test(path) || path === 'tools/procs.mjs' || shared.test(path)) {
      return 'all';
    } else if (path.startsWith('src/main/')) {
      const matches = mainAreas.filter(([pattern]) => pattern.test(path.slice('src/main/'.length)));
      if (!matches.length) return 'all';
      for (const [, features] of matches) features.forEach(add);
    } else if (path.startsWith('src/renderer/')) {
      const matches = areas.filter(([pattern]) => pattern.test(path.slice('src/renderer/'.length)));
      if (!matches.length) return 'all';
      for (const [, features] of matches) features.forEach(add);
    } else if (path.startsWith('src/')) {
      // Preload, shared types, or code in a folder this table does not know yet.
      return 'all';
    }
  }
  return [...selected].sort();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const specs = readdirSync(new URL('../e2e/integration/', import.meta.url))
    .filter(p => p.endsWith('.spec.ts')).map(p => 'e2e/integration/' + p);
  const selected = selectSpecs(readFileSync(0, 'utf8').split(/\r?\n/).filter(Boolean), specs);
  console.log(selected === 'all' ? 'all' : selected.join(' '));
}
