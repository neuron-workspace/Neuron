import { useState } from 'react';
import { Plug, ShieldCheck } from 'lucide-react';
import { usePlugins } from '../plugins/host';
import type { Connector } from '../plugins/connectors';
import { Input } from '../components/ui/input';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';

export function ConnectorBadge({ status }: { status: 'connected' | 'not-set-up' }) {
  return status === 'connected' ? <Badge variant="default">Connected</Badge> : <Badge variant="outline">Not set up</Badge>;
}

function ConnectorForm({ connector, onDone }: { connector: Connector; onDone: () => void }) {
  const { connectorValues, savedSecrets, saveConnector } = usePlugins();
  const saved = savedSecrets(connector.id);
  const [values, setValues] = useState<Record<string, string>>(() => ({ ...connectorValues(connector.id) }));
  // A saved secret is never shown or read back. The field appears only once
  // the person asks to replace it.
  const [replacing, setReplacing] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    await saveConnector(connector.id, values);
    // The typed secret does not stay in renderer state once it is stored.
    setValues({});
    setSaving(false);
    onDone();
  };
  return (
    <form className="mt-3 space-y-3 border-t border-[var(--divider)] pt-3" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      {connector.fields.map((field) => {
        const id = `connector-${connector.id}-${field.key}`;
        const secretSaved = field.type === 'password' && saved[field.key] && !replacing[field.key];
        return (
          <div key={field.key} className="space-y-1">
            <label className="text-[11px] font-medium text-[var(--ink-secondary)]" htmlFor={secretSaved ? undefined : id}>{field.label}</label>
            {secretSaved ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-[var(--ink-secondary)]">Saved</span>
                <Button type="button" size="sm" variant="outline" onClick={() => setReplacing((prev) => ({ ...prev, [field.key]: true }))}>Replace</Button>
              </div>
            ) : (
              <Input
                id={id}
                type={field.type === 'password' ? 'password' : 'text'}
                autoComplete="off"
                placeholder={field.placeholder}
                value={values[field.key] ?? ''}
                onChange={(e) => setValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
              />
            )}
            {field.description && <p className="text-[10px] leading-4 text-[var(--ink-muted)]">{field.description}</p>}
          </div>
        );
      })}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={saving}>Save</Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>Cancel</Button>
      </div>
    </form>
  );
}

function ConnectorRow({ connector }: { connector: Connector }) {
  const { connectorStatus, disconnect } = usePlugins();
  const [editing, setEditing] = useState(false);
  const status = connectorStatus(connector.id);
  return (
    <div className="p-4" data-connector={connector.id}>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-md border border-[var(--divider)] bg-[var(--surface)] text-[var(--accent-strong)]">
          <Plug className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-[var(--ink)]">{connector.name}</h3>
            <ConnectorBadge status={status} />
          </div>
          <p className="mt-1 text-xs leading-5 text-[var(--ink-secondary)]">{connector.description}</p>
        </div>
        {!editing && (
          <div className="flex shrink-0 gap-2">
            {status === 'connected' ? (
              <>
                <Button size="sm" variant="outline" onClick={() => setEditing(true)} aria-label={`Change ${connector.name}`}>Change</Button>
                <Button size="sm" variant="ghost" onClick={() => void disconnect(connector.id)} aria-label={`Disconnect ${connector.name}`}>Disconnect</Button>
              </>
            ) : (
              <Button size="sm" variant="outline" onClick={() => setEditing(true)} aria-label={`Set up ${connector.name}`}>Set up</Button>
            )}
          </div>
        )}
      </div>
      {editing && <ConnectorForm connector={connector} onDone={() => setEditing(false)} />}
    </div>
  );
}

/** The Connectors section of the Settings window: services set up once, for every workspace. */
export default function ConnectorsPage() {
  const { connectors } = usePlugins();
  return (
    <div>
      <p className="flex items-start gap-1.5 text-xs leading-5 text-[var(--ink-secondary)]">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--accent-strong)]" />
        Keys are kept by the desktop app and are never shown again. A workspace uses a connector only through a plugin that is on in that workspace.
      </p>
      <div className="mt-6 divide-y divide-[var(--divider)] overflow-hidden rounded-md border border-[var(--divider)]">
        {connectors.map((connector) => <ConnectorRow key={connector.id} connector={connector} />)}
      </div>
    </div>
  );
}
