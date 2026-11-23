// Electron wiring for HTMX views: IPC surface, approval store, .neuron
// scaffolding, and view-server lifecycle. The server itself (server.ts) and
// the policy/session/manifest modules are electron-free and tested directly.

import { ipcMain } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { SessionManager } from './sessions';
import { computeTrust } from './trust';
import { createViewServer, ViewServer } from './server';
import { compilePolicy, resolveInWorkspace } from './pathPolicy';
import { validateManifest, effectiveGrants, ViewManifest } from './manifest';
import { isViewPath, manifestPathFor, legacyManifestPathFor, defaultViewName } from './appPaths';

interface Deps {
  /** The workspace of the window that sent the request; views are served against that root only. */
  getRepoRoot: (event: import('electron').IpcMainInvokeEvent) => string | null;
  getSetting: (key: string) => unknown;
  setSetting: (key: string, value: unknown) => void;
}

/**
 * Trust in one exact version of a view (7B): the content hash of its HTML,
 * manifest and served code (trust.ts). It lasts until any of those change.
 * Records from before this (`{ manifestHash }`) do not count: those views ask
 * once more.
 */
interface ApprovalRecord { contentHash: string; grantedAt: string }
type Approvals = Record<string, ApprovalRecord>;

export const APPROVALS_KEY = 'htmxViewApprovals';

const sessions = new SessionManager();
let serverPromise: Promise<ViewServer> | null = null;
let serverOrigin: string | null = null;

/** Origin of the running view server, for navigation guards in main.ts. */
export function getViewServerOrigin(): string | null {
  return serverOrigin;
}

/** Called when the active workspace changes: every open view session dies. */
export function revokeAllViewSessions(): void {
  sessions.revokeAll();
}

function htmxJsPath(): string {
  // Dev: resolve from node_modules. Packaged: copied next to the compiled main
  // bundle by tools/copy-htmx.mjs during build.
  const bundled = path.join(__dirname, 'htmx.min.js');
  if (fs.existsSync(bundled)) return bundled;
  return require.resolve('htmx.org/dist/htmx.min.js');
}

async function ensureServer(): Promise<ViewServer> {
  if (!serverPromise) {
    serverPromise = createViewServer(sessions, htmxJsPath()).then((s) => {
      serverOrigin = s.origin;
      return s;
    });
    serverPromise.catch(() => { serverPromise = null; });
  }
  return serverPromise;
}

// --- .neuron scaffold ---------------------------------------------------------

const SCAFFOLD: Record<string, string> = {
  'config.json': JSON.stringify({ version: 1 }, null, 2) + '\n',
  'variables.json': JSON.stringify({
    version: 1,
    variables: {
      dashboardTitle: { type: 'string', value: 'My dashboard', writable: false, description: 'Shown by the starter templates.' },
      projectStatus: { type: 'string', value: 'active', writable: true, description: 'A view-editable example variable.' },
    },
  }, null, 2) + '\n',
  'fragments/hello.html': `<span class="neuron-metric-label">{{ variables.dashboardTitle }}</span>
<p>This fragment lives in <code>.neuron/fragments/hello.html</code>.
Fragments interpolate <code>{{ variables.name }}</code> and <code>{{ params.name }}</code> — values are always HTML-escaped.</p>
`,
  'templates/dashboard.html': `<header><h1>{{ variables.dashboardTitle }}</h1></header>
<div class="neuron-grid cols-3">
  <section hx-get="/api/v1/fragments/workspace-summary" hx-trigger="load" hx-swap="innerHTML">Loading…</section>
  <section hx-get="/api/v1/fragments/hello" hx-trigger="load" hx-swap="innerHTML">Loading…</section>
  <section>
    <span class="neuron-metric-label">Tags</span>
    <div hx-get="/api/v1/tags" hx-trigger="load" hx-swap="innerHTML">Loading…</div>
  </section>
</div>
`,
  'templates/note-browser.html': `<header><h1>Note browser</h1></header>
<section>
  <form hx-get="/api/v1/search" hx-target="#results" hx-trigger="submit, input changed delay:300ms from:#q">
    <label for="q">Search notes</label>
    <input id="q" name="query" type="search" autocomplete="off" />
  </form>
  <div id="results"></div>
</section>
<section hx-get="/api/v1/notes?limit=25" hx-trigger="load" hx-swap="innerHTML">Loading notes…</section>
`,
  'templates/file-list.html': `<header><h1>Workspace files</h1></header>
<section hx-get="/api/v1/files?limit=50" hx-trigger="load" hx-swap="innerHTML">Loading files…</section>
`,
};

