import { useEffect, useState } from 'react';
import { Sparkles, Plug, PencilRuler, LayoutGrid, Search, PackagePlus, ShieldCheck, PanelRight, PanelBottom, TerminalSquare, AppWindow } from 'lucide-react';
import { DOCKS, placePanels, type Dock, type WorkbenchLayout } from '../lib/layout';
import { appPluginId, usePlugins } from '../plugins/host';
import type { PluginCategory, PluginManifest } from '../plugins/types';
import { Input } from '../components/ui/input';
import { Switch } from '../components/ui/switch';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { cn } from '../lib/utils';
import { ConnectorBadge } from './ConnectorsPage';

const categoryMeta: Record<PluginCategory, { label: string; icon: React.ComponentType<{ className?: string }> }> = {
  ai: { label: 'AI', icon: Sparkles },
  integration: { label: 'Integrations', icon: Plug },
  editor: { label: 'Editor', icon: PencilRuler },
  view: { label: 'Views', icon: LayoutGrid },
};

/** A workspace HTML app: a folder in plugins/ with a neuron.app.json marker. */
export interface WorkspaceApp { folder: string; manifestPath: string }

/** The apps a workspace carries, from its file list. */
export function workspaceApps(paths: string[]): WorkspaceApp[] {
  const apps = new Map<string, WorkspaceApp>();
  for (const path of paths) {
    const match = /^plugins\/([^/]+)\/neuron\.app\.json$/.exec(path);
    if (match) apps.set(match[1], { folder: match[1], manifestPath: path });
  }
  return [...apps.values()].sort((a, b) => a.folder.localeCompare(b.folder));
}

/** Options of a plugin with no connector: per workspace, never secrets. */
function WorkspaceOptions({ manifest }: { manifest: PluginManifest }) {
  const { getConfig, setConfig } = usePlugins();
  const fields = (manifest.configSchema ?? []).filter((f) => f.type !== 'password');
  const [values, setValues] = useState<Record<string, string>>(getConfig(manifest.id));
  useEffect(() => setValues(getConfig(manifest.id)), [manifest.id, getConfig]);
  if (manifest.connector || fields.length === 0) return null;
  const save = () => setConfig(manifest.id, values);
  return (
    <div className="mt-3 space-y-3 border-t border-[var(--divider)] pt-3">
      {fields.map((field) => (
        <div key={field.key} className="space-y-1">
          <label className="text-[11px] font-medium text-[var(--ink-secondary)]" htmlFor={`${manifest.id}-${field.key}`}>{field.label}</label>
          <Input id={`${manifest.id}-${field.key}`} placeholder={field.placeholder} value={values[field.key] ?? ''}
            onChange={(e) => setValues((prev) => ({ ...prev, [field.key]: e.target.value }))} onBlur={save} />
          {field.description && <p className="text-[10px] leading-4 text-[var(--ink-muted)]">{field.description}</p>}
        </div>
      ))}
    </div>
  );
}

/** "Uses Claude", with the connector's status, and the way to set it up when it is not. */
function ConnectorLine({ manifest }: { manifest: PluginManifest }) {
  const { connectorOf, connectorStatus } = usePlugins();
  const connector = connectorOf(manifest.id);
  if (!connector) return null;
  const status = connectorStatus(connector.id);
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[var(--ink-secondary)]" data-connector-line={connector.id}>
      {status === 'connected' ? (
        <><span>Uses {connector.name}</span><ConnectorBadge status={status} /></>
      ) : (
        <>
          <span>Set up {connector.name} in Settings</span>
          <Button size="sm" variant="outline" onClick={() => void window.electronAPI?.windowControls.openPage('connectors')}>Set up</Button>
        </>
      )}
    </div>
  );
}

function PluginRow({ manifest, layout, onOpenDock }: { manifest: PluginManifest; layout: WorkbenchLayout; onOpenDock?: (dock: Dock) => void }) {
  const { isEnabled, setEnabled, panels, commands } = usePlugins();
  const enabled = isEnabled(manifest.id);
  const meta = categoryMeta[manifest.category];
  const Icon = meta.icon;
  const myPanels = panels.filter((p) => p.pluginId === manifest.id);
  const placed = placePanels(myPanels, layout);
  const sidePanels = [...placed.left, ...placed.right].flat();
  const bottomPanels = placed.bottom.flat();
  const myCommands = commands.filter((c) => c.pluginId === manifest.id);

  return (
    <div className={cn('p-4', enabled && 'bg-[var(--surface)]')} data-plugin-row={manifest.id}>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-md border border-[var(--divider)] bg-[var(--surface)] text-[var(--accent-strong)]">
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-[var(--ink)]">{manifest.name}</h3>
            <Badge variant="outline">{meta.label}</Badge>
          </div>
          <p className="mt-1 text-xs leading-5 text-[var(--ink-secondary)]">{manifest.description}</p>
          <ConnectorLine manifest={manifest} />
          {enabled && (myPanels.length > 0 || myCommands.length > 0) && (
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-[var(--ink-muted)]">
              {sidePanels.length > 0 && <span className="flex items-center gap-1"><PanelRight className="h-3 w-3" /> {sidePanels.map((p) => p.view.title).join(', ')}</span>}
              {bottomPanels.length > 0 && <span className="flex items-center gap-1"><PanelBottom className="h-3 w-3" /> {bottomPanels.map((p) => p.view.title).join(', ')}</span>}
              {myCommands.length > 0 && <span className="flex items-center gap-1"><TerminalSquare className="h-3 w-3" /> {myCommands.map((c) => c.command.title).join(', ')}</span>}
            </div>
          )}
          {onOpenDock && enabled && (sidePanels.length > 0 || bottomPanels.length > 0) && (
            <div className="mt-3 flex flex-wrap gap-2">
              {DOCKS.filter((dock) => placed[dock].length > 0).map((dock) => (
                <Button key={dock} size="sm" variant="outline" onClick={() => onOpenDock(dock)}>Open {dock} dock</Button>
              ))}
            </div>
          )}
        </div>
        <EnableSwitch name={manifest.name} checked={enabled} onChange={(on) => setEnabled(manifest.id, on)} />
      </div>
      {enabled && <WorkspaceOptions manifest={manifest} />}
    </div>
  );
}

