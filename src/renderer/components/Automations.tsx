import { useEffect, useState } from 'react';
import { Play, Plus, Trash2, Zap } from 'lucide-react';
import { HIDDEN_CHARS_REFUSAL, isRunnableCommand, runAutomationInTerminal } from '../lib/terminal-bus';

interface Automation {
  id: string;
  name: string;
  commands: string[];
}

const STORE_KEY = 'automations';

/** Named command sequences run in the visible workspace terminal. */
export default function Automations() {
  const [items, setItems] = useState<Automation[]>([]);
  const [name, setName] = useState('');
  const [body, setBody] = useState('');
  const [notice, setNotice] = useState('Output appears in the workspace terminal.');

  useEffect(() => {
    void window.electronAPI?.settings.get<Automation[]>(STORE_KEY).then((saved) => {
      if (Array.isArray(saved)) setItems(saved);
    });
  }, []);

  const persist = async (next: Automation[]) => {
    setItems(next);
    await window.electronAPI?.settings.set(STORE_KEY, next);
  };

  // Lines are kept as typed, not trimmed: trim() would drop a leading U+FEFF and
  // the rule is to refuse hidden characters visibly (isRunnableCommand).
  const add = () => {
    const lines = body.split(/\r?\n/);
    const commands = lines.filter((l) => l.trim().length > 0);
    if (!name.trim() || commands.length === 0) return;
    const bad = lines.findIndex((line) => line.trim().length > 0 && !isRunnableCommand(line));
    if (bad >= 0) {
      setNotice(`Line ${bad + 1}: ${HIDDEN_CHARS_REFUSAL}`);
      return;
    }
    void persist([...items, { id: `${Date.now()}`, name: name.trim(), commands }]);
    setName('');
    setBody('');
  };

  const remove = (id: string) => void persist(items.filter((a) => a.id !== id));

  // A saved automation can still hold a bad line (settings synced or edited by
  // hand), so the whole list is checked again here, and refused as one.
  const run = (automation: Automation) => {
    setNotice(runAutomationInTerminal(automation.commands)
      ? `${automation.name} sent to the workspace terminal.`
      : `${automation.name}: ${HIDDEN_CHARS_REFUSAL} Nothing was sent.`);
  };

  return (
    <div className="nav-surface flex h-full flex-col font-sans">
      <header className="pane-header flex items-center gap-2 border-b px-3 text-accent">
        <Zap className="h-4 w-4" />
        <span className="text-xs font-medium text-primary">Automations</span>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* List + editor */}
        <div className="flex w-1/2 flex-col border-r divider-color">
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {items.length === 0 && <p className="px-2 py-4 text-center text-xs text-[var(--ink-muted)]">No automations yet. Add one below.</p>}
            {items.map((a) => (
              <div key={a.id} className="note-row group mb-1 flex items-center gap-2 rounded-md px-2 py-1.5">
                <button onClick={() => run(a)} className="interactive grid h-7 w-7 place-items-center rounded text-[var(--accent-strong)] hover:bg-[var(--surface-hover)]" title={`Run ${a.name}`} aria-label={`Run ${a.name}`}>
                  <Play className="h-3.5 w-3.5" />
                </button>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium text-[var(--ink)]">{a.name}</div>
                  <div className="truncate font-mono text-[10px] text-[var(--ink-muted)]">{a.commands.join(' · ')}</div>
                  {!a.commands.every(isRunnableCommand) && (
                    <div className="text-[10px] text-[var(--danger)]">{HIDDEN_CHARS_REFUSAL}</div>
                  )}
                </div>
                <button onClick={() => remove(a.id)} className="interactive grid h-7 w-7 place-items-center rounded text-[var(--ink-muted)] opacity-0 hover:text-[var(--danger)] group-hover:opacity-100" title="Delete" aria-label={`Delete ${a.name}`}>
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
          <div className="border-t divider-color p-2">
            <input className="field mb-1.5 py-1.5 text-xs" placeholder="Automation name" value={name} onChange={(e) => setName(e.target.value)} />
            <textarea className="field mb-1.5 h-20 resize-none py-1.5 font-mono text-[11px]" placeholder="One command per line, e.g.&#10;npm run build&#10;git status" value={body} onChange={(e) => setBody(e.target.value)} />
            <button onClick={add} className="interactive flex w-full items-center justify-center gap-1.5 rounded-md bg-[var(--accent)] py-1.5 text-xs font-semibold text-[var(--canvas)]">
              <Plus className="h-3.5 w-3.5" /> Add automation
            </button>
          </div>
        </div>

        <div className="w-1/2 overflow-y-auto bg-[var(--canvas)] p-2 text-xs">
          <p role="status" className="px-2 py-4 text-center text-[var(--ink-muted)]">{notice}</p>
        </div>
      </div>
    </div>
  );
}