/** Create missing .neuron folders/files. Never overwrites anything. */
function ensureScaffold(root: string): void {
  for (const dir of ['fragments', 'styles', 'templates']) {
    const resolved = resolveInWorkspace(root, `.neuron/${dir}`);
    if (resolved) fs.mkdirSync(resolved.full, { recursive: true });
  }
  for (const [rel, content] of Object.entries(SCAFFOLD)) {
    const resolved = resolveInWorkspace(root, `.neuron/${rel}`);
    if (!resolved) continue;
    // 'wx' creates only when absent, in one step: never overwrites a file that appears meanwhile.
    try { fs.writeFileSync(resolved.full, content, { encoding: 'utf-8', flag: 'wx' }); } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
  }
}

// --- manifest + approvals -------------------------------------------------------

function loadManifest(root: string, viewRel: string): { manifest: ViewManifest | null; errors: string[]; manifestPath: string } {
  const manifestPath = manifestPathFor(viewRel);
  const primary = resolveInWorkspace(root, manifestPath);
  const legacy = resolveInWorkspace(root, legacyManifestPathFor(viewRel));
  const resolved = primary && fs.existsSync(primary.full) ? primary
    : legacy && fs.existsSync(legacy.full) ? legacy
    : null;
  if (!resolved) return { manifest: null, errors: [], manifestPath };
  let raw: string;
  try { raw = fs.readFileSync(resolved.full, 'utf-8'); } catch { return { manifest: null, errors: ['Manifest could not be read.'], manifestPath }; }
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return { manifest: null, errors: ['Manifest is not valid JSON.'], manifestPath }; }
  const result = validateManifest(parsed);
  if (!result.ok) return { manifest: null, errors: result.errors, manifestPath };
  return { manifest: result.value!, errors: [], manifestPath };
}

function viewKey(root: string, viewRel: string): string {
  return `${root}::${viewRel}`;
}

const CONTENT_HASH = /^[0-9a-f]{64}$/;