function EnableSwitch({ name, checked, onChange }: { name: string; checked: boolean; onChange: (on: boolean) => void }) {
  return (
    <label className="flex shrink-0 items-center gap-2 text-[11px] text-[var(--ink-muted)]">
      Enable for this workspace
      <Switch checked={checked} onCheckedChange={onChange} aria-label={`Enable ${name} for this workspace`} />
    </label>
  );
}

function AppRow({ app }: { app: WorkspaceApp }) {
  const { isAppEnabled, setEnabled } = usePlugins();
  const [info, setInfo] = useState<{ name: string; description: string }>({ name: app.folder, description: '' });
  useEffect(() => {
    let cancelled = false;
    void window.electronAPI?.readNote(app.manifestPath).then((text) => {
      try {
        const parsed = JSON.parse(text) as { name?: unknown; description?: unknown };
        if (!cancelled) setInfo({ name: typeof parsed.name === 'string' && parsed.name ? parsed.name : app.folder, description: typeof parsed.description === 'string' ? parsed.description : '' });
      } catch { /* an unreadable marker keeps the folder name */ }
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [app.manifestPath, app.folder]);
  const enabled = isAppEnabled(app.folder);
  return (
    <div className={cn('p-4', enabled && 'bg-[var(--surface)]')} data-app-row={app.folder}>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-md border border-[var(--divider)] bg-[var(--surface)] text-[var(--accent-strong)]">
          <AppWindow className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-[var(--ink)]">{info.name}</h3>
            <Badge variant="outline">Workspace app</Badge>
          </div>
          <p className="mt-1 text-xs leading-5 text-[var(--ink-secondary)]">{info.description || `plugins/${app.folder}`}</p>
        </div>
        <EnableSwitch name={info.name} checked={enabled} onChange={(on) => setEnabled(appPluginId(app.folder), on)} />
      </div>
    </div>
  );
}

/**
 * The Plugins section of the Workspace settings dialog. What is switched on
 * here is on for this workspace only, and only on this machine: the record is
 * in the app's settings, not in the workspace folder, so a shared workspace
 * cannot switch anything on for itself.
 */
export default function PluginsPage({ layout, onOpenDock, apps }: { layout: WorkbenchLayout; onOpenDock?: (dock: Dock) => void; apps: WorkspaceApp[] }) {
  const { plugins } = usePlugins();
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const filtered = plugins.filter((p) => !q || p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q));
  const filteredApps = apps.filter((a) => !q || a.folder.toLowerCase().includes(q));

  return (
    <div>
      <p className="flex items-start gap-1.5 text-xs leading-5 text-[var(--ink-secondary)]">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--accent-strong)]" />
        Built-ins are trusted Neuron code. Workspace apps run as capability-scoped HTML apps in an isolated webview.
      </p>
      <label className="relative mt-3 block w-full max-w-xs">
        <span className="sr-only">Search plugins</span>
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--ink-muted)]" />
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search plugins" className="pl-8" />
      </label>

      <div className="mt-4">
        {filtered.length + filteredApps.length > 0 ? (
          <div className="divide-y divide-[var(--divider)] overflow-hidden rounded-md border border-[var(--divider)]">
            {filtered.map((manifest) => <PluginRow key={manifest.id} manifest={manifest} layout={layout} onOpenDock={onOpenDock} />)}
            {filteredApps.map((app) => <AppRow key={app.folder} app={app} />)}
          </div>
        ) : (
          <p className="py-12 text-center text-sm text-[var(--ink-muted)]">No plugins match your search.</p>
        )}

        <div className="mt-4 flex items-center gap-3 rounded-md border border-dashed border-[var(--divider)] p-4">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-[var(--divider)] bg-[var(--surface)] text-[var(--ink-muted)]">
            <PackagePlus className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-[var(--ink)]">Add a workspace app</h3>
            <p className="mt-1 text-xs leading-5 text-[var(--ink-secondary)]">Copy a folder containing <code>index.html</code> and <code>neuron.app.json</code> into <code>plugins/</code>. It runs as an isolated HTML app, never as renderer code.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
