import { TerminalSquare } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
import { formatChord } from '../lib/keybindings';
import type { WorkbenchLayout } from '../lib/layout';
import { useTerminalToggle } from '../lib/useTerminalToggle';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

interface StatusBarProps {
  activeNote: string | null;
  saveState: SaveState;
  layout: WorkbenchLayout;
  onLayoutChange: (patch: Partial<WorkbenchLayout>) => void;
  onOpenPlugins: () => void;
  /** The chord that does the same as the terminal button, for its tooltip. */
  terminalChord: string;
}

const saveText: Record<SaveState, string> = {
  idle: 'Ready',
  saving: 'Saving…',
  saved: 'Saved locally',
  error: 'Save failed',
};

// No workspace name here: the switcher in the toolbar and the explorer heading
// already say which workspace is open, and a third copy was one too many.
export default function StatusBar({ activeNote, saveState, layout, onLayoutChange, onOpenPlugins, terminalChord }: StatusBarProps) {
  const terminal = useTerminalToggle(layout, onLayoutChange, onOpenPlugins);
  const label = !terminal.enabled ? 'Enable the Terminal plugin' : terminal.visible ? 'Hide terminal' : 'Show terminal';
  return (
    <footer className="status-bar flex select-none items-center justify-between px-3 font-sans text-xs text-[var(--ink-muted)]">
      <div className="flex min-w-0 items-center gap-3">
        {activeNote && (
          <span className={`flex items-center gap-1.5 ${saveState === 'error' ? 'text-[var(--danger)]' : ''}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${saveState === 'error' ? 'bg-[var(--danger)]' : saveState === 'saving' ? 'bg-[var(--warning)]' : 'bg-[var(--positive)]'}`} />
            {saveText[saveState]}
          </span>
        )}
      </div>
      <div className="flex items-center gap-3">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={terminal.toggle}
              aria-label={label}
              aria-pressed={terminal.visible}
              className="interactive grid h-5 w-5 place-items-center rounded text-[var(--ink-muted)] hover:bg-[var(--surface-hover)]"
            >
              <TerminalSquare size={14} />
            </button>
          </TooltipTrigger>
          <TooltipContent>{terminal.enabled ? `${label} (${formatChord(terminalChord)})` : label}</TooltipContent>
        </Tooltip>
        <span>UTF-8</span>
        <span>Markdown</span>
      </div>
    </footer>
  );
}