export function initHtmxViews(deps: Deps): void {
  /** Only content-bound records count; anything else (old manifest-hash records) is dropped. */
  const readApprovals = (): Approvals => {
    const out: Approvals = Object.create(null);
    const raw = deps.getSetting(APPROVALS_KEY);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      const record = value as Partial<ApprovalRecord> | null;
      if (record && typeof record === 'object' && typeof record.contentHash === 'string' && CONTENT_HASH.test(record.contentHash)
        && typeof record.grantedAt === 'string') {
        out[key] = { contentHash: record.contentHash, grantedAt: record.grantedAt };
      }
    }
    return out;
  };

  ipcMain.handle('htmx-views:open', async (_event, relativePath: string, theme?: 'light' | 'dark') => {
    const root = deps.getRepoRoot(_event);
    if (!root) return { status: 'error', message: 'No workspace is open.' };
    if (theme !== undefined && theme !== 'light' && theme !== 'dark') return { status: 'error', message: 'Invalid theme.' };
    const resolved = resolveInWorkspace(root, relativePath);
    if (!resolved || !isViewPath(resolved.rel)) return { status: 'error', message: 'Not a valid HTMX view path.' };
    if (!fs.existsSync(resolved.full)) return { status: 'error', message: 'View file not found.' };

    try { ensureScaffold(root); } catch { /* read-only workspace: views still work */ }

    const { manifest, errors, manifestPath } = loadManifest(root, resolved.rel);
    if (errors.length) return { status: 'error', message: `Invalid manifest (${manifestPath}): ${errors.join(' ')}` };

    const grants = effectiveGrants(manifest);
    const name = manifest?.name ?? defaultViewName(resolved.rel);
    const key = viewKey(root, resolved.rel);
    // Every view asks first, capabilities or not, and asks again after any
    // change to its HTML, manifest or served code.
    const trust = computeTrust(root, resolved.rel);
    const record = readApprovals()[key];
    if (!record || record.contentHash !== trust.contentHash) {
      // A view that changed under a running session stops now.
      const running = sessions.findByPath(root, resolved.rel);
      if (running) sessions.revoke(running.id);
      return {
        status: 'needs-approval',
        path: resolved.rel,
        name,
        description: manifest?.description,
        permissions: [...grants.caps],
        readPaths: ['workspace.files.read', 'workspace.directories.list', 'workspace.search', 'notes.read', 'tags.read']
          .some((cap) => grants.caps.has(cap)) ? grants.readPatterns : [],
        writePaths: grants.writePatterns,
        contentHash: trust.contentHash,
        changed: !!record,
      };
    }

    const server = await ensureServer();
    // One session per open tab; reopening the same view replaces its session.
    const existing = sessions.findByPath(root, resolved.rel);
    if (existing) sessions.revoke(existing.id);
    const session = sessions.create({
      viewPath: resolved.rel,
      root,
      name,
      theme: manifest?.themeMode === 'light' ? 'light' : manifest?.themeMode === 'dark' ? 'dark' : (theme ?? 'dark'),
      caps: grants.caps,
      readPolicy: compilePolicy(grants.readPatterns),
      writePolicy: compilePolicy(grants.writePatterns),
      trusted: trust.files,
    });
    return {
      status: 'ready',
      sessionId: session.id,
      url: `${server.origin}/views/${session.id}/document?boot=${session.bootToken}`,
      partition: `view-${session.id}`, // in-memory partition: per-view cookie/storage isolation
      name,
    };
  });

  // Trust the version the prompt showed, and only that one: the renderer sends
  // back the hash it was given, and a view that changed in between asks again.
  ipcMain.handle('htmx-views:approve', (_event, relativePath: string, contentHash: string) => {
    const root = deps.getRepoRoot(_event);
    if (!root) return { success: false, error: 'No workspace is open.' };
    // Inline, not CONTENT_HASH: tools/main-guards.test.mjs runs this handler on its own.
    if (typeof contentHash !== 'string' || !/^[0-9a-f]{64}$/.test(contentHash)) return { success: false, error: 'Invalid content hash.' };
    const resolved = resolveInWorkspace(root, relativePath);
    if (!resolved || !isViewPath(resolved.rel)) return { success: false, error: 'Invalid path.' };
    if (!fs.existsSync(resolved.full)) return { success: false, error: 'View file not found.' };
    if (loadManifest(root, resolved.rel).errors.length) return { success: false, error: 'Manifest invalid.' };
    if (computeTrust(root, resolved.rel).contentHash !== contentHash) {
      return { success: false, changed: true, error: 'This view changed while you were reviewing it.' };
    }
    const approvals = readApprovals();
    approvals[viewKey(root, resolved.rel)] = { contentHash, grantedAt: new Date().toISOString() };
    deps.setSetting(APPROVALS_KEY, approvals);
    return { success: true };
  });

  ipcMain.handle('htmx-views:close', (_event, sessionId: string) => {
    const root = deps.getRepoRoot(_event);
    if (!root || typeof sessionId !== 'string' || sessions.get(sessionId)?.root !== root) return { success: false };
    sessions.revoke(sessionId);
    return { success: true };
  });

  // Take trust back: the record goes and a running session stops at once.
  ipcMain.handle('htmx-views:reset-approval', (_event, relativePath: string) => {
    const root = deps.getRepoRoot(_event);
    if (!root) return { success: false };
    const resolved = resolveInWorkspace(root, relativePath);
    if (!resolved) return { success: false };
    const key = viewKey(root, resolved.rel);
    const approvals = readApprovals();
    if (approvals[key]) { delete approvals[key]; deps.setSetting(APPROVALS_KEY, approvals); }
    const session = sessions.findByPath(root, resolved.rel);
    if (session) sessions.revoke(session.id);
    return { success: true };
  });

  /** The views trusted in this window's workspace, for Workspace settings. */
  ipcMain.handle('htmx-views:list-trusted', (_event) => {
    const root = deps.getRepoRoot(_event);
    if (!root) return { success: false, views: [] };
    const prefix = `${root}::`;
    const views = Object.entries(readApprovals())
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, record]) => {
        const rel = key.slice(prefix.length);
        return { path: rel, name: defaultViewName(rel), grantedAt: record.grantedAt };
      })
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    return { success: true, views };
  });
}
